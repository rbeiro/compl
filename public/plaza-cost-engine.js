/**
 * Pure arithmetic for the Plaza workbook snapshot. No network or storage access.
 *
 * API:
 *   calculateDish(data, recipeId, options)
 *   calculateAllDishes(data, options)
 *   calculateSubrecipe(data, subrecipeId, options)
 *   calculateAllSubrecipes(data, options)
 *   getStandardPrice(data, group, options)
 *
 * options = {
 *   lineOverrides: { [lineId]: { quantity, yield } },
 *   standardPrices: { [literalGroup]: pricePerPurchaseUnit },
 *   referencePrices: { [partNumber]: pricePerPurchaseUnit },
 *   subrecipeWeights: { [subrecipeId]: measuredFinalGrams },
 *   portions: desiredProductionPortions
 * }
 * An absent override preserves the source; null/empty explicitly clears it.
 * An empty yield means 1, as in the workbook; 0 and >1 are invalid.
 * Price overrides never invent a missing product reference or purchase unit.
 * All prices and costs stay at full floating-point precision until presentation.
 */

export const ENGINE_VERSION = '1.0.0';
export const COST_STATES = Object.freeze(['complete', 'provisional', 'pending', 'empty']);

const own = (object, key) => object != null && Object.prototype.hasOwnProperty.call(object, key);
const blank = value => value == null || (typeof value === 'string' && value.trim() === '');
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const normalize = value => String(value ?? '').trim().toLocaleLowerCase('es');
const unique = values => [...new Set(values.filter(Boolean))];
const validPurchaseUnits = new Set(['kg', 'litro', 'unidad', 'manojo']);

/** Parse a decimal input without coercing blanks/booleans to zero. */
export function numericInput(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(input)) return null;
  const parsed = Number(input.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Excel's cost convention, including its explicit 1 g = 1 ml assumption.
 * This is deliberately not a physical density calculation.
 */
export function conversionFactor(recipeUnit, purchaseUnit) {
  const from = normalize(recipeUnit), to = normalize(purchaseUnit);
  if (!from || !to) return null;
  if (from === to) return 1;
  if ((to === 'kg' || to === 'litro') && (from === 'g' || from === 'ml')) return 0.001;
  if ((to === 'kg' || to === 'litro') && (from === 'kg' || from === 'litro')) return 1;
  return null;
}

function calculationGrams(quantity, unit) {
  if (!positive(quantity)) return null;
  const name = normalize(unit);
  if (name === 'g' || name === 'ml') return quantity;
  if (name === 'kg' || name === 'litro') return quantity * 1000;
  return null;
}

function indexRows(rows, key) {
  const map = new Map();
  for (const row of rows ?? []) {
    const value = row[key];
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  }
  return map;
}

function contextFor(data, options = {}) {
  return {
    data, options: options ?? {},
    recipes: indexRows(data.recipes, 'id'),
    ingredients: indexRows(data.ingredients, 'recipeId'),
    tariffs: indexRows(data.tariffs, 'reference'),
    standards: indexRows(data.standards, 'group'),
    subrecipes: indexRows(data.subrecipes, 'id'),
    subingredients: indexRows(data.subrecipeIngredients, 'subrecipeId'),
    subrecipeResults: new Map()
  };
}

function issue(code, message, blocking = true, extra = {}) {
  return { code, message, blocking, ...extra };
}

function issueSummary(issues) {
  return {
    issues,
    missing: issues.filter(item => item.blocking),
    warnings: issues.filter(item => !item.blocking),
    reasons: unique(issues.map(item => item.message))
  };
}

function selectedOverride(map, key) {
  return own(map, key) ? { exists: true, value: map[key] } : { exists: false, value: undefined };
}

function tariffPrice(ctx, reference, group = null) {
  const matches = ctx.tariffs.get(reference) ?? [];
  if (!reference || matches.length !== 1) {
    return {
      reference: reference || null, group, unit: null, unitPrice: null,
      status: 'pending', simulated: false, tariff: null,
      priceKey: group ? `standard:${group}` : reference ? `reference:${reference}` : null,
      issues: [issue('reference_missing', matches.length > 1 ? 'La referencia de compra está duplicada.' : 'Falta una referencia de compra válida.')]
    };
  }
  const tariff = matches[0], unit = tariff.unit;
  const issues = [];
  if (!validPurchaseUnits.has(normalize(unit))) issues.push(issue('purchase_unit_missing', 'Falta una unidad de compra válida.'));
  const amount = numericInput(tariff.currentAmount), billedBase = numericInput(tariff.billedBase);
  let unitPrice = null, status = 'pending', method = tariff.pricingMethod || 'amountOverBilledBase';

  if (tariff.control === 'Lista' && positive(amount) && positive(billedBase)) {
    unitPrice = amount / billedBase;
    status = 'complete';
  } else if (tariff.control === 'Provisional' && method === 'provisionalHistoricalPriceOverComparableWeight') {
    // The Font bread exception uses the documented HISTORICAL amount, not its
    // newer currentAmount. An absent billedBase must never be guessed.
    const historical = numericInput(tariff.provisionalInputs?.historicalAmount);
    const comparisonWeight = numericInput(tariff.provisionalInputs?.comparisonWeightKg);
    if (positive(historical) && positive(comparisonWeight)) {
      unitPrice = historical / comparisonWeight;
      status = 'provisional';
      issues.push(issue('historical_price', 'Tarifa provisional: importe histórico y peso de un formato comparable; falta confirmar el peso de la caja vigente.', false));
    }
  }

  const shared = group != null ? selectedOverride(ctx.options.standardPrices, group) : { exists: false };
  const byReference = selectedOverride(ctx.options.referencePrices, reference);
  const override = shared.exists ? shared : byReference;
  const simulated = override.exists;
  if (override.exists) {
    const changedPrice = numericInput(override.value);
    unitPrice = positive(changedPrice) ? changedPrice : null;
    method = shared.exists ? 'manualStandardPrice' : 'manualReferencePrice';
    if (unitPrice !== null && status === 'pending') {
      status = 'provisional';
      issues.push(issue('manual_price_unverified_base', 'Precio normalizado introducido en la simulación; la tarifa de origen todavía requiere comprobación.', false));
    }
    if (unitPrice === null) issues.push(issue('price_missing', 'Introduce un precio normalizado mayor que cero.'));
  }

  if (unitPrice === null && !issues.some(item => item.code === 'price_missing')) {
    if (!positive(amount)) issues.push(issue('price_missing', 'Falta un importe de compra válido.'));
    else if (!positive(billedBase)) issues.push(issue('purchase_base_missing', 'Falta la base facturada para normalizar la tarifa.'));
    else issues.push(issue('price_pending', 'La tarifa de compra está pendiente de validación.'));
  }
  if (issues.some(item => item.blocking)) status = 'pending';
  return {
    reference, group, tariff, unit: unit || null, unitPrice,
    status, simulated, method,
    priceKey: group != null ? `standard:${group}` : `reference:${reference}`,
    issues
  };
}

function standardPrice(ctx, group) {
  const matches = ctx.standards.get(group) ?? [];
  if (!group || matches.length !== 1) {
    return {
      group: group || null, reference: null, unit: null, unitPrice: null,
      status: 'pending', simulated: false, tariff: null,
      priceKey: group ? `standard:${group}` : null,
      issues: [issue('standard_missing', !group ? 'Falta vincular el ingrediente a un estándar de compra.' : matches.length > 1 ? 'El estándar de compra está duplicado.' : 'Falta seleccionar una referencia para este estándar.')]
    };
  }
  const standard = matches[0];
  if (!['Disponible', 'Pendiente de tarifa'].includes(standard.status)) {
    return {
      group, standard, reference: standard.selectedReference || null, unit: null, unitPrice: null,
      status: 'pending', simulated: false, tariff: null, priceKey: `standard:${group}`,
      issues: [issue('standard_unresolved', 'Falta confirmar una referencia válida para este estándar.')]
    };
  }
  const result = tariffPrice(ctx, standard.selectedReference, group);
  if (result.tariff && result.tariff.group !== group) {
    result.status = 'pending';
    result.issues.push(issue('standard_group_mismatch', 'La referencia elegida no pertenece al estándar.'));
    result.unitPrice = null;
  }
  return { ...result, standard };
}

/** Resolve a shared standard price with the same rules used by every dish. */
export function getStandardPrice(data, group, options = {}) {
  const result = standardPrice(contextFor(data, options), group);
  return { ...result, ...issueSummary(result.issues) };
}

function computeLine(ctx, source, isSubrecipeIngredient = false) {
  const override = ctx.options.lineOverrides?.[source.id] ?? {};
  const quantityInput = own(override, 'quantity') ? override.quantity : source.quantity;
  const yieldInput = own(override, 'yield') ? override.yield : own(override, 'yieldFactor') ? override.yieldFactor : source.yieldFactor;
  const quantity = numericInput(quantityInput);
  const parsedYield = blank(yieldInput) ? 1 : numericInput(yieldInput);
  const effectiveYield = positive(parsedYield) && parsedYield <= 1 ? parsedYield : null;
  const issues = [];
  const kind = isSubrecipeIngredient ? 'Estándar' : source.linkType;
  const key = isSubrecipeIngredient ? source.group : source.key;
  const changed = own(override, 'quantity') || own(override, 'yield') || own(override, 'yieldFactor');
  const base = {
    ...source, sourceStatus: source.status || null, originalStatus: source.status || null,
    quantityInput, yieldInput: blank(yieldInput) ? null : yieldInput,
    quantity, yieldFactor: blank(yieldInput) ? null : parsedYield, effectiveYield,
    linkType: kind, key, standardGroup: kind === 'Estándar' ? key || null : null,
    quantityChanged: own(override, 'quantity'), yieldChanged: own(override, 'yield') || own(override, 'yieldFactor'),
    simulated: changed, source: source.source
  };
  if (kind === 'Excluir del coste') {
    return {
      ...base, status: 'excluded', statusLabel: 'Excluida', excluded: true,
      appliedReference: null, purchaseUnit: null, purchaseQuantity: null, unitPrice: null,
      cost: 0, lineCost: 0, conversion: null, priceKey: null,
      ...issueSummary([issue('excluded', source.note || 'Ingrediente excluido expresamente del coste en el libro.', false, { lineId: source.id, ingredient: source.name })])
    };
  }
  if (!source.name) issues.push(issue('ingredient_name_missing', 'Falta el nombre del ingrediente.'));
  if (!positive(quantity)) issues.push(issue('quantity_missing', 'Falta una cantidad de receta mayor que cero.'));
  if (!source.unit || !kind || !key) issues.push(issue('link_missing', 'Falta unidad o vínculo de compra.'));
  if (effectiveYield === null) issues.push(issue('yield_invalid', 'El rendimiento debe ser mayor que 0 y menor o igual que 1; vacío equivale a 1.'));

  let pricing;
  if (kind === 'Estándar') pricing = standardPrice(ctx, key);
  else if (kind === 'Referencia') pricing = tariffPrice(ctx, key);
  else if (kind === 'Subreceta') {
    const subrecipe = computeSubrecipe(ctx, key);
    const usable = subrecipe.status !== 'pending' && subrecipe.status !== 'empty' && positive(subrecipe.costPerKg);
    pricing = {
      reference: subrecipe.found ? key : null,
      unit: subrecipe.found ? 'Kg' : null,
      unitPrice: usable ? subrecipe.costPerKg : null,
      status: usable ? subrecipe.status : 'pending',
      simulated: subrecipe.simulated,
      priceKey: `subrecipe:${key}`, subrecipe,
      issues: subrecipe.issues.map(item => ({ ...item, subrecipeId: key }))
    };
    if (!usable && !pricing.issues.some(item => item.blocking)) pricing.issues.push(issue('subrecipe_cost_missing', 'La subreceta no tiene un coste por kg completo.'));
  } else {
    pricing = { reference: null, unit: null, unitPrice: null, status: 'pending', simulated: false,
      priceKey: null, issues: [issue('link_invalid', 'El tipo de vínculo de compra no es válido.')] };
  }
  issues.push(...pricing.issues);
  const factor = conversionFactor(source.unit, pricing.unit);
  if (source.unit && pricing.unit && factor === null) issues.push(issue('unit_incompatible', 'Las unidades de receta y compra son incompatibles.'));
  const calculatedPurchase = positive(quantity) && positive(factor) && effectiveYield !== null ? quantity * factor / effectiveYield : null;
  const purchaseQuantity = finite(calculatedPurchase) ? calculatedPurchase : null;
  if (calculatedPurchase !== null && purchaseQuantity === null) issues.push(issue('numeric_overflow', 'La cantidad excede el intervalo calculable.'));
  const calculatedCost = finite(purchaseQuantity) && positive(pricing.unitPrice) ? purchaseQuantity * pricing.unitPrice : null;
  if (calculatedCost !== null && !finite(calculatedCost)) issues.push(issue('numeric_overflow', 'El coste excede el intervalo calculable.'));
  const hasBlocking = issues.some(item => item.blocking);
  const status = hasBlocking ? 'pending' : pricing.status === 'provisional' ? 'provisional' : 'complete';
  const cost = status !== 'pending' && finite(calculatedCost) ? calculatedCost : null;
  const lineIssues = issues.map(item => ({ ...item, lineId: source.id, ingredient: source.name }));
  return {
    ...base, status, statusLabel: status === 'complete' ? 'Lista' : status === 'provisional' ? 'Provisional' : pendingLineLabel(lineIssues),
    excluded: false, appliedReference: pricing.reference, purchaseUnit: pricing.unit,
    purchaseQuantity, unitPrice: pricing.unitPrice, conversion: factor,
    cost, lineCost: cost, priceKey: pricing.priceKey, priceMethod: pricing.method || (kind === 'Subreceta' ? 'subrecipe' : null),
    subrecipeId: kind === 'Subreceta' ? key : null,
    simulated: changed || pricing.simulated,
    ...issueSummary(lineIssues)
  };
}

function pendingLineLabel(issues) {
  const codes = new Set(issues.filter(item => item.blocking).map(item => item.code));
  if (codes.has('ingredient_name_missing')) return 'Falta ingrediente';
  if (codes.has('quantity_missing')) return 'Falta cantidad';
  if (codes.has('link_missing')) return 'Falta unidad o vínculo';
  if (codes.has('reference_missing') || codes.has('standard_missing') || codes.has('standard_unresolved') || codes.has('standard_group_mismatch')) return 'Revisar referencia';
  if (codes.has('yield_invalid')) return 'Revisar rendimiento';
  if (codes.has('unit_incompatible')) return 'Unidad incompatible';
  return 'Tarifa pendiente';
}

function sumKnown(lines) {
  const known = lines.filter(line => finite(line.cost));
  return known.length ? known.reduce((sum, line) => sum + line.cost, 0) : null;
}

function computeSubrecipe(ctx, id) {
  if (ctx.subrecipeResults.has(id)) return ctx.subrecipeResults.get(id);
  const matches = ctx.subrecipes.get(id) ?? [];
  if (matches.length !== 1) {
    const missing = {
      id, found: false, name: '', status: 'pending', statusLabel: 'Revisar subreceta',
      lines: [], knownCost: null, batchCost: null, costPerKg: null, knownCostPerKg: null,
      initialWeightGrams: null, expectedWeightGrams: null, actualWeightGrams: null, appliedWeightGrams: null,
      pendingCount: 0, provisionalCount: 0, simulated: false,
      ...issueSummary([issue('subrecipe_missing', 'Falta una subreceta válida y única.')])
    };
    ctx.subrecipeResults.set(id, missing);
    return missing;
  }
  const source = matches[0];
  const lines = (ctx.subingredients.get(id) ?? []).map(row => computeLine(ctx, row, true));
  const issues = lines.flatMap(line => line.issues);
  if (!lines.length) issues.push(issue('subrecipe_empty', 'La subreceta no tiene ingredientes.'));
  const weights = lines.map(line => calculationGrams(line.quantity, line.unit));
  const initialWeightGrams = lines.length && weights.every(finite) ? weights.reduce((a, b) => a + b, 0) : null;
  const rule = source.yieldRule;
  const ruleValue = numericInput(rule?.value);
  let estimatedLossGrams = null;
  if (rule?.kind === 'butterRecovery' && positive(ruleValue) && ruleValue <= 1) {
    const butter = lines.map((line, index) => ({ line, weight: weights[index] })).filter(item => item.line.standardGroup === 'Mantequilla');
    if (butter.length === 1 && finite(butter[0].weight)) estimatedLossGrams = butter[0].weight * (1 - ruleValue);
  } else if (rule?.kind === 'batchLoss' && finite(ruleValue) && ruleValue >= 0 && ruleValue < 1 && finite(initialWeightGrams)) {
    estimatedLossGrams = initialWeightGrams * ruleValue;
  }
  const expectedWeightGrams = finite(initialWeightGrams) && finite(estimatedLossGrams) ? initialWeightGrams - estimatedLossGrams : null;
  const weightOverride = selectedOverride(ctx.options.subrecipeWeights, id);
  const actualInput = weightOverride.exists ? weightOverride.value : source.actualWeightGrams;
  const hasActual = !blank(actualInput);
  const actualWeightGrams = hasActual ? numericInput(actualInput) : null;
  const appliedWeightGrams = hasActual ? positive(actualWeightGrams) ? actualWeightGrams : null : positive(expectedWeightGrams) ? expectedWeightGrams : null;
  const weightBasis = positive(actualWeightGrams) ? 'measured' : !hasActual && positive(expectedWeightGrams) ? 'estimated' : 'missing';
  if (appliedWeightGrams === null) issues.push(issue('subrecipe_weight_invalid', 'Falta un peso final válido para calcular el coste por kg.'));
  else if (weightBasis === 'estimated') issues.push(issue('subrecipe_weight_estimated', 'Peso final estimado del libro; falta pesar el lote terminado.', false));
  const knownCost = sumKnown(lines);
  const pendingCount = lines.filter(line => line.status === 'pending').length;
  const provisionalCount = lines.filter(line => line.status === 'provisional').length;
  const batchCost = lines.length && !pendingCount ? knownCost : null;
  const costPerKg = finite(batchCost) && positive(appliedWeightGrams) ? 1000 * batchCost / appliedWeightGrams : null;
  const status = !lines.length ? 'empty' : issues.some(item => item.blocking) ? 'pending' : weightBasis === 'estimated' || provisionalCount ? 'provisional' : 'complete';
  const result = {
    ...source, id, found: true, sourceStatus: source.status, originalStatus: source.status, lines,
    status, statusLabel: status === 'complete' ? 'Confirmado' : status === 'provisional' ? 'Provisional' : status === 'empty' ? 'Sin ingredientes' : 'Revisar subreceta',
    knownCost, baseCost: batchCost, batchCost, costPerKg,
    knownCostPerKg: finite(knownCost) && positive(appliedWeightGrams) ? 1000 * knownCost / appliedWeightGrams : null,
    initialWeightGrams, estimatedLossGrams, expectedWeightGrams, actualWeightGrams, appliedWeightGrams,
    weightBasis, yieldConfirmed: weightBasis === 'measured', actualWeightInput: actualInput ?? null,
    pendingCount, provisionalCount, knownCount: lines.filter(line => finite(line.cost) && !line.excluded).length,
    simulated: weightOverride.exists || lines.some(line => line.simulated),
    ...issueSummary(issues)
  };
  ctx.subrecipeResults.set(id, result);
  return result;
}

export function calculateSubrecipe(data, subrecipeId, options = {}) {
  return computeSubrecipe(contextFor(data, options), typeof subrecipeId === 'object' ? subrecipeId.id : subrecipeId);
}

export function calculateAllSubrecipes(data, options = {}) {
  const ctx = contextFor(data, options);
  return (data.subrecipes ?? []).map(row => computeSubrecipe(ctx, row.id));
}

function computeDish(ctx, recipeId) {
  const matches = ctx.recipes.get(recipeId) ?? [];
  const source = matches[0] || { id: recipeId, name: '', portions: null };
  const lines = (ctx.ingredients.get(recipeId) ?? []).map(row => computeLine(ctx, row));
  const issues = lines.flatMap(line => line.issues.filter(item => item.code !== 'excluded'));
  if (matches.length !== 1) issues.push(issue('recipe_missing', 'Falta un ID de receta válido y único.'));
  if (!source.name) issues.push(issue('recipe_name_missing', 'Falta el nombre del plato.'));
  if (!lines.length) issues.push(issue('recipe_empty', 'El plato no tiene ingredientes registrados.'));
  const baseServings = numericInput(source.portions);
  if (lines.length && !positive(baseServings)) issues.push(issue('base_servings_missing', 'Faltan las raciones de la receta base.'));
  const portionsInput = own(ctx.options, 'portions') ? ctx.options.portions : baseServings;
  const parsedPortions = numericInput(portionsInput);
  const portions = positive(parsedPortions) ? parsedPortions : null;
  const scale = positive(baseServings) && positive(portions) ? portions / baseServings : null;
  const productionError = own(ctx.options, 'portions') && portions === null ? 'Introduce un número de raciones a producir mayor que cero.' : null;
  const knownCost = sumKnown(lines);
  const pendingCount = lines.filter(line => line.status === 'pending').length;
  const provisionalCount = lines.filter(line => line.status === 'provisional').length;
  const structuralValid = matches.length === 1 && Boolean(source.name);
  const baseCost = lines.length && !pendingCount && structuralValid ? knownCost : null;
  const knownPerServing = finite(knownCost) && positive(baseServings) ? knownCost / baseServings : null;
  const costPerServing = finite(baseCost) && positive(baseServings) ? baseCost / baseServings : null;
  const status = !lines.length ? 'empty' : issues.some(item => item.blocking) ? 'pending' : provisionalCount ? 'provisional' : 'complete';
  const statusLabel = status === 'empty' ? 'Sin ingredientes' : status === 'pending' ? pendingCount ? 'Revisar ingredientes' : 'Faltan raciones' : status === 'provisional' ? 'Coste provisional' : 'Completa';
  const scaledLines = lines.map(line => ({
    ...line,
    costPerServing: finite(line.cost) && positive(baseServings) ? line.cost / baseServings : null,
    costPerPortion: finite(line.cost) && positive(baseServings) ? line.cost / baseServings : null,
    batchQuantity: finite(line.quantity) && finite(scale) ? line.quantity * scale : null,
    batchPurchaseQuantity: finite(line.purchaseQuantity) && finite(scale) ? line.purchaseQuantity * scale : null,
    batchCost: finite(line.cost) && finite(scale) ? line.cost * scale : null
  }));
  return {
    ...source, id: recipeId, found: matches.length === 1, sourceStatus: source.status || null, originalStatus: source.status || null,
    status, statusLabel, completeness: status, lines: scaledLines,
    baseServings, portions, portionsInput, scale, productionValid: productionError === null && scale !== null, productionError,
    knownCost, knownSubtotal: pendingCount > 0 ? knownCost : null,
    baseCost, totalCost: baseCost,
    knownPerServing, knownPerPortion: knownPerServing,
    costPerServing, costPerPortion: costPerServing,
    knownBatchCost: finite(knownPerServing) && positive(portions) ? knownPerServing * portions : null,
    batchCost: finite(costPerServing) && positive(portions) ? costPerServing * portions : null,
    pendingCount, provisionalCount, lineCount: lines.length,
    excludedCount: lines.filter(line => line.excluded).length,
    knownCount: lines.filter(line => finite(line.cost) && !line.excluded).length,
    simulated: lines.some(line => line.simulated) || (own(ctx.options, 'portions') && portions !== baseServings),
    ...issueSummary(issues)
  };
}

/** Compute base recipe values and the scaled production batch independently. */
export function calculateDish(data, recipeId, options = {}) {
  return computeDish(contextFor(data, options), typeof recipeId === 'object' ? recipeId.id : recipeId);
}

export function calculateAllDishes(data, options = {}) {
  const ctx = contextFor(data, options);
  return (data.recipes ?? []).map(row => computeDish(ctx, row.id));
}

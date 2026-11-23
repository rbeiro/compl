// Quantities belong to a base recipe. Purchase prices are for one stated purchase unit.
const groups = [
  ['mass', 1, 'g', 'gr', 'grs', 'gramo', 'gramos', 'grama', 'gramas', 'gram', 'grams'],
  ['mass', 1000, 'kg', 'kgs', 'kilo', 'kilos', 'kilogramo', 'kilogramos', 'quilograma', 'quilogramas'],
  ['volume', 1, 'ml', 'mililitro', 'mililitros'],
  ['volume', 10, 'cl', 'centilitro', 'centilitros'],
  ['volume', 100, 'dl', 'decilitro', 'decilitros'],
  ['volume', 1000, 'l', 'lt', 'lts', 'litro', 'litros', 'litre', 'liter'],
  ['count', 1, 'ud', 'uds', 'un', 'u', 'unidad', 'unidades', 'unidade', 'unit', 'units']
];
const units = new Map();
for (const [group, factor, ...names] of groups) {
  for (const name of names) units.set(name, {group, factor});
}
function unitInfo(unit) {
  const key = String(unit ?? '').normalize('NFKC').trim().toLowerCase().replace(/\.$/, '');
  return key ? (units.get(key) || {group:key, factor:1}) : null;
}
export function numericInput(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const text = String(value ?? '').trim();
  if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(text)) return null;
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export function defaultCostSettings(rows) {
  return {servings:1, baseServings:1, salePrice:null, ingredients:(rows || []).map(item=>{
    const unit = String(item.unidad ?? '').trim();
    return {name:String(item.nombre ?? '').trim(), quantity:numericInput(item.cantidad), unit, price:null, priceUnit:unit};
  }).filter(item=>item.name)};
}
export function costFigures(settings) {
  const base = numericInput(settings.baseServings);
  const servings = numericInput(settings.servings);
  const sale = numericInput(settings.salePrice);
  const rows = settings.ingredients.map(item=>{
    const unit = unitInfo(item.unit), purchaseUnit = unitInfo(item.priceUnit);
    const price = numericInput(item.price), quantity = numericInput(item.quantity);
    const forOne = base > 0 && quantity !== null ? quantity / base : null;
    const batchQuantity = forOne !== null && servings > 0 ? forOne * servings : null;
    const perServing = unit && purchaseUnit && unit.group === purchaseUnit.group && forOne !== null && price !== null
      ? forOne * unit.factor / purchaseUnit.factor * price : null;
    return {batchQuantity, perServing, total:perServing !== null && servings > 0 ? perServing * servings : null};
  });
  const complete = rows.length > 0 && rows.every(row=>row.perServing !== null);
  const perServing = complete ? rows.reduce((sum,row)=>sum+row.perServing,0) : null;
  return {rows, complete, perServing, total:complete && servings > 0 ? perServing * servings : null, sale,
    margin:complete && sale !== null ? sale - perServing : null,
    percentage:complete && sale > 0 ? perServing / sale * 100 : null};
}
export function unitsCompatible(a,b) {
  const left=unitInfo(a), right=unitInfo(b);
  return Boolean(left && right && left.group === right.group);
}

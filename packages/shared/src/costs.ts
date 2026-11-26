// Recipe costing (port of legacy workspace-cost-math.js). Quantities belong to
// a base recipe of `baseServings` portions; purchase prices are for one stated
// purchase unit, without VAT.

export type CostIngredient = {
  name: string;
  quantity: number | null;
  unit: string;
  price: number | null;
  priceUnit: string;
};
export type CostSettings = {
  servings: number | null;
  baseServings: number | null;
  salePrice: number | null;
  ingredients: CostIngredient[];
};
export type CostLine = { batchQuantity: number | null; perServing: number | null; total: number | null };
export type CostFigures = {
  rows: CostLine[];
  complete: boolean;
  perServing: number | null;
  total: number | null;
  sale: number | null;
  margin: number | null;
  percentage: number | null;
};

const groups: [string, number, ...string[]][] = [
  ["mass", 1, "g", "gr", "grs", "gramo", "gramos", "grama", "gramas", "gram", "grams"],
  ["mass", 1000, "kg", "kgs", "kilo", "kilos", "kilogramo", "kilogramos", "quilograma", "quilogramas"],
  ["volume", 1, "ml", "mililitro", "mililitros"],
  ["volume", 10, "cl", "centilitro", "centilitros"],
  ["volume", 100, "dl", "decilitro", "decilitros"],
  ["volume", 1000, "l", "lt", "lts", "litro", "litros", "litre", "liter"],
  ["count", 1, "ud", "uds", "un", "u", "unidad", "unidades", "unidade", "unit", "units"],
];
const units = new Map<string, { group: string; factor: number }>();
for (const [group, factor, ...names] of groups) for (const name of names) units.set(name, { group, factor });

function unitInfo(unit: unknown) {
  const key = String(unit ?? "").normalize("NFKC").trim().toLowerCase().replace(/\.$/, "");
  return key ? (units.get(key) ?? { group: key, factor: 1 }) : null;
}

/** A non-negative number from a number or a "1,5"/"1.5" string; null otherwise. */
export function numericInput(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const text = String(value ?? "").trim();
  if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(text)) return null;
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** First cost sheet of a recipe, from its ingredient rows (`nombre`, `cantidad`, `unidad`). */
export function defaultCostSettings(rows: { nombre?: unknown; cantidad?: unknown; unidad?: unknown }[] | null | undefined): CostSettings {
  return {
    servings: 1,
    baseServings: 1,
    salePrice: null,
    ingredients: (rows ?? [])
      .map((item) => {
        const unit = String(item.unidad ?? "").trim();
        return { name: String(item.nombre ?? "").trim(), quantity: numericInput(item.cantidad), unit, price: null, priceUnit: unit };
      })
      .filter((item) => item.name),
  };
}

export function costFigures(settings: CostSettings): CostFigures {
  const base = numericInput(settings.baseServings);
  const servings = numericInput(settings.servings);
  const sale = numericInput(settings.salePrice);
  const rows = settings.ingredients.map((item) => {
    const unit = unitInfo(item.unit);
    const purchaseUnit = unitInfo(item.priceUnit);
    const price = numericInput(item.price);
    const quantity = numericInput(item.quantity);
    const forOne = base !== null && base > 0 && quantity !== null ? quantity / base : null;
    const batchQuantity = forOne !== null && servings !== null && servings > 0 ? forOne * servings : null;
    const perServing =
      unit && purchaseUnit && unit.group === purchaseUnit.group && forOne !== null && price !== null
        ? ((forOne * unit.factor) / purchaseUnit.factor) * price
        : null;
    return { batchQuantity, perServing, total: perServing !== null && servings !== null && servings > 0 ? perServing * servings : null };
  });
  const complete = rows.length > 0 && rows.every((row) => row.perServing !== null);
  const perServing = complete ? rows.reduce((sum, row) => sum + row.perServing!, 0) : null;
  return {
    rows,
    complete,
    perServing,
    total: complete && servings !== null && servings > 0 ? perServing! * servings : null,
    sale,
    margin: complete && sale !== null ? sale - perServing! : null,
    percentage: complete && sale !== null && sale > 0 ? (perServing! / sale) * 100 : null,
  };
}

export function unitsCompatible(a: unknown, b: unknown) {
  const left = unitInfo(a);
  const right = unitInfo(b);
  return Boolean(left && right && left.group === right.group);
}

/** Purchase units of the Plaza tariffs and the recipe units they can be used with (legacy tariff-picker.js). */
export function quantityUnits(unit: string): string[] {
  return ({ Kg: ["g", "Kg"], Litro: ["ml", "Litro"], Unidad: ["Unidad"], Manojo: ["Manojo"] } as Record<string, string[]>)[unit] ?? [];
}

/** Two-decimal display value of an exact amount (legacy cost-precision.js keeps the exact value behind it). */
export const displayAmount = (n: number) => String(Math.round((n + Number.EPSILON) * 100) / 100);

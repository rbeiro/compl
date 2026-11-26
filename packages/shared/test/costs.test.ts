import { describe, expect, it } from "vitest";
import { costFigures, defaultCostSettings, numericInput, unitsCompatible } from "../src/costs.js";

describe("cost engine", () => {
  it("reads numbers like the legacy inputs", () => {
    expect(numericInput("1,5")).toBe(1.5);
    expect(numericInput(".5")).toBe(0.5);
    expect(numericInput("-1")).toBeNull();
    expect(numericInput("1e3")).toBeNull();
  });

  it("scales a base recipe to the batch and converts purchase units", () => {
    const figures = costFigures({
      servings: 4,
      baseServings: 2,
      salePrice: 10,
      ingredients: [
        { name: "Arroz", quantity: 200, unit: "g", price: 2.5, priceUnit: "kg" },
        { name: "Caldo", quantity: 1, unit: "l", price: 0.4, priceUnit: "dl" },
      ],
    });
    expect(figures.complete).toBe(true);
    expect(figures.rows[0]).toMatchObject({ batchQuantity: 400 });
    expect(figures.perServing).toBeCloseTo(0.25 + 2, 6);
    expect(figures.total).toBeCloseTo(9, 6);
    expect(figures.margin).toBeCloseTo(7.75, 6);
    expect(figures.percentage).toBeCloseTo(22.5, 6);
  });

  it("is incomplete when a price or a compatible unit is missing", () => {
    const figures = costFigures({
      servings: 1,
      baseServings: 1,
      salePrice: null,
      ingredients: [{ name: "Sal", quantity: 2, unit: "g", price: 1, priceUnit: "ud" }],
    });
    expect(figures).toMatchObject({ complete: false, perServing: null, total: null, percentage: null });
    expect(unitsCompatible("Kg", "gramos")).toBe(true);
  });

  it("starts from the recipe sheet's ingredients", () => {
    expect(defaultCostSettings([{ nombre: " Arroz ", cantidad: "160", unidad: "g" }, { nombre: "" }])).toEqual({
      servings: 1,
      baseServings: 1,
      salePrice: null,
      ingredients: [{ name: "Arroz", quantity: 160, unit: "g", price: null, priceUnit: "g" }],
    });
  });
});

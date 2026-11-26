import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLAZA_TEMPLATE } from "../src/routes/costs.js";
import { setupApp } from "./fixtures.js";

const { app, pool, store, createUser, addStaff, tokenFor, close } = await setupApp();
const H = "hotel-costes", O = "enoteca", G = "arroz";
let chef: string, staff: string, artsChef: string;

const call = (token: string, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
const settings = {
  servings: 4,
  baseServings: 2,
  salePrice: 18,
  ingredients: [{ name: "Arroz", quantity: 160, unit: "g", price: 2.5, priceUnit: "kg" }],
};

beforeAll(async () => {
  const [c, s, a] = await Promise.all([
    createUser("costes.chef@compichef.com"),
    createUser("costes.staff@compichef.com"),
    createUser("costes.arts@compichef.com"),
  ]);
  await addStaff(c!, H, 1);
  await addStaff(s!, H, 3);
  await addStaff(a!, PLAZA_TEMPLATE.hotel, 1);
  chef = await tokenFor(c!, { aal: "aal2" });
  staff = await tokenFor(s!);
  artsChef = await tokenFor(a!, { aal: "aal2" });
  await pool.query(`insert into public.compi_arts_outlets (hotel_key, outlet_key, hotel, outlet) values ($1, $2, 'Hotel Costes', 'Enoteca')`, [H, O]);
  await pool.query(
    `insert into public.compi_arts_guides (hotel_key, outlet_key, guide_key, hotel, outlet, title, guide_state)
     values ($1, $2, $3, 'Hotel Costes', 'Enoteca', 'Arroz', 'ready')`,
    [H, O, G],
  );
  // A source only counts when its Word and PDF files are validated.
  await pool.query(
    `insert into compi_private.arts_validated_files (hotel_key, outlet_key, guide_key, format, digest)
     values ($1, $2, $3, 'docx', $4), ($1, $2, $3, 'pdf', $4)`,
    [H, O, G, "0".repeat(64)],
  );
  await pool.query(
    `insert into compi_private.arts_guide_sources (hotel_key, outlet_key, guide_key, revision, source, docx_sha, pdf_sha)
     values ($1, $2, $3, $4, $5, $6, $6)`,
    [H, O, G, randomUUID(), { data: { ingredientes: [{ nombre: "Arroz bomba", cantidad: "160", unidad: "g" }] } }, "0".repeat(64)],
  );
});
afterAll(close);

describe("recipe costs", () => {
  const path = `/v1/guides/${H}/${O}/${G}/cost`;

  it("is for the executive chef only", async () => {
    expect((await call(staff, "GET", path)).status).toBe(403);
  });

  it("starts from the recipe's ingredients, then saves with revisions", async () => {
    const first = (await (await call(chef, "GET", path)).json()) as any;
    expect(first).toMatchObject({ revision: null, settings: null });
    expect(first.ingredientes[0]).toMatchObject({ nombre: "Arroz bomba" });

    const saved = await call(chef, "PUT", path, { settings, previous: null });
    expect(saved.status).toBe(200);
    const { revision } = (await saved.json()) as { revision: string };
    expect((await call(chef, "PUT", path, { settings: { ...settings, servings: 6 }, previous: null })).status).toBe(409);
    expect((await call(chef, "PUT", path, { settings: { ...settings, servings: 6 }, previous: revision })).status).toBe(200);
    expect((await call(chef, "PUT", path, { settings: { ...settings, servings: 0 }, previous: revision })).status).toBe(422);

    const overview = (await (await call(chef, "POST", "/v1/costs/overview", { guides: [{ h: H, o: O, g: G }] })).json()) as any;
    expect(overview.items[0]).toMatchObject({ guideKey: G, settings: { servings: 6 }, ingredientCount: 1 });
  });

  it("serves the Plaza template to the Hotel Arts executive chef", async () => {
    expect((await call(chef, "GET", "/v1/costs/plaza")).status).toBe(403);
    expect((await call(artsChef, "GET", "/v1/costs/plaza")).status).toBe(404);
    await store.put(PLAZA_TEMPLATE.bucket, PLAZA_TEMPLATE.key, new TextEncoder().encode('{"recipes":[]}'), "application/json");
    const res = await call(artsChef, "GET", "/v1/costs/plaza");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recipes: [] });
  });
});

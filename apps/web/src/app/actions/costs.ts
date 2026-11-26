"use server";

import type { components } from "@compi/api-client";
import { getApi } from "@/lib/api";

// Recipe costing (legacy workspace-costs.js / cost-book.js) through the API.

export type CostSettings = components["schemas"]["CostSettings"];
export type RecipeCost = components["schemas"]["RecipeCost"];
export type CostResult<T> = { ok: true; data: T } | { ok: false; conflict?: boolean };

const key = /^[a-z0-9-]{1,200}$/;
const valid = (...keys: string[]) => keys.every((k) => key.test(k));

export async function loadCost(h: string, o: string, g: string): Promise<CostResult<RecipeCost>> {
  const api = await getApi();
  if (!api || !valid(h, o, g)) return { ok: false };
  try {
    const { data } = await api.GET("/v1/guides/{h}/{o}/{g}/cost", { params: { path: { h, o, g } } });
    return data ? { ok: true, data } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function saveCost(h: string, o: string, g: string, settings: CostSettings, previous: string | null): Promise<CostResult<string>> {
  const api = await getApi();
  if (!api || !valid(h, o, g)) return { ok: false };
  try {
    const { data, response } = await api.PUT("/v1/guides/{h}/{o}/{g}/cost", { params: { path: { h, o, g } }, body: { settings, previous } });
    return data ? { ok: true, data: data.revision } : { ok: false, conflict: response.status === 409 };
  } catch {
    return { ok: false };
  }
}

export type CostIndex = { hotelKey: string; outletKey: string; guideKey: string; settings: CostSettings | null; ingredientCount: number | null };

/** Cost status of many recipes, 200 at a time (legacy readIndex). Null when it could not be read. */
export async function costOverview(guides: { h: string; o: string; g: string }[]): Promise<CostIndex[] | null> {
  const api = await getApi();
  if (!api || !guides.every((x) => valid(x.h, x.o, x.g))) return null;
  const items: CostIndex[] = [];
  try {
    for (let start = 0; start < guides.length; start += 200) {
      const batch = guides.slice(start, start + 200);
      const { data } = await api.POST("/v1/costs/overview", { body: { guides: batch } });
      if (!data || data.items.length !== batch.length) return null;
      items.push(...data.items);
    }
    return items;
  } catch {
    return null;
  }
}

/** The Plaza template (Hotel Arts executive chef). Null when unavailable. */
export async function loadPlazaTemplate(): Promise<Record<string, unknown> | null> {
  const api = await getApi();
  if (!api) return null;
  try {
    const { data } = await api.GET("/v1/costs/plaza");
    return (data as Record<string, unknown> | undefined) ?? null;
  } catch {
    return null;
  }
}

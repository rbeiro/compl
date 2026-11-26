"use server";

import { getApi } from "@/lib/api";
import { catalogError } from "@/lib/catalog-errors";

// Editing the archive (legacy management.js folderControls / guideControls).
// Errors are keys of the "ArchiveEdit" namespace (legacy `info(error)`).

export type CatalogResult = { ok: true; key?: string } | { ok: false; error: string };

const key = /^[a-z0-9-]{1,200}$/;
type Api = NonNullable<Awaited<ReturnType<typeof getApi>>>;
async function run(keys: string[], call: (api: Api) => Promise<{ data?: unknown; error?: unknown; response: Response }>): Promise<CatalogResult> {
  if (!keys.every((k) => key.test(k))) return { ok: false, error: "gone" };
  const api = await getApi();
  if (!api) return { ok: false, error: "sessionExpired" };
  try {
    const { data, error, response } = await call(api);
    if (response.ok) return { ok: true, key: (data as { key?: string } | undefined)?.key };
    return { ok: false, error: catalogError(response.status, error) };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function createOutlet(h: string, name: string) {
  return run([h], (api) => api.POST("/v1/hotels/{h}/outlets", { params: { path: { h } }, body: { name } }));
}
export async function renameOutlet(h: string, o: string, name: string) {
  return run([h, o], (api) => api.PATCH("/v1/hotels/{h}/outlets/{o}", { params: { path: { h, o } }, body: { name } }));
}
export async function deleteOutlet(h: string, o: string) {
  return run([h, o], (api) => api.DELETE("/v1/hotels/{h}/outlets/{o}", { params: { path: { h, o } } }));
}
export async function createGuide(h: string, o: string, name: string) {
  return run([h, o], (api) => api.POST("/v1/hotels/{h}/outlets/{o}/guides", { params: { path: { h, o } }, body: { name } }));
}
export async function renameGuide(h: string, o: string, g: string, name: string) {
  return run([h, o, g], (api) => api.PATCH("/v1/guides/{h}/{o}/{g}", { params: { path: { h, o, g } }, body: { name } }));
}
export async function publishGuide(h: string, o: string, g: string) {
  return run([h, o, g], (api) => api.POST("/v1/guides/{h}/{o}/{g}/publish", { params: { path: { h, o, g } } }));
}
export async function deleteGuide(h: string, o: string, g: string) {
  return run([h, o, g], (api) => api.DELETE("/v1/guides/{h}/{o}/{g}", { params: { path: { h, o, g } } }));
}

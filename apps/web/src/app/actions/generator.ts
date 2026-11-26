"use server";

import { getApi } from "@/lib/api";

// Recipe generator drafts and document brand (small requests). Large ones
// (documents, assistant) go through /api/generator.

const key = /^[a-z0-9-]{1,200}$/;
type Result<T> = { ok: true; data: T } | { ok: false; status: number; detail?: string };

async function run<T>(keys: string[], call: (api: NonNullable<Awaited<ReturnType<typeof getApi>>>) => Promise<{ data?: unknown; error?: unknown; response: Response }>): Promise<Result<T>> {
  if (!keys.every((k) => key.test(k))) return { ok: false, status: 404 };
  const api = await getApi();
  if (!api) return { ok: false, status: 401 };
  try {
    const { data, error, response } = await call(api);
    if (response.ok) return { ok: true, data: data as T };
    return { ok: false, status: response.status, detail: (error as { error?: { detail?: string } } | undefined)?.error?.detail };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function reserveDraft(h: string, o: string, ticket: string, label: string, fingerprint: string) {
  return run<{ key: string }>([h, o], (api) => api.POST("/v1/outlets/{h}/{o}/drafts", { params: { path: { h, o } }, body: { ticket, label, fingerprint } }));
}

export async function saveSource(h: string, o: string, g: string, body: { source: Record<string, unknown>; docx: string; pdf: string; previous: string | null }) {
  return run<{ revision: string }>([h, o, g], (api) => api.PUT("/v1/guides/{h}/{o}/{g}/source", { params: { path: { h, o, g } }, body }));
}

export type Brand = { accent: string; logo_png: string | null; configured: boolean; revision: number };

export async function loadBrand(h: string) {
  return run<Brand>([h], (api) => api.GET("/v1/hotels/{h}/brand", { params: { path: { h } } }));
}

export async function saveBrand(h: string, accent: string, logo: string | null, expectedRevision: number) {
  return run<Brand>([h], (api) =>
    api.PUT("/v1/hotels/{h}/brand", { params: { path: { h } }, body: { accent, logo_png: logo, expected_revision: expectedRevision } }),
  );
}

"use server";

import { getApi } from "@/lib/api";

const key = /^[a-z0-9-]{1,200}$/;
const valid = (h: string, o: string, g: string) => key.test(h) && key.test(o) && key.test(g);
const fileUrl = (h: string, o: string, g: string, rest: string) => `/api/guides/${h}/${o}/${g}/${rest}`;

export type GuideStep = { accion: string; control?: string | null };
export type GuideData = { pasos?: GuideStep[]; pase?: string; racion?: string; version?: string; [key: string]: unknown };
export type LoadedGuide = { data: GuideData; approvedUrl: string | null; cleanUrl: string | null; failed?: boolean };

/**
 * Everything the plating view shows for one guide (legacy workspace-plating.js
 * `select`): its structured data and image, falling back to what the stored
 * Word file contains for published guides without them.
 */
export async function loadGuide(input: {
  h: string; o: string; g: string; state: string; hasSource: boolean; hasImage: boolean; hasCleanImage: boolean;
}): Promise<LoadedGuide> {
  const { h, o, g } = input;
  const api = await getApi();
  if (!api || !valid(h, o, g)) return { data: { pasos: [] }, approvedUrl: null, cleanUrl: null, failed: true };
  try {
    const params = { path: { h, o, g } };
    const detail = input.hasSource ? (await api.GET("/v1/guides/{h}/{o}/{g}", { params })).data : null;
    let data: GuideData = (detail?.data as GuideData | null) ?? { pasos: [] };
    let approvedUrl = input.hasImage ? fileUrl(h, o, g, "media/approved") : null;
    const needsSteps = !data.pasos?.length;
    if (input.state === "ready" && (!approvedUrl || needsSteps)) {
      const legacy = (await api.GET("/v1/guides/{h}/{o}/{g}/legacy", { params })).data;
      if (legacy?.data) {
        const legacyData = legacy.data as GuideData;
        if (!detail?.data) data = legacyData;
        else if (needsSteps && legacyData.pasos?.length) data = { ...data, pasos: legacyData.pasos };
        if (!approvedUrl && legacy.hasImage) approvedUrl = fileUrl(h, o, g, "legacy/image");
      }
    }
    return { data, approvedUrl, cleanUrl: input.hasCleanImage ? fileUrl(h, o, g, "media/clean") : null };
  } catch {
    return { data: { pasos: [] }, approvedUrl: null, cleanUrl: null, failed: true };
  }
}

/** Marks a guide as reviewed (per user). Null when it could not be saved. */
export async function setReviewed(h: string, o: string, g: string, reviewed: boolean): Promise<boolean | null> {
  const api = await getApi();
  if (!api || !valid(h, o, g)) return null;
  const { data } = await api.PUT("/v1/guides/{h}/{o}/{g}/review", { params: { path: { h, o, g } }, body: { reviewed } });
  return data ? data.reviewed : null;
}

/** Current brand revision of a hotel's documents (null when unavailable). */
export async function brandRevision(h: string): Promise<number | null> {
  const api = await getApi();
  if (!api || !key.test(h)) return null;
  const { data } = await api.GET("/v1/hotels/{h}/brand/revision", { params: { path: { h } } });
  return data ? data.revision : null;
}

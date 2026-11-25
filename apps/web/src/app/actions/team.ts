"use server";

import type { components } from "@compi/api-client";
import { getApi } from "@/lib/api";

// Team management (legacy management.js). Errors come back as keys of the
// "Team" namespace, following legacy `info(error)`.

export type StaffMember = components["schemas"]["StaffMember"];
export type CreatedAccount = components["schemas"]["CreatedAccount"];
export type TeamResult<T> = { ok: true; data: T } | { ok: false; error: string };

const hotelKey = /^[a-z0-9-]{1,200}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Database messages (Spanish source text) → "Team" keys.
const known: Record<string, string> = {
  "Rango inválido": "errRank",
  "Otro usuario ha modificado el rango": "errRankChanged",
  "Debe quedar un administrador activo en el hotel": "errLastAdmin",
  "Operación inválida": "errOperation",
  "El empleado ya está activo o retirado. Actualiza la lista.": "errActiveOrWithdrawn",
  "La invitación ha cambiado. Actualiza la lista.": "errInvitationChanged",
  "Utiliza Reenviar invitación.": "errUseResend",
  "Revisa el nombre, el apellido, el puesto, el outlet y el rango.": "errRegistration",
  "El rango ha cambiado. Actualiza la lista.": "errAccessRankChanged",
  "Este empleado aún no ha activado su cuenta.": "errNotActivated",
  "Indica el estado del acceso": "errAccessState",
  "El acceso debe seguir retirado. Actualiza la lista.": "errStillWithdrawn",
  "Demasiadas cuentas creadas. Inténtalo más tarde.": "tooMany",
};

function errorKey(status: number, body: unknown) {
  const error = (body as { error?: { code?: string; detail?: string } } | undefined)?.error;
  if (error?.code === "already_created") return "alreadyCreated";
  if (status === 429) return "tooMany";
  if (status === 401) return "sessionExpired";
  if (status === 403) return "forbidden";
  if (error?.detail && known[error.detail]) return known[error.detail]!;
  // A conflict without a rule message is a duplicate email or name (legacy 23505).
  if (status === 409 && error?.code === "conflict" && !error.detail) return "duplicate";
  if (status === 409) return "changed";
  if (status === 404) return "gone";
  if (status === 422) return "fileInvalid";
  return "failed";
}

type Api = NonNullable<Awaited<ReturnType<typeof getApi>>>;
async function run<T>(h: string, call: (api: Api) => Promise<{ data?: unknown; error?: unknown; response: Response }>): Promise<TeamResult<T>> {
  if (!hotelKey.test(h)) return { ok: false, error: "failed" };
  const api = await getApi();
  if (!api) return { ok: false, error: "sessionExpired" };
  try {
    const { data, error, response } = await call(api);
    if (response.ok) return { ok: true, data: (data ?? null) as T };
    return { ok: false, error: errorKey(response.status, error) };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function loadStaff(h: string) {
  return run<{ items: StaffMember[] }>(h, (api) => api.GET("/v1/hotels/{h}/staff", { params: { path: { h } } }));
}

export async function registerEmployee(
  h: string,
  input: { requestId: string; givenName: string; surname: string; position: string; outlet: string; rank: 2 | 3 },
) {
  if (!uuid.test(input.requestId)) return { ok: false, error: "failed" } as TeamResult<CreatedAccount>;
  return run<CreatedAccount>(h, (api) => api.POST("/v1/hotels/{h}/staff", { params: { path: { h } }, body: input }));
}

export async function changeRank(h: string, id: string, rank: number, previous: number) {
  return run<null>(h, (api) => api.PUT("/v1/hotels/{h}/staff/{id}/rank", { params: { path: { h, id } }, body: { rank, previous } }));
}

export async function setAccess(h: string, id: string, enabled: boolean, expectedRank: number) {
  return run<null>(h, (api) =>
    api.PUT("/v1/hotels/{h}/staff/{id}/access", { params: { path: { h, id } }, body: { enabled, expectedRank } }),
  );
}

export async function deleteEmployee(h: string, id: string, withdrawnAt: string | null) {
  return run<null>(h, (api) =>
    api.DELETE("/v1/hotels/{h}/staff/{id}", { params: { path: { h, id }, query: withdrawnAt ? { withdrawnAt } : {} } }),
  );
}

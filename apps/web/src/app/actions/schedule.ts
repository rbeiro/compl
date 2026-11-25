"use server";

import { getApi } from "@/lib/api";
import type { components } from "@compi/api-client";

// Schedules (legacy horarios.js). Rules live in the database; errors come back
// as message keys of the "Schedule" namespace, plus the HTTP status (409 means
// "changed elsewhere": the client reloads).

export type ScheduleView = components["schemas"]["ScheduleView"];
export type ScheduleResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

const hotelKey = /^[a-z0-9-]{1,200}$/;
const known: Record<string, string> = {
  "Introduce una hora de entrada y otra de salida distintas.": "errTimes",
  "El empleado tiene vacaciones aprobadas para ese día.": "errOnLeave",
  "El turno ha cambiado. Revisa el cuadrante actualizado.": "errShiftChanged",
  "El saldo ha cambiado. Revisa la tabla actualizada.": "errBalanceChanged",
  "Hay días que ya has solicitado. Revisa la selección.": "errAlreadyRequested",
  "La selección supera los 45 días disponibles en un año.": "errOverYear",
  "Esta solicitud ya tiene una decisión.": "errDecided",
};

/** Legacy horarios.js `message(error)`. */
function errorKey(status: number, body: unknown) {
  const detail = (body as { error?: { detail?: string } } | undefined)?.error?.detail;
  if (detail && known[detail]) return known[detail];
  if (status === 403) return "forbidden";
  if (status === 401) return "sessionExpired";
  return "failed";
}

type Api = NonNullable<Awaited<ReturnType<typeof getApi>>>;
async function run<T>(h: string, call: (api: Api) => Promise<{ data?: unknown; error?: unknown; response: Response }>) {
  if (!hotelKey.test(h)) return { ok: false, error: "failed", status: 400 } as ScheduleResult<T>;
  const api = await getApi();
  if (!api) return { ok: false, error: "sessionExpired", status: 401 } as ScheduleResult<T>;
  try {
    const { data, error, response } = await call(api);
    if (response.ok) return { ok: true, data: (data ?? null) as T } as ScheduleResult<T>;
    return { ok: false, error: errorKey(response.status, error), status: response.status } as ScheduleResult<T>;
  } catch {
    return { ok: false, error: "failed", status: 0 } as ScheduleResult<T>;
  }
}

export async function loadSchedule(h: string, month: string, department: string | null) {
  return run<ScheduleView>(h, (api) =>
    api.GET("/v1/hotels/{h}/schedule", {
      params: { path: { h }, query: { month, ...(department ? { department } : {}) } },
    }),
  );
}

export async function editShift(
  h: string,
  employee: string,
  day: string,
  shift: { kind: "work" | "off" | "clear"; start: string | null; end: string | null; previous: string | null },
) {
  return run<null>(h, (api) =>
    api.PUT("/v1/hotels/{h}/schedule/shifts/{employee}/{day}", { params: { path: { h, employee, day } }, body: shift }),
  );
}

export async function setBalance(h: string, employee: string, month: string, minutes: number, previous: string | null) {
  return run<null>(h, (api) =>
    api.PUT("/v1/hotels/{h}/schedule/balances/{employee}/{month}", {
      params: { path: { h, employee, month } },
      body: { minutes, previous },
    }),
  );
}

export async function requestLeave(h: string, id: string, days: string[]) {
  return run<null>(h, (api) => api.PUT("/v1/hotels/{h}/schedule/leave/{id}", { params: { path: { h, id } }, body: { days } }));
}

export async function decideLeave(h: string, id: string, decision: "approved" | "rejected") {
  return run<null>(h, (api) =>
    api.PUT("/v1/hotels/{h}/schedule/leave/{id}/decision", { params: { path: { h, id } }, body: { decision } }),
  );
}

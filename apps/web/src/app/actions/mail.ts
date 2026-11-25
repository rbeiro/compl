"use server";

import { getApi } from "@/lib/api";

// Internal mail (legacy mailbox.js). The rules live in the database; these
// actions only forward to the API and turn its errors into message keys of the
// "Mail" namespace for the client to show.

export type MailEntry = {
  id: string;
  origin: "inbox" | "sent" | "drafts";
  folder: string | null;
  starred: boolean;
  unread: boolean;
  sender: string;
  recipients: string;
  subject: string;
  updated_at: string;
  snippet?: string | null;
};
export type MailItem = MailEntry & { body: string; revision: number };
export type Mailbox = {
  address: string;
  folders: { id: string; label: string }[];
  entries: MailEntry[];
  item: MailItem | null;
};
export type MailResult<T> = { ok: true; data: T } | { ok: false; error: string };

const hotelKey = /^[a-z0-9-]{1,200}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Database messages (Spanish source text) → keys of the "Mail" namespace.
const known: Record<string, string> = {
  "Carpeta no disponible.": "folderGone",
  "Correo no disponible.": "messageGone",
  "Elige un nombre de carpeta distinto de las bandejas base (1–60 caracteres).": "folderNameInvalid",
  "Solo puedes eliminar una carpeta personal propia.": "ownFolderOnly",
  "El correo supera la longitud permitida.": "tooLong",
  "El borrador cambió en otra pestaña. Ábrelo de nuevo antes de guardar.": "draftChanged",
  "El borrador ya no está disponible.": "draftGone",
  "Usa hasta 12 direcciones internas @compichef.com, separadas por comas.": "recipientsFormat",
  "Hay un destinatario sin buzón activo en este hotel. Revisa las direcciones.": "recipientInactive",
  "Completa destinatario, asunto y mensaje.": "incomplete",
};

type ApiFailure = { error?: { code?: string; detail?: string } } | undefined;

/** Legacy mailbox.js `message(error)`. */
function errorKey(status: number, body: ApiFailure) {
  if (status === 403) return "noMailbox";
  if (status === 401) return "sessionExpired";
  const detail = body?.error?.detail;
  if (detail && known[detail]) return known[detail];
  // Only creating a folder with a name already in use conflicts without a message.
  if (status === 409) return "folderExists";
  if (status === 404) return "gone";
  return "failed";
}

async function run<T>(
  h: string,
  call: (api: NonNullable<Awaited<ReturnType<typeof getApi>>>) => Promise<{ data?: unknown; error?: unknown; response: Response }>,
): Promise<MailResult<T>> {
  if (!hotelKey.test(h)) return { ok: false, error: "failed" };
  const api = await getApi();
  if (!api) return { ok: false, error: "sessionExpired" };
  try {
    const { data, error, response } = await call(api);
    if (response.ok) return { ok: true, data: (data ?? null) as T };
    return { ok: false, error: errorKey(response.status, error as ApiFailure) };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function readMailbox(h: string, box: string, page: number, item?: string): Promise<MailResult<Mailbox>> {
  if (item && !uuid.test(item)) return { ok: false, error: "gone" };
  return run(h, (api) =>
    api.GET("/v1/hotels/{h}/mail", {
      params: { path: { h }, query: { box, page: Math.max(0, Math.trunc(page)), ...(item ? { item } : {}) } },
    }),
  );
}

export async function saveMessage(
  h: string,
  id: string,
  draft: { to: string; subject: string; body: string; revision: number; send: boolean },
): Promise<MailResult<{ id: string; revision?: number; sent: boolean }>> {
  if (!uuid.test(id)) return { ok: false, error: "failed" };
  return run(h, (api) => api.PUT("/v1/hotels/{h}/mail/messages/{id}", { params: { path: { h, id } }, body: draft }));
}

export type MessageAction = { action: "star"; value: boolean } | { action: "read" } | { action: "move"; folder: string | null };

export async function changeMessage(h: string, id: string, action: MessageAction): Promise<MailResult<null>> {
  if (!uuid.test(id)) return { ok: false, error: "gone" };
  return run(h, (api) => api.POST("/v1/hotels/{h}/mail/messages/{id}/actions", { params: { path: { h, id } }, body: action }));
}

export async function createFolder(h: string, label: string): Promise<MailResult<{ id: string }>> {
  return run(h, (api) => api.POST("/v1/hotels/{h}/mail/folders", { params: { path: { h } }, body: { label } }));
}

export async function deleteFolder(h: string, folder: string): Promise<MailResult<null>> {
  if (!uuid.test(folder)) return { ok: false, error: "gone" };
  return run(h, (api) => api.DELETE("/v1/hotels/{h}/mail/folders/{folder}", { params: { path: { h, folder } } }));
}

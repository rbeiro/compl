// Archive editing errors → keys of the "ArchiveEdit" namespace (legacy management.js `info()`).

const known: Record<string, string> = {
  "Nombre inválido": "errName",
  "Carpeta no disponible": "errFolder",
  "Valida y sube tanto el Word como el PDF antes de publicar.": "errPublish",
  "El archivo ha cambiado. Vuelve a abrir la ficha.": "errFileChanged",
};

/** Legacy management.js `info()`. Also used for upload responses. */
export function catalogError(status: number, body: unknown): string {
  const detail = (body as { error?: { detail?: string } } | null)?.error?.detail;
  if (status === 401) return "sessionExpired";
  if (status === 403) return "forbidden";
  if (detail && known[detail]) return known[detail]!;
  if (status === 409) return "changed";
  if (status === 404) return "gone";
  if (status === 413 || status === 422) return "fileInvalid";
  return "failed";
}


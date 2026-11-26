export class ServiceError extends Error {
  constructor(code, status = 422, plan) {
    super(code);
    this.code = code;
    this.status = status;
    this.plan = plan;
  }
}

export function boundedText(value, max, required = true) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw new ServiceError('invalid_input');
  const text = value.trim();
  if (required && !text) throw new ServiceError('invalid_input');
  return text;
}

export function dish(data) {
  const name = boundedText(data.name, 120);
  if (!Array.isArray(data.ingredients) || !data.ingredients.length || data.ingredients.length > 40) throw new ServiceError('invalid_input');
  const ingredients = data.ingredients.map(item => ({
    nombre: boundedText(item?.nombre, 120),
    cantidad: boundedText(item?.cantidad ?? '', 40, false),
    unidad: boundedText(item?.unidad ?? '', 40, false)
  }));
  return {name,ingredients};
}

const maxImageBytes = 10 * 1024 * 1024;
export function imageBytes(encoded, pngOnly = false) {
  if (typeof encoded !== 'string' || encoded.length > 4 * Math.ceil(maxImageBytes / 3)) throw new ServiceError('invalid_image', 413);
  if (encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new ServiceError('unsupported_image');
  let raw;
  try { raw = atob(encoded); } catch { throw new ServiceError('unsupported_image'); }
  if (raw.length > maxImageBytes) throw new ServiceError('invalid_image', 413);
  const png = raw.startsWith('\x89PNG\r\n\x1a\n');
  const jpeg = raw.startsWith('\xff\xd8\xff');
  const webp = raw.startsWith('RIFF') && raw.slice(8,12) === 'WEBP';
  const heif = raw.slice(4,8) === 'ftyp' && /heic|heix|hevc|hevx|mif1|msf1/.test(raw.slice(8,64));
  if (pngOnly ? !png : !(png || jpeg || webp || heif)) throw new ServiceError('unsupported_image');
  const bytes = new Uint8Array(raw.length);
  for (let i=0; i<raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function safePlan(input) {
  const point = p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n) && n >= 0 && n <= 1);
  if (!Array.isArray(input) || input.length < 1 || input.length > 40) throw new ServiceError('invalid_plan');
  return input.map(item => {
    if (typeof item?.text !== 'string' || !item.text.trim() || item.text.length > 200 ||
        item.text.split('\n').length > 3 || /[\u0000-\u0009\u000b-\u001f\u007f]/u.test(item.text) ||
        !point(item.xy) || !Array.isArray(item.arrow) || item.arrow.length !== 4 || !item.arrow.every(point)) throw new ServiceError('invalid_plan');
    return {text:item.text.trim(), xy:item.xy, arrow:item.arrow};
  });
}

export function deadlines(...signals) {
  return AbortSignal.any(signals.filter(Boolean));
}

export async function readJson(stream, limit, signal, inputError = 'invalid_input') {
  const reader = stream?.getReader();
  if (!reader) throw new ServiceError(inputError);
  let timeout = false;
  const abort = () => { timeout = true; void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort',abort,{once:true});
  const chunks = [];
  let size = 0;
  try {
    if (signal.aborted) abort();
    while (!timeout) {
      const {value,done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { void reader.cancel().catch(() => {}); throw new ServiceError('payload_too_large',413); }
      chunks.push(value);
    }
    if (timeout) throw new ServiceError('timeout',504);
    try { return JSON.parse(await new Blob(chunks).text()); }
    catch { throw new ServiceError(inputError); }
  } finally {
    signal.removeEventListener('abort',abort);
    reader.releaseLock();
  }
}


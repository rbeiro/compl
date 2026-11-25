// Port of mediaType() from the legacy guide-files.ts: recognises the image
// formats each source slot may hold from the file's leading bytes.
export class InvalidMedia extends Error {}

const ascii = (data: Uint8Array, from: number, to: number) => String.fromCharCode(...data.subarray(from, to));

export function mediaType(slot: string, data: Uint8Array): string {
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => data[i] === value);
  const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
  const webp = ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 12) === "WEBP";
  if (slot === "original" && webp) return "image/webp";
  if (slot === "original" && data.length >= 16 && ascii(data, 4, 8) === "ftyp") {
    const boxLength = new DataView(data.buffer, data.byteOffset, 4).getUint32(0);
    if (boxLength >= 16 && boxLength <= data.length && boxLength <= 65536) {
      const brands = [ascii(data, 8, 12)];
      for (let i = 16; i + 4 <= boxLength; i += 4) brands.push(ascii(data, i, i + 4));
      if (brands.some((b) => ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"].includes(b))) return "image/heic";
      if (!brands.some((b) => ["avif", "avis"].includes(b)) && brands.some((b) => ["mif1", "msf1"].includes(b))) return "image/heif";
    }
  }
  if (["photo", "original"].includes(slot) && jpeg) return "image/jpeg";
  if (slot !== "photo" && png) return "image/png";
  throw new InvalidMedia("No se ha podido leer la fotografía.");
}

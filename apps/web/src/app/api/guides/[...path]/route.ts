import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { ACCESS_COOKIE } from "@/lib/session-cookies";
import { serverEnv } from "@/lib/server-env";

// Same-origin gateway for guide files and images: the browser cannot attach
// the httpOnly session token to API requests itself, so this forwards an
// allow-listed set of read-only paths with it. The API authorizes each one.
const allowed = [
  /^[a-z0-9-]{1,200}\/[a-z0-9-]{1,200}\/[a-z0-9-]{1,200}\/media\/(approved|clean)$/,
  /^[a-z0-9-]{1,200}\/[a-z0-9-]{1,200}\/[a-z0-9-]{1,200}\/files\/(pdf|docx)$/,
  /^[a-z0-9-]{1,200}\/[a-z0-9-]{1,200}\/[a-z0-9-]{1,200}\/legacy\/image$/,
];
const forwarded = ["content-type", "content-length", "x-compi-brand-revision", "x-compi-drive-original"];

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (!allowed.some((rule) => rule.test(path))) return new Response(null, { status: 404 });
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return new Response(null, { status: 401 });

  const original = request.nextUrl.searchParams.get("original") === "1" ? "?original=1" : "";
  const upstream = await fetch(`${serverEnv.API_URL}/v1/guides/${path}${original}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const headers = new Headers({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" });
  for (const name of forwarded) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  const download = request.nextUrl.searchParams.get("download");
  if (download && upstream.ok) {
    headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(download)}`);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

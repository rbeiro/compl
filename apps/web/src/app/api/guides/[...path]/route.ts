import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { ACCESS_COOKIE } from "@/lib/session-cookies";
import { serverEnv } from "@/lib/server-env";

// Same-origin gateway for guide files and images: the browser cannot attach
// the httpOnly session token to API requests itself, so this forwards an
// allow-listed set of paths with it. The API authorizes each one. Uploads
// (PUT/POST) stream the file through; they are accepted from this origin only.
const guide = "[a-z0-9-]{1,200}\\/[a-z0-9-]{1,200}\\/[a-z0-9-]{1,200}";
const uploads = {
  PUT: [new RegExp(`^${guide}\\/files\\/(pdf|docx)$`), new RegExp(`^${guide}\\/source\\/(original|photo|art|image)$`)],
  POST: [new RegExp(`^${guide}\\/stage\\/(pdf|docx)$`)],
};
const allowed = [
  new RegExp(`^${guide}\\/source\\/(original|photo|art|image)$`),
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

  const query = new URLSearchParams();
  if (request.nextUrl.searchParams.get("original") === "1") query.set("original", "1");
  const sha = request.nextUrl.searchParams.get("sha");
  if (sha && /^[a-f0-9]{64}$/.test(sha)) query.set("sha", sha);
  const upstream = await fetch(`${serverEnv.API_URL}/v1/guides/${path}${query.size ? `?${query}` : ""}`, {
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

async function upload(request: NextRequest, method: "PUT" | "POST", params: Promise<{ path: string[] }>) {
  const path = (await params).path.join("/");
  if (!uploads[method].some((rule) => rule.test(path))) return new Response(null, { status: 404 });
  // Same-origin only: the browser's Origin must match the host it called.
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host || URL.parse(origin)?.host !== host) return new Response(null, { status: 403 });
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return new Response(null, { status: 401 });
  const previous = request.nextUrl.searchParams.get("previous");
  const query = previous && /^[a-f0-9]{64}$/.test(previous) ? `?previous=${previous}` : "";
  const upstream = await fetch(`${serverEnv.API_URL}/v1/guides/${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      ...(request.headers.get("content-length") ? { "Content-Length": request.headers.get("content-length")! } : {}),
    },
    body: request.body,
    duplex: "half",
    cache: "no-store",
  } as RequestInit);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
  });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return upload(request, "PUT", params);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return upload(request, "POST", params);
}

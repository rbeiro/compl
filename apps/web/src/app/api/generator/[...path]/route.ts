import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { ACCESS_COOKIE } from "@/lib/session-cookies";
import { serverEnv } from "@/lib/server-env";

// Same-origin gateway for the recipe generator's large JSON requests (recipe
// with its photo, assistant images): Server Actions cap request bodies, so
// these stream through to the API with the session token. The API authorizes.
const outlet = "[a-z0-9-]{1,200}\\/[a-z0-9-]{1,200}";
const allowed = new RegExp(`^${outlet}\\/(documents|assistant\\/(status|watercolor|annotations|compose|prepare))$`);

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (!allowed.test(path)) return new Response(null, { status: 404 });
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host || URL.parse(origin)?.host !== host) return new Response(null, { status: 403 });
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return new Response(JSON.stringify({ error: { code: "session_expired" } }), { status: 401 });
  const master = path.endsWith("/documents") && request.nextUrl.searchParams.get("rendition") === "master" ? "?rendition=master" : "";
  const upstream = await fetch(`${serverEnv.API_URL}/v1/outlets/${path}${master}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: request.body,
    duplex: "half",
    cache: "no-store",
    signal: request.signal,
  } as RequestInit);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
  });
}

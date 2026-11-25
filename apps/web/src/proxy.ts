import createIntlMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { refreshSession } from "@/lib/supabase/proxy";

const handleI18n = createIntlMiddleware(routing);

// Pages that need a signed-in user, without the locale prefix.
const protectedPrefixes = ["/portal", "/acceso/verificacion", "/acceso/nueva-contrasena"];

function stripLocale(pathname: string) {
  const [, first, ...rest] = pathname.split("/");
  return (routing.locales as readonly string[]).includes(first)
    ? "/" + rest.join("/")
    : pathname;
}

export default async function proxy(request: NextRequest) {
  const response = handleI18n(request);
  const claims = await refreshSession(request, response);

  const path = stripLocale(request.nextUrl.pathname);
  const needsAuth = protectedPrefixes.some(
    (p) => path === p || path.startsWith(p + "/"),
  );

  if (needsAuth && !claims) {
    const prefix = request.nextUrl.pathname.slice(
      0,
      request.nextUrl.pathname.length - path.length,
    );
    const url = request.nextUrl.clone();
    url.pathname = `${prefix}/acceso`;
    const redirect = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }

  return response;
}

export const config = {
  // Skip Next internals, API routes and static files.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};

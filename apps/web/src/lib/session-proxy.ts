import type { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  clearedCookies,
  REFRESH_COOKIE,
  secondsLeft,
  sessionCookies,
  type Tokens,
} from "./session-cookies";

/**
 * Keeps the session alive: when the access token is missing or about to
 * expire, exchanges the refresh token at the API and writes the new cookies to
 * both the forwarded request and the response. Returns whether a session exists.
 */
export async function refreshSession(request: NextRequest, response: NextResponse): Promise<boolean> {
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  if (access && secondsLeft(access) > 60) return true;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refresh) return false;

  let tokens: Tokens | null = null;
  try {
    const res = await fetch(new URL("/v1/auth/refresh", process.env.API_URL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
      cache: "no-store",
    });
    if (res.ok) tokens = (await res.json()) as Tokens;
    else if (res.status !== 401) return !!access; // API trouble: keep what we have.
  } catch {
    return !!access;
  }

  const cookies = tokens ? sessionCookies(tokens) : clearedCookies();
  for (const [name, value, options] of cookies) {
    request.cookies.set(name, value);
    response.cookies.set(name, value, options);
  }
  return !!tokens;
}

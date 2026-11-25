import "server-only";
import { cookies } from "next/headers";
import { ACCESS_COOKIE, clearedCookies, sessionCookies, type Tokens } from "./session-cookies";

/** Access token of the current request (refreshed by the proxy when needed). */
export async function accessToken() {
  return (await cookies()).get(ACCESS_COOKIE)?.value;
}

/** Stores new session tokens. Only callable from Server Actions / Route Handlers. */
export async function saveSession(tokens: Tokens) {
  const store = await cookies();
  for (const [name, value, options] of sessionCookies(tokens)) store.set(name, value, options);
}

export async function clearSession() {
  const store = await cookies();
  for (const [name, value, options] of clearedCookies()) store.set(name, value, options);
}

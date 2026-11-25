// Session cookies shared by the proxy and server code. The tokens come from the
// CompI API (which delegates to the identity provider); the browser never sees
// them from JavaScript (httpOnly).
export const ACCESS_COOKIE = "compi_at";
export const REFRESH_COOKIE = "compi_rt";
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

export type Tokens = { accessToken: string; refreshToken: string; expiresAt: number };

type CookieOptions = { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/"; maxAge: number };

const base = () => ({
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/" as const,
});

export function sessionCookies(tokens: Tokens): [string, string, CookieOptions][] {
  const now = Math.floor(Date.now() / 1000);
  return [
    [ACCESS_COOKIE, tokens.accessToken, { ...base(), maxAge: Math.max(0, tokens.expiresAt - now) }],
    [REFRESH_COOKIE, tokens.refreshToken, { ...base(), maxAge: REFRESH_MAX_AGE }],
  ];
}

export function clearedCookies(): [string, string, CookieOptions][] {
  return [
    [ACCESS_COOKIE, "", { ...base(), maxAge: 0 }],
    [REFRESH_COOKIE, "", { ...base(), maxAge: 0 }],
  ];
}

/** Seconds until the token expires, read without verifying (timing only; the API verifies). */
export function secondsLeft(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp - Math.floor(Date.now() / 1000) : 0;
  } catch {
    return 0;
  }
}

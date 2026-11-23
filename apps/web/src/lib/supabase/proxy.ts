import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

// Refreshes the Supabase session on every request and writes updated
// cookies onto `response`. Returns the verified user claims, if any.
export async function refreshSession(
  request: NextRequest,
  response: NextResponse,
) {
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getClaims() verifies the JWT; never trust getSession() alone on the server.
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

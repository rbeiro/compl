import "server-only";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = { id: string; email: string | null };

// Data Access Layer: the single place that reads the session on the server.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: (claims.email as string | undefined) ?? null };
}

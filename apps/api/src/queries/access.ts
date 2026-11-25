import type { Tx } from "../db/client.js";

// Thin wrappers over the database functions: the rules live in SQL.

/** Whether this session still needs a second factor (rank-1 accounts). */
export async function needsMfa(tx: Tx): Promise<boolean> {
  const [row] = await tx<{ needsMfa: boolean }[]>`
    select public.compi_needs_mfa() as "needsMfa"
  `;
  return row?.needsMfa ?? false;
}

/** Hotels the user belongs to and their rank in each (1 = executive chef). */
export function myHotels(tx: Tx) {
  return tx<{ hotelKey: string; accessRank: number }[]>`
    select hotel_key as "hotelKey", access_rank as "accessRank"
    from public.compi_my_access()
  `;
}

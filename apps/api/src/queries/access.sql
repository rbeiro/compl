/*
  Session and access. The rules live in the database functions; these queries only call them.
  Column aliases ending in "!" tell PgTyped the value is never null.
*/

/* @name needsMfa */
SELECT public.compi_needs_mfa() AS "needsMfa!";

/* @name listMyHotels */
SELECT hotel_key AS "hotelKey!", access_rank AS "accessRank!"
FROM public.compi_my_access();

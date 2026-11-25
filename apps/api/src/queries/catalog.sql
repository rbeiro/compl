/*
  Plating-guide catalog of the Hotel Arts edition (compi_arts_* objects, see
  legacy/public/hotel-arts-api.js). Row-level security filters every read.
*/

/* @name listOutlets */
SELECT hotel_key AS "hotelKey!", outlet_key AS "outletKey!", hotel AS "hotel!", outlet AS "outlet!"
FROM public.compi_arts_outlets
ORDER BY hotel, outlet;

/* @name listGuides */
-- Keyset pagination: pass the last (hotel, outlet, guide) of the previous page,
-- or empty strings for the first page.
SELECT
  hotel_key AS "hotelKey!", outlet_key AS "outletKey!", guide_key AS "guideKey!",
  hotel AS "hotel!", outlet AS "outlet!", title AS "title!", guide_state AS "state!",
  kind, category, reviewed AS "reviewed!", can_classify AS "canClassify!",
  has_source AS "hasSource!", has_image AS "hasImage!", image_kind AS "imageKind",
  has_clean AS "hasCleanImage!", partida AS "station", racion AS "portion", pase AS "pass",
  sala_es AS "serviceNotes", nombre_en AS "englishName"
FROM public.compi_arts_workspace_catalog(:afterHotel!, :afterOutlet!, :afterGuide!, :limit!);

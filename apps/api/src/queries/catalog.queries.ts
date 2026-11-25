/** Types generated for queries found in "src/queries/catalog.sql" */
import { PreparedQuery } from '@pgtyped/runtime';

/** 'ListOutlets' parameters type */
export type ListOutletsParams = void;

/** 'ListOutlets' return type */
export interface ListOutletsResult {
  hotel: string;
  hotelKey: string;
  outlet: string;
  outletKey: string;
}

/** 'ListOutlets' query type */
export interface ListOutletsQuery {
  params: ListOutletsParams;
  result: ListOutletsResult;
}

const listOutletsIR: any = {"usedParamSet":{},"params":[],"statement":"SELECT hotel_key AS \"hotelKey!\", outlet_key AS \"outletKey!\", hotel AS \"hotel!\", outlet AS \"outlet!\"\nFROM public.compi_arts_outlets\nORDER BY hotel, outlet"};

/**
 * Query generated from SQL:
 * ```
 * SELECT hotel_key AS "hotelKey!", outlet_key AS "outletKey!", hotel AS "hotel!", outlet AS "outlet!"
 * FROM public.compi_arts_outlets
 * ORDER BY hotel, outlet
 * ```
 */
export const listOutlets = new PreparedQuery<ListOutletsParams,ListOutletsResult>(listOutletsIR);


/** 'ListGuides' parameters type */
export interface ListGuidesParams {
  afterGuide: string;
  afterHotel: string;
  afterOutlet: string;
  limit: number;
}

/** 'ListGuides' return type */
export interface ListGuidesResult {
  canClassify: boolean;
  category: string | null;
  englishName: string | null;
  guideKey: string;
  hasCleanImage: boolean;
  hasImage: boolean;
  hasSource: boolean;
  hotel: string;
  hotelKey: string;
  imageKind: string | null;
  kind: string | null;
  outlet: string;
  outletKey: string;
  pass: string | null;
  portion: string | null;
  reviewed: boolean;
  serviceNotes: string | null;
  state: string;
  station: string | null;
  title: string;
}

/** 'ListGuides' query type */
export interface ListGuidesQuery {
  params: ListGuidesParams;
  result: ListGuidesResult;
}

const listGuidesIR: any = {"usedParamSet":{"afterHotel":true,"afterOutlet":true,"afterGuide":true,"limit":true},"params":[{"name":"afterHotel","required":true,"transform":{"type":"scalar"},"locs":[{"a":643,"b":654}]},{"name":"afterOutlet","required":true,"transform":{"type":"scalar"},"locs":[{"a":657,"b":669}]},{"name":"afterGuide","required":true,"transform":{"type":"scalar"},"locs":[{"a":672,"b":683}]},{"name":"limit","required":true,"transform":{"type":"scalar"},"locs":[{"a":686,"b":692}]}],"statement":"-- Keyset pagination: pass the last (hotel, outlet, guide) of the previous page,\n-- or empty strings for the first page.\nSELECT\n  hotel_key AS \"hotelKey!\", outlet_key AS \"outletKey!\", guide_key AS \"guideKey!\",\n  hotel AS \"hotel!\", outlet AS \"outlet!\", title AS \"title!\", guide_state AS \"state!\",\n  kind, category, reviewed AS \"reviewed!\", can_classify AS \"canClassify!\",\n  has_source AS \"hasSource!\", has_image AS \"hasImage!\", image_kind AS \"imageKind\",\n  has_clean AS \"hasCleanImage!\", partida AS \"station\", racion AS \"portion\", pase AS \"pass\",\n  sala_es AS \"serviceNotes\", nombre_en AS \"englishName\"\nFROM public.compi_arts_workspace_catalog(:afterHotel!, :afterOutlet!, :afterGuide!, :limit!)"};

/**
 * Query generated from SQL:
 * ```
 * -- Keyset pagination: pass the last (hotel, outlet, guide) of the previous page,
 * -- or empty strings for the first page.
 * SELECT
 *   hotel_key AS "hotelKey!", outlet_key AS "outletKey!", guide_key AS "guideKey!",
 *   hotel AS "hotel!", outlet AS "outlet!", title AS "title!", guide_state AS "state!",
 *   kind, category, reviewed AS "reviewed!", can_classify AS "canClassify!",
 *   has_source AS "hasSource!", has_image AS "hasImage!", image_kind AS "imageKind",
 *   has_clean AS "hasCleanImage!", partida AS "station", racion AS "portion", pase AS "pass",
 *   sala_es AS "serviceNotes", nombre_en AS "englishName"
 * FROM public.compi_arts_workspace_catalog(:afterHotel!, :afterOutlet!, :afterGuide!, :limit!)
 * ```
 */
export const listGuides = new PreparedQuery<ListGuidesParams,ListGuidesResult>(listGuidesIR);



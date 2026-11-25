import type { Tx } from "../db/client.js";

// The Hotel Arts edition keeps its catalog in the compi_arts_* objects
// (see legacy/public/hotel-arts-api.js); row-level security filters every read.

export function outlets(tx: Tx) {
  return tx<{ hotelKey: string; outletKey: string; hotel: string; outlet: string }[]>`
    select hotel_key as "hotelKey", outlet_key as "outletKey", hotel, outlet
    from public.compi_arts_outlets
    order by hotel, outlet
  `;
}

export type GuideCursor = { hotelKey: string; outletKey: string; guideKey: string };

export function guides(tx: Tx, after: GuideCursor | null, limit: number) {
  return tx<GuideRow[]>`
    select hotel_key as "hotelKey", outlet_key as "outletKey", guide_key as "guideKey",
           hotel, outlet, title, guide_state as "state", kind, category, reviewed,
           can_classify as "canClassify", has_source as "hasSource", has_image as "hasImage",
           image_kind as "imageKind", has_clean as "hasCleanImage",
           partida as "station", racion as "portion", pase as "pass",
           sala_es as "serviceNotes", nombre_en as "englishName"
    from public.compi_arts_workspace_catalog(
      ${after?.hotelKey ?? ""}, ${after?.outletKey ?? ""}, ${after?.guideKey ?? ""}, ${limit}
    )
  `;
}

export type GuideRow = {
  hotelKey: string;
  outletKey: string;
  guideKey: string;
  hotel: string;
  outlet: string;
  title: string;
  state: "draft" | "ready" | "archived";
  kind: string | null;
  category: string | null;
  reviewed: boolean;
  canClassify: boolean;
  hasSource: boolean;
  hasImage: boolean;
  imageKind: string | null;
  hasCleanImage: boolean;
  station: string | null;
  portion: string | null;
  pass: string | null;
  serviceNotes: string | null;
  englishName: string | null;
};

import "server-only";
import { cache } from "react";
import { getApi, sessionDestination } from "@/lib/api";

export const sections = [
  "inicio", "horarios", "equipo", "recetas", "escandallos", "plating", "generar", "archivo", "correo", "seguridad",
] as const;
export type Section = (typeof sections)[number];

/** Legacy hash routes → paths (#/portal → /portal, #/empresa/… → /empresa/…). */
export const sectionPath = {
  inicio: "/portal",
  horarios: "/horarios",
  equipo: "/equipo",
  recetas: "/recetas",
  escandallos: "/escandallos",
  plating: "/plating",
  generar: "/generar",
  archivo: "/empresa",
  correo: "/correo",
  seguridad: "/seguridad",
} as const satisfies Record<Section, string>;

export type Links = Record<Section, string | null>;

/**
 * Everything the workspace frame needs, loaded once per request.
 * Section availability follows the legacy portal (portal.js `links`):
 * staff sections need any hotel, team/costing need rank 1, generation rank 1–2.
 */
export const loadWorkspace = cache(async () => {
  const api = await getApi();
  if (!api) return { status: "redirect" as const, to: "/acceso" };
  const destination = await sessionDestination(api);
  if (destination !== "/portal") return { status: "redirect" as const, to: destination ?? "/acceso" };

  const [me, outlets] = await Promise.all([api.GET("/v1/me"), api.GET("/v1/outlets")]);
  if (me.response.status === 401) return { status: "redirect" as const, to: "/acceso" };
  if (!me.data || !outlets.data) throw new Error("The workspace could not be loaded from the API.");

  const access = me.data.hotels;
  const active = access.length > 0;
  const admin = access.some((a) => a.accessRank === 1);
  const editor = access.some((a) => a.accessRank === 1 || a.accessRank === 2);
  const allow = (ok: boolean, section: Section) => (ok ? sectionPath[section] : null);
  const links: Links = {
    inicio: sectionPath.inicio,
    horarios: allow(active, "horarios"),
    equipo: allow(admin, "equipo"),
    recetas: allow(active, "recetas"),
    escandallos: allow(admin, "escandallos"),
    plating: allow(active, "plating"),
    generar: allow(editor, "generar"),
    archivo: allow(active, "archivo"),
    correo: allow(active, "correo"),
    seguridad: allow(active, "seguridad"),
  };
  const hotelName = (key: string) => outlets.data.items.find((o) => o.hotelKey === key)?.hotel ?? key;
  const hotelLabel = access.map((a) => hotelName(a.hotelKey)).join(" · ");

  return { status: "ok" as const, api, me: me.data, outlets: outlets.data.items, access, links, hotelLabel };
});

/** Every guide the user can see (follows the API's keyset cursor, like legacy loadCatalog). */
export const loadAllGuides = cache(async () => {
  const workspace = await loadWorkspace();
  if (workspace.status !== "ok") return [];
  const items = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const { data } = await workspace.api.GET("/v1/guides", { params: { query: { limit: 200, cursor } } });
    if (!data) throw new Error("The catalog could not be loaded from the API.");
    items.push(...data.items);
    if (!data.nextCursor) break;
    cursor = data.nextCursor;
  }
  // Legacy loadCatalog: only known kinds/categories, sorted by hotel, outlet, title.
  return items
    .map((g) => ({
      ...g,
      kind: (g.kind && g.kind in guideKinds ? g.kind : null) as keyof typeof guideKinds | null,
      category: g.category && g.category in guideCategories ? g.category : null,
    }))
    .sort((a, b) => a.hotel.localeCompare(b.hotel) || a.outlet.localeCompare(b.outlet) || a.title.localeCompare(b.title));
});

export const guideKinds = { plato: "Plato", elaboracion: "Elaboración" } as const;
export const guideCategories = {
  desayunos: "Desayunos", entrantes: "Entrantes", principales: "Principales", postres: "Postres", fondos: "Fondos",
  salsas: "Salsas", bases: "Bases", guarniciones: "Guarniciones", otros: "Otros",
} as const;

/** Where a guide opens: published guides in Plating Guides, drafts in the archive. */
export function guideHref(g: { state: string; hotelKey: string; outletKey: string; guideKey: string; hotel: string; outlet: string }) {
  if (g.state === "ready") return `/plating/${[g.hotelKey, g.outletKey, g.guideKey].map(encodeURIComponent).join("/")}`;
  return `/empresa/${[g.hotel, g.outlet, "Plating Guides", g.guideKey].map(encodeURIComponent).join("/")}`;
}

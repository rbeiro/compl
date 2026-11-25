"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { signOut } from "@/app/actions/auth";
import { Icon } from "@/components/icon";
import { LanguagePicker } from "@/components/language-picker";
import { Link, usePathname } from "@/i18n/navigation";
import { carbon, sequence } from "@/lib/motion";
import { WsIcon } from "./ws-icon";

// Port of legacy workspace-shell.js `mountShell` + workspace-shell.css.

type Section =
  | "inicio" | "horarios" | "equipo" | "recetas" | "escandallos" | "plating" | "generar" | "archivo" | "correo" | "seguridad";
type Links = Record<Section, string | null>;

const primary: [Section, string, string][] = [
  ["inicio", "home", "home"],
  ["horarios", "schedules", "calendar"],
  ["equipo", "team", "users"],
  ["recetas", "recipes", "book"],
  ["escandallos", "costs", "cost"],
  ["plating", "plating", "plating"],
  ["generar", "generate", "generate"],
];
const secondary: [Section, string, string][] = [
  ["archivo", "archive", "folder"],
  ["correo", "mail", "mail"],
  ["seguridad", "security", "lock"],
];
/** Breadcrumb title per section (legacy `titles`). */
const titleKey: Record<Section, string> = {
  inicio: "home", horarios: "schedules", equipo: "team", recetas: "recipes", escandallos: "costs",
  plating: "plating", generar: "generate", archivo: "archiveTitle", correo: "mail", seguridad: "securityTitle",
};
const fromPath: Record<string, Section> = { portal: "inicio", empresa: "archivo" };

export function sectionOf(pathname: string): Section {
  const first = pathname.split("/")[1] ?? "";
  return fromPath[first] ?? (first as Section);
}

const navLink =
  "ws-nav-link m-0 flex min-h-11 items-center gap-[.78rem] rounded-[8px] border-0 px-[.84rem] py-[.55rem] text-[.86rem]/[1.3] font-[550] text-[#505c52] no-underline transition-[background,transform] duration-(--ws-duration) ease-(--ws-ease) hover:bg-[#e9e5dc] hover:text-green aria-[current=page]:bg-green aria-[current=page]:text-white";

export function WorkspaceShell({ links, hotel, children }: { links: Links; hotel: string; children: ReactNode }) {
  const t = useTranslations("Workspace");
  const c = useTranslations("Common");
  const locale = useLocale();
  const pathname = usePathname();
  const section = sectionOf(pathname);
  const [open, setOpen] = useState(false);
  const rail = useRef<HTMLElement>(null);
  const railHead = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const crumb = useRef<HTMLSpanElement>(null);
  const header = useRef<HTMLElement>(null);
  const previousPath = useRef<string | null>(null);

  // Arrival motion: first view rises in ("portal-access"); later sections play
  // the "workspace-route" sequence on the breadcrumb and title.
  useEffect(() => {
    const title = content.current?.querySelector("h1");
    if (previousPath.current === null) carbon(title);
    else if (previousPath.current !== pathname) sequence([crumb.current, title]);
    previousPath.current = pathname;
  }, [pathname]);

  // Mobile drawer: modal while open (focus trap, Escape, inert background).
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 760px)");
    const sync = () => {
      if (!mobile.matches) setOpen(false);
      if (rail.current) rail.current.inert = mobile.matches && !open;
    };
    sync();
    mobile.addEventListener("change", sync);
    return () => mobile.removeEventListener("change", sync);
  }, [open]);

  const wasOpen = useRef(false);
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 760px)").matches;
    if (header.current) header.current.inert = open;
    if (content.current) content.current.inert = open;
    document.body.style.overflow = open ? "hidden" : "";
    if (open) {
      close.current?.focus();
      sequence([railHead.current, ...Array.from(rail.current?.querySelectorAll("a[data-nav]") ?? [])]);
    } else if (wasOpen.current && mobile) {
      toggle.current?.focus();
      sequence([toggle.current, content.current?.querySelector("h1")]);
    }
    wasOpen.current = open;
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Navigating closes the drawer.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to route changes
  useEffect(() => setOpen(false), [pathname]);

  function onRailKey(event: React.KeyboardEvent) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(rail.current?.querySelectorAll<HTMLElement>("a[href],button") ?? []).filter(
      (el) => el.getClientRects().length,
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  const item = ([key, label, icon]: [Section, string, string]) =>
    links[key] && (
      <Link key={key} href={links[key]} data-nav className={navLink} aria-current={section === key ? "page" : undefined}>
        <WsIcon name={icon} className="size-[1.14rem]" />
        <span>{t(label)}</span>
      </Link>
    );

  return (
    <div className="ws-vars">
      <header
        ref={header}
        className="masthead sticky top-0 z-[19] ms-(--ws-rail-width) border-b border-(--ws-line) bg-[rgba(250,247,242,.98)]"
      >
        <div className="masthead-inner m-auto flex min-h-[76px] w-full max-w-[1510px] flex-nowrap items-center justify-start gap-4 px-[clamp(1.5rem,2.85vw,3rem)] max-760:min-h-16 max-760:gap-[.35rem] max-760:px-[.8rem]">
          <button
            ref={toggle}
            type="button"
            aria-label={t("openMenu")}
            aria-controls="ws-rail"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className="ws-menu-toggle hidden size-11 place-items-center rounded-[8px] border-0 bg-transparent p-0 text-green hover:bg-[#ebe7de] max-760:inline-grid"
          >
            <WsIcon name="menu" />
          </button>
          <Link href="/" aria-label={c("homeLabel")} className="hidden min-h-11 flex-none items-center max-760:inline-flex max-720:order-[-2]">
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG logo sized by CSS */}
            <img src="/brand/assets/logo/compi-logo-green.svg" alt="CompI" width={1226} height={327} className="block h-auto w-[95px]" />
          </Link>
          <div className="ws-top-context flex min-w-0 items-center gap-3 max-760:hidden">
            <span className="grid size-[2.2rem] flex-none place-items-center rounded-[8px] border border-[#d7e0d4] bg-green-soft text-green">
              <WsIcon name="location" className="size-[1.1rem]" />
            </span>
            <div className="ws-hotel-copy grid min-w-0">
              {hotel ? (
                <>
                  <strong className="truncate text-[.88rem]/[1.35] font-[650] text-ink">{hotel}</strong>
                  <small className="text-[.62rem]/[1.3] font-medium tracking-[.055em] text-(--ws-muted) uppercase">{c("myWorkspace")}</small>
                </>
              ) : (
                <strong className="truncate text-[.88rem]/[1.35] font-[650] text-ink">{c("myWorkspace")}</strong>
              )}
            </div>
            <span ref={crumb} className="ws-crumb min-w-0 border-s border-(--ws-line) ps-4 text-[.82rem] text-(--ws-muted) max-960:hidden">
              {t(titleKey[section] ?? "home")}
            </span>
          </div>
          <nav
            aria-label={c("workspaceNav")}
            className="app-nav ms-auto flex min-w-0 items-center gap-2 max-460:gap-[.18rem] max-720:order-2 max-720:mt-[.2rem] max-720:w-full max-720:border-t max-720:border-line max-720:pt-[.45rem]"
          >
            <form action={signOut}>
              <input type="hidden" name="locale" value={locale} />
              <button
                id="logout"
                type="submit"
                title={c("signOut")}
                aria-label={c("signOut")}
                className="ml-[.35rem] inline-flex min-h-11 items-center justify-center gap-[.6rem] border-0 bg-transparent px-[.6rem] py-[.55rem] text-[.9rem]/[1.35] font-semibold text-muted hover:rounded-control hover:bg-green-soft hover:text-green max-850:w-11 max-720:m-0 max-460:text-[.84rem]"
              >
                <Icon name="logout" className="w-[1.05rem]" />
                <span className="max-850:hidden">{c("signOut")}</span>
              </button>
            </form>
          </nav>
          <div className="max-720:order-[-1]">
            <LanguagePicker />
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="ws-frame m-0 ms-(--ws-rail-width) min-h-[calc(100vh-76px)] w-auto max-w-none p-0 outline-none">
        <aside
          id="ws-rail"
          ref={rail}
          aria-label={c("myWorkspace")}
          role={open ? "dialog" : undefined}
          aria-modal={open ? true : undefined}
          onKeyDown={onRailKey}
          onClick={(event) => {
            if (open && (event.target as HTMLElement).closest("a")) setOpen(false);
          }}
          className={`ws-rail fixed inset-y-0 start-0 z-30 box-border flex w-(--ws-rail-width) flex-col gap-0 overflow-y-auto overscroll-contain border-e border-(--ws-line) bg-(--ws-rail) px-4 pt-[1.7rem] pb-4 max-1190:px-[.7rem] max-760:invisible max-760:w-[min(280px,86vw)] max-760:-translate-x-[106%] max-760:transition-transform max-760:duration-(--ws-duration) max-760:ease-(--ws-ease) rtl:max-760:translate-x-[106%] ${
            open ? "max-760:visible max-760:translate-x-0 max-760:shadow-[0_0_2rem_#17281c23] rtl:max-760:translate-x-0" : ""
          }`}
        >
          <div ref={railHead} className="ws-rail-head mx-3 mb-8 flex items-center justify-between gap-4 max-1190:mx-[.6rem] max-760:mb-5">
            <Link href="/portal" aria-label={c("homeLabel")} className="inline-flex min-h-11 items-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- SVG logo sized by CSS */}
              <img src="/brand/assets/logo/compi-logo-green.svg" alt="CompI" width={150} height={40} className="block h-auto w-[144px] max-w-full" />
            </Link>
            <button
              ref={close}
              type="button"
              aria-label={t("closeMenu")}
              onClick={() => setOpen(false)}
              className="hidden size-11 place-items-center rounded-[8px] border-0 bg-transparent p-0 text-green hover:bg-[#ebe7de] max-760:inline-grid"
            >
              <WsIcon name="close" />
            </button>
          </div>
          <p className="ws-rail-label mb-4 px-[.88rem] text-[.65rem]/[1.5] font-[650] tracking-[.13em] text-(--ws-muted) uppercase">
            {c("myWorkspace")}
          </p>
          <nav aria-label={t("mainNav")} className="ws-nav m-0 flex flex-col flex-nowrap items-stretch gap-1 pb-5">
            {primary.map(item)}
          </nav>
          <div className="ws-support m-0 mt-auto flex flex-col flex-nowrap items-stretch gap-1 border-t border-(--ws-line) pt-[.65rem]">
            {secondary.map(item)}
          </div>
        </aside>
        {open && (
          <div aria-hidden="true" onClick={() => setOpen(false)} className="fixed inset-0 z-[25] hidden bg-[#17281c52] max-760:block" />
        )}
        <div
          ref={content}
          tabIndex={-1}
          className="ws-main-content mx-auto box-border w-full max-w-[1510px] min-w-0 px-[clamp(1.5rem,2.85vw,3rem)] pt-[clamp(1.5rem,2.8vw,2.75rem)] pb-12 outline-none max-760:px-4 max-760:pt-[1.35rem] max-760:pb-10"
        >
          {children}
        </div>
      </main>
    </div>
  );
}

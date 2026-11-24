"use client";

import { useEffect } from "react";
import { carbon } from "@/lib/motion";

// Port of legacy motion.js `observeLanding` and the section-jump motion in portal.js.
// Renders nothing; wires behavior onto the server-rendered landing markup.
export function LandingMotion() {
  useEffect(() => {
    const landing = document.querySelector("[data-page=home]");
    if (!landing) return;

    // Sections rise into view the first time they are 12% visible.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          carbon(entry.target);
        }
      },
      { threshold: 0.12 },
    );
    landing.querySelectorAll("[data-reveal]").forEach((el) => observer.observe(el));

    // Accordion: animate the revealed text, or the summary when closing.
    const onToggle = (event: Event) => {
      const details = event.target as HTMLDetailsElement;
      if (!details.matches?.("[data-tools] details")) return;
      carbon(details.open ? details.querySelector("p") : details.querySelector("summary"));
    };
    landing.addEventListener("toggle", onToggle, true);

    // "About" / "Tools" links: animate the heading of the section jumped to.
    const onHash = () => {
      const target = location.hash && document.getElementById(location.hash.slice(1));
      if (target) carbon(target.querySelector("h2"));
    };
    window.addEventListener("hashchange", onHash);

    return () => {
      observer.disconnect();
      landing.removeEventListener("toggle", onToggle, true);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  return null;
}

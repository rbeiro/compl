"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { BrandSettings } from "./brand-settings";
import styles from "./generator.module.css";
import { RecipeGenerator, type Destination, type InitialSource } from "./recipe-generator";

// Legacy generatorPanels(): "Crear receta" and, for executive chefs, "Marca de las fichas".

const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).map((n) => `${styles[n as string] ?? ""} ${n}`).join(" ");

export function GeneratorView({
  destinations,
  selected,
  initialSource,
  brandHotels,
}: {
  destinations: Destination[];
  selected: number | null;
  initialSource?: InitialSource;
  brandHotels: { key: string; name: string }[];
}) {
  const t = useTranslations("Generator");
  const [tab, setTab] = useState(0);
  const [opened, setOpened] = useState(false);
  const [brandHotel, setBrandHotel] = useState<string | undefined>();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const recipe = <RecipeGenerator destinations={destinations} selected={selected} initialSource={initialSource} />;
  if (!brandHotels.length) return recipe;
  const activate = (index: number) => {
    setTab(index);
    if (index === 1 && !opened) {
      const hotel = selected !== null ? destinations[selected]?.hotelKey : undefined;
      setBrandHotel(brandHotels.some((h) => h.key === hotel) ? hotel : undefined);
      setOpened(true);
    }
  };
  const labels = [t("crearReceta"), t("marcaDeLasFichas")];
  return (
    <div className={cx("root")}>
      <div className={cx("generator-tabs")} role="tablist" aria-label={t("generacionDeRecetas")}>
        {labels.map((label, i) => (
          <button
            key={i}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            className="btn download"
            id={`generator-tab-${i}`}
            role="tab"
            aria-controls={`generator-panel-${i}`}
            aria-selected={tab === i}
            tabIndex={tab === i ? 0 : -1}
            onClick={() => activate(i)}
            onKeyDown={(event) => {
              const target = ({ ArrowRight: 1 - i, ArrowLeft: 1 - i, Home: 0, End: 1 } as Record<string, number>)[event.key];
              if (target === undefined) return;
              event.preventDefault();
              activate(target);
              tabs.current[target]?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <section id="generator-panel-0" role="tabpanel" aria-labelledby="generator-tab-0" hidden={tab !== 0}>
        {recipe}
      </section>
      <section id="generator-panel-1" role="tabpanel" aria-labelledby="generator-tab-1" hidden={tab !== 1}>
        {opened && <BrandSettings hotels={brandHotels} selected={brandHotel} />}
      </section>
    </div>
  );
}

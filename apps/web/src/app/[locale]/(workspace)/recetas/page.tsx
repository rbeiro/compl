import { Suspense } from "react";
import { SectionGate, sectionMetadata } from "@/components/workspace/section";
import { loadAllGuides, loadWorkspace } from "@/lib/workspace";
import { RecipesView } from "./recipes-view";

export const generateMetadata = () => sectionMetadata("recetas");

// Legacy #/recetas (workspace-recipes.js): the screen replaces the section heading.
export default function RecipesPage() {
  return (
    <Suspense>
      <SectionGate section="recetas">
        <Recipes />
      </SectionGate>
    </Suspense>
  );
}

async function Recipes() {
  const workspace = await loadWorkspace();
  if (workspace.status !== "ok") return null;
  const rows = await loadAllGuides();
  return (
    <RecipesView
      rows={rows}
      context={workspace.hotelLabel || null}
      newRecipeHref={workspace.links.generar}
      favoriteScope={workspace.me.userId}
    />
  );
}

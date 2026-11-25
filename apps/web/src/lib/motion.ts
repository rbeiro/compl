// Port of legacy/public/motion-choices.js. Every motion on the public pages and
// sign-in uses the "carbon" preset: a short fade-and-lift via the Web
// Animations API. Respects prefers-reduced-motion like the original.

const carbonEase = "cubic-bezier(.2,0,.38,.9)";
const sequenceEase = "cubic-bezier(.2,.75,.25,1)";
const running = new WeakMap<Element, Animation>();

function reducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function animate(node: Element, frames: Keyframe[], duration: number, delay = 0, easing = carbonEase) {
  if (!node.isConnected || !("animate" in node) || reducedMotion()) return;
  running.get(node)?.cancel();
  const animation = node.animate(frames, { duration, delay, easing, fill: "backwards" });
  running.set(node, animation);
  animation.finished
    .catch(() => {})
    .finally(() => {
      if (running.get(node) === animation) running.delete(node);
    });
}

/** Fade in and rise 8px (175ms). Several items are staggered by 24ms. */
export function carbon(...nodes: (Element | null | undefined)[]) {
  nodes
    .filter((n): n is Element => !!n)
    .slice(0, 8)
    .forEach((node, i) =>
      animate(node, [{ opacity: 0.28, translate: "0 8px" }, { opacity: 1, translate: "0 0" }], 175, i * 24),
    );
}

/**
 * "Secuencia" preset (mobile menu, section arrivals): items fade up 7px,
 * staggered by 54ms; a single item gets a softer two-step curve.
 */
export function sequence(
  nodes: (Element | null | undefined)[],
  { backwards = false, stillImages = false }: { backwards?: boolean; stillImages?: boolean } = {},
) {
  const items = nodes.filter((n): n is Element => !!n && !(n as HTMLElement).hidden).slice(0, 8);
  const shift = backwards ? "-7px" : "7px";
  items.forEach((node, i) => {
    // "guide-labels": images only fade, so the picture does not jump.
    const still = stillImages && node.tagName === "IMG";
    const entry = still ? { opacity: 0.15 } : { opacity: 0.15, translate: `0 ${shift}` };
    const rest = still ? { opacity: 1 } : { opacity: 1, translate: "0 0" };
    const frames =
      items.length === 1 && !still
        ? [entry, { opacity: 0.62, translate: "0 1px", offset: 0.35 }, { opacity: 0.65, offset: 0.55 }, rest]
        : [entry, rest];
    animate(node, frames, items.length > 1 ? 255 : 410, i * 54, sequenceEase);
  });
}

/**
 * "Duo" preset (confirming buttons): a squash-and-stretch bounce with three
 * small sparks when the action is positive, a short press otherwise.
 */
export function duo(button: HTMLElement | null | undefined, { positive = true } = {}) {
  if (!button) return;
  const frames = positive
    ? [
        { scale: "1.1 .84" },
        { translate: "0 -4px", scale: ".96 1.08", offset: 0.4 },
        { translate: "0 1px", scale: "1.025 .97", offset: 0.72 },
        { translate: "0 0", scale: "1" },
      ]
    : [{ scale: ".93" }, { scale: "1" }];
  animate(button, frames, positive ? 405 : 170, 0, sequenceEase);
  if (!positive || reducedMotion()) return;
  button.querySelectorAll("[data-motion-sparks]").forEach((layer) => layer.remove());
  const layer = document.createElement("span");
  layer.dataset.motionSparks = "";
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:absolute;inset:0;pointer-events:none";
  if (getComputedStyle(button).position === "static") button.style.position = "relative";
  button.append(layer);
  const colors = ["#67946c", "#aa8552", "#67946c"];
  const marks = [-1, 0, 1].map((direction, i) => {
    const mark = document.createElement("i");
    mark.style.cssText = `position:absolute;top:15%;left:50%;width:3px;height:6px;border-radius:2px;opacity:0;background:${colors[i]};margin-inline-start:${direction * 6}px`;
    layer.append(mark);
    return mark.animate(
      [
        { opacity: 0, translate: "0 1px", scale: ".45" },
        { opacity: 1, offset: 0.26 },
        { opacity: 0, translate: `${direction * 10}px -9px`, scale: ".8" },
      ],
      { duration: 310, delay: i * 24, easing: sequenceEase, fill: "backwards" },
    ).finished;
  });
  void Promise.allSettled(marks).then(() => layer.remove());
}

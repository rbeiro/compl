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
export function sequence(nodes: (Element | null | undefined)[], { backwards = false } = {}) {
  const items = nodes.filter((n): n is Element => !!n && !(n as HTMLElement).hidden).slice(0, 8);
  const shift = backwards ? "-7px" : "7px";
  items.forEach((node, i) => {
    const entry = { opacity: 0.15, translate: `0 ${shift}` };
    const rest = { opacity: 1, translate: "0 0" };
    const frames =
      items.length === 1
        ? [entry, { opacity: 0.62, translate: "0 1px", offset: 0.35 }, { opacity: 0.65, offset: 0.55 }, rest]
        : [entry, rest];
    animate(node, frames, items.length > 1 ? 255 : 410, i * 54, sequenceEase);
  });
}

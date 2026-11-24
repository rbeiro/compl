// Port of legacy/public/motion-choices.js. Every motion on the public pages and
// sign-in uses the "carbon" preset: a short fade-and-lift via the Web
// Animations API. Respects prefers-reduced-motion like the original.

const carbonEase = "cubic-bezier(.2,0,.38,.9)";
const running = new WeakMap<Element, Animation>();

function reducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function animate(node: Element, frames: Keyframe[], duration: number, delay = 0) {
  if (!node.isConnected || !("animate" in node) || reducedMotion()) return;
  running.get(node)?.cancel();
  const animation = node.animate(frames, { duration, delay, easing: carbonEase, fill: "backwards" });
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

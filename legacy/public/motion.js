import {motionFor} from './motion-choices.js';

export function enterPanel(element, direction = 'up') {
  return motionFor('panel', element, {direction});
}

const observedLandings = new WeakMap();
export function observeLanding(landing) {
  if (!landing || observedLandings.has(landing)) return observedLandings.get(landing);
  function toggle(event) {
    const section = event.target;
    if (!section.matches?.('.tools-copy details')) return;
    const item = section.open ? section.querySelector('p') : section.querySelector('summary');
    motionFor('landing-tools', item);
  }
  landing.addEventListener('toggle', toggle, true);
  const observer = window.IntersectionObserver && new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      motionFor('landing-reveal', entry.target);
    }
  }, {threshold:.12});
  for (const item of landing.querySelectorAll('.home-project > div, .tools-photo, .tools-copy')) observer?.observe(item);
  const handle = {disconnect() {
    observer?.disconnect();
    landing.removeEventListener('toggle', toggle, true);
    observedLandings.delete(landing);
  }};
  observedLandings.set(landing,handle);
  return handle;
}

const cards = 'a.ws-metric,.workspace-card,.folder';
function highlight(event) {
  const card = event.target.closest?.(cards);
  if (!card || card.contains(event.relatedTarget)) return;
  if (event.type === 'focusin' && !card.matches(':focus-visible')) return;
  if (event.type === 'pointerover' && event.pointerType === 'touch') return;
  motionFor('control-focus',card);
}
document.addEventListener('pointerover',highlight);
document.addEventListener('focusin',highlight);

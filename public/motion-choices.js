import {motionStyles} from './motion-map.js';

const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
const running = new WeakMap();
const active = new Set();
const ease = 'cubic-bezier(.2,.75,.25,1)';
const gridEase = 'cubic-bezier(.2,0,.38,.9)';

reduced?.addEventListener?.('change', event => {
  if (event.matches) for (const animation of active) animation.cancel();
});

function animate(node, frames, duration, delay, id, easing = ease) {
  if (!node?.animate || !node.isConnected || reduced?.matches) return Promise.resolve();
  running.get(node)?.cancel();
  const animation = node.animate(frames, {id:'compi-' + id, duration, delay, easing, fill:'backwards'});
  running.set(node, animation);
  active.add(animation);
  return animation.finished.catch(() => {}).finally(() => {
    active.delete(animation);
    if (running.get(node) === animation) running.delete(node);
  });
}

function sparks(target, id) {
  const host = target.closest?.('button');
  if (!host) return [];
  host.querySelectorAll('[data-motion-sparks]').forEach(layer => layer.remove());
  const layer = document.createElement('span');
  layer.dataset.motionSparks = '';
  layer.setAttribute('aria-hidden','true');
  host.append(layer);
  const tasks = [-1,0,1].map((direction, i) => {
    const mark = document.createElement('i');
    layer.append(mark);
    return animate(mark, [
      {opacity:0, translate:'0 1px', scale:'.45'},
      {opacity:1, offset:.26},
      {opacity:0, translate:direction * 10 + 'px -9px', scale:'.8'}
    ], 310, i * 24, id);
  });
  return [Promise.all(tasks).finally(() => layer.remove())];
}

function run(id, node, options) {
  if (!node?.isConnected || !node.animate || reduced?.matches) return Promise.resolve();
  const style = motionStyles[id];
  if (!style) return Promise.resolve();
  // Only the separate numeric glyphs may pulse. Never fall back to an input, unit or row.
  if (id === 'hours-adjust' || id === 'cost-servings') {
    if (!node.matches?.('span[data-motion-number]') || !/^\p{Nd}+([.,]\p{Nd}+)?$/u.test(node.textContent)) return Promise.resolve();
  }
  const backwards = options.direction === 'previous' || options.direction === -1;
  const leaving = options.direction === 'out';
  const endpoints = Array.from(new Set(Array.from(options.items || []).filter(el =>
    el?.animate && el.isConnected && !el.hidden && !el.closest?.('[hidden]')))).slice(0,8);
  const items = endpoints.length ? endpoints : [node];
  if (style === 'tactil') {
    return animate(node, [
      {scale:'.985'}, {scale:'.95', offset:.22}, {scale:'1.022', offset:.52}, {scale:'1'}
    ], 370, 0, id);
  }
  if (style === 'duo') {
    const positive = options.positive !== false;
    const frames = positive ? [
      {scale:'1.1 .84'}, {translate:'0 -4px', scale:'.96 1.08', offset:.4},
      {translate:'0 1px', scale:'1.025 .97', offset:.72}, {translate:'0 0', scale:'1'}
    ] : [{scale:'.93'}, {scale:'1'}];
    return Promise.all([animate(node, frames, positive ? 405 : 170, 0, id), ...(positive ? sparks(node, id) : [])]);
  }
  if (style === 'carbon') {
    if (id === 'grow-notes') return animate(node,[{boxShadow:'0 0 0 2px rgb(35 96 65 / .18)'},{boxShadow:'0 0 0 0 transparent'}],175,0,id,gridEase);
    const sideways = id === 'panel';
    const entry = {opacity:sideways ? .6 : .28, translate:sideways ? (backwards ? '-24px 0' : '24px 0') : '0 8px'};
    const rest = {opacity:1, translate:'0 0'};
    return Promise.all(items.map((item, i) => animate(item, leaving ? [rest, {...entry,opacity:0}] : [entry,rest],
      leaving ? 145 : sideways ? 210 : 175, leaving ? 0 : i * 24, id, gridEase)));
  }
  return Promise.all(items.map((item, i) => {
    const stillImage = id === 'guide-labels' && item.tagName === 'IMG';
    const entry = stillImage ? {opacity:.15} : {opacity:.15, translate:'0 ' + (backwards ? '-7px' : '7px')};
    const rest = stillImage ? {opacity:1} : {opacity:1,translate:'0 0'};
    const frames = items.length === 1 && !stillImage
      ? [entry,{opacity:.62,translate:'0 1px',offset:.35},{opacity:.65,offset:.55},rest] : [entry,rest];
    return animate(item,frames,items.length > 1 ? 255 : 410,i * 54,id);
  }));
}

// Some panels are assembled offscreen and inserted synchronously by their caller.
export function motionFor(id, element, options = {}) {
  const mounted = !element || element.isConnected || !globalThis.requestAnimationFrame || reduced?.matches
    ? Promise.resolve() : new Promise(resolve => requestAnimationFrame(resolve));
  return mounted.then(() => run(id, element, options)).then(() => {}).finally(() => options.finished?.());
}

// Recent engines render the actual select and its customizable picker with select-menu.css.
// Older engines keep that same form control. Only its single-choice popup is enhanced.
import {motionFor} from './motion-choices.js';

let serial = 0;
const installed = new WeakMap();

function eligible(node) {
  return node?.localName === 'select' && !node.multiple && node.size <= 1 && !node.matches(':disabled');
}
function available(option) {
  return option && !option.disabled && !option.hidden &&
    !(option.parentElement?.localName === 'optgroup' && (option.parentElement.disabled || option.parentElement.hidden));
}
function popupName(select) {
  if (select.getAttribute('aria-label')) return select.getAttribute('aria-label');
  return [...(select.labels || [])].map(label => {
    const copy = label.cloneNode(true);
    copy.querySelectorAll('select,button,input,textarea,svg,[hidden]').forEach(node => node.remove());
    return copy.textContent.trim();
  }).join(' ') || select.title;
}

export function installSelectMenus(doc = document) {
  if (installed.has(doc)) return installed.get(doc);
  const view = doc.defaultView;
  const nativePicker = view.CSS?.supports('appearance','base-select') && view.CSS?.supports('selector(::picker(select))');
  if (nativePicker) return () => {};
  const subscription = new view.AbortController();
  const lifetime = {signal:subscription.signal};
  let open;

  function dismiss(restoreFocus = false) {
    if (!open) return;
    const {select,box,events,observer,treeObserver,resize,expanded,controls} = open;
    open = null;
    events.abort();observer.disconnect();treeObserver.disconnect();resize?.disconnect();
    box.remove();
    if (expanded === null) select.removeAttribute('aria-expanded');
    else select.setAttribute('aria-expanded',expanded);
    if (controls === null) select.removeAttribute('aria-controls');
    else select.setAttribute('aria-controls',controls);
    if (restoreFocus && select.isConnected && eligible(select)) select.focus({preventScroll:true});
  }
  function show(select) {
    if (!eligible(select)) return;
    dismiss();
    const events = new view.AbortController(), listen = {signal:events.signal};
    const box = doc.createElement('div');
    box.id = 'compi-listbox-' + (++serial);
    box.className = 'compi-select-list';
    const motion = select.matches('.ws-rec-category-filter') ? 'filter' :
      select.closest('[data-language-picker]') ? 'language' : null;
    if (motion) box.dataset.menuMotion = motion;
    box.setAttribute('role','listbox');
    box.tabIndex = -1;
    box.dir = view.getComputedStyle(select).direction || doc.documentElement.dir || 'ltr';
    if (typeof box.showPopover === 'function') box.setAttribute('popover','manual');
    const expanded = select.getAttribute('aria-expanded'), controls = select.getAttribute('aria-controls');
    select.setAttribute('aria-expanded','true');
    select.setAttribute('aria-controls',box.id);
    const owner = select.closest(box.showPopover ? 'dialog[open], [popover]:popover-open' : 'dialog[open]');
    (owner || doc.body).append(box);
    if (box.showPopover) box.showPopover();

    let active = select.selectedIndex, options = [], rows = [], typed = '', lastTyped = 0;
    const anchor = select.closest('[data-language-picker]') || select;
    function moveTo(index,scroll = true) {
      if (!available(options[index]) || !rows[index]) return;
      if (rows[active]) rows[active].classList.remove('is-active');
      active = index;
      rows[active].classList.add('is-active');
      box.setAttribute('aria-activedescendant',rows[active].id);
      if (scroll) {
        const item = rows[active].getBoundingClientRect(), panel = box.getBoundingClientRect();
        if (item.top < panel.top) box.scrollTop -= panel.top - item.top;
        if (item.bottom > panel.bottom) box.scrollTop += item.bottom - panel.bottom;
      }
    }
    function position() {
      if (!select.isConnected || !eligible(select) || !select.getClientRects().length) { dismiss();return; }
      const a = anchor.getBoundingClientRect(), vp = view.visualViewport;
      const left = (vp?.offsetLeft || 0) + 8, top = (vp?.offsetTop || 0) + 8;
      const right = left + (vp?.width || doc.documentElement.clientWidth) - 16;
      const bottom = top + (vp?.height || doc.documentElement.clientHeight) - 16;
      if (a.bottom < top || a.top > bottom || a.right < left || a.left > right) { dismiss();return; }
      const below = Math.max(0,bottom - a.bottom - 5), above = Math.max(0,a.top - top - 5);
      const up = below < Math.min(220,box.scrollHeight) && above > below;
      const room = up ? above : below;
      box.style.minWidth = Math.min(Math.max(a.width,170),right-left)+'px';
      box.style.maxWidth = Math.max(1,right-left)+'px';
      box.style.maxHeight = Math.max(1,Math.min(360,room))+'px';
      const metrics = box.getBoundingClientRect();
      const x = box.dir === 'rtl' ? a.right - metrics.width : a.left;
      box.style.left = Math.min(Math.max(left,x),Math.max(left,right-metrics.width))+'px';
      box.style.top = Math.max(top,up ? a.top - metrics.height - 5 : a.bottom + 5)+'px';
    }
    function refresh() {
      if (!select.isConnected || !eligible(select)) { dismiss();return; }
      const focusedOption = options[active];
      options = [...select.options];rows = [];
      const namedBy = select.getAttribute('aria-labelledby');
      box.removeAttribute('aria-labelledby');box.removeAttribute('aria-label');
      if (namedBy) box.setAttribute('aria-labelledby',namedBy);
      else { const name=popupName(select); if(name)box.setAttribute('aria-label',name); }
      box.replaceChildren();box.removeAttribute('aria-activedescendant');
      let group;
      const fragment = doc.createDocumentFragment();
      for (const [index,option] of options.entries()) {
        const parent = option.parentElement;
        if (option.hidden || parent.hidden) continue;
        let container = fragment;
        if (parent.localName === 'optgroup') {
          if (group?.element !== parent) {
            const node = doc.createElement('div'), title = doc.createElement('div');
            node.setAttribute('role','group');node.setAttribute('aria-label',parent.label);
            title.className = 'compi-select-group';title.textContent = parent.label;title.setAttribute('aria-hidden','true');
            node.append(title);fragment.append(node);group = {element:parent,node};
          }
          container = group.node;
        }
        const row = doc.createElement('div');
        row.className = 'compi-select-option';row.id = box.id+'-'+index;row.dataset.index = String(index);
        row.setAttribute('role','option');row.setAttribute('aria-selected',String(option.selected));
        if (!available(option)) row.setAttribute('aria-disabled','true');
        if (option.lang) row.lang = option.lang;
        if (option.dir) row.dir = option.dir;
        row.textContent = option.label;
        container.append(row);rows[index] = row;
      }
      box.append(fragment);
      const preserved = options.indexOf(focusedOption);
      const index = available(options[preserved]) ? preserved : select.selectedIndex;
      active = -1;
      position();
      if (open) moveTo(available(options[index]) ? index : options.findIndex(available));
    }
    function commit(index) {
      const choice = options[index];
      if (!available(choice) || !eligible(select) || !select.contains(choice)) return;
      const changed = select.selectedIndex !== choice.index;
      select.selectedIndex = choice.index;
      dismiss(true);
      if (changed) {
        select.dispatchEvent(new view.Event('input',{bubbles:true}));
        select.dispatchEvent(new view.Event('change',{bubbles:true}));
      }
    }
    function navigate(event) {
      const {key} = event;
      const enabled = options.map((option,index) => available(option) ? index : -1).filter(index => index >= 0);
      const at = enabled.indexOf(active);
      if (key === 'Tab') { dismiss(true);return; }
      if (key === 'Escape') dismiss(true);
      else if (key === 'Enter' || (key === ' ' && (!typed || performance.now()-lastTyped>700))) commit(active);
      else if (key === 'Home') moveTo(enabled[0]);
      else if (key === 'End') moveTo(enabled.at(-1));
      else if (key === 'ArrowDown') moveTo(enabled[Math.min(at+1,enabled.length-1)]);
      else if (key === 'ArrowUp') moveTo(enabled[Math.max(0,at-1)]);
      else if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing) {
        const now = performance.now();
        typed = now-lastTyped > 700 ? key : typed+key;lastTyped = now;
        const prefix = [...typed].every(ch => ch===key) ? key : typed;
        const collator = new Intl.Collator(doc.documentElement.lang || undefined,{sensitivity:'base',usage:'search'});
        const ordered = prefix.length === 1 ? [...enabled.slice(at+1),...enabled.slice(0,at+1)] : [...enabled.slice(Math.max(0,at)),...enabled.slice(0,Math.max(0,at))];
        const match = ordered.find(i => collator.compare(options[i].label.slice(0,prefix.length),prefix) === 0);
        if (match !== undefined) moveTo(match);
      } else return;
      event.preventDefault();event.stopPropagation();
    }
    const observer = new view.MutationObserver(refresh);
    const treeObserver = new view.MutationObserver(() => {
      if (!select.isConnected || !eligible(select) || select.closest('[hidden]')) dismiss();
    });
    const resize = view.ResizeObserver ? new view.ResizeObserver(position) : null;
    open = {select,box,events,observer,treeObserver,resize,expanded,controls};
    observer.observe(select,{subtree:true,childList:true,characterData:true,attributes:true});
    treeObserver.observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','hidden']});
    resize?.observe(anchor);
    refresh();
    if (!open) return;
    if (motion) motionFor(motion,box,motion==='filter' ? {items:rows.filter(Boolean)} : {});
    box.focus({preventScroll:true});
    box.addEventListener('keydown',navigate,listen);
    box.addEventListener('click',event => {
      const row=event.target.closest('[data-index]');
      if(row)commit(Number(row.dataset.index));
    },listen);
    doc.addEventListener('focusin',event => {
      if (!box.contains(event.target) && event.target !== select) dismiss();
    },listen);
    doc.addEventListener('scroll',event=>{if(!box.contains(event.target))position();},{...listen,capture:true});
    view.addEventListener('resize',position,listen);
    view.visualViewport?.addEventListener('resize',position,listen);
    view.visualViewport?.addEventListener('scroll',position,listen);
    view.addEventListener('compi:languagechange',refresh,listen);
    view.addEventListener('hashchange',()=>dismiss(),listen);
    select.addEventListener('change',()=>{active=select.selectedIndex;options=[];refresh();},listen);
    select.form?.addEventListener('reset',()=>queueMicrotask(()=>{if(open?.box===box){options=[];refresh();}}),listen);
  }

  doc.addEventListener('pointerdown',event=>{
    if (open && !open.box.contains(event.target) && event.target!==open.select) dismiss();
    if (event.button===0 && eligible(event.target)) event.preventDefault();
  },{...lifetime,capture:true});
  doc.addEventListener('mousedown',event=>{
    if (event.button===0 && eligible(event.target)) event.preventDefault();
  },{...lifetime,capture:true});
  doc.addEventListener('click',event=>{
    const select=event.target;
    if (!eligible(select) || event.defaultPrevented) return;
    event.preventDefault();
    if(open?.select===select)dismiss(true);else show(select);
  },lifetime);
  doc.addEventListener('keydown',event=>{
    if(!eligible(event.target) || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey)return;
    if(['ArrowDown','ArrowUp',' ','Enter','F4'].includes(event.key)){
      event.preventDefault();show(event.target);
    }
  },lifetime);
  const remove=()=>{dismiss();subscription.abort();installed.delete(doc);};
  installed.set(doc,remove);
  return remove;
}
if (typeof document!=='undefined')installSelectMenus(document);

import {platingHref} from './workspace-catalog.js';
import {motionFor} from './motion-choices.js';
import {bindAttr,bindComputed,bindText,locale,t} from './i18n.js';

const primary = [
  ['inicio','Inicio','home'], ['horarios','Horarios','calendar'], ['equipo','Equipo','users'],
  ['recetas','Recetas','book'], ['escandallos','Escandallos','cost'], ['plating','Plating Guides','plating'],
  ['generar','Generación de recetas','generate']
];
const secondary = [['archivo','Archivo','folder'],['correo','Correo','mail'],['seguridad','Seguridad','lock']];
const svgNS = 'http://www.w3.org/2000/svg';
const shellOwners = new WeakMap();
const railIcons = new Set(['home','users','plating','menu','close','sun','plus']);
const spriteIcons = {location:'hotel',generate:'compose'};
function el(tag,cls='') {
  const element=document.createElement(tag);
  if(cls)element.className=cls;
  return element;
}
function translated(tag,key,cls='') {
  return bindText(el(tag,cls),key);
}
function literal(tag,text,cls='') {
  const element=el(tag,cls);
  element.textContent=text;
  return element;
}
export function workspaceIcon(name) {
  const svg=document.createElementNS(svgNS,'svg');
  svg.classList.add('icon','ws-icon');
  svg.setAttribute('aria-hidden','true');
  svg.setAttribute('focusable','false');
  const use=document.createElementNS(svgNS,'use');
  use.setAttribute('href',railIcons.has(name)?'/brand/workspace.svg#'+name:'/brand/ui.svg#'+(spriteIcons[name]||name));
  svg.append(use);
  return svg;
}
function localLink(href,cls='') {
  const link=el('a',cls);
  link.setAttribute('href',href);
  return link;
}
function actionLink(href,key,iconName,cls='') {
  const link=localLink(href,cls);
  link.append(workspaceIcon(iconName),translated('span',key));
  return link;
}
function iconButton(key,name,cls) {
  const button=el('button',cls);
  button.type='button';
  bindAttr(button,'aria-label',key);
  button.append(workspaceIcon(name));
  return button;
}
export function mountShell({main,section,title,hotel,links={},signal}) {
  shellOwners.get(main)?.();
  const header=document.querySelector('.masthead-inner');
  const masthead=header?.closest('header'), skip=document.querySelector('.skip');
  const rail=el('aside','ws-rail'), scrim=el('div','ws-scrim'), content=el('div','ws-main-content');
  content.tabIndex=-1;
  skip?.addEventListener('click',()=>content.focus(),{signal});
  rail.id='ws-rail';
  bindAttr(rail,'aria-label','Mi entorno de trabajo');
  const logo=localLink('#/inicio','ws-brand');
  bindAttr(logo,'aria-label','CompI · Inicio');
  const image=el('img');
  image.src='/brand/assets/logo/compi-logo-green.svg';image.alt='CompI';image.width=150;image.height=40;
  logo.append(image);
  const railHead=el('div','ws-rail-head');
  const close=iconButton('Cerrar menú','close','ws-rail-close');
  railHead.append(logo,close);
  const label=translated('p','Mi entorno de trabajo','ws-rail-label');
  const nav=el('nav','ws-nav');
  bindAttr(nav,'aria-label','Navegación principal');
  const tools=el('div','ws-support');
  for(const [key,text,icon] of [...primary,...secondary]) {
    if(!links[key])continue;
    const link=actionLink(links[key],text,icon,'ws-nav-link');
    if(section===key)link.setAttribute('aria-current','page');
    (primary.some(item=>item[0]===key)?nav:tools).append(link);
  }
  rail.append(railHead,label,nav,tools);
  scrim.hidden=true;
  scrim.setAttribute('aria-hidden','true');
  const toggle=iconButton('Abrir menú','menu','ws-menu-toggle');
  toggle.setAttribute('aria-controls',rail.id);
  const area=el('div','ws-top-context'), contextIcon=el('span','ws-hotel-icon');
  contextIcon.append(workspaceIcon('location'));
  const context=el('div','ws-hotel-copy');
  if(hotel)context.append(literal('strong',hotel),translated('small','Mi entorno de trabajo'));
  else context.append(translated('strong','Mi entorno de trabajo'));
  area.append(contextIcon,context);
  const currentTitle=title||[...primary,...secondary].find(item=>item[0]===section)?.[1];
  if(currentTitle)area.append(translated('span',currentTitle,'ws-crumb'));
  header?.prepend(toggle,area);
  main.classList.add('ws-frame');
  main.replaceChildren(rail,scrim,content);
  const mobile=window.matchMedia('(max-width: 760px)');
  let opened=false;
  function drawer(open,focus=false) {
    const wasOpen=opened;
    opened=mobile.matches&&open;
    rail.classList.toggle('is-open',opened);
    rail.inert=mobile.matches&&!opened;
    scrim.hidden=!opened;
    toggle.setAttribute('aria-expanded',String(opened));
    if(masthead)masthead.inert=opened;
    if(skip)skip.inert=opened;
    if(opened) {
      rail.setAttribute('role','dialog');rail.setAttribute('aria-modal','true');
      close.focus();
    } else {
      rail.removeAttribute('role');rail.removeAttribute('aria-modal');
      if(focus&&mobile.matches)toggle.focus();
    }
    content.inert=opened;
    if(opened&&!wasOpen)motionFor('mobile-nav',rail,{items:[railHead,...nav.children,...tools.children]});
    else if(wasOpen&&!opened&&mobile.matches)motionFor('mobile-nav',content,{items:[toggle,content.querySelector('h1')].filter(Boolean)});
  }
  toggle.addEventListener('click',()=>drawer(!opened,true),{signal});
  close.addEventListener('click',()=>drawer(false,true),{signal});
  scrim.addEventListener('click',()=>drawer(false,true),{signal});
  rail.addEventListener('click',event=>{
    if(opened&&event.target.closest('a'))drawer(false,true);
  },{signal});
  rail.addEventListener('keydown',event=>{
    if(!opened)return;
    if(event.key==='Escape'){event.preventDefault();drawer(false,true);return;}
    if(event.key!=='Tab')return;
    const focusable=[...rail.querySelectorAll('a[href],button,summary,input:checked')].filter(control=>control.getClientRects().length);
    const first=focusable[0],last=focusable.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  },{signal});
  mobile.addEventListener('change',()=>drawer(false),{signal});
  drawer(false);
  function remove() {
    if(shellOwners.get(main)!==remove)return;
    shellOwners.delete(main);
    if(masthead)masthead.inert=false;
    if(skip)skip.inert=false;
    toggle.remove();area.remove();rail.remove();scrim.remove();
    main.classList.remove('ws-frame');
  }
  shellOwners.set(main,remove);
  signal?.addEventListener('abort',remove,{once:true});
  return content;
}
function count(el,value) {
  bindComputed(el,()=>new Intl.NumberFormat(locale()).format(value));
}
function guideRoute(guide) {
  if(guide.guide_state==='ready')return platingHref(guide);
  return '#/empresa/'+[guide.hotel,guide.outlet,'Plating Guides',guide.guide_key].map(encodeURIComponent).join('/');
}
function overviewMetric(title,value,icon,href) {
  const card=href?localLink(href,'ws-metric'):el('article','ws-metric');
  const top=el('div','ws-metric-top');
  top.append(translated('span',title),workspaceIcon(icon));
  const number=el('strong');
  count(number,value);
  card.append(top,number);
  if(href)card.append(workspaceIcon('arrow'));
  return card;
}
export function renderInicio({content,hotel,links={},guides=[],outlets=[],access=[]}) {
  const root=el('div','ws-overview');
  const hero=el('section','ws-welcome'),intro=el('div','ws-intro');
  const today=el('time','ws-eyebrow ws-today');
  const date=new Date();
  today.dateTime=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  bindComputed(today,()=>new Intl.DateTimeFormat(locale(),{weekday:'long',day:'numeric',month:'long'}).format(date));
  intro.append(today,translated('h1','Tu cocina, en armonía.'),translated('p','Consulta la actividad y las fichas de tu equipo.'));
  const shortcuts=el('div','ws-welcome-actions');
  if(links.generar)shortcuts.append(actionLink(links.generar,'Crear ficha','plus','ws-button ws-button-primary'));
  if(links.recetas)shortcuts.append(actionLink(links.recetas,'Ver recetario','arrow','ws-button ws-button-text'));
  if(shortcuts.children.length)intro.append(shortcuts);
  const hotelCard=el('article','ws-hotel-card'),top=el('div','ws-card-top');
  top.append(translated('span','Tu espacio de trabajo','ws-eyebrow'),workspaceIcon('sun'));
  const hotelName=hotel?literal('h2',hotel):translated('h2','Mi entorno de trabajo');
  const bottom=el('div','ws-hotel-bottom'),outletCount=el('span');
  bindComputed(outletCount,()=>t(outlets.length===1?'{count} outlet':'{count} outlets',{count:new Intl.NumberFormat(locale()).format(outlets.length)}));
  bottom.append(outletCount);
  if(links.horarios)bottom.append(actionLink(links.horarios,'Ver horarios','arrow','ws-inline-link'));
  hotelCard.append(top,hotelName,bottom);hero.append(intro,hotelCard);root.append(hero);
  if(!access.length) {
    root.append(translated('p','Tu cuenta todavía no tiene acceso a un hotel.','ws-empty'));
    content.replaceChildren(root);return;
  }
  const ready=guides.filter(guide=>guide.guide_state==='ready').length;
  const drafts=guides.filter(guide=>guide.guide_state==='draft').length;
  const metrics=el('section','ws-metrics');
  bindAttr(metrics,'aria-label','Resumen del catálogo');
  metrics.append(overviewMetric('Hoteles',new Set(access.map(row=>row.hotel_key)).size,'location',links.archivo),
    overviewMetric('Outlets',outlets.length,'folder',links.plating),
    overviewMetric('Fichas técnicas',guides.length,'book',links.recetas),
    overviewMetric('Borradores',drafts,'file',links.plating));
  root.append(metrics);
  const panels=el('div','ws-panels');
  const catalog=el('section','ws-panel'),catalogHead=el('div','ws-panel-head');
  catalogHead.append(translated('h2','En tu recetario'));
  if(links.recetas)catalogHead.append(actionLink(links.recetas,'Ver recetario','arrow','ws-inline-link'));
  catalog.append(catalogHead);
  if(!guides.length)catalog.append(translated('p','Todavía no hay documentos disponibles para tu cuenta.','ws-empty'));
  else {
    const list=el('ul','ws-guide-list');
    for(const guide of guides.slice(0,4)) {
      const li=el('li'),link=localLink(guideRoute(guide),'ws-guide-link');
      const mark=el('span','ws-guide-mark');mark.append(workspaceIcon('book'));
      const copy=el('span','ws-guide-copy');
      const dish=literal('strong',guide.title);dish.translate=false;
      copy.append(dish,literal('small',[guide.hotel,guide.outlet].filter(Boolean).join(' · ')));
      link.append(mark,copy,workspaceIcon('arrow'));li.append(link);list.append(li);
    }
    catalog.append(list);
  }
  const service=el('section','ws-panel'),serviceHead=el('div','ws-panel-head');
  serviceHead.append(translated('h2','Estado de las fichas'));service.append(serviceHead);
  const stats=el('dl','ws-state-list');
  for(const [key,value] of [['Publicadas',ready],['Borradores',drafts]]) {
    const term=translated('dt',key),number=el('dd'),bar=el('div','ws-bar');
    const fill=el('span');fill.style.width=(guides.length?100*value/guides.length:0)+'%';
    bar.setAttribute('aria-hidden','true');bar.append(fill);count(number,value);
    const group=el('div','ws-state-row');number.append(bar);group.append(term,number);stats.append(group);
  }
  service.append(stats);panels.append(catalog,service);root.append(panels);
  content.replaceChildren(root);
  motionFor('workspace-home',metrics,{items:[...metrics.children]});
}

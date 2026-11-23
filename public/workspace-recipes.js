import {guideURL,releaseGuideURL} from './guide-language-image.js';
import {shownText} from './content-language.js';
import {bindAttr, bindComputed, bindText, locale, t} from './i18n.js';
import {GUIDE_CATEGORIES, GUIDE_KINDS, restaurantKey, restaurantChoices} from './workspace-catalog.js';
import {readLegacyGuide} from './workspace-legacy-guide.js';
import {motionFor} from './motion-choices.js';

const paths = {
  search:'m20 20-4.5-4.5 M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0',
  grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  list:'M4 5h2 M9 5h12 M4 12h2 M9 12h12 M4 19h2 M9 19h12',
  heart:'M20.7 4.9a5.4 5.4 0 0 0-7.6 0L12 6l-1.1-1.1a5.4 5.4 0 0 0-7.6 7.6L12 21l8.7-8.5a5.4 5.4 0 0 0 0-7.6z',
  book:'M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1zm0 0v15',
  arrow:'M4 12h15m-6-6 6 6-6 6', plus:'M12 5v14M5 12h14', close:'m6 6 12 12M18 6 6 18',
  clock:'M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0'
};

function icon(name) {
  const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 24 24');
  svg.setAttribute('aria-hidden','true');
  const line=document.createElementNS(ns,'path');
  line.setAttribute('d',paths[name]);
  svg.append(line);
  return svg;
}
function el(tag,css) {
  const n=document.createElement(tag);
  if(css)n.className=css;
  return n;
}
function real(tag,value,css) {
  const n=el(tag,css);
  n.dir='auto';
  n.textContent=value;
  return n;
}
function label(tag,key,css) {return bindText(el(tag,css),key);}
function action(key,onClick,css,iconName) {
  const b=el('button',css);
  b.type='button';
  if(iconName)b.append(icon(iconName));
  b.append(label('span',key));
  b.addEventListener('click',onClick);
  return b;
}
function iconButton(key,iconName,onClick,css) {
  const b=el('button',css);
  b.type='button';
  bindAttr(b,'aria-label',key);
  bindAttr(b,'title',key);
  b.append(icon(iconName));
  b.addEventListener('click',onClick);
  return b;
}
function link(href,key,css,iconName) {
  const a=el('a',css);
  a.href=href;
  if(iconName)a.append(icon(iconName));
  a.append(label('span',key));
  return a;
}
function option(select,value,caption) {
  const o=label('option',caption);
  o.value=value;
  select.append(o);
}
const rowKey=row=>JSON.stringify([row.hotel_key,row.outlet_key,row.guide_key]);
const folded=text=>String(text??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const emptyChoice='__none';
const pluralKinds={plato:'Platos',elaboracion:'Elaboraciones'};
const pillStatus=row=>row.guide_state==='draft'?'Borrador':row.guide_state==='ready'?'Publicada':'';

export function renderRecipes({content,catalog,openDocumentHref,canEdit,saveClassification,signal,rpc,
  canCreate=false,newRecipeHref,platingHref,loadRecipeImage,getGuideMedia,favoriteScope,selectedOutlet,hotel}) {
  const rows=Array.isArray(catalog)?catalog:[];
  const host=el('section','ws-recipes');
  let kind='',category='',restaurant='',query='',view='grid',shown=[];
  const cards=new Map(), thumbs=new Map(),urls=new Set(),pictureTargets=new WeakMap();
  const favStorage=favoriteScope?'compi.recipe-favorites.'+favoriteScope:null;
  let favorites=new Set();
  if(favStorage)try {
    const saved=JSON.parse(sessionStorage.getItem(favStorage)||'[]');
    if(Array.isArray(saved))favorites=new Set(saved.filter(v=>typeof v==='string'));
  }catch{}
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
    for(const {target,isIntersecting} of entries)if(isIntersecting) {
      observer.unobserve(target);
      const row=pictureTargets.get(target);
      if(row)void showThumbnail(target,row);
    }
  },{rootMargin:'120px'}):null;
  const legacy=new Map(), queue=[];
  let activeReads=0;
  function drain(){
    while(activeReads<2&&queue.length){
      const {row,resolve}=queue.shift();
      if(signal.aborted){resolve(null);continue;}
      activeReads++;
      Promise.resolve().then(()=>getGuideMedia(row,'docx',signal)).then(readLegacyGuide).then(resolve,()=>resolve(null))
        .finally(()=>{activeReads--;drain();});
    }
  }
  function legacyGuide(row){
    if(!getGuideMedia || row.has_source!==false || row.guide_state!=='ready')return Promise.resolve(null);
    const key=rowKey(row);
    if(!legacy.has(key))legacy.set(key,new Promise(resolve=>{queue.push({row,resolve});drain();}));
    return legacy.get(key);
  }
  async function showThumbnail(container,row) {
    if(signal.aborted)return;
    const key=rowKey(row);
    // Rerendered cards and the detail pane share a single private media request per guide.
    if(!thumbs.has(key))thumbs.set(key,Promise.resolve().then(async()=>{
      if(row.has_image&&loadRecipeImage)return loadRecipeImage(row,signal);
      return (await legacyGuide(row))?.image;
    }).then(blob=>{
      if(signal.aborted||!(blob instanceof Blob)||!/^image\/(jpeg|png|webp)$/i.test(blob.type))return '';
      const url=guideURL(blob,row);
      urls.add(url);
      return url;
    }).catch(()=>''));
    const url=await thumbs.get(key);
    if(!url||signal.aborted||!container.isConnected)return;
    const img=el('img');
    img.alt='';
    img.decoding='async';img.src=url;
    container.prepend(img);
    container.classList.add('has-photo');
  }
  function cover(row) {
    const frame=el('span','ws-rec-cover');
    const placeholder=el('span','ws-rec-cover-icon');
    placeholder.append(icon('book'));frame.append(placeholder);
    if(row.has_image || (!row.has_source&&row.guide_state==='ready'&&getGuideMedia)) {
      if(observer){pictureTargets.set(frame,row);observer.observe(frame);}
      else queueMicrotask(()=>void showThumbnail(frame,row));
    }
    frame.append(label('span',GUIDE_CATEGORIES[row.category]||'Sin clasificar','ws-rec-category'));
    return frame;
  }
  const head=el('header','ws-rec-head'), headCopy=el('div');
  const locationLabel=(typeof selectedOutlet==='string'?selectedOutlet:selectedOutlet?.outlet)||hotel;
  if(locationLabel)headCopy.append(real('p',locationLabel,'ws-rec-context'));
  headCopy.append(label('h1','Un recetario vivo.'),label('p','Platos y elaboraciones de tu cocina.','ws-rec-intro'));
  head.append(headCopy);
  if(canCreate&&newRecipeHref)head.append(link(newRecipeHref,'Nueva receta','ws-rec-primary','plus'));
  const tools=el('div','ws-rec-tools'), types=el('div','ws-rec-types'), right=el('div','ws-rec-controls');
  types.setAttribute('role','group');bindAttr(types,'aria-label','Tipo de receta');
  const buttons=new Map();
  for(const [value,key] of [['','Todos'],...Object.entries(pluralKinds),[emptyChoice,'Sin clasificar']]) {
    const b=action(key,()=>{if(kind!==value){kind=value;refresh('filter');}},'ws-rec-type');
    b.dataset.kind=value;
    types.append(b);buttons.set(value,b);
  }
  const searchLabel=el('label','ws-rec-search'), search=el('input');
  search.type='search';bindAttr(search,'aria-label','Buscar una receta');bindAttr(search,'placeholder','Buscar una receta…');
  search.addEventListener('input',()=>{query=search.value;refresh('recipe-search');});searchLabel.append(icon('search'),search);
  const outletSelect=el('select','ws-rec-category-filter ws-rec-outlet-filter');
  outletSelect.name='recipeRestaurantFilter';bindAttr(outletSelect,'aria-label','Restaurante');
  option(outletSelect,'','Todos los restaurantes');
  for(const {key,label:name} of restaurantChoices(rows)){
    const item=el('option');item.value=key;item.textContent=name;item.translate=false;outletSelect.append(item);
  }
  outletSelect.addEventListener('change',()=>{restaurant=outletSelect.value;refresh('filter');});
  const categorySelect=el('select','ws-rec-category-filter');
  categorySelect.name='recipeCategoryFilter';bindAttr(categorySelect,'aria-label','Categoría');
  option(categorySelect,'','Todas las categorías');
  for(const [value,key] of Object.entries(GUIDE_CATEGORIES))option(categorySelect,value,key);
  option(categorySelect,emptyChoice,'Sin clasificar');
  Array.from(categorySelect.options).forEach((item,index)=>item.style.setProperty('--rec-option-delay',Math.min(index,7)*55+'ms'));
  categorySelect.addEventListener('change',()=>{category=categorySelect.value;refresh('filter');});
  const views=el('div','ws-rec-views');
  views.setAttribute('role','group');bindAttr(views,'aria-label','Vista de recetas');
  const gridMode=iconButton('Vista de tarjetas','grid',()=>changeView('grid'),'ws-rec-view');
  const listMode=iconButton('Vista de lista','list',()=>changeView('list'),'ws-rec-view');
  views.append(gridMode,listMode);right.append(outletSelect,categorySelect,searchLabel,views);tools.append(types,right);
  const count=el('p','ws-rec-count');
  count.setAttribute('role','status');
  const grid=el('div','ws-rec-grid');
  host.append(head,tools,count,grid);content.replaceChildren(host);
  let dialog;
  function refreshView() {
    grid.classList.toggle('ws-rec-list',view==='list');
    gridMode.setAttribute('aria-pressed',String(view==='grid'));
    listMode.setAttribute('aria-pressed',String(view==='list'));
  }
  function changeView(next) {
    if(next===view)return;
    view=next;refreshView();
    motionFor('recipe-layout',grid,{items:grid.children});
  }
  function favorite(row) {
    const key=rowKey(row);
    const b=iconButton('Añadir a favoritos','heart',()=>{
      if(favorites.has(key))favorites.delete(key);else favorites.add(key);
      if(favStorage)try{sessionStorage.setItem(favStorage,JSON.stringify([...favorites]));}catch{}
      update();
      motionFor('recipe-favorite',b.querySelector('svg'),{positive:favorites.has(key)});
    },'ws-rec-favorite');
    function update(){
      const active=favorites.has(key);
      b.setAttribute('aria-pressed',String(active));
      const caption=active?'Quitar {name} de favoritos':'Añadir {name} a favoritos';
      bindAttr(b,'aria-label',caption,{name:row.title});
      bindAttr(b,'title',caption,{name:row.title});
    }
    update();return b;
  }
  function card(row) {
    const article=el('article','ws-rec-card');
    const main=el('button','ws-rec-open');
    main.type='button';bindAttr(main,'aria-label','Abrir {name}',{name:row.title});
    main.addEventListener('click',()=>openDetail(row));
    cards.set(rowKey(row),main);
    const body=el('span','ws-rec-copy'), top=el('span','ws-rec-topline');
    const kindLabel=label('span',GUIDE_KINDS[row.kind]||'Sin clasificar','ws-rec-kind');
    if(row.partida)kindLabel.append(' · ',real('bdi',row.partida));
    top.append(kindLabel);
    const status=pillStatus(row);if(status)top.append(label('span',status,'ws-rec-status '+row.guide_state));
    body.append(top,real('strong',row.title,'ws-rec-title'));
    if(row.sala_es)body.append(real('span',row.sala_es,'ws-rec-description'));
    const meta=el('span','ws-rec-meta');
    if(row.pase)meta.append(icon('clock'),real('span',row.pase));
    meta.append(real('span',[row.hotel,row.outlet].filter(Boolean).join(' · '),'ws-rec-outlet'),icon('arrow'));
    body.append(meta);main.append(cover(row),body);article.append(main,favorite(row));return article;
  }
  function refresh(motion){
    if(signal.aborted)return;
    const needle=folded(query.trim());
    shown=rows.filter(row=>(!restaurant||restaurantKey(row)===restaurant)&&(!kind||(row.kind||emptyChoice)===kind)&&(!category||(row.category||emptyChoice)===category)
      &&(!needle||[row.title,shownText(row.title),row.nombre_en,row.partida,row.hotel,row.outlet,t(GUIDE_CATEGORIES[row.category]||'Sin clasificar')].some(s=>folded(s).includes(needle))));
    observer?.disconnect();cards.clear();grid.replaceChildren();
    for(const [value,b] of buttons){
      b.setAttribute('aria-pressed',String(value===kind));
      b.hidden=value===emptyChoice&&kind!==emptyChoice&&!rows.some(row=>!row.kind);
    }
    bindComputed(count,()=>t(shown.length===1?'{n} receta':'{n} recetas',{n:new Intl.NumberFormat(locale()).format(shown.length)}));
    if(shown.length)grid.append(...shown.map(card));
    else {
      const empty=el('div','ws-rec-empty');empty.append(icon(rows.length?'search':'book'),label('h2',rows.length?'No hay coincidencias':'Todavía no hay recetas'));
      if(rows.length)empty.append(action('Mostrar todas',()=>{kind=category=restaurant=query=search.value=outletSelect.value=categorySelect.value='';refresh('filter');search.focus();},'ws-rec-secondary'));
      grid.append(empty);
    }
    if(motion)motionFor(motion,grid,{items:grid.children});
  }

  function editClassification(parent,row,onSaved){
    if(!saveClassification||!canEdit?.(row)||row.can_classify===false)return;
    const details=el('details','ws-rec-edit');
    details.append(label('summary','Editar clasificación'));
    const form=el('form'), group=el('div','ws-rec-edit-fields');
    function selectField(key,name,choices,value){
      const l=el('label'), s=el('select');
      s.name=name;l.append(label('span',key));
      option(s,'','Sin clasificar');for(const [slug,caption] of Object.entries(choices))option(s,slug,caption);
      s.value=value||'';l.append(s);group.append(l);return s;
    }
    const kindInput=selectField('Tipo de receta','guideKind',GUIDE_KINDS,row.kind);
    const categoryInput=selectField('Categoría','guideCategory',GUIDE_CATEGORIES,row.category);
    const save=label('button','Guardar clasificación','ws-rec-secondary');
    save.type='submit';
    const message=el('p','ws-rec-save-status');message.setAttribute('role','status');
    form.append(group,save,message);details.append(form);parent.append(details);
    details.addEventListener('toggle',()=>{
      if(details.open)motionFor('recipe-classification',form,{items:[...group.children,save]});
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(save.disabled||signal.aborted)return;
      const nextKind=kindInput.value||null,nextCategory=categoryInput.value||null;
      save.disabled=kindInput.disabled=categoryInput.disabled=true;bindText(message,'');
      try{
        await saveClassification(row,nextKind,nextCategory);
        if(signal.aborted)return;
        row.kind=nextKind;row.category=nextCategory;refresh();onSaved();
        bindText(message,'Clasificación guardada.');
        motionFor('recipe-classification',message);
      }catch{
        if(!signal.aborted)bindText(message,'No se pudo guardar la clasificación. Vuelve a intentarlo.');
      }finally{if(!signal.aborted)save.disabled=kindInput.disabled=categoryInput.disabled=false;}
    });
  }

  async function openDetail(row){
    if(dialog?.open)return;
    const drawer=el('dialog','ws-rec-drawer');
    dialog=drawer;
    let closing=false;
    function closeDrawer(){
      if(closing||!drawer.open)return;
      closing=true;
      if(typeof drawer.animate!=='function'||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
        drawer.close();return;
      }
      void motionFor('panel',drawer,{direction:'out'}).then(()=>{if(drawer.open)drawer.close();});
    }
    const header=el('header'), heading=real('h2',row.title);
    heading.id='ws-recipe-detail-title';drawer.setAttribute('aria-labelledby',heading.id);
    const x=iconButton('Cerrar','close',closeDrawer,'ws-rec-close');
    header.append(heading,x);
    const body=el('div','ws-rec-drawer-body'), detail=el('section','ws-rec-detail-data');
    const displayTypes=el('p','ws-rec-classification');
    function showTypes(){
      displayTypes.replaceChildren(label('span',GUIDE_KINDS[row.kind]||'Sin clasificar'));
      if(row.category&&GUIDE_CATEGORIES[row.category])displayTypes.append(label('span',GUIDE_CATEGORIES[row.category]));
    }
    showTypes();
    body.append(cover(row),displayTypes,detail);
    const summary=(data={})=>{
      detail.replaceChildren();
      if(data.sala_es||row.sala_es)detail.append(real('p',data.sala_es||row.sala_es,'ws-rec-detail-desc'));
      if(data.nombre_en){const english=real('p',data.nombre_en,'ws-rec-detail-en');english.dataset.contentLang='en';detail.append(english);}
      const dl=el('dl','ws-rec-data');
      for(const [caption,value] of [['Hotel y outlet',[row.hotel,row.outlet].filter(Boolean).join(' · ')],['Partida',data.partida||row.partida],
        ['Tiempo de pase',data.pase||row.pase],['Ración y unidad',data.racion||row.racion],['Vajilla',data.vajilla]]){
        if(value)dl.append(label('dt',caption),real('dd',value));
      }
      detail.append(dl);
      if(Array.isArray(data.ingredientes)&&data.ingredientes.some(i=>i.nombre)){
        const heading=label('h3','Ingredientes'),list=el('ul');
        for(const i of data.ingredientes)if(i.nombre)list.append(real('li',[i.nombre,i.cantidad,i.unidad].filter(Boolean).join(' · ')));
        detail.append(heading,list);
      }
    };
    summary();
    editClassification(body,row,showTypes);
    const footer=el('footer');
    const href=openDocumentHref?.(row);
    if(href)footer.append(link(href,'Abrir ficha completa','ws-rec-primary ws-rec-full','book'));
    const plating=platingHref?.(row);
    if(plating)footer.append(link(plating,'Guía de emplatado','ws-rec-secondary','arrow'));
    drawer.append(header,body,footer);host.append(drawer);
    drawer.addEventListener('click',e=>{if(e.target===drawer){
      const r=drawer.getBoundingClientRect();
      if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDrawer();
    }});
    drawer.addEventListener('cancel',event=>{event.preventDefault();closeDrawer();});
    drawer.addEventListener('close',()=>{
      drawer.remove();if(dialog===drawer)dialog=null;
      if(!signal.aborted)(cards.get(rowKey(row))||search).focus();
    },{once:true});
    drawer.showModal();
    motionFor('panel',drawer);
    motionFor('recipe',body,{items:[...body.children,footer]});
    try{
      const response=row.has_source===false?await legacyGuide(row):await rpc?.('compi_workspace_guide',{h:row.hotel_key,o:row.outlet_key,g:row.guide_key},signal);
      if(!signal.aborted&&!closing&&drawer.open&&response?.data)summary(response.data);
    }catch{
      if(!signal.aborted&&drawer.open)detail.append(label('p','No se pudieron cargar los detalles de la receta.','ws-rec-save-status'));
    }
  }
  signal.addEventListener('abort',()=>{
    observer?.disconnect();
    if(dialog?.open)dialog.close();
    for(const url of urls)releaseGuideURL(url);
    thumbs.clear();legacy.clear();drain();
  },{once:true});
  window.addEventListener('compi:languagechange',()=>{if(query)refresh();},{signal});
  refreshView();refresh();
}

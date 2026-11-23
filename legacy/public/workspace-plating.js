import {bindAttr,bindComputed,bindText,t} from './i18n.js';
import {restaurantKey,restaurantChoices} from './workspace-catalog.js';
import {GUIDE_CATEGORIES} from './workspace-catalog.js';
import {readLegacyGuide} from './workspace-legacy-guide.js';
import {motionFor} from './motion-choices.js';

const ns='http://www.w3.org/2000/svg';
const symbols={search:'M18 18l4 4M19 10a8 8 0 1 1-16 0 8 8 0 1 1 16 0',check:'m5 12 4 4L19 6',book:'M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2ZM12 6v15',
  next:'M4 12h15m-6-6 6 6-6 6',prev:'m14 6-6 6 6 6',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0',
  image:'M3 4h18v16H3zM3 16l6-6 5 5 3-3 4 4',clock:'M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0M12 6v6l4 2'};
function icon(name){
  const svg=document.createElementNS(ns,'svg'),p=document.createElementNS(ns,'path');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.classList.add('kit-icon');
  p.setAttribute('d',symbols[name]);svg.append(p);return svg;
}
function el(tag,cls='',value){
  const item=document.createElement(tag);if(cls)item.className=cls;
  if(value!=null)item.textContent=value;return item;
}
const label=(tag,key,cls='')=>bindText(el(tag,cls),key);
function button(cls,key,action,mark){
  const btn=el('button',cls);btn.type='button';
  if(mark)btn.append(icon(mark));
  if(key)btn.append(label('span',key));
  btn.addEventListener('click',action);return btn;
}
const identity=row=>[row.hotel_key,row.outlet_key,row.guide_key].join('/');
const emptyData=()=>({pasos:[]});

export function renderPlating({content,catalog,selected,selectedOutlet,openDocumentHref,platingHref,getGuideMedia,rpc,signal}){
  const rows=catalog||[],view=el('section','ws-plating');
  // Interface labels use the locale bindings; dish text and annotations belong to the approved guide.
  view.translate=false;
  content.replaceChildren(view);
  let index=Math.max(0,rows.findIndex(row=>selected&&identity(row)===identity(selected)));
  let step=0,showLabels=true,record,controller;
  const cache=new Map(),reviews=new Set();
  function entry(row){
    const key=identity(row);
    if(!cache.has(key)){
      if(cache.size>=5){
        const oldest=cache.keys().next().value;
        for(const url of cache.get(oldest).urls)URL.revokeObjectURL(url);
        cache.delete(oldest);
      }
      cache.set(key,{urls:[],data:emptyData()});
    }
    const item=cache.get(key);cache.delete(key);cache.set(key,item);return item;
  }
  const urlFor=(blob,item)=>{
    if(!blob?.size)return null;const url=URL.createObjectURL(blob);item.urls.push(url);return url;
  };
  signal?.addEventListener('abort',()=>{controller?.abort();for(const v of cache.values())for(const u of v.urls)URL.revokeObjectURL(u);cache.clear();},{once:true});
  const head=el('header','kit-page-head'),copy=el('div'),context=el('div','kit-eyebrow');
  copy.append(context,label('h1','El último gesto importa.','kit-page-title'),label('p','Una referencia visual para cada plato y cada servicio.','kit-page-desc'));
  const reviewButton=button('kit-btn kit-primary kit-review',null,()=>mark(!rows[index].reviewed),'check');
  const reviewText=el('span');reviewButton.append(reviewText);head.append(copy);if(rows.length)head.append(reviewButton);view.append(head);
  const toast=el('p','kit-message');toast.setAttribute('role','status');view.append(toast);
  const toolsPanel=el('div','kit-guide-filter');
  const categoryBox=el('label','kit-filter-field'),category=el('select','kit-guide-category');
  categoryBox.append(label('span','Clasificación'),category);
  const outletBox=el('label','kit-filter-field'),outlet=el('select','kit-guide-outlet');
  outletBox.append(label('span','Restaurante'),outlet);
  outlet.append(option('','Todos los restaurantes'));
  for(const {key,label:name} of restaurantChoices(rows)){const item=el('option','',name);item.value=key;outlet.append(item);}

  function option(value,text){
    const opt=label('option',text);opt.value=value;return opt;
  }
  category.append(option('','Todas las clasificaciones'));
  category.append(option('kind:plato','Platos'),option('kind:elaboracion','Elaboraciones'));
  for(const [value,text] of Object.entries(GUIDE_CATEGORIES))category.append(option(value,text));
  category.append(option('unclassified','Sin clasificar'));
  const searchBox=el('div','kit-filter-field kit-search-field'),searchLabel=el('label'),searchWrap=el('span','kit-guide-search'),search=el('input');
  search.id='kit-plating-search';searchLabel.htmlFor=search.id;bindText(searchLabel,'Buscar una guía');
  search.type='search';search.autocomplete='off';search.setAttribute('role','combobox');search.setAttribute('aria-autocomplete','list');
  search.setAttribute('aria-expanded','false');search.setAttribute('aria-haspopup','listbox');bindAttr(search,'placeholder','Buscar una guía…');
  const popup=el('div','kit-guide-popup'),suggestions=el('div','kit-guide-suggestions');
  suggestions.id='kit-plating-suggestions';suggestions.setAttribute('role','listbox');bindAttr(suggestions,'aria-label','Guías de emplatado');
  search.setAttribute('aria-controls',suggestions.id);
  const hint=el('p','kit-suggestion-hint');popup.hidden=true;popup.append(suggestions,hint);
  searchWrap.append(icon('search'),search);searchBox.append(searchLabel,searchWrap,popup);toolsPanel.append(outletBox,categoryBox,searchBox);
  const count=el('p','kit-filter-info');
  count.setAttribute('role','status');count.setAttribute('aria-live','polite');view.append(toolsPanel,count);
  const basic=el('p','kit-empty');view.append(basic);
  const card=el('section','kit-guide-workspace'),top=el('div','kit-guide-top'),topTitle=el('div'),dish=el('h2');
  const docLink=el('a','kit-btn kit-primary kit-document');docLink.append(icon('book'),label('span','Ver documento completo'));
  const toggle=button('kit-btn kit-secondary kit-label-toggle',null,async()=>{
    const row=rows[index],item=record,run=controller;
    if(showLabels&&!item.clean){
      toggle.disabled=true;
      try{
        const clean=await getGuideMedia(row,'clean',run.signal);
        if(run.signal.aborted)return;
        item.clean=urlFor(clean,item);if(!item.clean)throw Error();
      }catch{if(!run.signal.aborted)bindText(toast,'No se ha podido cargar la imagen.');return;}
      finally{if(!run.signal.aborted)toggle.disabled=false;}
    }
    showLabels=!showLabels;updateToggle();setPicture(true);
  },'eye');
  const toggleText=el('span'),sw=el('span','kit-switch');sw.setAttribute('aria-hidden','true');toggle.append(toggleText,sw);
  const tools=el('div','kit-guide-actions');tools.append(docLink,toggle);
  const eyebrow=el('span','kit-eyebrow');topTitle.append(eyebrow,dish);top.append(topTitle,tools);
  const columns=el('div','kit-guide-columns'),picture=el('div','kit-guide-picture'),instructions=el('div','kit-guide-instructions'),footer=el('footer','kit-guide-footer');
  columns.append(picture,instructions);card.append(top,columns,footer);view.append(card);

  function updateReview(){
    const row=rows[index];bindText(reviewText,row.reviewed?'Revisado':'Marcar como revisado');
    reviewButton.disabled=reviews.has(identity(row));
    reviewButton.setAttribute('aria-pressed',String(Boolean(row.reviewed)));
  }
  async function mark(reviewed){
    const row=rows[index],key=identity(row);
    if(reviews.has(key))return;reviews.add(key);updateReview();
    try{
      const result=await rpc('compi_review_guide',{h:row.hotel_key,o:row.outlet_key,g:row.guide_key,reviewed},signal);
      if(signal?.aborted)return;
      row.reviewed=result===true;
      if(!card.hidden&&row===rows[index]){
        updateReview();
        bindText(toast,row.reviewed?'Guía marcada como revisada.':'Marca de revisión eliminada.');
        motionFor('button',reviewButton,{positive:row.reviewed});
        motionFor('save-notice',toast);
      }
    }catch{if(!signal?.aborted&&row===rows[index])bindText(toast,'No se pudo guardar la revisión.');}
    finally{reviews.delete(key);if(!signal?.aborted&&row===rows[index]){updateReview();drawSteps();}}
  }
  const normalize=value=>String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
  const batch=12;
  let matches=[],active=-1,rendered=0,pendingChoice,acceptedTitle=null,restoringFocus=false;
  function hideSuggestions(){
    popup.hidden=true;search.setAttribute('aria-expanded','false');search.removeAttribute('aria-activedescendant');active=-1;
  }
  function appendSuggestions(limit){
    const fragment=document.createDocumentFragment();
    for(;rendered<Math.min(limit,matches.length);rendered++){
      const row=rows[matches[rendered]],item=el('div','kit-guide-option');
      item.setAttribute('role','option');item.setAttribute('aria-selected','false');
      item.setAttribute('aria-posinset',String(rendered+1));item.setAttribute('aria-setsize',String(matches.length));
      item.id='kit-guide-option-'+rendered;item.dataset.guide=identity(row);item.dataset.index=String(rendered);
      item.append(el('span','',row.title),el('small','',[row.outlet,row.hotel].filter(Boolean).join(' · ')));
      fragment.append(item);
    }
    suggestions.append(fragment);
    hint.hidden=!!matches.length&&rendered===matches.length;
    bindText(hint,matches.length?'Escribe para afinar la búsqueda o desplázate para ver más guías.':'No hay coincidencias');
  }
  function showSuggestions(){
    suggestions.replaceChildren();suggestions.scrollTop=0;active=-1;rendered=0;search.removeAttribute('aria-activedescendant');
    appendSuggestions(batch);popup.hidden=false;search.setAttribute('aria-expanded','true');
    motionFor('guide-search',popup,{items:matches.length?[...suggestions.children]:[hint]});
  }
  function highlight(position){
    if(!matches.length)return;
    const previous=suggestions.children[active];
    if(previous)previous.setAttribute('aria-selected','false');
    active=Math.max(0,Math.min(position,matches.length-1));
    if(active>=rendered)appendSuggestions(active+batch);
    const item=suggestions.children[active];item.setAttribute('aria-selected','true');
    search.setAttribute('aria-activedescendant',item.id);
    if(item.offsetTop<suggestions.scrollTop)suggestions.scrollTop=item.offsetTop;
    else if(item.offsetTop+item.offsetHeight>suggestions.scrollTop+suggestions.clientHeight)
      suggestions.scrollTop=item.offsetTop+item.offsetHeight-suggestions.clientHeight;
  }
  function filterGuides(autoChoose=false){
    clearTimeout(pendingChoice);
    const query=search.value===acceptedTitle?'':search.value;
    const words=normalize(query).trim().split(/\s+/u).filter(Boolean);
    matches=rows.reduce((result,row,n)=>{
      const group=Object.hasOwn(GUIDE_CATEGORIES,row.category)?row.category:'unclassified';
      if(outlet.value && restaurantKey(row)!==outlet.value)return result;
      if(category.value && category.value!==group && category.value!=='kind:'+row.kind)return result;
      const categoryName=t(GUIDE_CATEGORIES[group]||'Sin clasificar');
      const haystack=normalize([row.title,row.nombre_en,row.codigo,row.hotel,row.outlet,row.partida,categoryName].filter(Boolean).join(' '));
      if(words.every(word=>haystack.includes(word)))result.push(n);
      return result;
    },[]);
    const includesCurrent=matches.includes(index),wasHidden=card.hidden;
    bindText(count,matches.length===1?'1 guía':'{n} guías',{n:matches.length});
    bindText(basic,!rows.length?'No hay guías de emplatado en este outlet.':matches.length?'Selecciona una guía para ver el montaje.':'No hay coincidencias');
    basic.hidden=includesCurrent;
    card.hidden=reviewButton.hidden=!includesCurrent;
    if(!includesCurrent){
      controller?.abort();
      bindText(context,'Cocina');bindText(toast,'');picture.replaceChildren();
    }else if(wasHidden)void select(index,false);
    if(!popup.hidden)showSuggestions();
    if(autoChoose&&matches.length===1){
      const unique=matches[0];
      pendingChoice=setTimeout(()=>{
        if(signal?.aborted)return;
        hideSuggestions();
        if(index!==unique||card.hidden)void select(unique,true);
      },180);
    }
  }
  function commit(position){
    const next=matches[position];if(next===undefined)return;
    clearTimeout(pendingChoice);
    acceptedTitle=rows[next].title;search.value=acceptedTitle;
    if(next!==index||card.hidden)void select(next,true);
    hideSuggestions();filterGuides();
  }
  function openSearch(){
    if(popup.hidden)showSuggestions();
  }
  search.addEventListener('focus',()=>{
    if(restoringFocus)return;
    if(search.value===acceptedTitle)search.select();
    openSearch();
  });
  search.addEventListener('click',openSearch);
  search.addEventListener('input',()=>{acceptedTitle=null;filterGuides(true);openSearch();});
  for(const selector of [outlet,category])selector.addEventListener('change',()=>{
    if(acceptedTitle!==null){search.value='';acceptedTitle=null;}
    filterGuides();
    if(matches.length && !matches.includes(index))void select(matches[0],true);
    if(matches.length){basic.hidden=true;motionFor('filter',count);}
    hideSuggestions();
  });
  suggestions.addEventListener('scroll',()=>{
    if(rendered<matches.length&&suggestions.scrollTop+suggestions.clientHeight>=suggestions.scrollHeight-12)appendSuggestions(rendered+batch);
  });
  suggestions.addEventListener('pointerdown',()=>clearTimeout(pendingChoice));
  suggestions.addEventListener('mousedown',event=>event.preventDefault());
  suggestions.addEventListener('click',event=>{
    const item=event.target.closest('[role="option"]');
    if(!item||!suggestions.contains(item))return;
    commit(Number(item.dataset.index));
    if(document.activeElement!==search){
      restoringFocus=true;
      try{search.focus({preventScroll:true});}finally{restoringFocus=false;}
    }
  });
  search.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if(event.key==='Escape'&&!popup.hidden){event.preventDefault();clearTimeout(pendingChoice);hideSuggestions();return;}
    if(event.key==='Tab'){hideSuggestions();return;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();openSearch();
      highlight(active===-1?(event.key==='ArrowDown'?0:matches.length-1):active+(event.key==='ArrowDown'?1:-1));
    }else if(event.key==='Enter'&&!popup.hidden&&matches.length){
      event.preventDefault();commit(active<0?0:active);
    }
  });
  const outside=event=>{if(!toolsPanel.contains(event.target))hideSuggestions();};
  toolsPanel.addEventListener('focusout',event=>{if(!toolsPanel.contains(event.relatedTarget))hideSuggestions();});
  document.addEventListener('pointerdown',outside,true);
  const languageChanged=()=>filterGuides();
  window.addEventListener('compi:languagechange',languageChanged);
  signal?.addEventListener('abort',()=>{
    clearTimeout(pendingChoice);document.removeEventListener('pointerdown',outside,true);
    window.removeEventListener('compi:languagechange',languageChanged);
  },{once:true});
  function updateToggle(){
    const available=Boolean(rows[index].has_clean&&record.approved);
    toggle.disabled=!available;toggle.setAttribute('aria-pressed',String(available&&showLabels));
    bindText(toggleText,showLabels?'Ocultar etiquetas':'Mostrar etiquetas');
    bindAttr(toggle,'title',available?'Alternar la imagen anotada y la acuarela limpia':'Esta guía no incluye una versión sin etiquetas.');
    sw.classList.toggle('on',available&&showLabels);
  }
  function setPicture(changingLabels=false){
    const previous=changingLabels?picture.querySelector('img:not([aria-hidden])'):null;
    picture.replaceChildren();
    const row=rows[index],local=controller.signal;
    const url=!showLabels&&record.clean?record.clean:record.approved;
    if(url){
      const img=el('img');img.alt=row.title;
      if(changingLabels){
        if(previous?.naturalWidth){
          previous.setAttribute('aria-hidden','true');picture.append(previous);
        }
        img.addEventListener('load',()=>{
          if(local.aborted||img.parentElement!==picture||img.hasAttribute('aria-hidden'))return;
          void motionFor('guide-labels',picture,{items:[img,toggleText]}).then(()=>previous?.remove());
        },{once:true});
        img.addEventListener('error',()=>previous?.remove(),{once:true});
      }
      picture.append(img);
      img.src=url;return;
    }
    const state=el('div','kit-picture-placeholder');state.append(icon('image'));
    state.append(label('span',record.loaded?'Vista previa no disponible.':'Cargando ficha…'));
    if(record.failed)state.append(button('kit-btn kit-secondary','Reintentar',()=>{record.loaded=record.failed=false;select(index);}));
    picture.append(state);
  }
  function drawSteps(){
    instructions.replaceChildren();
    const row=rows[index],steps=record?.data?.pasos||[],header=el('div','kit-guide-step-header');
    header.append(label('span','Secuencia de montaje','kit-eyebrow'));instructions.append(header);
    if(!steps.length){
      instructions.append(label('p',record?.loaded?'Consulta los pasos en el documento completo.':'Cargando ficha…','kit-no-steps'));return;
    }
    step=Math.min(step,steps.length-1);
    header.append(el('span','',String(step+1)+' / '+steps.length));
    const list=el('div','kit-steps');instructions.append(list);
    steps.forEach((s,n)=>{
      const btn=button('kit-step'+(n===step?' current':n<step?' completed':''),null,()=>jump(n,'step'));
      btn.setAttribute('aria-pressed',String(n===step));const number=el('span','kit-step-number');
      if(n<step)number.append(icon('check'));else number.textContent=String(n+1).padStart(2,'0');
      const text=el('span');text.dir='auto';text.append(el('strong','',s.accion));
      if(s.control){const desc=el('span','kit-step-description',s.control);desc.hidden=n!==step;text.append(desc);}
      btn.append(number,text);list.append(btn);
    });
    const bottom=el('div','kit-guide-bottom'),progress=el('progress','kit-guide-progress');
    progress.max=steps.length;progress.value=step+1;bindAttr(progress,'aria-label','Secuencia de montaje');
    const nav=el('div','kit-guide-navigation'),prev=button('kit-plain-icon',null,()=>jump(step-1,'prev'),'prev');
    bindAttr(prev,'aria-label','Paso anterior');prev.disabled=step===0;
    const last=step===steps.length-1,next=button('kit-btn kit-primary',last?(row.reviewed?'Revisado':'Finalizar revisión'):'Siguiente paso',()=>last?mark(true):jump(step+1,'next'));
    next.append(icon(last?'check':'next'));next.disabled=last&&(row.reviewed||reviews.has(identity(row)));
    nav.append(prev,next);bottom.append(progress,nav);instructions.append(bottom);
  }
  function jump(n,focus){
    if(n===step)return;
    const last=step;step=n;drawSteps();
    const steps=instructions.querySelectorAll('.kit-step');
    motionFor('guide-steps',instructions,{items:[steps[last],steps[step],instructions.querySelector('progress')]});
    const target=focus==='step'?instructions.querySelector('.kit-step.current'):instructions.querySelector('.kit-guide-navigation '+(focus==='next'?'button:last-child':'button:first-child'));
    (target?.disabled?instructions.querySelector('.kit-step.current'):target)?.focus({preventScroll:true});
  }
  function drawFooter(){
    const data=record.data;footer.replaceChildren();
    for(const [key,mark,caption] of [['pase','clock','Tiempo de pase'],['racion','book','Ración']]){
      if(!data[key])continue;
      const item=el('span');item.append(icon(mark),bindComputed(el('span'),()=>t(caption)+' · '+data[key]));footer.append(item);
    }
    const row=rows[index];footer.append(bindComputed(el('span','kit-footer-reference'),()=>[row.outlet,data.version?t('Versión')+' '+data.version:''].filter(Boolean).join(' · ')));
  }
  function redraw(){updateToggle();setPicture();drawSteps();drawFooter();}
  async function select(n,focus=false){
    controller?.abort();controller=new AbortController();const local=controller.signal;
    index=n;step=0;showLabels=true;card.hidden=reviewButton.hidden=false;basic.hidden=true;
    const row=rows[index],item=entry(row);record=item;
    if(focus&&platingHref&&location.hash.startsWith('#/plating'))history.replaceState(history.state,'',platingHref(row));
    bindText(toast,'');bindComputed(context,()=>t('Cocina')+' / '+(row.outlet||selectedOutlet?.outlet||''));
    bindComputed(eyebrow,()=>t('Plating Guide')+' · '+t(row.guide_state==='draft'?'Borrador':'Publicada'));
    dish.dir='auto';dish.textContent=row.title;docLink.href=openDocumentHref(row);
    updateReview();redraw();
    if(focus)motionFor('guide-search',topTitle,{items:[eyebrow,dish]});
    if(item.loaded)return;
    try{
      const args={h:row.hotel_key,o:row.outlet_key,g:row.guide_key};
      const [detail,approved]=await Promise.all([
        row.has_source===false?Promise.resolve(null):rpc('compi_workspace_guide',args,local),
        row.has_image&&!item.approved?getGuideMedia(row,'approved',local):Promise.resolve(null)
      ]);
      if(local.aborted)return;
      if(detail?.data)item.data=detail.data;
      if(approved)item.approved=urlFor(approved,item);
      const needsSteps=!detail?.data?.pasos?.length;
      if(row.guide_state==='ready' && (!item.approved || needsSteps)){
        const legacy=await readLegacyGuide(await getGuideMedia(row,'docx',local));
        if(local.aborted)return;
        if(legacy){
          if(!detail?.data)item.data=legacy.data;
          else if(needsSteps && legacy.data?.pasos?.length)item.data={...item.data,pasos:legacy.data.pasos};
          if(!item.approved)item.approved=urlFor(legacy.image,item);
        }
      }
      item.loaded=true;
    }catch{
      if(local.aborted)return;
      bindText(toast,'No se pudo cargar la vista previa de esta ficha.');item.loaded=item.failed=true;
    }
    if(!local.aborted)redraw();
  }
  filterGuides();
  if(rows.length)void select(index);
}

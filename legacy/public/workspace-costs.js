import {amountField,readAmount,setupAmounts} from './cost-precision.js';
import {guideURL,releaseGuideURL} from './guide-language-image.js';
import {shownText} from './content-language.js';
import {mountTariffPicker,quantityUnits} from './tariff-picker.js';
import {readLegacyGuide} from './workspace-legacy-guide.js';
import {locale,t} from './i18n.js';
import {costFigures,defaultCostSettings,numericInput,unitsCompatible} from './workspace-cost-math.js';
import {motionFor} from './motion-choices.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const tr = (label,values) => escape(t(label, values));
const icon = name => `<svg class="icon" aria-hidden="true" focusable="false"><use href="/brand/ui.svg#${name}"></use></svg>`;
const keyOf = row => JSON.stringify([row.hotel_key,row.outlet_key,row.guide_key]);
const labels = {all:'Todos',plato:'Platos',elaboracion:'Elaboraciones',unknown:'Sin clasificar'};
const kindOf = row => ['plato','elaboracion'].includes(row.kind) ? row.kind : 'unknown';
const caption = row => [t(row.kind === 'plato' ? 'Plato' : row.kind === 'elaboracion' ? 'Elaboración' : 'Sin clasificar'),row.outlet].filter(Boolean).join(' · ');
const searchKey = value=>String(value ?? '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const number = (value,maximumFractionDigits=2) => value == null ? '—' : new Intl.NumberFormat(locale(),{maximumFractionDigits:Math.min(2,maximumFractionDigits)}).format(value);
const money = (value,precision=2) => value == null ? '—' : new Intl.NumberFormat(locale(),{style:'currency',currency:'EUR',maximumFractionDigits:Math.min(2,precision)}).format(value);
const attr = value => escape(value == null ? '' : value);
const routeArgs = row=>({h:row.hotel_key,o:row.outlet_key,g:row.guide_key});
const clsButton=(action,content,kind='')=>`<button type="button" data-cost="${action}" class="wc-button ${kind}">${content}</button>`;
const clone = value => JSON.parse(JSON.stringify(value));

export function renderCosts({content,catalog=[],signal,rpc,canEdit=false,loadRecipeImage,getGuideMedia,loadTariffs,connect,onCost,openPicker}) {
  const view=document.createElement('section');
  view.className='wc-view';
  content.replaceChildren(view);
  const records=catalog.filter(row=>row.guide_key && row.guide_state!=='archived');
  const drafts=new Map();
  let current=null, active=null, filter='all', attempt=0, modal=null, feedback='', failed=false;
  let imageController=null, imageUrl=null, imageKey=null;
  const permitted=row=>Boolean(row && (typeof canEdit==='function' ? canEdit(row) : canEdit));
  const filtered=()=>records.filter(row=>filter==='all'||kindOf(row)===filter);
  const el=selector=>view.querySelector(selector);
  const setMessage=msg=>{feedback=msg;const box=el('.wc-status');if(box)box.textContent=msg?t(msg):'';};

  function releaseImage(){
    imageController?.abort();
    if(imageUrl)releaseGuideURL(imageUrl);
    imageController=null;imageUrl=null;imageKey=null;
  }
  function close(){if(modal){const element=modal;modal=null;element.close();element.remove();}}
  function dialog(title,body) {
    close();
    const element=document.createElement('dialog');
    element.className='wc-dialog';
    element.setAttribute('aria-label',t(title));
    element.innerHTML=`<header><h2>${tr(title)}</h2><button type="button" class="wc-icon-btn" data-cost="close" aria-label="${tr('Cerrar')}">×</button></header>${body}`;
    view.append(element);modal=element;
    element.addEventListener('close',()=>{if(modal===element)modal=null;element.remove();},{once:true});
    element.addEventListener('click',event=>{if(event.target===element)close();});
    element.showModal();return element;
  }

  function picker() {
    const candidates=filtered();
    const win=dialog('Elegir una receta',`<div class="wc-picker"><label class="wc-field"><span>${tr('Buscar por nombre u outlet')}</span><input type="search" maxlength="160" autocomplete="off" autofocus></label><div class="wc-options"></div></div>`);
    const search=win.querySelector('input');
    function drawOptions(){
      const query=searchKey(search.value.trim());
      const options=candidates.filter(row=>searchKey([row.title,shownText(row.title),row.outlet,row.hotel,row.category].join(' ')).includes(query));
      const list=win.querySelector('.wc-options');
      list.innerHTML=options.length?options.map(row=>`<button type="button" class="wc-option" data-cost="select" data-row="${records.indexOf(row)}"><span><strong dir="auto">${escape(row.title)}</strong><small>${escape(caption(row))}</small></span>${icon(row===current?'book':'arrow')}</button>`).join(''):`<p class="wc-muted">${tr('No hay coincidencias.')}</p>`;
      motionFor('cost-picker',list,{items:[...list.children]});
    }
    search.addEventListener('input',drawOptions);drawOptions();search.focus();
  }

  let tariffRequest;
  async function offerTariffs(form){
    const host=form.querySelector('.wc-tariff-picker');
    if(!host)return;
    host.textContent=t('Cargando tarifas…');
    try{
      tariffRequest??=loadTariffs();
      const tariffs=await tariffRequest;
      if(!host.isConnected)return;
      mountTariffPicker(host,tariffs,{
        confirmedOnly:true,translate:t,priceFor:row=>row.unitPrice,
        onSelect(row){
          if(!row)return;
          const fields=form.elements;
          fields.name.value=row.name.slice(0,120);
          amountField(fields.price,Number(Number(row.unitPrice).toFixed(4)));
          fields.priceUnit.value=row.unit;
          if(!unitsCompatible(fields.unit.value,row.unit))fields.unit.value=quantityUnits(row.unit)[0];
        }
      });
      const note=document.createElement('small');
      note.textContent=t('Al guardar la ficha se conserva el precio de compra elegido.');
      host.append(note);
    }catch{
      tariffRequest=null;
      if(host.isConnected)host.textContent=t('No se pudieron cargar las tarifas. Puedes introducir el precio de compra.');
    }
  }
  function editRow(index) {
    if(!active||active.saving||!permitted(current))return;
    const rows=active.settings.ingredients;
    const adding=index===rows.length;
    if(adding && rows.length>=40)return;
    const item=adding ? {name:'',quantity:null,unit:'',price:null,priceUnit:''} : rows[index];
    if(!item)return;
    const fields=[
      ['name','Ingrediente','text','maxlength="120" required'],
      ['quantity','Cantidad de la receta base','number','min="0" max="999999.9999" step="0.0001"'],
      ['unit','Unidad de la receta','text','maxlength="40" list="wc-units"'],
      ['price','Precio de compra sin IVA (€)','number','min="0" max="99999.9999" step="0.0001"'],
      ['priceUnit','Unidad de compra','text','maxlength="40" list="wc-units"']
    ];
    const win=dialog(adding?'Añadir ingrediente':'Editar ingrediente',`<form class="wc-editor">${loadTariffs && current.hotel_key==='hotel-arts-barcelona'?'<div class="wc-tariff-picker"></div>':''}<div class="wc-edit-grid">${fields.map(([key,label,type,attrs])=>`<label class="wc-field"><span>${tr(label)}</span><input name="${key}" type="${type}" value="${attr(item[key])}" ${attrs}></label>`).join('')}</div><datalist id="wc-units">${['g','kg','ml','cl','l','ud'].map(unit=>`<option value="${unit}"></option>`).join('')}</datalist><p class="wc-form-error" role="alert"></p><footer>${adding?'':clsButton('remove',tr('Quitar ingrediente'),'wc-quiet')}<button type="submit" class="wc-button wc-primary">${tr('Aplicar')}</button></footer></form>`);
    const form=win.querySelector('form'), f=form.elements;
    setupAmounts(form);void offerTariffs(form);
    function finishEdit(){
      change();close();paint();
      const body=el('.wc-table tbody'),line=body.rows[Math.min(index,body.rows.length-1)];
      motionFor('cost-ingredient',line,{items:[...line.cells]});
    }
    motionFor('cost-ingredient',form,{items:[...form.querySelectorAll('.wc-field,footer')]});
    win.querySelector('[data-cost="remove"]')?.addEventListener('click',()=>{rows.splice(index,1);finishEdit();});
    form.addEventListener('submit',event=>{
      event.preventDefault();
      const entry={name:f.name.value.trim(),quantity:numericInput(readAmount(f.quantity)),unit:f.unit.value.trim(),
        price:numericInput(readAmount(f.price)),priceUnit:f.priceUnit.value.trim()};
      const error=win.querySelector('.wc-form-error');
      if(!entry.name){error.textContent=t('Indica el nombre del ingrediente.');f.name.focus();return;}
      if(entry.price!==null && (!entry.priceUnit || (entry.unit && !unitsCompatible(entry.unit,entry.priceUnit)))){
        error.textContent=t('Usa unidades de compra y receta compatibles.');f.priceUnit.focus();return;
      }
      if(adding)rows.push(entry);else rows[index]=entry;
      finishEdit();
    });
    (adding?f.name:f.price).focus();
  }

  function change(){active.dirty=true;if(!active.conflict)setMessage('Cambios sin guardar.');}
  function rowsHTML(state,figures){
    if(!state.ingredients.length)return `<tr><td colspan="5" class="wc-table-empty">${tr('Esta ficha no tiene ingredientes registrados.')}</td></tr>`;
    return state.ingredients.map((item,i)=>{
      const line=figures.rows[i], editable=permitted(current)&&!active.saving;
      return `<tr><th scope="row"><span class="wc-ingredient" dir="auto">${escape(item.name)}</span></th><td class="wc-num">${number(line.batchQuantity)} <small>${escape(item.unit)}</small></td><td class="wc-num">${money(item.price,4)}${item.priceUnit?` <small>/ ${escape(item.priceUnit)}</small>`:''}</td><td class="wc-num wc-line-total">${money(line.total)}</td><td>${editable?`<button type="button" class="wc-icon-btn" data-cost="edit" data-index="${i}" aria-label="${tr('Editar {name}',{name:item.name})}">${icon('compose')}</button>`:''}</td></tr>`;
    }).join('');
  }
  function update(){
    if(!active || !el('.wc-table'))return;
    const s=active.settings,figures=costFigures(s);
    onCost?.(current,s.ingredients.length,figures.complete);
    el('tbody').innerHTML=rowsHTML(s,figures);
    for(const [selector,val] of [['.wc-total-value',figures.total],['.wc-serving-value',figures.perServing],['.wc-sale-value',figures.sale],['.wc-margin-value',figures.margin]]){
      el(selector).textContent=money(val);
    }
    const count=el('.wc-batch-count'),control=el('[data-value="servings"]');
    const [before,after='']=t(s.servings===1?'{count} ración':'{count} raciones').split('{count}');
    if(s.servings==null)count.replaceChildren(before,'—',after);
    else{
      const digits=count.querySelector('[data-motion-number]')||document.createElement('span');
      digits.dataset.motionNumber='';
      digits.textContent=number(s.servings,0);
      count.replaceChildren(before,digits,after);
    }
    const display=el('.wc-stepper-value [data-motion-number]');
    display.textContent=control.validity.valid&&s.servings!=null?number(s.servings,0):'';
    el('.wc-ring strong').textContent=figures.percentage===null?'—':number(figures.percentage,1)+' %';
    el('.wc-ring').style.setProperty('--wc-fill',(figures.percentage===null?0:Math.min(100,figures.percentage))+'%');
    el('.wc-calculation-note').textContent=t(figures.complete?'Importes sin IVA.':'Completa las cantidades, las unidades y los precios para calcular el coste.');
    if(el('[data-cost="save"]'))el('[data-cost="save"]').disabled=!active.dirty||active.saving||active.conflict||!s.servings||!s.baseServings||hasInvalidInput();
    if(el('[data-cost="minus"]'))el('[data-cost="minus"]').disabled=active.saving||!permitted(current)||s.servings<=1;
    if(el('[data-cost="plus"]'))el('[data-cost="plus"]').disabled=active.saving||!permitted(current)||s.servings>=999;
  }
  function hasInvalidInput(){return Array.from(view.querySelectorAll('.wc-panel input')).some(input=>!input.checkValidity());}
  function pulseServings(){
    const control=el('[data-value="servings"]');
    if(!control||!control.validity.valid||active?.settings.servings==null)return;
    // Whilst typing, the native field keeps its own text, selection and caret.
    // Animate the quantity below the table instead. +/- uses the stepper's numeral.
    const target=document.activeElement===control?el('.wc-batch-count [data-motion-number]'):el('.wc-stepper-value [data-motion-number]');
    motionFor('cost-servings',target,{numeric:true});
  }

  async function thumbnail(){
    const target=el('.wc-thumb');if(!target||!current||(!active?.legacyImage && (!current.has_image || !loadRecipeImage)))return;
    const chosen=keyOf(current);
    if(imageKey!==chosen){
      imageKey=chosen;const controller=new AbortController();imageController=controller;
      try{
        const blob=active?.legacyImage || await loadRecipeImage(current,controller.signal);
        if(!blob||controller.signal.aborted||signal?.aborted||imageKey!==chosen)return;
        imageUrl=guideURL(blob,current);
      }catch{return;}
    }
    const element=el('.wc-thumb');if(!element||!imageUrl||imageKey!==chosen)return;
    const img=document.createElement('img');img.alt='';img.src=imageUrl;element.replaceChildren(img);
  }

  function paint(){
    const row=current,can=permitted(row),s=active?.settings;
    const kinds=['all','plato','elaboracion'];if(records.some(r=>kindOf(r)==='unknown'))kinds.push('unknown');
    const filters=kinds.map(k=>`<button type="button" data-cost="filter" data-kind="${k}" aria-pressed="${filter===k}">${tr(labels[k])}</button>`).join('');
    const saveAction=can&&s?clsButton('save',`<span aria-hidden="true">✓</span> ${tr('Guardar ajuste')}`,'wc-primary'):'';
    const hero=openPicker?'':`<header class="wc-heading"><h1>${tr('Escandallos')}</h1>${saveAction}</header><div class="wc-filter" role="group" aria-label="${tr('Tipo de ficha')}">${filters}</div>`;
    const recipe=row?`<section class="wc-card wc-selected"><div class="wc-thumb" aria-hidden="true">${icon('book')}</div><div class="wc-selected-name"><small>${tr('Receta seleccionada')}</small><h2 dir="auto">${escape(row.title)}</h2><p>${escape(caption(row))}</p></div>${openPicker?saveAction:clsButton('choose',tr('Cambiar')+' '+icon('chevron'),'wc-quiet')}</section>`:'';
    const status=`<div class="wc-status" role="status" aria-live="polite">${feedback?tr(feedback):''}</div>`;
    if(!row){
      view.innerHTML=hero+`<p class="wc-empty">${tr('No hay fichas disponibles para esta selección.')}</p>`+status;return;
    }
    if(!s){
      view.innerHTML=hero+recipe+`<p class="wc-empty" role="status">${tr(failed?'No se pudo cargar el escandallo.':'Cargando escandallo…')} ${failed?clsButton('retry',tr('Reintentar')):''}</p>`;
      void thumbnail();return;
    }
    const disabled=(!can||active.saving)?'disabled':'';
    const stepper=`<div class="wc-stepper-wrap"><label for="wc-servings">${tr('Raciones del lote')}</label><div class="wc-stepper"><button type="button" data-cost="minus" aria-label="${tr('Reducir una ración')}">−</button><span class="wc-stepper-value"><input id="wc-servings" data-value="servings" type="number" min="1" max="999" step="1" required value="${attr(s.servings)}" ${disabled}><span data-motion-number aria-hidden="true"></span></span><button type="button" data-cost="plus" aria-label="${tr('Añadir una ración')}">+</button></div></div>`;
    const table=`<section class="wc-card wc-ingredients"><header><h2>${tr('Ingredientes y costes')}</h2>${stepper}</header><div class="wc-table-scroll" tabindex="0" role="region" aria-label="${tr('Ingredientes y costes')}"><table class="wc-table"><thead><tr><th>${tr('Ingrediente')}</th><th class="wc-num">${tr('Cantidad')}</th><th class="wc-num">${tr('Precio de compra')}</th><th class="wc-num">${tr('Coste del lote')}</th><th><span class="wc-sr">${tr('Editar ingrediente')}</span></th></tr></thead><tbody></tbody></table></div><div class="wc-base"><label class="wc-inline">${tr('Raciones de la receta base')} <input type="number" min="1" max="999" step="1" required data-value="baseServings" value="${attr(s.baseServings)}" ${disabled}></label>${can&&s.ingredients.length<40&&!active.saving?clsButton('add','+ '+tr(s.ingredients.length?'Añadir ingrediente':'Añadir ingredientes'),s.ingredients.length?'wc-quiet':'wc-primary'):''}</div><div class="wc-total"><div>${tr('Coste total del lote')}<small class="wc-batch-count"></small></div><strong class="wc-total-value"></strong></div></section>`;
    const price=`<section class="wc-card wc-price"><div><span class="wc-symbol" aria-hidden="true">${icon('cost')}</span><h2>${tr('Precio de venta sin IVA')}</h2></div><label class="wc-sale-input"><span class="wc-sr">${tr('Precio de venta sin IVA')}</span><input data-value="salePrice" type="number" min="0" max="99999.99" step="0.01" value="${attr(s.salePrice)}" ${disabled}><span>€</span></label></section>`;
    const summary=`<aside class="wc-card wc-summary"><h2>${tr('Rentabilidad')}</h2><div class="wc-ring"><div><strong>—</strong><span>${tr('Food cost')}</span></div></div><dl><div><dt>${tr('Coste por ración')}</dt><dd class="wc-serving-value"></dd></div><div><dt>${tr('Precio de venta')}</dt><dd class="wc-sale-value"></dd></div><div class="wc-margin"><dt>${tr('Margen bruto por ración')}</dt><dd class="wc-margin-value"></dd></div></dl><p class="wc-calculation-note"></p></aside>`;
    view.innerHTML=hero+`<div class="wc-panel"><div class="wc-main">${recipe}${table}${price}</div>${summary}</div>`+status+(active.conflict?clsButton('reload',tr('Recargar datos guardados')):'');
    for(const [name,value] of Object.entries(active.invalidFields)){
      const input=el(`input[data-value="${name}"]`);
      input.value=value;
      input.setCustomValidity(t('Introduce un número válido.'));
    }
    update();void thumbnail();
  }

  async function selectRow(row,force=false){
    close();++attempt;const sequence=attempt;const chosen=row?keyOf(row):null;
    if(chosen!==imageKey)releaseImage();
    current=row;active=chosen?drafts.get(chosen):null;feedback=active?.conflict?'Otra persona ha guardado cambios. Recarga los datos antes de continuar.':active?.dirty?'Cambios sin guardar.':'';failed=false;
    if(active&&!force){paint();return;}
    active=null;paint();if(!row)return;
    try{
      const answer=await rpc('compi_recipe_cost',routeArgs(row),signal);
      if(sequence!==attempt||signal?.aborted)return;
      let ingredients=answer?.ingredientes, legacyImage=null;
      const missingIngredients=!answer?.settings && !ingredients?.length;
      if((missingIngredients||!row.has_image) && row.has_source===false && row.guide_state==='ready' && getGuideMedia){
        try {
          const legacy=await readLegacyGuide(await getGuideMedia(row,'docx',signal));
          if(missingIngredients)ingredients=legacy?.data?.ingredientes;
          if(!row.has_image)legacyImage=legacy?.image;
        } catch { /* An unavailable original can still be costed manually. */ }
        if(sequence!==attempt||signal?.aborted)return;
      }
      const settings=answer?.settings?clone(answer.settings):defaultCostSettings(ingredients);
      active={settings,legacyImage,invalidFields:{},revision:answer?.revision||null,saving:false,dirty:false,conflict:false};
      drafts.set(chosen,active);paint();
    }catch{
      if(sequence!==attempt||signal?.aborted)return;
      failed=true;paint();
    }
  }
  async function save(){
    if(!active?.dirty||active.saving||active.conflict||!permitted(current)||hasInvalidInput())return;
    const row=current, entry=active,snapshot=clone(entry.settings);
    let saved=false;
    entry.saving=true;feedback='Guardando…';paint();
    try{
      const revision=await rpc('compi_save_recipe_cost',{...routeArgs(row),settings:snapshot,previous:entry.revision},signal);
      entry.revision=revision;entry.dirty=false;saved=true;
      if(!signal?.aborted && current===row)feedback='Ajuste guardado.';
    }catch(error){
      const conflict=error?.code==='PT409'||error?.status===409;
      entry.conflict=conflict;
      if(!signal?.aborted && current===row)feedback=conflict?'Otra persona ha guardado cambios. Recarga los datos antes de continuar.':'No se pudo guardar el escandallo.';
    }finally{
      entry.saving=false;
      if(!signal?.aborted && current===row){
        paint();
        motionFor('save-notice',el('.wc-status'),{positive:saved});
        if(saved&&entry.servingsEdited)pulseServings();
      }
      if(saved)entry.servingsEdited=false;
    }
  }

  view.addEventListener('click',event=>{
    const btn=event.target.closest('button[data-cost]');if(!btn||!view.contains(btn))return;
    const action=btn.dataset.cost;
    if(action==='close'){close();return;}
    if(action==='choose'){if(openPicker)openPicker();else picker();return;}
    if(action==='select'){
      const row=records[Number(btn.dataset.row)];
      void selectRow(row).then(()=>{
        const name=el('.wc-selected-name');
        if(!signal?.aborted&&row===current&&name)motionFor('cost-picker',name,{items:[...name.children]});
      });
      return;
    }
    if(action==='filter'){filter=btn.dataset.kind;const list=filtered();void selectRow(list.includes(current)?current:list[0]||null);return;}
    if(action==='retry'||action==='reload'){void selectRow(current,true);return;}
    if(action==='edit'){editRow(Number(btn.dataset.index));return;}
    if(action==='add'){editRow(active.settings.ingredients.length);return;}
    if(action==='save'){void save();return;}
    if((action==='plus'||action==='minus')&&active&&!active.saving&&permitted(current)){
      active.settings.servings=Math.min(999,Math.max(1,(active.settings.servings||1)+(action==='plus'?1:-1)));
      const servings=el('[data-value="servings"]');
      servings.value=active.settings.servings;servings.setCustomValidity('');delete active.invalidFields.servings;
      active.servingsEdited=true;change();update();pulseServings();
    }
  });
  view.addEventListener('input',event=>{
    const name=event.target.dataset.value;if(!name||!active||active.saving||!permitted(current))return;
    event.target.setCustomValidity('');
    if(event.target.validity.valid)delete active.invalidFields[name];
    else active.invalidFields[name]=event.target.value;
    const value=event.target.valueAsNumber;
    active.settings[name]=Number.isFinite(value)&&event.target.validity.valid?value:null;
    change();update();
    if(name==='servings'){active.servingsEdited=true;pulseServings();}
    if(name==='salePrice'){
      const summary=el('.wc-summary'),items=[...summary.querySelectorAll('.wc-ring strong,dd.wc-sale-value,dd.wc-margin-value')];
      motionFor('cost-margin',summary,{items});
    }
  });
  window.addEventListener('compi:languagechange',()=>{close();paint();},{signal});
  signal?.addEventListener('abort',()=>{++attempt;close();releaseImage();drafts.clear();},{once:true});
  if(connect){connect({select:selectRow});return;}
  return selectRow(records[0]||null);
}

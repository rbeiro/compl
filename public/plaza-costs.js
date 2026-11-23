import {translateTexts} from './content-language.js';
import {amountField,readAmount,setupAmounts} from './cost-precision.js';
import {mountTariffPicker,quantityUnits} from './tariff-picker.js';
import {calculateDish,calculateSubrecipe,conversionFactor} from './plaza-cost-engine.js';
import {locale} from './i18n.js';
import {motionFor} from './motion-choices.js';

const esc=value=>String(value??'').replace(/(\d+[,.]\d{3,})(?=\s*(?:€|EUR|%))/gi,m=>num(Number(m.replace(',','.')))).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(n,d=2)=>n==null||!Number.isFinite(Number(n))?'—':new Intl.NumberFormat(locale(),{maximumFractionDigits:Math.min(d,2)}).format(n);
const euro=(n,d=2)=>n==null||!Number.isFinite(Number(n))?'—':new Intl.NumberFormat(locale(),{style:'currency',currency:'EUR',minimumFractionDigits:Math.min(d,2),maximumFractionDigits:Math.min(d,2)}).format(n);
const unit=u=>({Kg:'kg',Litro:'l',Unidad:'ud',Manojo:'manojo'}[u]||u||'');
const icon=name=>`<svg class="icon" aria-hidden="true"><use href="/brand/ui.svg#${name}"></use></svg>`;
const searchIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>';
const normalize=s=>String(s??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const has=(o,k)=>Object.hasOwn(o,k);
const labels={complete:'Completo',provisional:'Provisional',pending:'Pendiente',empty:'Sin ingredientes'};
const badge=(status,text)=>`<span class="ec-badge ${status}">${esc(text||labels[status]||status)}</span>`;
const button=(action,label,style='',attrs='')=>`<button type="button" class="ec-button ${style}" data-action="${action}" ${attrs}>${label}</button>`;
const source=(row,key)=>row?.source?`${row.source.sheet}!${key&&row.source.cells[key]?row.source.cells[key]:row.source.row}`:'Plantilla Excel';

export function renderPlaza({main,data,userId,signal,showCatalog,onIndex,openPicker}){
  const root=document.createElement('div');
  root.className='ec-module';
  root.lang='es';
  const content=document.createElement('div');
  const notice=document.createElement('div');
  notice.className='ec-toast';notice.hidden=true;
  notice.setAttribute('role','status');
  root.append(content,notice);
  main.replaceChildren(root);
  if(showCatalog){
    const back=document.createElement('a');
    back.href='#/escandallos/catalogo';back.className='ec-catalog-link';
    back.textContent='Escandallos del catálogo';
    root.append(back);
  }
  const css=document.createElement('link');
  css.rel='stylesheet';css.href='/plaza-costs.css';document.head.append(css);
  const storageKey='compi.costes.plaza.v1.'+encodeURIComponent(userId);
  const recipes=new Map(data.recipes.map(x=>[x.id,x]));
  const ingredients=new Map(data.ingredients.map(x=>[x.id,x]));
  const tariffs=new Map(data.tariffs.map(x=>[x.reference,x]));
  const standards=new Map(data.standards.map(x=>[x.group,x]));
  const ui={tab:'platos',page:0,query:'',filter:'all'};
  let modal,toastTimer,dirty=false,lastStored=null;
  function initialState(selected){
    return {schema:1,sourceHash:data.metadata.sourceSha256,selected,dishes:{},batchSizes:{},lineOverrides:{},
      standardPrices:{},referencePrices:{},subrecipeWeights:{},journal:[]};
  }
  let state=initialState(data.recipes.find(x=>x.status==='Completa')?.id||data.recipes[0].id);
  try{
    lastStored=localStorage.getItem(storageKey);
    const saved=JSON.parse(lastStored);
    if(saved?.schema===1&&saved.sourceHash===data.metadata.sourceSha256&&recipes.has(saved.selected)&&
      Array.isArray(saved.journal)&&['batchSizes','lineOverrides','standardPrices','referencePrices','subrecipeWeights']
      .every(key=>saved[key]&&typeof saved[key]==='object'&&!Array.isArray(saved[key])))state={...state,...saved};
  }catch{}
  if(!state.dishes || typeof state.dishes!=='object' || Array.isArray(state.dishes))state.dishes={};
  function writeState(next){
    try{
      if(localStorage.getItem(storageKey)!==lastStored){
        toast('Ya se guardaron cambios en otra pestaña. Vuelve a abrir Escandallos para cargar la última versión.');return false;
      }
      const json=JSON.stringify({...next,savedAt:new Date().toISOString()});
      localStorage.setItem(storageKey,json);lastStored=json;return true;
    }catch{toast('No se ha podido guardar. Los ajustes siguen abiertos en esta pestaña.');return false;}
  }
  root.addEventListener('click',handleClick,{signal});
  root.addEventListener('keydown',event=>{
    const tabs=event.target.closest('.ec-tabs');
    if(!tabs||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const all=[...tabs.querySelectorAll('[role=tab]')],i=all.indexOf(event.target);
    if(i<0)return;
    event.preventDefault();
    const index=event.key==='Home'?0:event.key==='End'?all.length-1:(i+(event.key==='ArrowRight'?1:-1)+all.length)%all.length;
    all[index].click();
  },{signal});
  signal.addEventListener('abort',()=>{clearTimeout(toastTimer);closeDialog();css.remove();root.remove();},{once:true});

  const options=id=>({...state,portions:state.batchSizes[id]??state.dishes[id]?.baseServings??recipes.get(id)?.portions??1});
  function calc(id){
    const draft=state.dishes[id];
    if(!draft?.lines?.length)return calculateDish(data,id,options(id));
    const recipe={...recipes.get(id),portions:draft.baseServings};
    const added=draft.lines.map(line=>{
      const tariff=tariffs.get(line.reference);
      return {...line,recipeId:id,name:tariff?.name||line.reference,linkType:'Referencia',key:line.reference,
        appliedReference:line.reference,purchaseUnit:tariff?.unit,custom:true};
    });
    return calculateDish({...data,recipes:[recipe],ingredients:[...data.ingredients,...added]},id,options(id));
  }
  const subCalc=id=>calculateSubrecipe(data,id,options(state.selected));
  const rateForStandard=s=>has(state.standardPrices,s.group)?state.standardPrices[s.group]:(has(state.referencePrices,s.selectedReference)?state.referencePrices[s.selectedReference]:tariffs.get(s.selectedReference)?.unitPrice??null);
  const rateForTariff=t=>has(state.referencePrices,t.reference)?state.referencePrices[t.reference]:t.unitPrice;
  function changed(message){dirty=true;state.journal.unshift({date:new Date().toISOString(),message});state.journal=state.journal.slice(0,60);}
  function toast(message){clearTimeout(toastTimer);const el=notice;el.textContent=message;el.hidden=false;toastTimer=setTimeout(()=>el.hidden=true,4000);}
  function closeDialog(){if(modal){const current=modal;modal=null;current.close();current.remove();}}
  function dialog(title,body){closeDialog();const el=document.createElement('dialog');el.className='ec-dialog';el.setAttribute('aria-label',title);el.innerHTML=`<header><h2>${esc(title)}</h2><button type="button" class="ec-dialog-close" aria-label="Cerrar ventana" data-action="close-dialog">×</button></header><div class="ec-dialog-body">${body}</div>`;root.append(el);modal=el;el.addEventListener('click',e=>{if(e.target===el)closeDialog();});el.addEventListener('close',()=>{if(modal===el)modal=null;el.remove();},{once:true});el.showModal();
    setupAmounts(el);
    if(title==='Elegir un plato')motionFor('cost-picker',el);
    else if(title==='Añadir ingredientes'||title.startsWith('Editar '))motionFor('cost-ingredient',el.querySelector('form')||el);
    return el;}
  function tabsHTML(){return `<div class="ec-tabs" role="tablist" aria-label="Hojas de la plantilla">${[['platos','Platos',45],['tarifas','Tarifas',577],['estandares','Estándares',525],['subrecetas','Subrecetas',2],['cambios','Cambios',11]].map(([key,title,count])=>`<button type="button" class="ec-tab" role="tab" aria-selected="${ui.tab===key}" tabindex="${ui.tab===key?'0':'-1'}" data-action="tab" data-tab="${key}" aria-controls="ec-panel">${title}<span class="ec-tab-count">${count}</span></button>`).join('')}</div>`;}
  function metricsHTML(){const results=data.recipes.map(row=>calc(row.id));
    onIndex?.(results.map(r=>({id:r.id,status:r.status,count:r.lineCount})),state.selected);
    return `<section class="ec-summary-strip" aria-label="Resumen de escandallos">${[['Platos en carta',45,'2 servicios','book'],['Con ingredientes',results.filter(r=>r.lineCount>0).length,'de '+results.length+' platos','file'],['Coste completo',results.filter(r=>r.status==='complete').length,'con las tarifas aplicadas','cost'],['Tarifas de compra',577,'54 proveedores','folder']].map(([label,value,detail,ic])=>`<article class="ec-stat"><div class="ec-stat-top"><span>${label}</span>${icon(ic)}</div><strong>${value}</strong><small>${detail}</small></article>`).join('')}</section>`;}
  function renderCosts(){
    content.innerHTML=`<section class="ec-view"><header class="ec-heading"><div>${openPicker?'<h2>Plaza</h2>':'<h1>Escandallos</h1><p>Plaza · Del ingrediente al coste por ración.</p>'}</div><div class="ec-actions">${button('guide','Cómo funciona','ghost')}${button('save',icon('file')+' Guardar cambios','primary')}</div></header>${metricsHTML()}${tabsHTML()}<div id="ec-panel" role="tabpanel">${ui.tab==='platos'?dishHTML():ui.tab==='subrecetas'?subrecipesHTML():ui.tab==='cambios'?historyHTML():directoryHTML()}</div></section>`;
    wireInputs();
  }
  function dishHTML(){
    const recipe=recipes.get(state.selected),result=calc(recipe.id),baseline=calculateDish(data,recipe.id),portionCount=options(recipe.id).portions;
    const recipeHead=`<section class="ec-selected"><div class="ec-mark">${icon('book')}</div><div class="ec-selected-copy"><span class="eyebrow">${esc(recipe.service)} · Receta seleccionada</span><h2>${esc(recipe.name)}</h2><div class="ec-meta-line">${badge(result.status)}<span>${esc(recipe.id)}</span>${result.simulated?badge('simulation','Con ajustes'):''}</div></div>${openPicker?'':button('choose',`Cambiar plato ${icon('chevron')}`)}</section>`;
    if(result.status==='empty')return recipeHead+`<section class="ec-empty">${icon('file')}<h3>Este plato aún no tiene desglose.</h3><p>Elige los productos de Tarifas e indica cuánto lleva la receta y para cuántas raciones.</p>${button('add-tariff-line','Añadir ingredientes','primary')}</section>`;
    const rows=result.lines.map(line=>{const original=ingredients.get(line.id)||line;return `<tr><td><strong>${esc(line.name)}</strong><small>${line.status==='excluded'?'Excluida por Cocina':line.status==='pending'?esc(line.statusLabel):line.status==='provisional'?'Referencia provisional':original.linkType==='Subreceta'?'Subreceta de cocina':'Referencia vinculada'}${line.effectiveYield!==1&&line.effectiveYield!=null?` · Rend. ${num(line.effectiveYield*100,1)} %`:''}</small></td><td class="num">${line.batchQuantity==null?typeof original.quantity==='number'?num(original.quantity):esc(original.quantity||'—'):num(line.batchQuantity,3)} <span class="price-unit">${esc(original.unit||'')}</span></td><td class="num">${euro(line.unitPrice,4)}<small>/ ${esc(unit(line.purchaseUnit||original.purchaseUnit)||'unidad pendiente')}</small></td><td class="num"><strong>${euro(line.batchCost,4)}</strong>${line.cost===null?'<small>Por completar</small>':''}</td><td><button class="ec-row-action" type="button" data-action="${line.custom?'edit-tariff-line':'edit-line'}" data-id="${esc(line.id)}" aria-label="Editar ${esc(line.name)}">${icon('compose')}</button></td></tr>`;}).join('');
    const pending=result.status==='pending';
    const body=`<section class="ec-card"><header class="ec-card-head"><div><h3>Ingredientes y costes</h3><p>Cantidades para ${num(portionCount,0)} ${portionCount===1?'ración':'raciones'}.</p></div><form id="batch-form" class="ec-step-wrap"><label for="batch-count">Raciones a preparar</label><div class="ec-stepper"><button type="button" data-action="minus" aria-label="Reducir una ración" ${portionCount<=1?'disabled':''}>−</button><span class="ec-step-value"><input id="batch-count" type="number" required min="1" max="9999" step="1" value="${portionCount}" aria-label="Raciones a preparar"><span data-motion-number aria-hidden="true">${portionCount}</span></span><button type="button" data-action="plus" ${portionCount>=9999?'disabled':''} aria-label="Añadir una ración">+</button></div><button type="submit" class="ec-button ec-apply-batch">Aplicar</button></form></header><div class="ec-scroll" tabindex="0" role="region" aria-label="Tabla de ingredientes"><table class="ec-table ec-ingredient-table"><thead><tr><th>Ingrediente</th><th class="num">Cantidad</th><th class="num">Precio estándar</th><th class="num">Coste del lote</th><th><span class="sr-only">Editar</span></th></tr></thead><tbody>${rows}</tbody></table></div><div class="ec-totalbar"><div><span>${pending?'Subtotal conocido del lote':'Coste del lote'}</span><small>${num(portionCount,0)} ${portionCount===1?'ración':'raciones'} · Receta base: ${num(result.baseServings,0)}</small></div><strong>${euro(pending?result.knownBatchCost:result.batchCost)}</strong></div><div class="ec-table-note">${button('add-tariff-line','Añadir ingredientes')} Edita un ingrediente con el lápiz. El lote escala cantidades y costes; el coste por ración conserva la proporción de la receta.</div></section>`;
    const missingCount=result.pendingCount||0;
    const aside=`<aside class="ec-aside"><section class="ec-card"><div class="ec-cost-top ${result.status}"><span class="eyebrow">${pending?'Subtotal conocido por ración':'Coste por ración'}</span><h3>${euro(pending?result.knownPerServing:result.costPerServing)}</h3>${badge(result.status,pending?'Coste final pendiente':result.status==='provisional'?'Estimación provisional':'Desglose completo')}<p>${pending?'Faltan datos. Esta cifra no representa el coste total del plato.':result.status==='provisional'?'Hay una tarifa o un rendimiento estimado que debe confirmarse.':result.simulated?'Calculado con tus ajustes guardados o pendientes. El valor original figura debajo.':'Calculado con las cantidades de la receta y las tarifas aplicadas.'}</p></div><div class="ec-cost-body"><dl class="ec-dl"><div><dt>Importe por ración</dt><dd>${euro(pending?result.knownPerServing:result.costPerServing,4)}</dd></div><div><dt>Ingredientes pendientes</dt><dd>${missingCount} de ${result.lines.length}</dd></div><div><dt>Raciones del lote</dt><dd>${num(portionCount,0)}</dd></div><div class="separated"><dt>${pending?'Subtotal del Excel':'Coste del Excel'}</dt><dd>${euro(pending?baseline.knownPerServing:baseline.costPerServing,4)}</dd></div></dl>${button('trace','Ver origen del cálculo','ec-source-button')}</div><div class="ec-card-foot">Coste de ingredientes. La plantilla no incluye precio de venta, personal ni gastos generales.</div></section><section class="ec-card ec-math-card"><h3>Cómo se calcula</h3><div class="ec-formula">Cantidad de compra × tarifa<br>Suma del lote ÷ raciones</div><p>El rendimiento ajusta cuánto necesitas comprar para obtener la cantidad de receta.</p>${button('guide','Ver explicación','ghost ec-source-button')}</section></aside>`;
    const notes=recipeNotes(recipe,result);
    return recipeHead+`<div class="ec-detail-grid"><div>${body}${notes}<div class="ec-detail-bottom"><p>${dirty?'Hay cambios sin guardar.':'Los ajustes guardados permanecen en este navegador.'}</p><div class="ec-actions">${dirty&&result.status==='complete'?button('save','Guardar escandallo','primary'):''}${button('reset','Restablecer ajustes','ghost')}${button('export','Exportar receta', '',`data-id="${esc(recipe.id)}"`)}</div></div></div>${aside}</div>`;
  }
  function recipeNotes(recipe,result){
    let html='';const originals=recipe.ingredientIds.map(id=>ingredients.get(id));
    const missing=result.lines.filter(x=>x.status==='pending');
    if(missing.length)html+=`<aside class="ec-note pending"><h3>Qué falta para cerrar este escandallo</h3>${missing.map(x=>`<p><strong>${esc(x.name)}:</strong> ${esc(x.missing?.map(issue=>issue.message).join(' ')||x.note||x.statusLabel)}.</p>`).join('')}</aside>`;
    if(originals.some(x=>x.appliedReference==='FOO000000206116'))html+=`<aside class="ec-note"><h3>El pan mantiene su referencia provisional</h3><p>Falta el peso neto de la caja de Font. El Excel aplica 78,65 € históricos ÷ 5,64 kg = 13,94 €/kg. No mezcla el importe vigente de 72,74 € con ese peso antiguo.</p></aside>`;
    if(originals.some(x=>x.linkType==='Subreceta'))html+=`<aside class="ec-note ${result.status==='complete'?'info':''}"><h3>Este plato incorpora una elaboración</h3><p>El coste de la holandesa o del puré depende del peso final de su lote. Puedes probar un peso distinto en la pestaña ${button('subrecipes-tab','Subrecetas','ghost')}.</p></aside>`;
    html+=`<aside class="ec-note info"><details><summary>Supuestos de esta plantilla</summary><ul><li>Rendimiento vacío equivale al 100 %. Las 28 líneas originales no tienen un rendimiento medido introducido.</li><li>Para el cálculo se conserva la regla de Cocina: 1 g = 1 ml. Es una convención de coste, no una densidad física medida.</li>${originals.some(x=>x.status==='Excluida')?'<li>La sal Maldon está excluida por instrucción de Cocina; su cantidad c/s no se ha cuantificado.</li>':''}</ul></details></aside>`;
    return html;
  }
  function chooseRecipe(loadedOnly=false){
    const el=dialog('Elegir un plato',`<div class="ec-filterbar"><label class="ec-search">${searchIcon}<input type="search" id="dish-search" placeholder="Buscar un plato…" aria-label="Buscar un plato" autocomplete="off"></label><select id="dish-state" aria-label="Filtrar platos"><option value="all">Todos los platos</option><option value="loaded" ${loadedOnly?'selected':''}>Con ingredientes</option><option value="pending">Pendientes</option></select></div><div class="ec-recipe-options"></div>`);
    function update(){const q=normalize(el.querySelector('#dish-search').value),filter=el.querySelector('#dish-state').value;const all=data.recipes.filter(x=>normalize(x.name+' '+x.service).includes(q)).filter(x=>filter==='all'||filter==='loaded'&&calc(x.id).lineCount>0||filter==='pending'&&['pending','empty'].includes(calc(x.id).status));el.querySelector('.ec-recipe-options').innerHTML=all.length?all.map(recipe=>{const c=calc(recipe.id);return `<button type="button" class="ec-recipe-option" aria-pressed="${recipe.id===state.selected}" data-action="select-recipe" data-id="${esc(recipe.id)}"><span><strong>${esc(recipe.name)}</strong><small>${esc(recipe.service)} · ${c.lineCount} ingredientes</small></span><span class="option-end">${badge(c.status)}<span>${c.status==='pending'||c.status==='empty'?'Sin coste final':euro(c.costPerServing)}</span></span></button>`;}).join(''):'<p>No hay platos con ese nombre.</p>';}
    el.querySelector('#dish-search').addEventListener('input',update);el.querySelector('#dish-state').addEventListener('change',update);update();el.querySelector('#dish-search').focus();
  }
  function editTariffLine(id,reference=''){
    const recipe=recipes.get(state.selected), draft=state.dishes[recipe.id]||{};
    const previous=(draft.lines||[]).find(line=>line.id===id);
    const el=dialog(previous?'Editar ingrediente de Tarifas':'Añadir ingredientes',`
      <form class="ec-tariff-editor">
        <p><strong>${esc(recipe.name)}</strong></p><div class="ec-tariff-picker"></div>
        <div class="ec-edit-grid">
          <label class="ec-field">Cantidad neta de la receta base<input name="quantity" type="number" min="0.000001" step="any" required></label>
          <label class="ec-field">Unidad de la receta<select name="unit" required></select></label>
          <label class="ec-field">Rendimiento (%)<input name="yield" type="number" min="0.000001" max="100" step="any" required></label>
          <label class="ec-field">Raciones de la receta base<input name="base" type="number" min="1" max="9999" step="1" required></label>
        </div><p class="ec-line-preview" role="status"></p>
        <footer>${previous?button('remove-tariff-line','Quitar ingrediente','ghost'):''}<button type="submit" class="ec-button primary">Aplicar ingrediente</button></footer>
      </form>`);
    const form=el.querySelector('form'), f=form.elements;
    amountField(f.quantity,previous?.quantity??'');amountField(f.yield,(previous?.yieldFactor??1)*100);
    f.base.value=draft.baseServings??recipe.portions??1;
    f.base.readOnly=Boolean(recipe.portions);
    let tariff=null;
    function preview(){
      const quantity=readAmount(f.quantity), yieldFactor=readAmount(f.yield)/100;
      const factor=tariff && conversionFactor(f.unit.value,tariff.unit);
      const price=tariff && rateForTariff(tariff);
      const cost=quantity*factor/yieldFactor*price;
      el.querySelector('.ec-line-preview').textContent=tariff && quantity>0 && yieldFactor>0 && yieldFactor<=1 && price>0 && factor>0 && Number.isFinite(cost)
        ? 'Coste del ingrediente en la receta base: '+euro(cost,4) : tariff && !(price>0)?'Tarifa pendiente de precio.':'';
    }
    const picker=mountTariffPicker(el.querySelector('.ec-tariff-picker'),data.tariffs,{
      selected:previous?.reference||reference,priceFor:rateForTariff,
      onSelect(row){
        const preferred=f.unit.value || previous?.unit;tariff=row;
        f.unit.replaceChildren(...quantityUnits(row?.unit).map(u=>new Option(unit(u),u)));
        if([...f.unit.options].some(o=>o.value===preferred))f.unit.value=preferred;
        preview();
      }
    });
    picker.choices.required=true;form.addEventListener('input',preview);
    function finish(lines,message,baseServings=draft.baseServings||recipe.portions||1){
      state.dishes[recipe.id]={baseServings,lines};
      changed(message+' · '+recipe.name);ui.tab='platos';closeDialog();renderCosts();
      const table=content.querySelector('.ec-ingredient-table tbody');
      if(table)motionFor('cost-ingredient',table,{items:[...table.rows].slice(-3)});
    }
    form.querySelector('[data-action="remove-tariff-line"]')?.addEventListener('click',()=>finish(draft.lines.filter(line=>line.id!==id),'Ingrediente retirado'));
    form.addEventListener('submit',event=>{
      event.preventDefault();if(!tariff||!form.reportValidity())return;
      const row={id:previous?.id||crypto.randomUUID(),reference:tariff.reference,quantity:readAmount(f.quantity),unit:f.unit.value,yieldFactor:readAmount(f.yield)/100};
      const lines=draft.lines||[];
      finish(previous?lines.map(line=>line.id===id?row:line):[...lines,row],tariff.name,f.base.valueAsNumber);
    });
    (tariff?f.quantity:picker.search).focus();
  }
  function editLine(id){
    const row=ingredients.get(id);if(!row)return;const result=calc(row.recipeId).lines.find(x=>x.id===id);
    if(row.status==='Excluida'){dialog(row.name,`<p>Esta línea está excluida por instrucción documentada de Cocina. La cantidad «c/s» no se ha medido; el cero del cálculo representa una exclusión.</p><p>${esc(row.note||'')}</p><p class="ec-ref">${esc(source(row,'status'))} · Cambios</p>`);return;}
    const current=state.lineOverrides[id]||{},allowPrice=Boolean(row.purchaseUnit&&row.appliedReference&&row.linkType!=='Subreceta');
    const el=dialog('Editar '+row.name,`<form id="line-editor"><p>Ajusta la <strong>receta base de ${num(recipes.get(row.recipeId).portions,0)} ración</strong>. Las cantidades del lote se recalculan automáticamente.</p><div class="ec-edit-grid"><label class="ec-field"><span>Cantidad base <small>(${esc(row.unit||'unidad pendiente')})</small></span><input name="quantity" type="number" step="any" min="0.000001" max="1000000" required value="${current.quantity??row.quantity??''}"></label><label class="ec-field"><span>Rendimiento <small>(%)</small></span><input name="yield" type="number" step="any" min="0.01" max="100" required value="${(current.yield??row.effectiveYield??1)*100}"><span class="ec-field-hint">100 % equivale al valor que aplica el Excel cuando está vacío.</span></label><label class="ec-field"><span>Precio de referencia <small>(€/${esc(unit(row.purchaseUnit)||'unidad')})</small></span><input name="price" type="number" step="any" min="0.000001" max="1000000" ${allowPrice?'required':'disabled'} value="${result.unitPrice??''}"><span class="ec-field-hint">${row.linkType==='Subreceta'?'Se calcula desde el lote de la subreceta.':allowPrice?'Este precio ajustado se compartirá con las recetas que usan el mismo vínculo.':'Falta una referencia o unidad válida. Añadir un número no resolvería el dato pendiente.'}</span></label><div class="ec-field"><span>Origen</span><span class="ec-field-hint">${esc(row.linkType||'Vínculo pendiente')}<br>${esc(row.key||'Sin referencia')}<br>${esc(source(row,'quantity'))}</span></div></div>${row.note?`<div class="ec-note"><p>${esc(row.note)}</p></div>`:''}<p class="ec-validation" role="alert"></p><footer>${button('close-dialog','Cancelar','ghost')}<button class="ec-button primary" type="submit">Aplicar a la prueba</button></footer></form>`);
    el.querySelector('form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;const quantity=readAmount(form.elements.quantity),yieldFactor=readAmount(form.elements.yield)/100;if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(yieldFactor)||yieldFactor<=0||yieldFactor>1)return;state.lineOverrides[id]={quantity,yield:yieldFactor};if(allowPrice){const price=readAmount(form.elements.price);if(price!==result.unitPrice){if(row.linkType==='Estándar')state.standardPrices[row.key]=price;else state.referencePrices[row.appliedReference]=price;}}changed(`Ajuste de ${row.name} en ${recipes.get(row.recipeId).name}: ${num(quantity,3)} ${row.unit}, rendimiento ${num(yieldFactor*100,2)} %.`);closeDialog();renderCosts();toast('Ajuste aplicado en los platos vinculados.');});
  }
  function directoryRows(){if(ui.tab==='tarifas'){return data.tariffs.filter(x=>normalize([x.name,x.reference,x.supplier,x.group].join(' ')).includes(normalize(ui.query))).filter(x=>ui.filter==='all'||ui.filter==='available'&&x.unitPrice!=null||ui.filter==='pending'&&x.unitPrice==null);}return data.standards.filter(x=>normalize([x.group,x.selectedName,x.selectedReference].join(' ')).includes(normalize(ui.query))).filter(x=>ui.filter==='all'||ui.filter==='available'&&rateForStandard(x)!=null||ui.filter==='pending'&&rateForStandard(x)==null);}
  function directoryHTML(){const ist=ui.tab==='tarifas';return `<header class="ec-directory-head"><h2>${ist?'Tarifas de compra':'Una referencia por ingrediente'}</h2><p>${ist?'El catálogo conserva el formato de compra, la base facturada y el precio normalizado de la plantilla. Las referencias sin base o precio permanecen pendientes.':'Los estándares conectan el nombre operativo de cocina con el producto elegido de compras. Un cambio de precio se refleja en las recetas que usan ese estándar.'}</p></header><div class="ec-filterbar"><label class="ec-search">${searchIcon}<input id="directory-search" type="search" placeholder="${ist?'Buscar ingrediente, proveedor o referencia…':'Buscar un estándar…'}" aria-label="Buscar en ${ist?'tarifas':'estándares'}" value="${esc(ui.query)}"></label><select id="directory-filter" aria-label="Estado del precio"><option value="all" ${ui.filter==='all'?'selected':''}>Todos los estados</option><option value="available" ${ui.filter==='available'?'selected':''}>Con precio</option><option value="pending" ${ui.filter==='pending'?'selected':''}>Precio pendiente</option></select></div><section class="ec-card" id="directory-results">${directoryTableHTML()}</section><div class="ec-note info"><p>Los valores de la plantilla se conservan como origen. Cualquier precio que pruebes es una simulación y no actualiza compras ni el archivo Excel.</p></div>`;}
  function directoryTableHTML(){const list=directoryRows(),perPage=15,maxPage=Math.max(0,Math.ceil(list.length/perPage)-1);ui.page=Math.min(ui.page,maxPage);const page=list.slice(ui.page*perPage,(ui.page+1)*perPage),ist=ui.tab==='tarifas';let headers=ist?'<th>Producto y referencia</th><th>Proveedor / formato</th><th class="num">Precio por unidad</th><th>Control</th>':'<th>Nombre de cocina</th><th>Referencia elegida</th><th class="num">Precio aplicado</th><th>Estado</th>';
    const rows=page.map(x=>{if(ist)return `<tr tabindex="0" role="button" data-action="tariff" data-id="${esc(x.reference)}" aria-label="Ver tarifa ${esc(x.name)}"><td class="long-name"><strong>${esc(x.name)}</strong><small>${esc(x.reference)}</small></td><td>${esc(x.supplier)}<small>${esc(x.packDescription||'Formato pendiente')}</small></td><td class="num">${euro(rateForTariff(x),4)}<small>/ ${esc(unit(x.unit)||'unidad pendiente')}</small></td><td>${badge(x.control==='Lista'?'complete':x.control==='Provisional'?'provisional':'pending',x.control)}${has(state.referencePrices,x.reference)?'<small>Precio ajustado</small>':''}</td></tr>`;const tf=tariffs.get(x.selectedReference);return `<tr tabindex="0" role="button" data-action="standard" data-id="${esc(x.group)}" aria-label="Ver estándar ${esc(x.group)}"><td class="long-name"><strong>${esc(x.group)}</strong><small>${esc(x.policy||'')}</small></td><td>${esc(x.selectedName||'Sin elegir')}<small>${esc(x.selectedReference||'Referencia pendiente')}</small></td><td class="num">${euro(rateForStandard(x),4)}<small>/ ${esc(unit(tf?.unit)||'unidad pendiente')}</small></td><td>${badge(rateForStandard(x)!=null?'complete':'pending',x.status)}${has(state.standardPrices,x.group)?'<small>Precio ajustado</small>':''}</td></tr>`;}).join('');
    return `<div class="ec-scroll" tabindex="0" role="region" aria-label="Tabla de ${ist?'tarifas':'estándares'}"><table class="ec-table ec-directory-table"><thead><tr>${headers}</tr></thead><tbody>${rows||'<tr><td class="ec-empty-table" colspan="4">No hay coincidencias. Prueba otro nombre.</td></tr>'}</tbody></table></div><div class="ec-pagination"><span>${list.length?ui.page*perPage+1:0}–${Math.min((ui.page+1)*perPage,list.length)} de ${list.length} ${ist?'tarifas':'estándares'}</span><div>${button('previous','Anterior','',ui.page===0?'disabled':'')}${button('next','Siguiente','',ui.page===maxPage?'disabled':'')}</div></div>`;
  }
  function tariffDialog(id){const x=tariffs.get(id);if(!x)return;dialog(x.name,`<p>${esc(x.supplier)} · ${esc(x.reference)}</p><dl class="ec-dl"><div><dt>Formato de compra</dt><dd>${esc(x.packDescription||'Pendiente')}</dd></div><div><dt>Importe vigente del formato</dt><dd>${euro(x.currentAmount,4)}</dd></div><div><dt>Base facturada</dt><dd>${num(x.billedBase,4)} ${esc(unit(x.unit))}</dd></div><div><dt>Precio unitario del Excel</dt><dd>${euro(x.unitPrice,4)} / ${esc(unit(x.unit))}</dd></div><div><dt>Precio aplicado en los platos vinculados</dt><dd>${euro(rateForTariff(x),4)} / ${esc(unit(x.unit))}</dd></div><div><dt>Control original</dt><dd>${esc(x.control)}</dd></div></dl>${x.note?`<div class="ec-note"><p>${esc(x.note)}</p></div>`:''}${x.reference==='FOO000000206116'?'<div class="ec-note"><p>El precio provisional del pan usa 78,65 € / 5,64 kg. No se recalcula con el importe vigente mientras falte el peso de la caja.</p></div>':''}<p class="ec-ref">Origen: ${esc(source(x,'unitPrice'))}</p><footer>${quantityUnits(x.unit).length?button('add-tariff-line','Añadir a '+esc(recipes.get(state.selected).name),'',`data-reference="${esc(id)}"`):''}${x.unitPrice!=null?button('edit-reference-price','Probar otro precio unitario','primary',`data-id="${esc(id)}"`):button('close-dialog','Cerrar')}</footer>`);}
  function standardDialog(group){const x=standards.get(group);if(!x)return;const tf=tariffs.get(x.selectedReference),used=data.ingredients.filter(row=>row.linkType==='Estándar'&&row.key===group);dialog(x.group,`<p>Este estándar indica qué producto de compras se utiliza cuando la receta solicita «${esc(x.group)}».</p><dl class="ec-dl"><div><dt>Producto elegido</dt><dd>${esc(x.selectedName||'Pendiente')}</dd></div><div><dt>Referencia</dt><dd>${esc(x.selectedReference||'Sin elegir')}</dd></div><div><dt>Regla de selección</dt><dd>${esc(x.policy||'Pendiente')}</dd></div><div><dt>Precio aplicado</dt><dd>${euro(rateForStandard(x),4)} / ${esc(unit(tf?.unit)||'unidad pendiente')}</dd></div><div><dt>Uso directo en platos cargados</dt><dd>${new Set(used.map(row=>row.recipeId)).size}</dd></div></dl><p class="ec-ref">Origen: ${esc(source(x,'selectedReference'))}${tf?' · '+esc(source(tf,'unitPrice')):''}</p><footer>${tf?.unitPrice!=null?button('edit-standard-price','Probar otro precio','primary',`data-id="${esc(group)}"`):button('close-dialog','Cerrar')}</footer>`);}
  function editPrice(key,isStandard){const std=isStandard?standards.get(key):null,tf=isStandard?tariffs.get(std?.selectedReference):tariffs.get(key);if(!tf?.unit||tf.unitPrice==null)return;const current=isStandard?rateForStandard(std):rateForTariff(tf);const el=dialog('Editar precio de compra',`<form id="price-editor"><p><strong>${esc(isStandard?std.group:tf.name)}</strong><br>Se actualizarán los costes que utilizan este vínculo en los platos vinculados. La tarifa original permanece intacta.</p><label class="ec-field"><span>Precio normalizado (€/${esc(unit(tf.unit))})</span><input name="price" type="number" step="any" min="0.000001" max="1000000" required value="${current}"></label><p class="ec-field-hint">Valor del Excel: ${euro(tf.unitPrice,4)} / ${esc(unit(tf.unit))}. Se conserva cualquier advertencia original de referencia provisional.</p><footer>${button('close-dialog','Cancelar','ghost')}<button type="submit" class="ec-button primary">Aplicar precio</button></footer></form>`);el.querySelector('form').addEventListener('submit',event=>{event.preventDefault();if(!event.currentTarget.reportValidity())return;const value=readAmount(event.currentTarget.elements.price);if(isStandard)state.standardPrices[key]=value;else state.referencePrices[key]=value;changed(`Precio de ${isStandard?std.group:tf.name}: ${euro(value,4)} / ${unit(tf.unit)}.`);closeDialog();renderCosts();toast('Precio aplicado a sus vínculos.');});}
  function subrecipesHTML(){return `<header class="ec-directory-head"><h2>Elaboraciones que alimentan tus platos.</h2><p>Una subreceta se calcula por lote y se convierte a coste por kg. El Excel utiliza pesos finales estimados; aquí puedes probar qué cambia cuando introduces el peso real obtenido.</p></header><div class="ec-subrecipe-grid">${data.subrecipes.map(x=>{const c=subCalc(x.id),weight=state.subrecipeWeights[x.id]??x.actualWeightGrams;return `<section class="ec-card ec-subrecipe"><div class="ec-card-head"><div><span class="eyebrow">${esc(x.id)}</span><h3>${esc(x.name)}</h3></div>${badge(weight?'simulation':'provisional',weight?'Peso registrado':'Peso estimado')}</div><div class="ec-sub-cost"><strong>${euro(c.costPerKg,4)}</strong><span>/ kg</span></div><dl class="ec-dl"><div><dt>Coste del lote</dt><dd>${euro(c.batchCost,4)}</dd></div><div><dt>Peso de entrada</dt><dd>${num(x.initialWeightGrams,2)} g</dd></div><div><dt>Peso previsto en Excel</dt><dd>${num(x.expectedWeightGrams,2)} g</dd></div><div><dt>Peso aplicado</dt><dd>${num(weight||x.appliedWeightGrams,2)} g</dd></div></dl><form class="ec-weight-editor" data-subrecipe="${esc(x.id)}"><label for="weight-${esc(x.id)}">Peso final del lote (g)</label><div class="ec-field-row"><input id="weight-${esc(x.id)}" name="weight" type="number" min="0.01" max="1000000" step="any" placeholder="Pendiente de pesar" value="${weight??''}"><button type="submit" class="ec-button">Aplicar</button></div><p>Vacío: conserva los ${num(x.expectedWeightGrams,2)} g estimados de la plantilla. Los pesos introducidos aquí se guardan con los ajustes de Plaza.</p></form><div class="ec-linked">Afecta a: ${x.linkedRecipeIds.map(id=>`<button data-action="select-recipe" data-id="${esc(id)}" type="button">${esc(recipes.get(id)?.name||id)}</button>`).join(' · ')}.</div><details><summary>Ingredientes y supuesto de rendimiento</summary><ul>${data.subrecipeIngredients.filter(row=>row.subrecipeId===x.id).map(row=>`<li>${esc(row.name)} · ${num(row.quantity,2)} ${esc(row.unit)}</li>`).join('')}</ul><p class="ec-field-hint">${esc(x.yieldRule.description)} ${x.id==='SUB-HOL'?'Recuperación estimada de mantequilla: 80 %.':'Merma estimada del lote: 5 %.'}</p></details><p class="ec-ref">Fuente: ${esc(source(x,'costPerKg'))} · ${esc(source(x,'actualWeightGrams'))}</p></section>`;}).join('')}</div>`;}
  function historyHTML(){return `<header class="ec-directory-head"><h2>Decisiones que se pueden seguir.</h2><p>El historial de la plantilla documenta criterios de Cocina y Compras. Los cambios guardados en este navegador se registran aparte y no alteran las fórmulas del Excel.</p></header>${state.journal.length?`<h3 class="ec-history-heading">Ajustes de Plaza en este navegador</h3><div class="ec-history">${state.journal.map(x=>`<article class="ec-history-item"><time class="ec-history-date">${new Date(x.date).toLocaleTimeString(locale(),{hour:'2-digit',minute:'2-digit'})}</time><div><h3>Ajuste local</h3><p>${esc(x.message)}</p></div></article>`).join('')}</div>`:''}<h3 class="ec-history-heading">Historial original · 11 entradas</h3><div class="ec-history">${data.changeHistory.map(x=>`<article class="ec-history-item"><time class="ec-history-date">17 nov 2026</time><div><h3>${esc(x.operation)} · ${esc(x.field)}</h3>${x.oldValue!=null?`<p>Antes: ${esc(x.oldValue)}</p>`:''}<p class="value-new">${esc(x.newValue)}</p><p>${esc(x.confirmation)}</p><small>${esc(x.affectedRecipes||'')} · ${esc(source(x,'confirmation'))}</small></div></article>`).join('')}</div>`;}
  function trace(){const recipe=recipes.get(state.selected),r=calc(recipe.id);dialog('Origen del cálculo',`<p><strong>${esc(recipe.name)}</strong> · ${esc(source(recipe,'name'))}</p><p>El módulo conserva el vínculo a las celdas originales. El valor calculado se obtiene de las cantidades, tarifas y rendimientos; un dato pendiente nunca se convierte en un cero supuesto.</p><div class="ec-scroll"><table class="ec-table"><thead><tr><th>Ingrediente</th><th>Cantidad fuente</th><th>Coste fuente</th></tr></thead><tbody>${r.lines.map(x=>{if(x.custom)return `<tr><td>${esc(x.name)}</td><td>${num(x.quantity,4)} ${esc(x.unit)} · Receta base</td><td>${esc(x.appliedReference)} · ${euro(x.unitPrice,4)} / ${esc(unit(x.purchaseUnit))}</td></tr>`;const o=ingredients.get(x.id);return `<tr><td>${esc(o.name)}</td><td>${esc(source(o,'quantity'))}<small>${typeof o.quantity==='number'?num(o.quantity):esc(o.quantity)} ${esc(o.unit)}</small></td><td>${esc(source(o,'lineCost'))}<small>${euro(o.lineCost,4)}</small></td></tr>`;}).join('')}</tbody></table></div><p class="ec-ref">Coste por ración: ${esc(source(recipe,'costPerPortion'))}. Rendimiento vacío: 100 % según Ingredientes!I5.</p>${button('guide','Entender el recorrido completo','primary')}`);}
  function guide(){dialog('Qué es un escandallo y cómo funciona',`<p><strong>Un escandallo calcula cuánto cuestan los ingredientes necesarios para producir una receta y una ración.</strong> Su objetivo aquí es unir la información de compras con las cantidades de cocina, mantener un criterio común y detectar qué datos faltan.</p><div class="ec-guide-grid"><section class="ec-guide-step"><h3>Tarifas</h3><p>577 referencias. Convierte el importe de un formato de compra a una tarifa por kg, litro o unidad. Una caja necesita su contenido neto para poder calcularla.</p></section><section class="ec-guide-step"><h3>Estándares</h3><p>525 nombres de cocina. Cada uno señala qué referencia de compra se utilizará, evitando elegir un producto distinto en cada receta.</p></section><section class="ec-guide-step"><h3>Ingredientes</h3><p>28 líneas cargadas. Relaciona plato, cantidad, unidad, tarifa y rendimiento. El rendimiento convierte la cantidad neta en la compra necesaria.</p></section><section class="ec-guide-step"><h3>Subrecetas</h3><p>Holandesa y puré de brócoli. Suma su lote y divide por el peso obtenido para conocer el coste por kg usado en otros platos.</p></section><section class="ec-guide-step"><h3>Platos</h3><p>45 platos. Suma las líneas válidas y divide por las raciones. Un ingrediente pendiente bloquea el coste final y deja visible solo el subtotal conocido.</p></section><section class="ec-guide-step"><h3>Cambios</h3><p>11 decisiones documentadas. Ayuda a entender por qué se eligió una referencia, una equivalencia o un coste provisional.</p></section></div><div class="ec-guide-example"><h3>Un ejemplo de tu Excel</h3><p>Huevos con sobrasada: <strong>1,01 € por ración.</strong></p><p>Si preparas 10 raciones conservando la receta, las cantidades se multiplican por 10 y el lote cuesta <strong>10,07 €</strong>. El coste unitario se mantiene.</p></div><h3>La lógica del cálculo</h3><ul class="ec-guide-list"><li><strong>Tarifa:</strong> importe de compra ÷ cantidad facturada.</li><li><strong>Compra necesaria:</strong> cantidad de receta × conversión ÷ rendimiento.</li><li><strong>Coste de ingrediente:</strong> compra necesaria × tarifa.</li><li><strong>Coste por ración:</strong> suma del coste de ingredientes ÷ raciones.</li></ul><p>Ejemplo explicativo: obtener 100 g útiles con un rendimiento del 80 % requiere 125 g de compra. Este ejemplo ilustra la fórmula; no es una cantidad añadida a tus recetas.</p><h3>Cómo leer los estados</h3><p>${badge('complete')} Todos los ingredientes tienen coste calculable.<br>${badge('provisional')} El resultado usa una referencia o un peso estimado.<br>${badge('pending')} Falta un vínculo, una unidad o un precio; el total aún no está cerrado.<br>${badge('empty')} El plato está en el catálogo, pero no tiene ingredientes cargados.</p><h3>Qué podrás decidir con esta información</h3><p>Comparar el impacto de una tarifa nueva, ajustar cantidades, planificar un lote y priorizar las referencias pendientes. Una vez completados los escandallos, podrás añadir precios de venta y objetivos de food cost para evaluar la rentabilidad.</p><div class="ec-note"><h3>El coste de ingredientes no es el beneficio del plato</h3><p>Este Excel no contiene PVP de platos, IVA, ventas, personal ni gastos generales. Por eso el módulo no presenta un margen ni recomienda precios de venta.</p></div><h3>Qué probar ahora</h3><ul class="ec-guide-list"><li>Cambia las raciones de Huevos con sobrasada y observa el coste del lote.</li><li>Edita la cantidad o el rendimiento de un ingrediente.</li><li>Abre Pan con tomate y revisa su tarifa provisional.</li><li>Prueba un peso final en la holandesa y consulta un benedictino.</li><li>Guarda los cambios o restablece los ajustes para volver al Excel original.</li></ul><p class="ec-ref">Fuente: las seis hojas de Escandallos_Plaza (1).xlsx. Las equivalencias y los supuestos se mantienen visibles en los platos vinculados.</p>`);}
  function reset(){dialog('Restablecer los ajustes de Plaza',`<div class="ec-reset-warning"><p>Volverás a las cantidades, precios y pesos del Excel original. Se eliminarán los ajustes y el historial local de Plaza.</p></div><footer>${button('close-dialog','Cancelar','ghost')}${button('confirm-reset','Restablecer ajustes','primary')}</footer>`);}
  async function exportRecipe(id){const r=recipes.get(id),c=calc(id),rows=[['CompI · Escandallos Plaza'],['Plato',r.name],['Estado',labels[c.status]],['Raciones del lote',c.portions],['Ingrediente','Cantidad del lote','Unidad','Rendimiento','Tarifa aplicada','Unidad de compra','Coste del lote','Estado'],...c.lines.map(x=>[x.name,x.batchQuantity??'',x.unit,x.effectiveYield??'',x.unitPrice??'',x.purchaseUnit,x.batchCost??'',x.status]),[],['Coste final del lote',c.batchCost??'Pendiente'],['Subtotal conocido',c.knownBatchCost],['Coste por ración',c.costPerServing??'Pendiente'],['Origen','Escandallos_Plaza (1).xlsx'],['Nota','Calculado en CompI con los ajustes locales y la plantilla de Plaza.']];const cell=v=>{let s=typeof v==='number'?num(v,2):String(v??'');if(typeof v==='string'&&/^[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};const target=locale();
    if(target!=='es'){
      const texts=[...new Set(rows.flat().filter(x=>typeof x==='string'&&x&&!x.endsWith('.xlsx')))];
      try{const translated=await translateTexts(texts,target);const labels=new Map(texts.map((x,i)=>[x,translated[i]]));for(const row of rows)for(let i=0;i<row.length;i++)if(labels.has(row[i]))row[i]=labels.get(row[i]);}
      catch{toast('No se pudo preparar la traducción. Vuelve a intentarlo.');return;}
      if(target!==locale()||signal?.aborted)return;
    }
    const csv='\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='CompI_Plaza_'+r.id+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Receta exportada en CSV.');}
  function applyPortions(value,origin){
    if(!Number.isInteger(value)||value<1||value>9999||value===options(state.selected).portions)return;
    state.batchSizes[state.selected]=value;
    changed(`Lote de ${recipes.get(state.selected).name}: ${value} raciones.`);
    renderCosts();
    const button=origin==='input'?content.querySelector('.ec-apply-batch'):content.querySelector('[data-action="'+origin+'"]');
    (button?.disabled?content.querySelector('#batch-count'):button)?.focus({preventScroll:true});
    motionFor('cost-servings',content.querySelector('[data-motion-number]'),{numeric:true});
  }
  function wireInputs(){
    const batch=content.querySelector('#batch-count');const applyBatch=()=>{if(!batch.value.trim()||!batch.checkValidity()||!Number.isInteger(Number(batch.value))||Number(batch.value)<1){batch.reportValidity();batch.value=options(state.selected).portions;return;}applyPortions(Number(batch.value),'input');};content.querySelector('#batch-form')?.addEventListener('submit',e=>{e.preventDefault();applyBatch();});
    content.querySelector('#directory-search')?.addEventListener('input',event=>{ui.query=event.target.value;ui.page=0;content.querySelector('#directory-results').innerHTML=directoryTableHTML();wireTableKeys();});
    content.querySelector('#directory-filter')?.addEventListener('change',event=>{ui.filter=event.target.value;ui.page=0;content.querySelector('#directory-results').innerHTML=directoryTableHTML();wireTableKeys();});
    setupAmounts(content);content.querySelectorAll('form[data-subrecipe]').forEach(form=>form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;const id=form.dataset.subrecipe,value=form.elements.weight.value.trim();if(value)state.subrecipeWeights[id]=readAmount(form.elements.weight);else delete state.subrecipeWeights[id];changed(`Peso final de ${data.subrecipes.find(x=>x.id===id).name}: ${value?num(Number(value),2)+' g':'estimación original'}.`);renderCosts();toast('Peso aplicado. Los platos vinculados se han recalculado.');}));
    wireTableKeys();
  }
  function wireTableKeys(){content.querySelectorAll('tr[role=button]').forEach(row=>row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();row.click();}}));}
  function handleClick(event){
    const el=event.target.closest('[data-action]');if(!el||el.disabled)return;const action=el.dataset.action,id=el.dataset.id;
    if(action==='close-dialog'){closeDialog();return;}if(action==='guide'){guide();return;}
    if(action==='choose'||action==='choose-loaded'){if(openPicker)openPicker();else chooseRecipe(action==='choose-loaded');return;}
    if(action==='select-recipe'){state.selected=id;ui.tab='platos';closeDialog();renderCosts();motionFor('cost-picker',content.querySelector('.ec-selected h2'));return;}
    if(action==='tab'){
      ui.tab=el.dataset.tab;ui.page=0;ui.query='';ui.filter='all';renderCosts();
      motionFor('panel',content.querySelector('#ec-panel'));
      content.querySelector('[aria-selected="true"]')?.focus({preventScroll:true});
      return;
    }
    if(action==='subrecipes-tab'){ui.tab='subrecetas';renderCosts();return;}
    if(action==='add-tariff-line'||action==='edit-tariff-line'){editTariffLine(action==='edit-tariff-line'?id:null,el.dataset.reference);return;}
    if(action==='edit-line'){editLine(id);return;}if(action==='trace'){trace();return;}if(action==='tariff'){tariffDialog(id);return;}if(action==='standard'){standardDialog(id);return;}
    if(action==='edit-reference-price'||action==='edit-standard-price'){editPrice(id,action==='edit-standard-price');return;}
    if(action==='previous'||action==='next'){ui.page+=action==='next'?1:-1;content.querySelector('#directory-results').innerHTML=directoryTableHTML();wireTableKeys();return;}
    if(action==='plus'||action==='minus'){
      applyPortions(options(state.selected).portions+(action==='plus'?1:-1),action);
      return;
    }
    if(action==='save'){
      if(!writeState(state))return;
      dirty=false;renderCosts();toast('Cambios guardados en este navegador.');
      motionFor('save-notice',notice);return;
    }
    if(action==='reset'){reset();return;}
    if(action==='confirm-reset'){
      const next=initialState(state.selected);
      if(!writeState(next))return;
      state=next;dirty=false;closeDialog();renderCosts();toast('Se han restaurado los valores de la plantilla.');return;
    }
    if(action==='export'){exportRecipe(id);return;}
  }
  renderCosts();
  return {select(id){
    if(!recipes.has(id))return;
    state.selected=id;ui.tab='platos';closeDialog();renderCosts();
  }};
}

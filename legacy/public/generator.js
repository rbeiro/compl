import {attachDatePicker} from './workspace-pickers.js';
import { motionFor } from './motion-choices.js';
import { bindText, bindAttr, locale } from './i18n.js';
import { attachPlating } from './plating-assistant.js?v=25';
import { saveGuideSource } from './guide-source.js?v=25';
import guideMessages from './locales/guide.js';
import {helpKeys} from './locales/guide-help.js';

const dishFields = [
  ['nombre_es','Nombre del plato',120],
  ['codigo','Código',60],['version','Versión',24],['fecha','Fecha',12,'date'],
  ['partida','Partida',80],['racion','Ración y unidad',60],['pase','Tiempo de pase',60],['vajilla','Vajilla',120]
];
const serviceFields = [
  ['sala_es','Descripción para sala',600,'textarea'],
  ['canal_zona','Canal y zona',160],['servicio_exterior','Servicio exterior',160],
  ['contiene','Alérgenos confirmados',260],['trazas','Trazas',260],['adaptaciones','Adaptaciones',260]
];
const ingredients=[['nombre','Ingrediente',120],['cantidad','Cantidad',40],['unidad','Unidad',40]];
const steps=[['accion','Acción de emplatado',600,'textarea'],['control','Observaciones',300,'textarea']];
async function fingerprint(blob){
  const hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
export function generator({main,node,link,route,api,rpc,signal,destinations,selected,MIME,initialSource}){
  function caption(tag,key,cls){
    const el=node(tag,undefined,cls);
    bindText(el,key);
    return el;
  }
  function fieldLabel(key,required=false){
    const el=node('label');
    const text=caption('span',key);el.append(text);
    if(required){const mark=node('span',' *');mark.setAttribute('aria-hidden','true');text.append(mark);}
    return el;
  }
  function captionLink(key,url,cls){
    const el=link('',url,cls);
    bindText(el,key);
    return el;
  }
  if(!destinations.length){main.append(caption('p','Todavía no hay un outlet disponible en los hoteles donde tienes permiso de edición.'));return;}
  main.append(caption('p','Elige el outlet, introduce los datos del plato y revisa la ficha antes de generar el Word y el PDF.','intro'));
  const form=node('form',undefined,'recipe-form'),review=node('section',undefined,'recipe-review');
  const status=node('p',undefined,'feedback');status.setAttribute('role','status');
  main.append(form,review,status);review.hidden=true;
  function button(text,action,primary=false){
    const el=caption('button',text,primary?'download primary':'download');el.type='button';el.addEventListener('click',action);return el;
  }
  function section(title){const fs=node('fieldset');fs.append(caption('legend',title));form.append(fs);return fs;}
  const helpToggle=caption('button','Mostrar ayuda del recetario','recipe-help-toggle');
  const helpIcon=node('span','?','recipe-help-icon');
  helpIcon.setAttribute('aria-hidden','true');
  helpToggle.prepend(helpIcon);
  helpToggle.type='button';
  helpToggle.setAttribute('aria-pressed','false');
  helpToggle.addEventListener('click',()=>{
    const enabled=form.classList.toggle('recipe-help-all');
    helpToggle.setAttribute('aria-pressed',String(enabled));
    const hints=enabled ? [...form.querySelectorAll('.recipe-field-help')] : [helpToggle];
    motionFor('recipe-help',hints[0] || helpToggle,{items:hints});
  });
  form.append(helpToggle);
  let helpIndex=0;
  function withHelp(content,key,...controls){
    const wrap=node('div',undefined,'recipe-field');
    const hint=caption('small',helpKeys[key],'recipe-field-help');
    hint.id='recipe-help-'+key+'-'+(++helpIndex);
    for(const control of controls)control.setAttribute('aria-describedby',hint.id);
    wrap.append(content,hint);
    return wrap;
  }
  function grow(el,animate=false){
    if(el.tagName!=='TEXTAREA'||!el.isConnected||el.offsetWidth===0)return;
    const previous=el.offsetHeight;
    el.style.height='auto';
    const border=el.offsetHeight-el.clientHeight;
    const height=el.scrollHeight+border;
    el.style.height=height+'px';
    if(animate && previous!==height && el.closest('.step-row'))motionFor('grow-notes',el);
  }
  function resizeNotes(){for(const el of form.querySelectorAll('textarea'))grow(el);}
  form.addEventListener('input',e=>grow(e.target,true),{signal});
  window.addEventListener('resize',resizeNotes,{signal});
  let syncDate;
  function control(parent,spec,required=false){
    const [key,title,max,type='text']=spec;
    const label=fieldLabel(title,required);
    const el=node(type==='textarea'?'textarea':'input');if(type!=='textarea')el.type=type;
    el.name=key;el.maxLength=max;
    if(type!=='date')el.dir='auto';
    if(type==='textarea'){el.rows=2;el.wrap='soft';}
    el.required=required;label.append(el);parent.append(withHelp(label,key,el));
    if(type==='date')syncDate=attachDatePicker(el,label,signal);
    return el;
  }
  const general=section('Datos del plato'),grid=node('div',undefined,'recipe-fields');general.append(grid);
  const destLabel=fieldLabel('Hotel y outlet',true),select=node('select');select.required=true;select.name='recipeDestination';
  const choose=caption('option','Selecciona un outlet');choose.value='';select.append(choose);
  for(const [i,dest] of destinations.entries()){
    const opt=node('option',dest.hotel+' · '+dest.outlet);opt.value=String(i);opt.dataset.hotelKey=dest.hotel_key;select.append(opt);
    if(dest===selected||(!selected&&destinations.length===1))select.value=String(i);
  }
  destLabel.append(select);grid.append(withHelp(destLabel,'recipeDestination',select));
  const controls={};
  for(const f of dishFields)controls[f[0]]=control(grid,f,f[0]==='nombre_es');
  let plating;
  function rows(title,specs,max){
    const fs=section(title),holder=node('div');fs.append(holder);
    const add=button(specs===steps?'Añadir paso':'Añadir ingrediente',()=>append({},true),true);
    const changed=()=>{if(specs===ingredients)plating?.dishChanged(true);};
    holder.addEventListener('input',changed);
    function sync(){add.disabled=holder.children.length>=max;for(const b of holder.querySelectorAll('button'))b.disabled=holder.children.length===1;}
    function append(values={},notify=false){
      const row=node('div',undefined,'recipe-row');row.classList.toggle('step-row',specs===steps);
      specs.forEach((sp,i)=>{control(row,sp,i===0).value=values[sp[0]] || '';});
      const remove=button('Quitar',()=>{
        const neighbor=row.nextElementSibling || row.previousElementSibling;
        const hadFocus=row.contains(document.activeElement);
        row.remove();sync();changed();
        if(hadFocus)(neighbor?.querySelector('input,textarea') || add).focus({preventScroll:true});
        if(neighbor)motionFor(specs===steps?'step-remove':'ingredient-remove',neighbor);
      });
      bindAttr(remove,'aria-label',specs===steps?'Quitar este paso':'Quitar este ingrediente');
      row.append(remove);holder.append(row);for(const el of row.querySelectorAll('textarea'))grow(el);sync();
      if(notify){
        changed();
        motionFor(specs===steps?'step-add':'ingredient-add',row);
      }
    }
    append();fs.append(add);
    return {
      read:()=>Array.from(holder.children,row=>Object.fromEntries(Array.from(row.querySelectorAll('input,textarea'),el=>[el.name,el.value.trim()]))),
      reset(items){holder.replaceChildren();for(const item of items?.length?items:[{}])append(item);}
    };
  }
  const ingredientRows=rows('Ingredientes',ingredients,40),stepRows=rows('Emplatado paso a paso',steps,24);
  const optional=section('Información para sala y servicio'),more=node('div',undefined,'recipe-fields');optional.append(more);
  for(const f of serviceFields)controls[f[0]]=control(more,f);
  async function request(operation,payload,requestSignal) {
    const dest=destinations[Number(select.value)];
    if(select.value==='' || !dest)throw Error('Outlet no disponible para edición');
    const path=[dest.hotel_key,dest.outlet_key,operation].map(encodeURIComponent).join('/');
    return (await api('/functions/v1/compi-asistente-ficha/'+path,{payload,signal:requestSignal || signal})).json();
  }
  plating=attachPlating({
    box:section('Fotografía de emplatado'),node,caption,button,withHelp,signal,request,
    readDish:()=>({name:controls.nombre_es.value.trim(),ingredients:ingredientRows.read()})
  });
  controls.nombre_es.addEventListener('input',()=>plating.dishChanged(false));
  const probeStatus=node('small',undefined,'hint');
  probeStatus.setAttribute('role','status');
  const retryProbe=button('Reintentar',()=>probe());
  const probeControls=node('div',undefined,'toolbar');
  probeControls.append(probeStatus,retryProbe);
  destLabel.parentElement.append(probeControls);
  let capabilityRequest;
  async function probe() {
    capabilityRequest?.abort();
    const controller=new AbortController();
    capabilityRequest=controller;
    const chosen=select.value!=='';
    plating.setOutlet(chosen,null,chosen);
    probeControls.hidden=true;
    if(!chosen)return;
    try{
      const available=await request('status',{},controller.signal);
      if(controller.signal.aborted||signal.aborted)return;
      plating.setOutlet(true,!!(available.watercolor&&available.composition),false,!!available.composition);
    }catch{
      if(controller.signal.aborted||signal.aborted)return;
      plating.setOutlet(true,false);
      bindText(probeStatus,'No se pudo comprobar la disponibilidad de los asistentes.');
      probeControls.hidden=false;
    }
  }
  signal.addEventListener('abort',()=>capabilityRequest?.abort(),{once:true});
  select.addEventListener('change',()=>{
    plating.changeOutlet();
    probe();
  });
  if(initialSource) {
    const data=initialSource.data;
    select.disabled=true;
    for(const [key,el] of Object.entries(controls))el.value=data[key] || '';
    syncDate();
    ingredientRows.reset(data.ingredientes);
    stepRows.reset(data.pasos);
    plating.restore(initialSource.media,data.ingredientes_en_foto);
    resizeNotes();
  }
  probe();
  const next=caption('button','Revisar ficha','download primary');next.type='submit';form.append(next);
  function formatPreviewDate(){
    const date=review.querySelector('time');
    if(!date)return;
    date.textContent=new Intl.DateTimeFormat(locale(),{dateStyle:'medium',timeZone:'UTC'}).format(new Date(date.dateTime+'T00:00:00Z'));
  }
  window.addEventListener('compi:languagechange',formatPreviewDate,{signal});
  function feedback(err,retry){
    if(signal.aborted)return;
    const detail=err.detail||err.message||'';
    const count=detail.match(/^Indica al menos una fila y respeta el máximo de (\d+)\.$/);
    const character=detail.match(/^El PDF no admite el carácter «(.+)»\.$/u);
    if(err.status===403)bindText(status,'Tu cuenta no tiene permiso de edición en este outlet.');
    else if(err.status===401)bindText(status,'La sesión ha caducado. Vuelve a iniciar sesión.');
    else if(count)bindText(status,'Indica al menos una fila y respeta el máximo de {max}.',()=>({max:new Intl.NumberFormat(locale()).format(Number(count[1]))}));
    else if(character)bindText(status,'El PDF no admite el carácter «{char}».',{char:character[1]});
    else bindText(status,Object.hasOwn(guideMessages,detail)?detail:'No se pudo completar la operación. Puedes volver a intentarlo.');
    motionFor('generation-error',status,{items:retry ? [status,retry] : [status]});
  }
  function heading(text){const h=caption('h2',text);h.tabIndex=-1;review.append(h);h.focus();}
  form.onsubmit=async event=>{
    event.preventDefault();if(next.disabled)return;
    const dest=destinations[Number(select.value)];if(select.value===''||!dest)return;
    next.disabled=true;bindText(status,'');
    try{
      const data=Object.fromEntries(Object.entries(controls).map(([k,v])=>[k,v.value.trim()]));
      // These fields belong to the stored document schema, outside the editable form.
      data.nombre_en=initialSource?.data?.nombre_en ?? '';
      data.sala_en=initialSource?.data?.sala_en ?? '';
      data.ingredientes=ingredientRows.read();data.pasos=stepRows.read();
      const media=await plating.getMedia();
      data.foto=media ? (media.kind==='acuarela'?media.image:media.photo) : '';
      data.ingredientes_en_foto=!!(data.foto&&media.checked);
      const mime=media?.kind==='acuarela'?'image/png':'image/jpeg';
      if(data.foto){
        const bytes=Uint8Array.from(atob(data.foto),ch=>ch.charCodeAt(0));
        data.imagen_aprobada={tipo:media.kind,sha256:await fingerprint(new Blob([bytes]))};
      }
      if(signal.aborted)return;
      if(!data.nombre_es||data.nombre_es.includes('/')||!data.ingredientes.every(i=>i.nombre)||!data.pasos.every(i=>i.accion))throw Error('Completa el nombre, cada ingrediente y cada paso. El nombre del plato no puede incluir barras.');
      form.hidden=true;review.hidden=false;review.replaceChildren();heading('Revisar ficha');
      review.append(node('p',dest.hotel+' · '+dest.outlet),node('h3',data.nombre_es));
      const dl=node('dl',undefined,'recipe-summary');
      const summary=[...dishFields.slice(1),...serviceFields];
      for(const [key,text] of summary)if(data[key]){
        const value=node('dd');value.dir='auto';
        if(key==='fecha'){
          const date=node('time',data[key]);date.dateTime=data[key];value.append(date);
        }else value.textContent=data[key];
        dl.append(caption('dt',text),value);
      }
      review.append(dl);formatPreviewDate();
      for(const [title,items,ordered] of [['Ingredientes',data.ingredientes.map(i=>[i.nombre,i.cantidad,i.unidad].filter(Boolean).join(' · ')),false],['Emplatado',data.pasos.map(i=>[i.accion,i.control].filter(Boolean).join(' — ')),true]]){
        if(title==='Ingredientes'&&data.ingredientes_en_foto)continue;
        const list=node(ordered?'ol':'ul');for(const item of items)list.append(node('li',item));review.append(caption('h3',title),list);
      }
      if(data.foto){const picture=node('img');picture.className='recipe-photo';bindAttr(picture,'alt','Foto de emplatado seleccionada');picture.src='data:'+mime+';base64,'+data.foto;review.append(picture);}
      if(data.ingredientes_en_foto)review.append(caption('small','La foto ya incluye la lista completa de ingredientes','hint'));
      const actions=node('div',undefined,'toolbar');review.append(actions);
      const edit=button('Volver a editar',()=>{
        review.hidden=true;form.hidden=false;resizeNotes();bindText(status,'');controls.nombre_es.focus();
        motionFor('review-draft',general);
      });
      const generate=button('Generar Word y PDF',async()=>{
        edit.disabled=generate.disabled=true;bindText(status,'Generando los documentos…');
        motionFor('generate-files',status);
        try{
          const path='/functions/v1/compi-generar-ficha/'+[dest.hotel_key,dest.outlet_key].map(encodeURIComponent).join('/');
          async function rendition(url){
            const reply=await (await api(url,{payload:data})).json();
            const files={};
            for(const f of ['docx','pdf']){
              const bytes=Uint8Array.from(atob(reply[f]),ch=>ch.charCodeAt(0));
              files[f]=new Blob([bytes],{type:MIME[f]});
            }
            return {files,revision:reply.brand_revision};
          }
          let preview=await rendition(path);
          if(signal.aborted)return;
          bindText(status,'');review.replaceChildren();heading('Ficha generada');review.append(node('p',data.nombre_es+' · '+dest.outlet));
          const downloads=node('div',undefined,'toolbar');review.append(downloads);
          let refreshing;
          async function latestPreview(){
            const revision=await rpc('compi_document_brand_revision',{h:dest.hotel_key});
            if(preview.revision!==revision)preview=await rendition(path);
            return preview.files;
          }
          for(const [f,text] of [['docx','Descargar Word'],['pdf','Descargar PDF']]){
            const get=button(text,async()=>{
              get.disabled=true;
              try{
                refreshing??=latestPreview().finally(()=>{refreshing=null;});
                const files=await refreshing;
                if(signal.aborted||!get.isConnected)return;
                const url=URL.createObjectURL(files[f]),a=link('',url);
                a.download=data.nombre_es+'.'+f;document.body.append(a);a.click();a.remove();
                setTimeout(()=>URL.revokeObjectURL(url),30000);
              }catch(error){feedback(error,get);}finally{get.disabled=false;}
            });
            downloads.append(get);
          }
          const ticket=crypto.randomUUID();
          let master,hash;
          const save=button('Guardar como borrador',async()=>{
            save.disabled=true;bindText(status,'Guardando en Guías de emplatado…');
            motionFor('draft-library',status);
            try{
              master??=(await rendition(path+'?rendition=master')).files;
              hash??=await fingerprint(master.docx);
              if(signal.aborted)return;
              const args={h:dest.hotel_key,o:dest.outlet_key,ticket,label:data.nombre_es,fingerprint:hash};
              const guideKey=initialSource?.guideKey || (await rpc('compi_reserve_generated_draft',args)).key;
              await saveGuideSource({api,rpc,dest,guideKey,data,media:media || {},files:master,previous:initialSource?.revision || null});
              if(signal.aborted)return;
              bindText(status,'Word y PDF guardados como borrador.');
              const open=captionLink('Abrir borrador',route([dest.hotel,dest.outlet,'Plating Guides',guideKey]),'download primary');
              save.replaceWith(open);
              motionFor('draft-library',status,{items:[status,open]});
            }catch(e){feedback(e,save);save.disabled=false;}
          },true);
          downloads.append(save);
          motionFor('generate-files',downloads,{items:[review.firstElementChild,...downloads.children]});
          review.append(button('Preparar otra ficha',()=>{
            review.hidden=true;
            form.hidden=false;
            initialSource=undefined;select.disabled=false;
            form.reset();plating.reset();
            select.value=String(destinations.indexOf(dest));
            ingredientRows.reset();
            stepRows.reset();probe();
            controls.nombre_es.focus();
            bindText(status,'');
          }));
        }catch(e){feedback(e,generate);edit.disabled=generate.disabled=false;}
      },true);
      actions.append(edit,generate);
      motionFor('review-draft',review,{items:[...review.children]});
    }catch(e){feedback(e,next);}
    finally{next.disabled=false;}
  };
}

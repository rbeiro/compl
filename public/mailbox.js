import {motionFor} from './motion-choices.js';
import {t,locale,bindText,bindAttr,bindComputed} from './i18n.js';
import mailMessages from './locales/mail.js';
const boxes = {inbox:'Buzón de entrada',sent:'Enviados',drafts:'Borradores',starred:'Favoritos'};
const symbols = {inbox:'mail',sent:'send',drafts:'compose',starred:'star'};
const pageSize=40;


export async function mailbox({main,node,icon,rpc,hotels,signal}){
  let hotel=hotels[0].key, box='inbox', page=0, sequence=0, data, editor=null, mode='list';
  const text=(tag,key,cls,params)=>{
    const element=node(tag,undefined,cls);
    bindText(element,key,params);
    return element;
  };
  function original(tag,value,cls){
    const element=node(tag,undefined,cls);
    element.textContent=value??'';
    element.dir='auto';
    return element;
  }
  function folderName(id){
    return boxes[id]?t(boxes[id]):data?.folders.find(folder=>folder.id===id)?.label||t('Carpeta');
  }
  function folderLabel(tag,id){
    return boxes[id]?text(tag,boxes[id]):original(tag,folderName(id));
  }
  function formattedDate(date){
    const time=node('time');
    time.dateTime=date;
    bindComputed(time,()=>{
      const lang=locale()==='pt'?'pt-PT':locale();
      if(lang!==formattedLocale){
        formattedLocale=lang;
        dateFormat=new Intl.DateTimeFormat(lang,{dateStyle:'short',timeStyle:'short',calendar:'gregory'});
      }
      return dateFormat.format(new Date(date));
    });
    return time;
  }
  let formattedLocale,dateFormat;
  const status=node('p',undefined,'mail-status');
  status.setAttribute('role','status');
  const account=node('div',undefined,'mail-account'),layout=node('div',undefined,'mail-layout');
  const nav=node('nav',undefined,'mail-nav'),panel=node('section',undefined,'mail-panel');
  bindAttr(nav,'aria-label','Bandejas de correo');bindAttr(panel,'aria-label','Contenido del buzón');
  layout.append(nav,panel);main.append(account,status,layout);
  const hotelSelect=node('select');
  if(hotels.length>1){
    const label=node('label');label.append(text('span','Hotel'),hotelSelect);account.append(label);
    for(const h of hotels){const option=original('option',h.name);option.value=h.key;hotelSelect.append(option);}
    hotelSelect.onchange=()=>safe(async()=>{
      const next=hotelSelect.value;hotelSelect.value=hotel;
      await leaveEditor();hotel=next;hotelSelect.value=next;
      sequence++;data=null;address.textContent='';bindText(status,'');nav.replaceChildren();panel.replaceChildren();
      await visit('inbox');
    });
  }
  const address=node('bdi',undefined,'mail-address');address.dir='ltr';account.append(address);
  function message(error){
    if(error.status===403)return 'Necesitas un buzón @compichef.com activo en este hotel.';
    if(error.status===401)return 'La sesión ha caducado. Vuelve a entrar.';
    if(error.code==='23505')return 'Ya tienes una carpeta con ese nombre.';
    if(Object.hasOwn(mailMessages,error.detail))return error.detail;
    if(error.status===404)return 'El correo o la carpeta ya no están disponibles.';
    return 'No se ha podido completar la operación.';
  }
  async function safe(fn,button){
    if(button?.disabled)return;
    if(button)button.disabled=true;
    try{await fn();}
    catch(e){if(!signal.aborted)bindText(status,message(e));}
    finally{if(button)button.disabled=false;}
  }
  function action(label,fn,cls='download',symbol,params){
    const button=node('button',undefined,cls);button.type='button';
    if(symbol)button.append(icon(symbol));
    if(label)button.append(typeof label==='string'?text('span',label,undefined,params):label);
    button.onclick=()=>safe(()=>fn(button),button);
    return button;
  }
  const change=(op,data)=>rpc('compi_mail_change',{h:hotel,op,data},signal);
  async function leaveEditor(){
    if(!editor)return;
    await editor.save();
    editor.stop();
    editor=null;
  }
  async function visit(target=box,offset=0){
    await leaveEditor();
    const request=++sequence;
    const next=await rpc('compi_mail_read',{h:hotel,box:target,p:offset},signal);
    if(signal.aborted||request!==sequence)return;
    const returning=mode==='detail';
    data=next;box=target;page=offset;mode='list';address.textContent=data.address;
    sidebar();list();
    if(returning)motionFor('mail-open',panel,{items:[...panel.children],direction:'previous'});
  }
  function sidebar(){
    nav.replaceChildren(action('Redactar',async()=>{await leaveEditor();compose();},'download primary mail-compose','compose'));
    for(const id of Object.keys(boxes))nav.append(folderButton(id,folderLabel('span',id),symbols[id]));
    const heading=text('h2','Mis carpetas');nav.append(heading);
    for(const folder of data.folders)nav.append(folderButton(folder.id,original('span',folder.label),'folder'));
    const create=node('details',undefined,'mail-newfolder'),summary=text('summary','Crear carpeta');
    const form=node('form'),label=node('label'),field=node('input'),submit=text('button','Crear','download');
    field.required=true;field.maxLength=60;field.dir='auto';label.append(text('span','Nombre de la carpeta'),field);submit.type='submit';form.append(label,submit);
    form.onsubmit=e=>{e.preventDefault();safe(async()=>{
      await leaveEditor();
      const newFolder=await change('folder_create',{label:field.value.trim()});
      await visit(newFolder.id);bindText(status,'Carpeta creada.');
    },submit);};create.append(summary,form);nav.append(create);
  }
  function folderButton(id,label,symbol){
    const b=action(label,async()=>{await visit(id);bindText(status,'');},'mail-folder',symbol);
    if(id===box&&mode!=='compose')b.setAttribute('aria-current','page');return b;
  }
  function favorite(m,refresh){
    const name=m.starred?'Quitar de favoritos':'Añadir a favoritos';
    const b=action(name,async()=>{
      const next=!m.starred;
      await change('star',{id:m.id,value:next});
      if(signal.aborted||!b.isConnected)return;
      await refresh();
      if(signal.aborted)return;
      const star=[...panel.querySelectorAll('.mail-star')].find(button=>button.dataset.mailId===String(m.id));
      // Removing the last star in Favorites also removes its row.
      const target=star||nav.querySelector('.mail-folder[aria-current="page"]');
      if(target){
        motionFor('mail-favorite',target.querySelector('.icon')||target,{positive:next});
        target.focus({preventScroll:true});
      }
    },'mail-star','star');
    b.dataset.mailId=String(m.id);
    b.setAttribute('aria-pressed',String(m.starred));bindAttr(b,'aria-label','{accion} · {asunto}',()=>({accion:t(name),asunto:m.subject||t('Sin asunto')}));bindAttr(b,'title',name);
    return b;
  }
  function confirmFolder(trigger){
    if(panel.querySelector('.mail-folder-dialog'))return;
    const id=box, dialog=node('dialog',undefined,'mail-folder-dialog');
    const heading=text('h2','Eliminar carpeta');
    heading.id='mail-folder-dialog-title';dialog.setAttribute('aria-labelledby',heading.id);
    const description=text('p','¿Eliminar «{carpeta}»? Sus correos volverán a Entrada, Enviados o Borradores según su origen.',undefined,{carpeta:folderName(id)});
    description.id='mail-folder-dialog-description';dialog.setAttribute('aria-describedby',description.id);
    const buttons=node('div',undefined,'mail-actions');
    const cancel=text('button','Cancelar','download'),remove=text('button','Eliminar carpeta','download danger');
    for(const button of [cancel,remove])button.type='button';
    buttons.append(cancel,remove);dialog.append(heading,description,buttons);panel.append(dialog);
    cancel.autofocus=true;
    cancel.onclick=()=>dialog.close();
    remove.onclick=()=>dialog.close('delete');
    dialog.onclose=()=>{
      dialog.remove();
      if(signal.aborted||!trigger.isConnected)return;
      trigger.focus({preventScroll:true});
      if(dialog.returnValue!=='delete'){
        motionFor('confirm-folder',trigger);
        return;
      }
      safe(async()=>{
        await change('folder_delete',{folder:id});
        await visit('inbox');
        if(signal.aborted)return;
        bindText(status,'Carpeta eliminada. Sus correos han vuelto a la bandeja de origen.');
        motionFor('confirm-folder',status);
        nav.querySelector('.mail-folder[aria-current="page"]')?.focus({preventScroll:true});
      },trigger);
    };
    dialog.showModal();
    motionFor('confirm-folder',dialog,{items:[heading,description,buttons]});
  }
  function list(){
    panel.replaceChildren();const head=node('div',undefined,'mail-panel-head');head.append(folderLabel('h2',box));
    head.append(action('Actualizar',()=>visit(box,page),'mail-text'));
    if(!boxes[box]){
      head.append(action('Eliminar carpeta',confirmFolder,'mail-text danger'));
    }
    panel.append(head);
    if(!data.entries.length){
      const empty=node('div',undefined,'mail-empty');empty.append(icon(symbols[box]||'folder'));
      const texts={inbox:'Todavía no has recibido correos.',sent:'Aquí aparecerán los correos que envíes.',drafts:'Aquí encontrarás los mensajes que guardes como borrador.',starred:'Marca un correo con la estrella para encontrarlo aquí.'};
      empty.append(text('p',texts[box]||'Esta carpeta está vacía.'));panel.append(empty);
    }
    for(const m of data.entries.slice(0,pageSize)){
      const row=node('div',undefined,'mail-row');if(m.unread)row.classList.add('unread');
      const open=action('',()=>openItem(m),'mail-row-open');open.replaceChildren();
      const recipients={destinatarios:m.recipients};
      const who=m.origin==='inbox'?original('span',m.sender):m.recipients?text('span','Para {destinatarios}',undefined,recipients):text('span','Sin destinatario');
      const rowTop=node('span',undefined,'mail-row-top');
      rowTop.append(who,formattedDate(m.updated_at));
      open.append(rowTop,m.subject?original('strong',m.subject):text('strong','Sin asunto'),original('span',m.snippet,'mail-snippet'));
      if(m.unread)bindAttr(open,'aria-label','Sin leer · {persona} · {asunto}',()=>({
        persona:m.origin==='inbox'?m.sender:m.recipients?t('Para {destinatarios}',recipients):t('Sin destinatario'),
        asunto:m.subject||t('Sin asunto')
      }));
      row.append(open,favorite(m,()=>visit(box,page)));panel.append(row);
    }
    if(page||data.entries.length>pageSize){
      const pages=node('div',undefined,'mail-actions');if(page)pages.append(action('Anterior',()=>visit(box,page-1)));
      pages.append(text('span','Página {numero}',undefined,()=>({numero:new Intl.NumberFormat(locale()).format(page+1)})));
      if(data.entries.length>pageSize)pages.append(action('Siguiente',()=>visit(box,page+1)));panel.append(pages);
    }
  }
  async function openItem(m){
    if(m.unread)await change('read',{id:m.id});
    const n=++sequence;
    const result=await rpc('compi_mail_read',{h:hotel,box,p:page,item:m.id},signal);
    if(signal.aborted||n!==sequence)return;
    data=result;const item=data.item;
    if(item.origin==='drafts'){compose(item);return;}
    const opening=mode!=='detail';
    mode='detail';sidebar();panel.replaceChildren(action('Volver a {carpeta}',()=>visit(box,page),'mail-text',undefined,()=>({carpeta:folderName(box)})));
    panel.append(item.subject?original('h2',item.subject):text('h2','Sin asunto'));
    const meta=node('dl',undefined,'mail-meta');
    for(const [label,value] of [['De',item.sender],['Para',item.recipients]])meta.append(text('dt',label),original('dd',value));
    const date=node('dd');date.append(formattedDate(item.updated_at));meta.append(text('dt','Fecha'),date);
    panel.append(meta,original('p',item.body,'mail-body'));
    const bar=node('div',undefined,'mail-actions');
    bar.append(favorite(item,()=>openItem(item)));
    if(item.origin==='inbox')bar.append(action('Responder',()=>compose(null,{to:item.sender,subject:/^Re:/i.test(item.subject)?item.subject:'Re: '+item.subject})));
    panel.append(bar);moveControl(item,panel);
    if(opening)motionFor('mail-open',panel,{items:[...panel.children]});
  }
  function moveControl(m,parent){
    const wrap=node('div',undefined,'mail-move'),label=node('label'),select=node('select');
    const home=folderLabel('option',m.origin);home.value='';select.append(home);
    for(const f of data.folders){const opt=original('option',f.label);opt.value=f.id;select.append(opt);}
    select.value=m.folder||'';label.append(text('span','Mover a'),select);
    wrap.append(label,action('Mover',async()=>{
      const target=select.value;await leaveEditor();await change('move',{id:m.id,folder:target||null});
      await visit(box,page);bindText(status,'Correo movido a {carpeta}.',()=>({carpeta:folderName(target||m.origin)}));
    }));parent.append(wrap);
  }
  function compose(m=null,prefill={}){
    sequence++;mode='compose';sidebar();panel.replaceChildren();bindText(status,'');
    panel.append(text('h2',m?'Editar borrador':'Nuevo correo'));
    const form=node('form',undefined,'mail-form');panel.append(form);
    const id=m?.id||crypto.randomUUID();let revision=m?.revision||0,timer,work=Promise.resolve(),dirty=false,version=0,sending=false,closed=false;
    function field(caption,tag,max,value){
      const label=node('label'),control=node(tag);control.maxLength=max;control.value=value||'';control.dir='auto';
      label.append(text('span',caption),control);form.append(label);return control;
    }
    const to=field('Para','input',1500,m?.recipients||prefill.to);to.dir='ltr';to.placeholder='a.vidal@compichef.com';
    form.append(text('small','Cuentas de prueba de este hotel. Separa varios destinatarios con comas.','hint'));
    const subject=field('Asunto','input',200,m?.subject||prefill.subject),body=field('Mensaje','textarea',30000,m?.body);
    body.rows=8;
    const state=node('p',undefined,'mail-save-state');state.setAttribute('role','status');
    const payload=()=>({id,revision,to:to.value,subject:subject.value,body:body.value});
    function save(){
      clearTimeout(timer);
      work=work.catch(()=>{}).then(async()=>{
        if(!dirty||closed)return;
        const snapshot=version;
        const result=await change('save',payload());revision=result.revision;
        if(snapshot===version&&!closed&&!signal.aborted){
          dirty=false;bindText(state,'Borrador guardado.');motionFor('mail-draft',state);
        }
      });return work;
    }
    function changed(){
      if(!dirty){bindText(state,'Guardando borrador…');motionFor('mail-draft',state);}
      dirty=true;version++;clearTimeout(timer);
      timer=setTimeout(()=>safe(save),550);
    }
    form.oninput=changed;
    const stop=()=>{clearTimeout(timer);closed=true;};
    editor={save,stop,dirty:()=>dirty};
    if(prefill.to||prefill.subject)changed();
    const buttons=node('div',undefined,'mail-actions');
    const send=action('Enviar',async()=>{
      if(sending)return;
      if(!to.value.trim()||!subject.value.trim()||!body.value.trim()){bindText(status,'Completa destinatario, asunto y mensaje.');return;}
      sending=true;const inputs=[to,subject,body];inputs.forEach(el=>el.readOnly=true);
      try{
        await save();await change('send',payload());stop();editor=null;
        await visit('sent');bindText(status,'Correo enviado.');
      }finally{sending=false;inputs.forEach(el=>el.readOnly=false);}
    },'download primary','send');
    buttons.append(send,action('Guardar borrador',async()=>{
      if(sending)return;
      if(!revision&&!dirty){bindText(status,'Escribe algo para guardar el borrador.');return;}
      await save();await visit('drafts');bindText(status,'Borrador guardado.');motionFor('mail-draft',status);
    }));
    form.onsubmit=e=>{e.preventDefault();send.click();};form.append(buttons,state);
    if(m){
      const tools=node('div',undefined,'mail-actions');
      tools.append(favorite(m,async()=>{await leaveEditor();await openItem(m);}));panel.append(tools);
      moveControl(m,panel);
    }
    to.focus();
  }
  const warn=e=>{if(editor?.dirty()){e.preventDefault();e.returnValue='';}};
  window.addEventListener('beforeunload',warn,{signal});
  const leaving=async e=>{
    const link=e.target.closest?.('a[href^="#/"]');
    if(!editor?.dirty()||!link||link.hash===location.hash||e.ctrlKey||e.metaKey)return;
    e.preventDefault();await safe(async()=>{await leaveEditor();location.hash=link.hash;});
  };
  document.addEventListener('click',leaving,{capture:true,signal});
  async function refreshInbox(){
    if(document.hidden||mode!=='list'||!data||nav.querySelector('details[open]')||panel.querySelector('dialog[open]')||layout.contains(document.activeElement))return;
    const request=sequence;
    const next=await rpc('compi_mail_read',{h:hotel,box,p:page},signal);
    if(signal.aborted||sequence!==request||mode!=='list')return;
    if(JSON.stringify(next.entries)!==JSON.stringify(data.entries)||JSON.stringify(next.folders)!==JSON.stringify(data.folders)){
      data=next;sidebar();list();
    }
  }
  const timer=setInterval(()=>safe(refreshInbox),20000);
  signal.addEventListener('abort',()=>{clearInterval(timer);editor?.stop();},{once:true});
  await safe(()=>visit());
}

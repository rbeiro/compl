import {keepNames} from './content-language.js';
import {motionFor} from './motion-choices.js';
import {displayPosition} from './positions.js';
import {confirmDialog} from './confirm-dialog.js';
import {t, bindText, bindAttr, bindComputed} from './i18n.js';
import staffMessages from './locales/staff.js';

export function management({node, link, main, api, token, render, route, MIME, endSession}) {
  function translatedNode(tag,source,className) {
    const element=node(tag,undefined,className);
    bindText(element,source);
    return element;
  }
  const rpc=async(name,args={},signal)=> {
    const r=await api('/rest/v1/rpc/'+name,{token:token(),payload:args,signal});
    const body=await r.text();
    return body?JSON.parse(body):null;
  };
  function credentials(email,password) {
    const card=node('section',undefined,'new-account');
    card.append(translatedNode('p','Esta contraseña solo se muestra ahora. El empleado deberá cambiarla la primera vez que entre.'));
    for(const [caption,value] of [['Correo del empleado',email],['Contraseña temporal',password]]){
      const label=node('label'),field=node('input');field.readOnly=true;field.value=value;field.dir='ltr';field.spellcheck=false;
      const copy=button('Copiar');
      copy.onclick=async()=>{try{await navigator.clipboard.writeText(value);bindText(copy,'Copiado');}catch{field.select();}};
      label.append(translatedNode('span',caption),field);card.append(label,copy);
    }
    const done=button('Entendido, ya la he copiado');
    done.onclick=()=>card.remove();
    card.append(done);return card;
  }
  function notice() {
    const message=node('p',undefined,'feedback');message.setAttribute('role','status');return message;
  }
  function input(form,caption,key,type='text') {
    const label=translatedNode('label',caption),field=node('input');field.name=key;field.type=type;field.required=true;
    if(type!=='file')field.maxLength=type==='email'?254:120;
    label.append(field);form.append(label);return field;
  }
  function button(label) { const b=translatedNode('button',label,'download');b.type='button';return b; }
  function rank(value,allowed=[1,2,3]) {
    const select=node('select');
    for(const [r,label] of [[1,'Rango 1 · Administración'],[2,'Rango 2 · Edición'],[3,'Rango 3 · Lectura']].filter(([r])=>allowed.includes(r))){
      const opt=translatedNode('option',label);opt.value=r;select.append(opt);
    }
    select.value=value;return select;
  }
  function info(error) {
    if(error.code==='already_created')return 'Esta cuenta ya se creó antes. La contraseña no se puede volver a mostrar.';
    if(error.status===429)return 'Demasiadas cuentas creadas. Inténtalo más tarde.';
    if(error.status===401){endSession('Vuelve a iniciar sesión.');return 'La sesión ha caducado.';}
    if(error.status===403 || error.code==='42501')return 'Tu rango actual no permite guardar este cambio.';
    if(error.code==='23505')return 'Ese correo o nombre ya está registrado en este hotel.';
    if(error.detail && Object.hasOwn(staffMessages,error.detail))return error.detail;
    if(error.status===409)return 'Los datos han cambiado. Vuelve a abrir el panel.';
    if(error.status===404)return 'La carpeta o ficha ya no está disponible.';
    if(error.status===422)return 'El servidor no ha podido validar el archivo. Revisa su formato y su contenido.';
    return 'No se pudo guardar. Comprueba los datos e inténtalo de nuevo.';
  }
  async function act(b,message,work) {
    if(b.disabled)return;
    b.disabled=true;bindText(message,'');
    try{await work();}
    catch(err){if(err.name!=='AbortError')bindText(message,info(err));}
    finally{b.disabled=false;}
  }
  function details(parent,summary) {
    const box=node('details',undefined,'manage');box.append(translatedNode('summary',summary));parent.append(box);return box;
  }
  function invitationLabel(employee) {
    if(employee.invite_state==='cancelled')return 'Invitación cancelada';
    if(employee.invite_until && Date.parse(employee.invite_until)<=Date.now())return 'Invitación caducada';
    return {queued:'Correo en cola',delivered:'Correo entregado al buzón',issued:'Enlace generado'}[employee.invite_state]||'Pendiente de activación';
  }
  function updatedRosterRow(id){
    return [...document.querySelectorAll('.team-roster tr[data-member-id]')].find(row=>row.dataset.memberId===String(id));
  }
  function invitationChanged(id){
    const row=updatedRosterRow(id);
    if(row)motionFor('team-invite',row.cells[1],{items:[row.cells[1].querySelector('small'),...row.cells[5].querySelectorAll('button')].filter(Boolean)});
  }
  function labInvite(cell, hotel, employee, signal) {
    const issued=['queued','delivered','issued'].includes(employee.invite_state);
    const send=button(issued?'Reenviar invitación':'Enviar invitación');
    const result=notice();
    const change=op=>rpc('compi_manage_invitation',{h:hotel,employee:employee.id,op,previous:employee.invite_revision},signal);
    cell.append(send,result);
    send.onclick=()=>act(send,result,async()=>{
      if(issued && !await confirmDialog({message:t('¿Sustituir la invitación anterior?'),accept:'Reenviar invitación'}))return;
      const response=await change(employee.invite_state && employee.invite_state!=='prepared'?'replace':'send');
      if(response.state==='channel_required'){
        bindText(result,'Falta el buzón individual de activación. Pide al operador del laboratorio que lo configure.');return;
      }
      await render();
      const done=document.querySelector('#staff-status');
      invitationChanged(employee.id);
      if(done)bindText(done,'Invitación en cola para el buzón individual del empleado.');
    });
    if(issued && employee.invite_state!=='cancelled'){
      const cancel=button('Cancelar invitación');cell.append(cancel);
      cancel.onclick=()=>act(cancel,result,async()=>{
        if(!await confirmDialog({message:t('¿Cancelar la invitación de {email}?',{email:employee.email}),accept:'Cancelar invitación',danger:true}))return;
        await change('cancel');await render();invitationChanged(employee.id);
      });
    }
  }
  function accessControl(cell, hotel, member, status, signal) {
    const restore=Boolean(member.withdrawn_at);
    const label=restore?'Restablecer acceso':'Retirar acceso';
    const action=button(label);
    if(!restore)action.classList.add('danger');
    bindAttr(action,'aria-label',restore?'Restablecer el acceso de {name}':'Retirar el acceso de {name}',{name:member.employee_name});
    cell.append(action);
    action.onclick=()=>act(action,status,async()=>{
      const question=restore
        ? '¿Restablecer el acceso de {name} ({email})? Podrá volver a acceder a los documentos y a su buzón de este hotel.'
        : '¿Retirar el acceso de {name} ({email})? Perderá el acceso a los documentos y a su buzón de este hotel.';
      if(!await confirmDialog({message:t(question,{name:member.employee_name,email:member.email}),accept:label,danger:!restore}))return;
      await rpc('compi_set_staff_access',{
        h:hotel,employee:member.id,enabled:restore,expected_rank:member.access_rank
      },signal);
      await render();
      const done=document.querySelector('#staff-status');
      if(done)bindText(done,restore?'Se ha restablecido el acceso de {name}.':'Se ha retirado el acceso de {name}.',{name:member.employee_name});
    });
    if(restore){
      const remove=button('Eliminar empleado');
      remove.classList.add('danger');
      bindAttr(remove,'aria-label','Eliminar a {name}',{name:member.employee_name});
      cell.append(remove);
      remove.onclick=()=>act(remove,status,async()=>{
        if(!await confirmDialog({accept:'Eliminar empleado',danger:true,message:t('¿Eliminar a {name} ({email}) de este hotel? Se borrarán su ficha de empleado, su buzón y sus carpetas de este hotel, y su usuario de acceso si no pertenece a otro hotel. Otros empleados conservarán sus copias de los correos. Esta acción es definitiva.',{name:member.employee_name,email:member.email})}))return;
        await rpc('compi_delete_withdrawn_employee',{h:hotel,employee:member.id,withdrawal:member.withdrawn_at},signal);
        await render();
        const done=document.querySelector('#staff-status');
        if(done)bindText(done,'Se ha eliminado a {name} de este hotel.',{name:member.employee_name});
      });
    }
  }
  function pendingControl(cell, hotel, member, status, signal) {
    const remove=button('Eliminar registro');
    remove.classList.add('danger');
    bindAttr(remove,'aria-label','Eliminar el registro pendiente de {name}',{name:member.employee_name});
    cell.append(remove);
    remove.onclick=()=>act(remove,status,async()=>{
      if(!await confirmDialog({message:t('¿Eliminar el registro de {name} ({email})? Todavía no tiene cuenta. Esta acción es definitiva.',{name:member.employee_name,email:member.email}),accept:'Eliminar registro',danger:true}))return;
      await rpc('compi_remove_pending_employee',{h:hotel,employee:member.id},signal);
      await render();
      const done=document.querySelector('#staff-status');
      if(done)bindText(done,'Se ha eliminado a {name} de este hotel.',{name:member.employee_name});
    });
  }
  async function panel(admins,hotel,signal) {
    if(!admins.includes(hotel)) {main.append(translatedNode('p','No tienes acceso a la gestión de empleados.'));return;}
    const staff=await (await api('/rest/v1/compi_staff?hotel_key=eq.'+encodeURIComponent(hotel)+'&select=id,email,employee_name,position_name,outlet_name,access_rank,user_id,withdrawn_at,invite_state,invite_until,invite_revision&order=employee_name',{token:token(),signal})).json();
    if(signal.aborted)return;
    const holder=details(main,'Registrar empleado'),form=node('form',undefined,'staff-form');
    holder.append(form);
    const given=input(form,'Nombre','nombre'),surname=input(form,'Apellido para el correo','apellido');
    const pos=input(form,'Puesto','posicion'),out=input(form,'Outlet habitual','outlet');
    const label=translatedNode('label','Rango de acceso'),r=rank(3,[2,3]);label.append(r);form.append(label);
    const create=button('Registrar empleado');create.type='submit';const msg=notice();form.append(create,msg);
    form.append(translatedNode('p','CompI asigna una dirección personal con la inicial, el apellido y el código del hotel. Si está ocupada, añade letras del nombre.','hint'));
    let requestId=crypto.randomUUID();
    form.addEventListener('input',()=>{requestId=crypto.randomUUID();});
    form.onsubmit=e=>{e.preventDefault();act(create,msg,async()=>{
      const response=await api('/functions/v1/compi-arts-crear-cuenta',{token:token(),signal,payload:{h:hotel,request_id:requestId,given_name:given.value.trim(),surname:surname.value.trim(),
        position_name:pos.value.trim(),outlet_name:out.value.trim(),access_rank:Number(r.value)}});
      const account=await response.json();
      await render();const status=document.querySelector('#staff-status');
      if(status){bindText(status,'Cuenta creada para {email}. Copia ahora la contraseña: no se volverá a mostrar.',{email:account.email});status.after(credentials(account.email,account.password));}
    });};
    const status=notice();status.id='staff-status';
    const refresh=button('Actualizar lista');refresh.onclick=()=>render();
    const toolbar=node('div',undefined,'team-toolbar'), searchLabel=translatedNode('label','Buscar en el equipo');
    const search=node('input');search.type='search';search.autocomplete='off';
    bindAttr(search,'placeholder','Nombre, puesto u outlet');searchLabel.append(search);
    toolbar.append(searchLabel,refresh);main.append(toolbar,status);
    const scroll=node('div',undefined,'table-scroll team-roster'),table=node('table'),head=table.createTHead().insertRow();
    scroll.setAttribute('role','region');bindAttr(scroll,'aria-label','Lista de empleados');scroll.tabIndex=0;
    const columns=['Nombre del empleado','Correo','Posición','Outlet habitual','Rango','Acciones'];
    for(const text of columns){const th=translatedNode('th',text);th.scope='col';head.append(th);}
    const body=table.createTBody(), roster=[];
    const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    for(const s of staff) {
      const row=body.insertRow();row.dataset.memberId=String(s.id);
      roster.push({row,terms:fold([s.employee_name,s.position_name,s.outlet_name,s.email].join(' '))});
      keepNames([s.employee_name,s.outlet_name]);
      for(const key of ['employee_name','email','position_name','outlet_name']){
        const cell=row.insertCell();cell.dir='auto';
        if(key==='position_name')displayPosition(cell,s[key]);else cell.textContent=s[key];
      }
      const initials=node('span',[...String(s.employee_name||'').trim().split(/\s+/).slice(0,2)].map(word=>Array.from(word)[0]).join('').toLocaleUpperCase(),'team-initials');
      initials.setAttribute('aria-hidden','true');row.cells[0].prepend(initials);
      if(s.withdrawn_at)row.cells[1].append(translatedNode('small','Acceso retirado'));
      else if(!s.user_id)row.cells[1].append(translatedNode('small',invitationLabel(s)));
      const pick=rank(s.access_rank);bindAttr(pick,'aria-label','Rango de {name}',{name:s.employee_name});row.insertCell().append(pick);
      pick.disabled=Boolean(s.withdrawn_at);
      const actions=row.insertCell(),save=button('Guardar');actions.append(save);save.disabled=true;
      if(s.user_id || s.withdrawn_at)accessControl(actions,hotel,s,status,signal);
      else pendingControl(actions,hotel,s,status,signal);
      for(const cell of row.cells)bindAttr(cell,'data-label',columns[cell.cellIndex]);
      pick.onchange=()=>{
        save.disabled=Number(pick.value)===s.access_rank;
        motionFor('team-rank',row,{items:[pick,save]});
      };
      save.onclick=()=>act(save,status,async()=>{
        const next=Number(pick.value);
        await rpc('compi_staff_change',{h:hotel,op:'rank',item:{id:s.id,rank:next,previous:s.access_rank}},signal);
        await render();const done=document.querySelector('#staff-status');
        if(done){
          bindText(done,'El rango de {name} ahora es {rank}.',{name:s.employee_name,rank:next});
          motionFor('team-rank',done,{items:[updatedRosterRow(s.id)?.querySelector('select'),done].filter(Boolean)});
        }
      });
    }
    const empty=translatedNode('p','No se encontraron empleados.','team-empty');
    empty.setAttribute('role','status');
    const filter=()=>{
      const query=fold(search.value.trim());let found=0;
      for(const {row,terms} of roster){row.hidden=!terms.includes(query);if(!row.hidden)found++;}
      empty.hidden=found>0;scroll.hidden=found===0;
    };
    search.addEventListener('input',filter);
    scroll.append(table);main.append(scroll,empty);filter();
  }
  function catalog(op,ctx,label='',signal) {
    return rpc('compi_catalog_change',{h:ctx.hotel_key,o:ctx.outlet_key||'',g:ctx.guide_key||'',op,label},signal);
  }
  function nameForm(box,caption,initial,saveText,work) {
    const form=node('form',undefined,'edit-form');const field=input(form,caption,'nombre');field.value=initial;
    const submit=button(saveText);submit.type='submit';const msg=notice();form.append(submit,msg);box.append(form);
    form.onsubmit=e=>{e.preventDefault();act(submit,msg,()=>work(field.value.trim()));};
  }
  function remove(box,what,action) {
    const folder=what==='carpeta';
    const b=button(folder?'Eliminar carpeta':'Eliminar ficha'),msg=notice();b.classList.add('danger');box.append(b,msg);
    const question=folder?'¿Eliminar esta carpeta del portal? También se ocultarán sus fichas.':'¿Eliminar esta ficha del portal?';
    b.onclick=async()=>{if(await confirmDialog({message:t(question),accept:folder?'Eliminar carpeta':'Eliminar ficha',danger:true}))act(b,msg,action);};
  }
  function go(hash) {if(location.hash===hash)return render();location.hash=hash;}
  function folderControls(level,ctx,rank,parts,signal) {
    if(level===1&&rank===1) {
      nameForm(details(main,'Crear carpeta de outlet'),'Nombre del outlet','','Crear carpeta',async name=>{
        await catalog('new_folder',ctx,name,signal);await go(route([...parts,name]));
      });
    }
    if(level===2&&rank===1){
      const box=details(main,'Gestionar carpeta');
      nameForm(box,'Nombre del outlet',ctx.outlet,'Guardar nombre',async name=>{
        await catalog('rename_folder',ctx,name,signal);await go(route([ctx.hotel,name]));
      });
      remove(box,'carpeta',async()=>{await catalog('delete_folder',ctx,'',signal);await go(route([ctx.hotel]));});
    }
    if(level===3&&rank<=2){
      nameForm(details(main,'Añadir guía de emplatado'),'Nombre del plato','','Crear borrador',async name=>{
        const key=await catalog('new_guide',ctx,name,signal);await go(route([...parts,key]));
      });
    }
  }
  function guideControls(row,rank,signal,parts) {
    if(rank>2)return;
    const draft=row.guide_state==='draft';
    const box=details(main,draft?'Completar borrador':'Editar ficha');box.open=draft;box.classList.add('guide-editor');
    nameForm(box,'Nombre de la ficha',row.title,'Guardar nombre',async name=>{await catalog('rename_guide',row,name,signal);await render();});
    for(const [ext,label] of [['docx','Word editable'],['pdf','PDF']]){
      const f=node('form',undefined,'edit-form'),picker=input(f,label,ext,'file');picker.accept='.'+ext;
      const pickerLabel=picker.parentElement, fileControl=node('span',undefined,'localized-file');
      fileControl.append(translatedNode('span','Elegir archivo','download'),picker);
      const fileName=node('bdi',undefined,'guide-file-name');fileName.setAttribute('aria-live','polite');
      const refreshName=()=>bindComputed(fileName,()=>picker.files[0]?.name||t('Ningún archivo seleccionado'));
      refreshName();picker.addEventListener('change',refreshName);
      const field=node('span',undefined,'guide-file-field');field.append(fileControl,fileName);pickerLabel.append(field);
      const caption=ext==='pdf'?(draft?'Subir PDF':'Sustituir PDF'):(draft?'Subir Word editable':'Sustituir Word editable');
      const b=button(caption);b.type='submit';const msg=notice();f.append(b,msg);box.append(f);
      f.onsubmit=e=>{e.preventDefault();act(b,msg,async()=>{
        const selected=picker.files[0];if(!selected)return;
        if(!selected.name.toLowerCase().endsWith('.'+ext)||selected.size<4||selected.size>10485760){bindText(msg,'Selecciona un archivo .{ext} válido de hasta 10 MB.',{ext});return;}
        const signature=new Uint8Array(await selected.slice(0,5).arrayBuffer());
        if(ext==='pdf'?String.fromCharCode(...signature)!=='%PDF-':signature[0]!==80||signature[1]!==75){bindText(msg,'El contenido no coincide con el formato seleccionado.');return;}
        const path=[row.hotel_key,row.outlet_key,row.guide_key,ext].map(encodeURIComponent).join('/');
        await api('/functions/v1/compi-subir-ficha/'+path,{token:token(),signal,upload:selected,mime:MIME[ext]});
        picker.value='';refreshName();bindText(msg,ext==='pdf'?'PDF guardado.':'Word editable guardado.');
        if(!draft)await render();
      });};
    }
    if(draft){const b=button('Publicar ficha'),msg=notice();b.classList.add('primary');box.append(b,msg);b.onclick=()=>act(b,msg,async()=>{await catalog('publish',row,'',signal);await render();});}
    if(rank===1)remove(box,'ficha',async()=>{await catalog('delete_guide',row,'',signal);await go(route(parts.slice(0,3)));});
  }
  return {rpc,panel,folderControls,guideControls};
}

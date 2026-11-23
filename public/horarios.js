import {attachMonthPicker} from './workspace-pickers.js?v=30';
import {displayPosition} from './positions.js';
import {motionFor} from './motion-choices.js';
import {bindComputed, bindText, locale, t} from './i18n.js';

let cachedFormat;
function formats(){
  const language=locale();
  if(cachedFormat?.language===language)return cachedFormat;
  const regional=language==='pt'?'pt-PT':language;
  const dates=options=>new Intl.DateTimeFormat(regional,{calendar:'gregory',timeZone:'UTC',...options});
  const number=options=>new Intl.NumberFormat(regional,options);
  cachedFormat={
    language,
    collator:new Intl.Collator(regional,{sensitivity:'base',numeric:true}),
    month:dates({month:'long',year:'numeric'}), short:dates({month:'short',day:'numeric'}),
    dated:dates({month:'short',day:'numeric',year:'numeric'}), weekday:dates({weekday:'short'}),
    clock:dates({hour:'2-digit',minute:'2-digit',hourCycle:'h23'}), number:number({useGrouping:false}),
    clockDigit:number({useGrouping:false,minimumIntegerDigits:2}),
    hours:number({style:'unit',unit:'hour',unitDisplay:'short'}),
    minutes:number({style:'unit',unit:'minute',unitDisplay:'short'}),
    days:number({style:'unit',unit:'day',unitDisplay:'long'}),
    list:new Intl.ListFormat(regional,{style:'short',type:'conjunction'}),
  };
  return cachedFormat;
}
const scheduleErrors=new Set([
  'Introduce una hora de entrada y otra de salida distintas.',
  'El empleado tiene vacaciones aprobadas para ese día.',
  'El turno ha cambiado. Revisa el cuadrante actualizado.',
  'El saldo ha cambiado. Revisa la tabla actualizada.',
  'Hay días que ya has solicitado. Revisa la selección.',
  'La selección supera los 45 días disponibles en un año.',
  'Esta solicitud ya tiene una decisión.',
]);
const states={pending:'Pendiente',approved:'Aprobada',rejected:'Rechazada'};
const tabs=[['roster','Cuadrante'],['leave','Solicitar vacaciones'],['manage','Gestión del equipo']];
const normalize=text=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const dayDate=iso=>new Date(iso+'T12:00:00Z');
const capitalize=text=>text.charAt(0).toUpperCase()+text.slice(1);
const monthDate=month=>dayDate(month+'-01');
function moveMonth(month,offset){
  const date=monthDate(month);date.setUTCMonth(date.getUTCMonth()+offset);return date.toISOString().slice(0,7);
}
function positionGroup(name){
  const p=normalize(name);
  if(/ejecutiv|executive|director/.test(p))return 0;
  if(/sous|segund[oa].*cocina|subchef|subjef/.test(p))return 2;
  if(/jef[ea] de cocina|chef de cocina|head chef|chef de cuisine/.test(p))return 1;
  if(/demi|segund[oa].*partida/.test(p))return 4;
  if(/jef[ea] de partida|chef de part|supervisor/.test(p))return 3;
  if(/ayudante|commis|auxiliar/.test(p))return 6;
  if(/practi|trainee|becari[oa]|aprendiz/.test(p))return 7;
  if(/cociner|pasteler|chef|cocinero/.test(p))return 5;
  return 8;
}
function positionKey(name){
  return normalize(name).replace(/\bjefa\b/g,'jefe').replace(/\b(ejecutiv|cociner|pasteler|segund|becari)a\b/g,'$1o');
}
function comparePeople(a,b){
  return positionGroup(a.position)-positionGroup(b.position)||formats().collator.compare(positionKey(a.position),positionKey(b.position))||formats().collator.compare(a.name,b.name);
}
function hours(minutes){
  const n=Math.abs(minutes),h=Math.floor(n/60),m=n%60;
  return (minutes<0?'−':minutes>0?'+':'')+formats().hours.format(h)+(m?' '+formats().minutes.format(m):'');
}
// Keep localized signs, separators and units in stationary text nodes.
function renderHourDigits(element,minutes){
  const amount=Number(minutes);
  const parts=Number.isFinite(amount)?hours(amount).split(/(\p{Nd}+)/u):['—'];
  element.replaceChildren(...parts.map((part,i)=>{
    if(i%2===0)return part;
    const digits=document.createElement('span');digits.dataset.motionNumber='';digits.textContent=part;
    return digits;
  }));
}
function pulseHours(element,previous=[]){
  const digits=[...element.querySelectorAll('[data-motion-number]')];
  const changed=digits.filter((span,i)=>span.textContent!==previous[i]);
  for(const span of changed.length?changed:digits)motionFor('hours-adjust',span,{numeric:true});
}
function ranges(days){
  const result=[];let first,last;
  function append(){
    if(first)result.push(first===last?formats().dated.format(dayDate(first)):formats().dated.formatRange(dayDate(first),dayDate(last)));
  }
  for(const date of [...days].sort()){
    if(!last||dayDate(date)-dayDate(last)!==86400000||date.slice(0,4)!==last.slice(0,4)){append();first=date;}last=date;
  }
  append();return formats().list.format(result);
}
function clock(time){return formats().clock.format(new Date('2000-01-01T'+time.slice(0,5)+':00Z'));}
function timeRange(shift){
  if(!shift)return '—';
  if(shift.kind==='off')return t('Libre');
  const start=shift.starts.slice(0,5),end=shift.ends.slice(0,5);
  return clock(start)+'–'+clock(end)+(end<start?' (+'+formats().number.format(1)+')':'');
}
const badgeStyles = new Map([
  ['chef ejecutivo','executive'], ['executive chef','executive'],
  ['chef de cocina','head'], ['jefe de cocina','head'], ['head chef','head'],
  ['sous chef','sous'], ['chef de partida','partida-chef'], ['jefe de partida','partida-jefe'],
  ['cocinero','cook'], ['cocinero de noches','night'], ['cocinero de noche','night'],
  ['ayudante de cocina','assistant']
]);

export async function schedules({main,node,rpc,hotels,signal}){
  const root=node('section',undefined,'schedule'),notice=node('p',undefined,'schedule-notice'),panel=node('div');
  notice.setAttribute('role','status');main.append(root);root.append(notice,panel);
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid'}).format(new Date());
  let hotel=hotels[0].key,month=today.slice(0,7),department=null,tab='roster',data,sequence=0,saving=false;
  let chosen=new Set(),requestId=crypto.randomUUID(),scrolled=0;
  function ui(tag,key,cls){
    const el=node(tag,undefined,cls);bindText(el,key);return el;
  }
  function field(label){const wrapper=node('label',undefined,'sched-field');wrapper.append(ui('span',label));return wrapper;}
  function button(label,handler,cls='download'){
    const el=label?ui('button',label,cls):node('button',undefined,cls);el.type='button';el.onclick=handler;return el;
  }
  function select(label,items,value,onChange){
    const wrapper=field(label),el=node('select');
    for(const item of items){const option=item.label?ui('option',item.label):node('option',item.name);option.value=item.key;el.append(option);}
    el.value=value;el.onchange=()=>onChange(el.value);wrapper.append(el);return wrapper;
  }
  function feedback(key,bad=false){bindText(notice,key);notice.classList.toggle('is-error',bad);}
  function message(error){return (scheduleErrors.has(error.detail)&&error.detail)||({403:'Tu cuenta no tiene permiso para esta operación.',401:'Tu sesión ha caducado. Vuelve a iniciar sesión.'}[error.status])||'No se pudo completar la operación. Vuelve a intentarlo.';}
  function resetChoice(){chosen=new Set();requestId=crypto.randomUUID();}
  async function load(direction){
    const turn=++sequence;panel.inert=true;panel.setAttribute('aria-busy','true');
    try{
      const result=await rpc('compi_schedule_view',{h:hotel,month_start:month+'-01',department:tab==='leave'?null:department},signal);
      if(signal.aborted||turn!==sequence)return;
      data=result;
      const reserved=new Set(data.mine.filter(x=>x.state!=='rejected').flatMap(x=>x.days));
      for(const d of chosen)if(reserved.has(d))chosen.delete(d);
      render();
      if(direction){
        const table=panel.querySelector('.schedule-grid,.sched-team-table');
        if(table)motionFor('schedule',table,{items:[...table.querySelectorAll('tr')],direction:direction==='previous'?-1:1});
      }
      return true;
    }catch(error){
      if(signal.aborted||turn!==sequence)return;
      data=undefined;panel.replaceChildren(button('Volver a cargar',()=>load()));feedback(message(error),true);
    }finally{if(!signal.aborted&&turn===sequence){panel.inert=false;panel.removeAttribute('aria-busy');}}
  }
  async function write(fn,args,done,dialog,onRendered){
    if(saving)return;saving=true;panel.inert=true;if(dialog)dialog.querySelector('fieldset').disabled=true;
    try{
      await rpc(fn,{h:hotel,...args},signal);
      if(signal.aborted)return;
      if(fn==='compi_schedule_request')resetChoice();
      dialog?.close();feedback(done);
      if(await load())onRendered?.();
    }catch(error){
      if(signal.aborted)return;
      if(error.status===409){dialog?.close();await load();}
      if(dialog?.open)bindText(dialog.querySelector('[role="status"]'),message(error));
      else feedback(message(error),true);
    }finally{saving=false;panel.inert=false;if(dialog?.open)dialog.querySelector('fieldset').disabled=false;}
  }
  let refreshDialog;
  function openDialog(title,setup,save){
    const dialog=node('dialog',undefined,'schedule-dialog'),form=node('form'),fieldset=node('fieldset'),heading=ui('h2',title);
    heading.id='sched-dialog-title';dialog.setAttribute('aria-labelledby',heading.id);
    const status=node('p',undefined,'feedback');status.setAttribute('role','status');
    const toolbar=node('div',undefined,'sched-actions');
    const submit=ui('button','Guardar','download primary');submit.type='submit';
    toolbar.append(button('Cancelar',()=>dialog.close()),submit);
    fieldset.append(heading);const read=setup(fieldset);fieldset.append(status,toolbar);form.append(fieldset);dialog.append(form);root.append(dialog);
    dialog.addEventListener('close',()=>{refreshDialog=undefined;dialog.remove();},{once:true});
    form.onsubmit=e=>{e.preventDefault();if(saving)return;const values=read();if(values)save(values,dialog);};dialog.showModal();
    return dialog;
  }
  function input(parent,label,type,value){
    const wrapper=field(label),control=node('input');control.type=type;control.value=value;wrapper.append(control);parent.append(wrapper);return control;
  }
  function shiftClock(parent,title,time){
    const box=node('fieldset',undefined,'sched-clock'),parts=node('div',undefined,'sched-clock-fields');
    box.append(ui('legend',title),parts);parent.append(box);
    const initial=(time||'').slice(0,5).split(':');
    function part(label,limit,selected){
      const wrapper=field(label),control=node('select'),empty=node('option','—');
      empty.value='';control.append(empty);
      for(let i=0;i<limit;i++){
        const option=node('option');
        option.value=String(i).padStart(2,'0');
        bindComputed(option,()=>formats().clockDigit.format(i));
        control.append(option);
      }
      control.value=selected||'';
      wrapper.append(control);parts.append(wrapper);return control;
    }
    const hour=part('Horas',24,initial[0]),minute=part('Minutos',60,initial[1]);
    return {hour,minute,read:()=>hour.value&&minute.value ? hour.value+':'+minute.value : ''};
  }
  function editShift(person,date,shift){
    const dialog=openDialog('Editar turno',parent=>{
      const summary=node('p');parent.append(summary);
      let kind=shift?.kind||'work';
      const group=node('div',undefined,'sched-time-pair sched-shift-times');
      const start=shiftClock(group,'Entrada',shift?.starts),end=shiftClock(group,'Salida',shift?.ends);
      const controls=[start.hour,start.minute,end.hour,end.minute];
      refreshDialog=()=>{
        summary.textContent=person.name+' · '+formats().dated.format(dayDate(date));
        if(end.hour.validity.customError)end.hour.setCustomValidity(t('La salida debe ser distinta de la entrada.'));
      };refreshDialog();
      function mode(value){
        kind=value;group.hidden=kind!=='work';
        end.hour.setCustomValidity('');
        for(const control of controls){control.disabled=group.hidden;control.required=!group.hidden;}
      }
      const kindSelect=select('Tipo',[{key:'work',label:'Turno de trabajo'},{key:'off',label:'Día libre'},{key:'clear',label:'Sin asignar'}],kind,value=>{
        mode(value);
        const target=group.hidden?summary:group;
        motionFor('shift-edit',target,{items:group.hidden?[summary]:[...group.children]});
      });
      parent.append(kindSelect,group);
      mode(kind);group.oninput=()=>end.hour.setCustomValidity('');
      group.onchange=event=>{
        end.hour.setCustomValidity('');
        const target=event.target.closest('.sched-clock')?.querySelector('legend');
        if(target)motionFor('shift-edit',target);
      };
      return ()=>{
        const startTime=start.read(),endTime=end.read();
        if(kind==='work'){
          const missing=controls.find(control=>!control.value);
          if(missing){missing.reportValidity();return null;}
          if(startTime===endTime){
            end.hour.setCustomValidity(t('La salida debe ser distinta de la entrada.'));
            end.hour.reportValidity();return null;
          }
        }
        return {employee_id:person.id,work_day:date,kind,start_time:kind==='work'?startTime:null,end_time:kind==='work'?endTime:null,previous:shift?.revision||null};
      };
    },(args,dlg)=>write('compi_schedule_edit',args,'Turno guardado.',dlg,()=>{
      const cell=[...panel.querySelectorAll('[data-shift-day]')].find(el=>el.dataset.shiftDay===date&&el.dataset.employee===person.id);
      if(cell)motionFor('shift-edit',cell,{items:cell.children.length?[...cell.children]:[cell]});
    }));
    const fields=[...dialog.querySelectorAll('fieldset>h2,fieldset>p:not(:empty),fieldset>.sched-field,.sched-clock')].filter(el=>!el.closest('[hidden]'));
    motionFor('shift-edit',dialog,{items:fields});
  }
  function editHours(person){
    const dialog=openDialog('Ajustar horas del mes',parent=>{
      const summary=node('p');parent.append(summary);refreshDialog=()=>{summary.textContent=person.name+' · '+formats().month.format(monthDate(month));};refreshDialog();
      let sign=person.adjustment<0?-1:1;
      const grid=node('div',undefined,'sched-time-pair'),n=Math.abs(person.adjustment);
      const hh=input(grid,'Horas','number',String(Math.floor(n/60))),mm=input(grid,'Minutos','number',String(n%60));
      for(const f of [hh,mm]){f.min='0';f.step='1';f.required=true;}
      mm.max='59';
      const draft=node('div',undefined,'sched-hour-preview'),value=node('strong');
      draft.append(ui('span','Ajuste del mes'),value);
      function showDraft(animate){
        const valid=hh.validity.valid&&mm.validity.valid;
        const previous=[...value.querySelectorAll('[data-motion-number]')].map(span=>span.textContent);
        renderHourDigits(value,valid?sign*(Number(hh.value)*60+Number(mm.value)):NaN);
        if(animate&&valid)pulseHours(value,previous);
      }
      parent.append(select('Sentido del ajuste',[{key:'1',label:'Horas a favor del empleado'},{key:'-1',label:'Horas que debe el empleado'}],String(sign),v=>{sign=Number(v);showDraft(true);}),
        grid,draft,ui('p','El ajuste sustituye al de este mes y se suma al saldo anterior.','hint'));
      grid.oninput=()=>showDraft(true);
      const refreshSummary=refreshDialog;
      refreshDialog=()=>{refreshSummary();showDraft(false);};refreshDialog();
      return ()=>({employee_id:person.id,month_start:month+'-01',adjustment:sign*(Number(hh.value)*60+Number(mm.value)),previous:person.revision});
    },(args,dlg)=>write('compi_schedule_balance',args,'Saldo de horas actualizado.',dlg,()=>{
      const row=[...panel.querySelectorAll('.sched-team-table tr[data-employee]')].find(el=>el.dataset.employee===person.id);
      if(row)pulseHours(row);
    }));
    dialog.classList.add('sched-hours-dialog');
    pulseHours(dialog.querySelector('.sched-hour-preview'));
  }
  function changeMonth(next){
    if(saving||!/^\d{4}-(0[1-9]|1[0-2])$/.test(next)||next.startsWith('0000'))return;
    if(next===month)return;
    const direction=next>month?'next':'previous';
    month=next;scrolled=0;feedback('');load(direction);
  }
  let monthView;
  signal.addEventListener('abort',()=>monthView?.abort(),{once:true});
  function head(){
    const bar=node('div',undefined,'sched-head'),filters=node('div',undefined,'sched-filters');
    if(hotels.length>1)filters.append(select('Hotel',hotels,hotel,value=>{hotel=value;department=null;tab='roster';resetChoice();scrolled=0;feedback('');load();}));
    if((data.admin||data.departments.length>1)&&tab==='roster')filters.append(select('Departamento',data.departments,data.dept,value=>{department=value;scrolled=0;feedback('');load('up');}));
    else if(tab!=='manage')filters.append(node('p',data.departments.find(d=>d.key===data.dept)?.name||data.dept,'sched-dept'));
    filters.append(button('Actualizar',()=>{feedback('');load();},'sched-plain'));
    const monthbar=node('div',undefined,'sched-month');
    const arrow=(offset,glyph)=>{
      const el=button('',()=>changeMonth(moveMonth(month,offset)),'sched-arrow');el.textContent=glyph;return el;
    };
    const rtl=document.documentElement.dir==='rtl',previous=arrow(-1,rtl?'›':'‹'),next=arrow(1,rtl?'‹':'›');
    previous.setAttribute('aria-label',t('Mes anterior'));next.setAttribute('aria-label',t('Mes siguiente'));
    const picker=node('label',undefined,'sched-picker');
    const control=node('input');control.type='month';control.value=month;control.setAttribute('aria-label',t('Elegir mes'));control.onchange=()=>changeMonth(control.value);
    picker.append(control);attachMonthPicker(control,picker,monthView.signal);monthbar.append(previous,picker,next);bar.append(filters,monthbar);return bar;
  }
  function used(year,state){
    return data.mine.filter(r=>r.state===state).flatMap(r=>r.days).filter(d=>d.startsWith(year+'-')).length;
  }
  function stats(){
    const block=node('div',undefined,'sched-stats'),year=month.slice(0,4),own=data.balances.find(b=>b.id===data.me);
    function stat(label,value,note){const box=node('div');box.append(node('span',label),node('strong',value),node('small',note));block.append(box);}
    const balance=own?.total||0;
    stat(t('Mi saldo de horas'),hours(balance),t(balance===0?'Al cierre del mes · Al día':balance>0?'Al cierre del mes · A tu favor':'Al cierre del mes · Horas que debes'));
    const pending=used(year,'pending'),approved=used(year,'approved');
    const number=value=>formats().number.format(value);
    stat(t('Vacaciones disponibles · {year}',{year:number(Number(year))}),
      t('{remaining} / {quota} días',{remaining:number(45-approved-pending),quota:number(45)}),
      t('Aprobados: {approved} · Pendientes: {pending}',{approved:number(approved),pending:number(pending)}));
    return block;
  }
  function roleBadge(person){
    const key=positionKey(person.position),style=badgeStyles.get(key);
    const badge=displayPosition(node('span',undefined,'sched-role'),person.position);
    if(style)badge.classList.add('role-'+style);
    else{
      const family=({1:'green',2:'plum',3:'ivory'})[person.rank]||'ivory';
      const hash=Array.from(key).reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,7);
      badge.classList.add('role-other');
      badge.style.setProperty('--role-family','var(--compi-'+family+')');
      badge.style.setProperty('--role-strength',(16+hash%2200/100)+'%');
    }
    return badge;
  }
  function grid(){
    const wrap=node('div',undefined,'schedule-scroll');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label',t('Cuadrante mensual por empleado'));
    const table=node('table',undefined,'schedule-grid'),caption=node('caption',capitalize(formats().month.format(monthDate(month)))+' · '+(data.departments.find(d=>d.key===data.dept)?.name||data.dept),'sched-sr');
    table.append(caption);const row=table.createTHead().insertRow(),corner=ui('th','Equipo');corner.scope='col';row.append(corner);
    const days=[];const number=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate();
    for(let n=1;n<=number;n++){
      const iso=month+'-'+String(n).padStart(2,'0'),dt=dayDate(iso),weekend=[0,6].includes(dt.getUTCDay());days.push({iso,weekend});
      const th=node('th',undefined,weekend?'weekend':'');th.scope='col';th.append(node('small',formats().weekday.format(dt).replace('.','')),node('strong',formats().number.format(n)));
      if(iso===today){th.classList.add('is-today');th.setAttribute('aria-current','date');}row.append(th);
    }
    const shifts=new Map(data.shifts.map(s=>[s.employee+s.day,s]));
    const holidays=new Set(data.vacations.map(v=>v.employee+v.day));
    const reserved=new Set(data.mine.filter(r=>r.state!=='rejected').flatMap(r=>r.days));
    const body=table.createTBody();
    const people=[...data.people];
    if(tab==='leave'){
      const own=data.balances.find(b=>b.id===data.me);
      if(own && !people.some(p=>p.id===own.id))people.push(own);
      for(const request of data.mine){
        if(request.state==='approved')for(const date of request.days)holidays.add(data.me+date);
      }
    }
    for(const p of people.sort(comparePeople)){
      const tr=body.insertRow(),who=node('th');who.scope='row';who.append(node('strong',p.name),roleBadge(p));tr.append(who);
      for(const {iso,weekend} of days){
        const td=tr.insertCell(),shift=shifts.get(p.id+iso),vac=holidays.has(p.id+iso);
        const mine=tab==='leave'&&p.id===data.me,pend=mine&&reserved.has(iso)&&!vac;
        if(weekend)td.classList.add('weekend');
        const text=vac?t('Vac.'):pend?t('Pend.'):timeRange(shift);
        const interactive=!vac&&(mine?!pend:data.admin&&tab==='roster');
        const cell=interactive?button('',()=>{
          if(mine){
            if(chosen.has(iso))chosen.delete(iso);else chosen.add(iso);
            requestId=crypto.randomUUID();paintChoice();updateSelection();
            motionFor('leave-select',cell,{items:[cell,selectionText,selectionDetails]});
          }
          else editShift(p,iso,shift);
        },'sched-cell'):node('span',undefined,'sched-cell');
        if(tab==='roster'){cell.dataset.shiftDay=iso;cell.dataset.employee=p.id;}
        const aria=p.name+', '+formats().short.format(dayDate(iso))+', '+(vac?t('Vacaciones'):pend?t('Pendiente de aprobación'):shift?text:t('Sin asignar'));
        cell.setAttribute('aria-label',aria);cell.title=aria;
        if(vac||pend||!shift||shift.kind==='off')cell.textContent=text;
        else{cell.append(node('span',clock(shift.starts)),node('span',clock(shift.ends)+(shift.ends<shift.starts?' +'+formats().number.format(1):'')));}
        if(vac)cell.classList.add('sched-vac');else if(pend)cell.classList.add('sched-pending');else if(shift)cell.classList.add(shift.kind==='off'?'sched-off':'sched-work');
        function paintChoice(){cell.setAttribute('aria-pressed',String(chosen.has(iso)));cell.classList.toggle('sched-selected',chosen.has(iso));}
        if(mine&&interactive)paintChoice();
        td.append(cell);
      }
    }
    wrap.append(table);wrap.onscroll=()=>{scrolled=wrap.scrollLeft;};return wrap;
  }
  let selectionText,selectionDetails,send;
  function updateSelection(){
    const years=new Set([month.slice(0,4),...[...chosen].map(d=>d.slice(0,4))]);
    const details=[];let over=false;
    for(const year of [...years].sort()){
      const count=[...chosen].filter(d=>d.startsWith(year+'-')).length;
      const left=45-used(year,'pending')-used(year,'approved')-count;
      details.push(formats().number.format(Number(year))+' · '+(left<0
        ? t('Saldo excedido: {days}',{days:formats().days.format(-left)})
        : t('Días disponibles tras la selección: {count}',{count:formats().number.format(left)})));
      if(left<0)over=true;
    }
    selectionText.textContent=t('Días seleccionados: {count}',{count:formats().number.format(chosen.size)});
    selectionDetails.textContent=details.join(' / ');send.disabled=!chosen.size||over;
  }
  function selection(){
    const bar=node('div',undefined,'sched-selection'),copy=node('div');selectionText=node('strong');selectionText.setAttribute('aria-live','polite');selectionDetails=node('small');
    copy.append(selectionText,selectionDetails);
    send=button('Enviar solicitud',()=>write('compi_schedule_request',{request_id:requestId,requested:[...chosen].sort()},'Solicitud enviada al chef.'),'download primary');
    const clear=button('Limpiar selección',()=>{
      if(!chosen.size)return;
      resetChoice();
      for(const cell of panel.querySelectorAll('.sched-selected')){cell.classList.remove('sched-selected');cell.setAttribute('aria-pressed','false');}
      updateSelection();motionFor('leave-select',copy,{items:[selectionText,selectionDetails]});
    },'sched-plain');bar.append(copy,clear,send);updateSelection();return bar;
  }
  function requests(items,admin){
    const section=node('section',undefined,'sched-requests');section.append(ui('h3',admin?'Solicitudes de vacaciones':'Mis solicitudes'));
    if(!items.length){section.append(ui('p',admin?'Sin solicitudes pendientes ni decisiones para este mes.':'Todavía no has solicitado vacaciones.','hint'));return section;}
    for(const request of items){
      const row=node('div',undefined,'sched-request'),copy=node('div');
      row.dataset.request=request.id;
      if(admin)copy.append(node('strong',request.name+' · '+request.department));
      copy.append(node('p',ranges(request.days)),node('small',formats().days.format(request.days.length)+' · '+t(states[request.state])));row.append(copy);
      if(admin&&request.state==='pending'){
        const actions=node('div',undefined,'sched-actions');
        for(const [value,label] of [['approved','Aprobar'],['rejected','Rechazar']]){
          actions.append(button(label,()=>write('compi_schedule_decide',{request_id:request.id,decision:value},value==='approved'?'Solicitud aprobada.':'Solicitud rechazada.',null,()=>{
            const updated=[...panel.querySelectorAll('.sched-request')].find(el=>el.dataset.request===request.id);
            const items=updated?[...updated.firstElementChild.children,notice]:[notice];
            motionFor('leave-review',updated||notice,{items});
          }),value==='approved'?'download primary':'download'));
        }
        row.append(actions);
      }
      section.append(row);
    }
    return section;
  }
  function manage(){
    const section=node('section'),wrap=node('div',undefined,'schedule-scroll'),table=node('table',undefined,'sched-team-table');
    section.append(ui('h2','Saldos del equipo'),ui('p','Saldo acumulado hasta el final del mes. Un saldo positivo son horas a favor del empleado.','hint'));
    const header=table.createTHead().insertRow();
    for(const label of ['Empleado','Puesto','Departamento','Ajuste del mes','Saldo acumulado','Acción']){const th=ui('th',label);th.scope='col';header.append(th);}
    const body=table.createTBody();
    for(const p of [...data.balances].sort((a,b)=>formats().collator.compare(a.department,b.department)||comparePeople(a,b))){
      const row=body.insertRow();row.insertCell().textContent=p.name;row.insertCell().append(roleBadge(p));row.insertCell().textContent=p.department;
      row.dataset.employee=p.id;renderHourDigits(row.insertCell(),p.adjustment);renderHourDigits(row.insertCell(),p.total);
      const edit=button('Ajustar',()=>editHours(p));edit.dataset.adjustHours='';edit.setAttribute('aria-label',t('Ajustar horas de {name}',{name:p.name}));row.insertCell().append(edit);
    }
    wrap.append(table);section.append(wrap,requests(data.requests,true));return section;
  }
  function render(){
    if(signal.aborted)return;
    const restoreMonthFocus=panel.querySelector('.sched-picker')?.contains(document.activeElement);
    monthView?.abort();monthView=new AbortController();
    panel.replaceChildren();const nav=node('div',undefined,'sched-tabs');nav.setAttribute('role','group');nav.setAttribute('aria-label',t('Vistas de horarios'));
    for(const [key,label] of tabs){
      if(key==='manage'&&!data.admin)continue;
      const b=button(label,()=>{if(saving||tab===key)return;tab=key;scrolled=0;feedback('');load('up');},'sched-tab');b.setAttribute('aria-pressed',String(tab===key));nav.append(b);
    }
    panel.append(nav,head(),stats());
    if(restoreMonthFocus)panel.querySelector('.sched-picker .wp-trigger')?.focus();
    if(tab==='manage'){panel.append(manage());return;}
    const section=node('section'),hint=tab==='leave'?'Selecciona en tu fila los días que quieres solicitar. Puedes cambiar de mes sin perder la selección.':
      data.admin?'Selecciona una celda para editar el turno.':'Consulta los turnos de tu departamento.';
    section.append(ui('h2',tab==='leave'?'Seleccionar vacaciones':'Cuadrante del departamento'),ui('p',hint,'hint'));
    const matrix=grid();section.append(matrix);panel.append(section);matrix.scrollLeft=scrolled;
    if(tab==='leave')section.append(selection(),requests(data.mine,false));
  }
  window.addEventListener('compi:languagechange',({detail})=>{
    if((detail.previous==='ar')!==(detail.locale==='ar'))scrolled=-scrolled;
    if(data)render();
    refreshDialog?.();
  },{signal});
  await load();
}

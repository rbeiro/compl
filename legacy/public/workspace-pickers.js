import {bindAttr, bindText, localize, locale, t} from './i18n.js';

let nextId=0;
const create=(tag,cls)=>{const el=document.createElement(tag);if(cls)el.className=cls;return el;};
function action(key,cls){
  const el=create('button',cls);el.type='button';
  if(key)bindText(el,key);
  return el;
}
function icon(name){
  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
  const paths={calendar:'M4 8h16M8 3v4m8-4v4M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1z',previous:'m14 6-6 6 6 6',next:'m10 6 6 6-6 6',close:'m6 6 12 12M18 6 6 18',down:'m6 9 6 6 6-6'};
  path.setAttribute('d',paths[name]);svg.append(path);return svg;
}
function iconButton(key,name){
  const b=action(null,'wp-icon-button');bindAttr(b,'aria-label',key);b.append(icon(name));return b;
}
function dispatchValue(input,value){
  input.value=value;
  for(const name of ['input','change'])input.dispatchEvent(new Event(name,{bubbles:true}));
}
function picker(input,caption,key,signal){
  const id='workspace-picker-'+(++nextId);
  const trigger=action(null,'wp-trigger');trigger.id=id+'-trigger';
  trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',id);
  if(input.getAttribute('aria-describedby'))trigger.setAttribute('aria-describedby',input.getAttribute('aria-describedby'));
  caption.htmlFor=trigger.id;input.hidden=true;input.after(trigger);
  const dialog=create('dialog','wp-dialog');dialog.id=id;dialog.setAttribute('aria-labelledby',id+'-title');
  const heading=create('header','wp-heading'),title=create('h2');title.id=id+'-title';bindText(title,key);
  const closeButton=iconButton('Cerrar selector','close');heading.append(title,closeButton);dialog.append(heading);
  // Attaching an open modal outside its form avoids implicit submissions and fieldset clipping.
  function close(restoreFocus=true){
    if(dialog.open)dialog.close();
    if(restoreFocus&&trigger.isConnected&&!trigger.matches(':disabled'))trigger.focus();
  }
  function position(){
    const rect=trigger.getBoundingClientRect();
    const vw=document.documentElement.clientWidth||window.innerWidth, vh=window.innerHeight;
    const width=dialog.offsetWidth, height=dialog.offsetHeight, margin=10;
    const left=document.documentElement.dir==='rtl'?rect.right-width:rect.left;
    const top=rect.bottom+6+height<=vh-margin?rect.bottom+6:rect.top-height-6;
    dialog.style.left=Math.max(margin,Math.min(left,vw-width-margin))+'px';
    dialog.style.top=Math.max(margin,Math.min(top,vh-height-margin))+'px';
  }
  function open(render){
    if(trigger.matches(':disabled')||signal.aborted)return;
    if(!dialog.isConnected){document.body.append(dialog);localize(dialog);}
    if(!dialog.open)dialog.showModal();
    trigger.setAttribute('aria-expanded','true');render();position();
  }
  closeButton.onclick=()=>close();
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('click',event=>{
    if(event.target!==dialog)return;
    const r=dialog.getBoundingClientRect();
    if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();
  });
  dialog.addEventListener('close',()=>trigger.setAttribute('aria-expanded','false'));
  window.addEventListener('resize',()=>{if(dialog.open)position();},{signal});
  signal.addEventListener('abort',()=>{if(dialog.open)close(false);dialog.remove();},{once:true});
  return {trigger,dialog,open,close};
}
// Local noon protects the civil date from daylight-saving changes; years 1–99 are literal.
function civil(year,month,day){
  const d=new Date(2000,0,1,12);d.setFullYear(year,month,day);return d;
}
function iso(date){
  return [String(date.getFullYear()).padStart(4,'0'),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}
function parseDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const [y,m,day]=value.split('-').map(Number), date=civil(y,m-1,day);
  return y>0&&iso(date)===value?date:null;
}
function monthOffset(date,offset){
  const first=civil(date.getFullYear(),date.getMonth()+offset,1);
  const last=civil(first.getFullYear(),first.getMonth()+1,0);
  return civil(first.getFullYear(),first.getMonth(),Math.min(date.getDate(),last.getDate()));
}
function weekStart(lang){
  const region=new Intl.Locale(lang).maximize();
  const info=region.getWeekInfo?.()||region.weekInfo;
  if(info?.firstDay)return info.firstDay%7;
  return lang==='ar'?6:lang==='en'?0:1;
}
export function attachDatePicker(input,caption,signal){
  const {trigger,dialog,open,close}=picker(input,caption,'Elegir fecha',signal);
  dialog.classList.add('wp-calendar');
  const value=create('span');trigger.append(icon('calendar'),value,icon('down'));
  const nav=create('div','wp-month'), prev=iconButton('Mes anterior','previous'), next=iconButton('Mes siguiente','next');
  const month=create('strong');month.id=dialog.id+'-month';month.setAttribute('aria-live','polite');
  nav.append(prev,month,next);dialog.append(nav);
  const table=create('table','wp-dates');table.setAttribute('role','grid');table.setAttribute('aria-labelledby',month.id);dialog.append(table);
  const footer=create('div','wp-footer'), clear=action('Borrar fecha','wp-minor'),today=action('Ir a hoy','wp-primary');
  footer.append(clear,today);dialog.append(footer);
  let focused;
  function format(options,date){return new Intl.DateTimeFormat(locale(),{calendar:'gregory',...options}).format(date);}
  function sync(){
    const selected=parseDate(input.value);
    value.textContent=selected?format({dateStyle:'medium'},selected):t('Elegir fecha');
    trigger.setAttribute('aria-label',selected?t('Elegir fecha')+' · '+format({dateStyle:'full'},selected):t('Elegir fecha'));
  }
  function commit(date){dispatchValue(input,date?iso(date):'');sync();close();}
  function move(date,focus=true){
    if(date.getFullYear()<1||date.getFullYear()>9999)return;
    focused=date;render(focus);
  }
  function render(focusDay){
    const start=weekStart(locale()),y=focused.getFullYear(),m=focused.getMonth();
    const first=civil(y,m,1),offset=(first.getDay()-start+7)%7,days=civil(y,m+1,0).getDate();
    month.textContent=format({month:'long',year:'numeric'},first);
    prev.disabled=y===1&&m===0;next.disabled=y===9999&&m===11;
    clear.disabled=!input.value;
    const head=create('thead'),header=head.insertRow();
    for(let i=0;i<7;i++){
      const weekday=civil(2024,0,7+start+i),th=create('th');th.scope='col';
      th.textContent=format({weekday:'short'},weekday);th.abbr=format({weekday:'long'},weekday);header.append(th);
    }
    // Header and rows update together to expose one coherent month to assistive tools.
    const body=create('tbody'), now=iso(new Date());
    const digits=new Intl.NumberFormat(locale()), fullDay=new Intl.DateTimeFormat(locale(),{calendar:'gregory',dateStyle:'full'});
    let target;
    for(let week=0;week<Math.ceil((offset+days)/7);week++){
      const row=body.insertRow();
      for(let col=0;col<7;col++){
        const day=week*7+col-offset+1,td=row.insertCell();if(day<1||day>days)continue;
        const date=civil(y,m,day),key=iso(date),b=action(null,'wp-day');b.dataset.date=key;
        b.textContent=digits.format(day);b.tabIndex=day===focused.getDate()?0:-1;
        b.setAttribute('aria-label',fullDay.format(date));td.setAttribute('aria-selected',String(key===input.value));
        if(key===now)b.setAttribute('aria-current','date');
        if(b.tabIndex===0)target=b;
        b.onclick=()=>commit(date);td.append(b);
      }
    }
    table.replaceChildren(head,body);
    if(focusDay)target?.focus({preventScroll:true});
  }
  table.addEventListener('keydown',event=>{
    if(!event.target.closest('.wp-day'))return;
    const rtl=document.documentElement.dir==='rtl', start=weekStart(locale()), idx=(focused.getDay()-start+7)%7;
    const shifts={ArrowLeft:rtl?1:-1,ArrowRight:rtl?-1:1,ArrowUp:-7,ArrowDown:7,Home:-idx,End:6-idx};
    if(Object.hasOwn(shifts,event.key)){event.preventDefault();move(civil(focused.getFullYear(),focused.getMonth(),focused.getDate()+shifts[event.key]));}
    else if(event.key==='PageUp'||event.key==='PageDown'){
      event.preventDefault();move(monthOffset(focused,(event.key==='PageUp'?-1:1)*(event.shiftKey?12:1)));
    }
  });
  prev.onclick=()=>move(monthOffset(focused,-1),false);
  next.onclick=()=>move(monthOffset(focused,1),false);
  today.onclick=()=>commit(new Date());clear.onclick=()=>commit(null);
  trigger.onclick=()=>{focused=parseDate(input.value)||new Date();open(()=>render(true));};
  input.addEventListener('input',sync,{signal});input.addEventListener('change',sync,{signal});
  input.form?.addEventListener('reset',()=>queueMicrotask(sync),{signal});
  window.addEventListener('compi:languagechange',()=>{sync();if(dialog.open)render(table.contains(document.activeElement));},{signal});
  sync();return sync;
}

const palette=['#23603F','#183C31','#4F6C59','#596976','#284C60','#725B47','#915846','#7B4359','#222D28','#8E8968','#D9CDB7','#FFFFFF'];
function hex(value){const m=/^#?([0-9a-f]{6})$/i.exec(value.trim());return m?'#'+m[1].toUpperCase():null;}
export function attachColorPicker(input,caption,signal){
  const {trigger,dialog,open,close}=picker(input,caption,'Elegir color',signal);
  dialog.classList.add('wp-color');
  const swatch=create('span','wp-swatch'),value=create('bdi');value.dir='ltr';trigger.append(swatch,value,icon('down'));
  const current=create('div','wp-color-current'),currentCaption=create('span'),currentValue=create('bdi');
  bindText(currentCaption,'Color actual');currentValue.dir='ltr';current.append(currentCaption,currentValue);
  const group=create('div','wp-palette');group.setAttribute('role','group');bindAttr(group,'aria-label','Paleta de colores');
  const choices=palette.map(code=>{
    const b=action(null,'wp-choice');b.dataset.color=code;b.style.setProperty('--wp-chip',code);b.setAttribute('aria-label',code);b.title=code;
    b.onclick=()=>commit(code);group.append(b);return b;
  });
  const lbl=create('label','wp-custom'),captionText=create('span');bindText(captionText,'Color personalizado');
  const custom=create('input');custom.type='text';custom.dir='ltr';custom.maxLength=7;custom.spellcheck=false;
  custom.autocomplete='off';lbl.append(captionText,custom);
  const err=create('p','wp-color-error');err.id=dialog.id+'-error';err.setAttribute('aria-live','polite');custom.setAttribute('aria-describedby',err.id);
  const apply=action('Aplicar color','wp-primary');
  dialog.append(current,group,lbl,err,apply);
  function sync(){
    const code=hex(input.value);
    swatch.style.backgroundColor=code;value.textContent=code;currentValue.textContent=code;
    trigger.setAttribute('aria-label',t('Elegir color')+' · '+code);
    for(const b of choices)b.setAttribute('aria-pressed',String(b.dataset.color===code));
  }
  function commit(code){dispatchValue(input,code);sync();close();}
  function validate(){
    const valid=!!hex(custom.value);
    custom.setAttribute('aria-invalid',String(!valid));apply.disabled=!valid;
    err.textContent=valid?'':t('Introduce un código de seis dígitos, por ejemplo #23603F.');
    return valid;
  }
  trigger.onclick=()=>open(()=>{
    sync();custom.value=hex(input.value);validate();
    (choices.find(b=>b.getAttribute('aria-pressed')==='true')||custom).focus();
  });
  custom.oninput=validate;apply.onclick=()=>{if(validate())commit(hex(custom.value));};
  custom.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();if(validate())commit(hex(custom.value));}};
  window.addEventListener('compi:languagechange',()=>{sync();if(dialog.open)validate();},{signal});
  sync();return sync;
}

export function attachMonthPicker(input,caption,signal){
  const {trigger,dialog,open,close}=picker(input,caption,'Elegir mes',signal);
  dialog.classList.add('wp-month-dialog');
  const value=create('span');trigger.append(value,icon('down'));
  const format=(date,options)=>new Intl.DateTimeFormat(locale(),{calendar:'gregory',...options}).format(date);
  function displayed(){return parseDate(input.value+'-01')||new Date();}
  function sync(){
    const language=locale();
    const monthYear=new Intl.DateTimeFormat(language,{calendar:'gregory',month:'long',year:'numeric'});
    value.textContent=monthYear.formatToParts(displayed()).map(({type,value:part})=>{
      if(type==='month')return part.charAt(0).toLocaleUpperCase(language)+part.slice(1);
      return language==='es'&&type==='literal'?' ':part;
    }).join('');
    trigger.setAttribute('aria-label',t('Elegir mes')+' · '+value.textContent);
  }
  const nav=create('div','wp-month'),prev=iconButton('Año anterior','previous'),next=iconButton('Año siguiente','next'),title=create('strong');
  title.setAttribute('aria-live','polite');nav.append(prev,title,next);
  const months=create('div','wp-months');months.setAttribute('role','group');bindAttr(months,'aria-label','Elegir mes');
  const footer=create('div','wp-footer');const current=action('Mes actual','wp-primary');footer.append(current);
  dialog.append(nav,months,footer);
  let year,active;
  const today=new Date();
  function commit(date){close();dispatchValue(input,iso(date).slice(0,7));}
  function draw(focus){
    title.textContent=new Intl.NumberFormat(locale(),{useGrouping:false}).format(year);
    prev.disabled=year===1;next.disabled=year===9999;
    months.replaceChildren();
    for(let i=0;i<12;i++){
      const date=civil(year,i,1),b=action(null,'wp-month-choice');
      b.dataset.month=iso(date).slice(0,7);b.textContent=format(date,{month:'short'});
      b.setAttribute('aria-label',format(date,{month:'long',year:'numeric'}));
      b.setAttribute('aria-pressed',String(input.value===b.dataset.month));
      if(year===today.getFullYear()&&i===today.getMonth())b.setAttribute('aria-current','date');
      b.tabIndex=i===active?0:-1;b.onclick=()=>commit(date);months.append(b);
      if(focus&&i===active)b.focus({preventScroll:true});
    }
  }
  function move(delta,focus){
    const d=civil(year,active+delta,1);
    if(d.getFullYear()<1||d.getFullYear()>9999)return;
    year=d.getFullYear();active=d.getMonth();draw(focus);
  }
  prev.onclick=()=>move(-12,false);next.onclick=()=>move(12,false);
  months.addEventListener('keydown',event=>{
    const rtl=document.documentElement.dir==='rtl';
    const shifts={ArrowLeft:rtl?1:-1,ArrowRight:rtl?-1:1,ArrowUp:-3,ArrowDown:3,Home:-active,End:11-active,PageUp:-12,PageDown:12};
    if(Object.hasOwn(shifts,event.key)){event.preventDefault();move(shifts[event.key],true);}
  });
  current.onclick=()=>commit(new Date());
  trigger.onclick=()=>{const date=displayed();year=date.getFullYear();active=date.getMonth();open(()=>draw(true));};
  input.addEventListener('input',sync,{signal});input.addEventListener('change',sync,{signal});
  window.addEventListener('compi:languagechange',()=>{sync();if(dialog.open)draw(months.contains(document.activeElement));},{signal});
  sync();
}

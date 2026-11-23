import {configureGuideLabels,resetGuideImages} from './guide-language-image.js';
import {clearLanguageContent,keepNames,useApproved} from './content-language.js';
import {hotelArtsApiPath} from './hotel-arts-api.js';
import {mountShell,renderInicio} from './workspace-shell.js?v=27';
import {loadCatalog,loadGuideImage,platingHref} from './workspace-catalog.js';
import {renderRecipes} from './workspace-recipes.js?v=27';
import {renderCostBook} from './cost-book.js';
import {renderPdfPages} from './pdf-reader.js';
import {renderPlating} from './workspace-plating.js?v=28';
import {t,locale,localize,bindText,bindAttr,bindComputed} from './i18n.js';
import {segundoFactor} from './segundo-factor.js?v=22';
import {observeLanding} from './motion.js?v=27';
import {motionFor} from './motion-choices.js';
import {schedules} from './horarios.js?v=30';
import {management} from './management.js?v=27';
import {recoveryForm, backupPanel} from './recovery.js?v=22';
import {mustChange, passwordChange} from './password-change.js';
import {mailbox} from './mailbox.js?v=27';
import {icon} from './ui.js';
import {generator} from './generator.js?v=28';
import {loadGuideSource} from './guide-source.js';
import {brandChangeEvent,brandSettings,generatorPanels} from './document-brand.js?v=27';
const REMOTE = 'https://dzfwdxhbldnfqowrnhxf.supabase.co';
const PUBLIC_KEY = 'sb_publishable_wp2Qs4vSJgFvqFd6qiPEAg_TmHKv60S';
const ROOT = '#/empresa/';
const STORAGE = 'compi.laboratorio.session';
const page = document.querySelector('#main');
let main = page;
const signout = document.querySelector('#logout');
const authTemplate = document.querySelector('#auth-template').content;
const homeTemplate = main.querySelector('.landing').cloneNode(true);
const publicNav = document.querySelector('#public-nav');
const homeRoutes = new Set(['', '#/inicio', '#proyecto', '#herramientas']);
const dashboard = '#/portal';
let landingObserver, displayedView, metricDestination;

function workspaceArrival(hash) {
  if(displayedView===hash)return;
  const cameFromAccess=displayedView==='login';
  const inArchive=hash.startsWith(ROOT)&&displayedView?.startsWith(ROOT);
  const fromMetric=metricDestination===hash;
  metricDestination=null;
  displayedView=hash;
  const crumb=document.querySelector('.ws-crumb');
  const title=main.querySelector('h1')||main.firstElementChild;
  if(cameFromAccess){
    motionFor('portal-access',title);
  }else if(inArchive){
    const links=main.querySelectorAll('.folders > .folder,.rows > .row');
    motionFor('archive-folder',main,{items:[main.querySelector('nav'),title,...links].filter(Boolean)});
  }else if(fromMetric){
    motionFor('workspace-home',main,{items:[crumb,title].filter(Boolean)});
  }else{
    motionFor('workspace-route',main,{items:[crumb,title].filter(Boolean)});
  }
}
const appNav = document.querySelector('#app-nav');
function layout(view) {
  const home=view==='home', privateView=view==='workspace';
  document.body.classList.toggle('workspace-active',privateView);
  document.body.classList.toggle('home-page',home);
  page.className=home?'home-view':privateView?'shell':'shell auth-view';
  publicNav.hidden=privateView;
  document.querySelector('#portal-context').hidden=true;
  appNav.hidden=!privateView;
}
function showHome(){
  const entering=!main.querySelector('.landing');
  if(entering){
    discardView();
    const home=homeTemplate.cloneNode(true);
    localize(home);
    main.append(home);
  }
  const previousView=displayedView;
  displayedView=location.hash||'#/inicio';
  landingObserver ??= observeLanding(main.querySelector('.landing'));
  visibleAccess=null;
  layout('home');
  bindText(pageTitle,'CompI · El portal de tu cocina');
  for(const a of document.querySelectorAll('[data-portal-link]')){
    const label=a.querySelector('span');
    a.dataset.guestLabel??=label.dataset.i18n||'Iniciar sesión';
    bindText(label,session?'Mi entorno de trabajo':a.dataset.guestLabel);
    a.href='#/acceso';
  }
  const section=location.hash.slice(1);
  for(const a of publicNav.querySelectorAll('a')){
    if(a.hash===location.hash)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');
  }
  if(section==='proyecto'||section==='herramientas'){
    const target=document.getElementById(section);
    target.focus({preventScroll:true});
    target.scrollIntoView();
    if(previousView!==displayedView)motionFor('landing-sections',target.querySelector('h2'));
  } else {
    window.scrollTo({top:0,behavior:entering?'instant':'auto'});
    if(previousView==='#proyecto'||previousView==='#herramientas')motionFor('landing-sections',main.querySelector('.hero-copy h1'));
  }
}
function workspaceHeader(signedIn) {
  layout(signedIn?'workspace':'login');
  if(!signedIn){
    for(const item of publicNav.querySelectorAll('a'))item.removeAttribute('aria-current');
    const access=publicNav.querySelector('[data-portal-link]');
    access.href='#/acceso';
    access.dataset.guestLabel='Iniciar sesión';
    bindText(access.querySelector('span'),'Iniciar sesión');
    access.setAttribute('aria-current','page');
  }
}
const MIME = {pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
let session, expiryTimer, currentRequest, claimedToken, visibleAccess;
let checkingAccess=false;
function currentUserId(token) {
  try {
    const part=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    const sub=JSON.parse(atob(part)).sub;
    return typeof sub==='string' && /^[0-9a-f-]{36}$/i.test(sub)?sub:null;
  } catch {return null;}
}
function managerFor(main) {
  return management({node,link,main,api,token:()=>session?.token,render,route,MIME,endSession});
}
const manage=managerFor(page);
configureGuideLabels(manage.rpc);


function node(tag, text, cls) {
  const el=document.createElement(tag);
  if(text!==undefined) el.textContent=text;
  if(cls) el.className=cls;
  return el;
}
function link(text, url, cls) {
  const el=node('a',text,cls);
  el.href=url;
  return el;
}
function uiNode(tag, key, cls) { return bindText(node(tag,undefined,cls),key); }
function uiLink(key, url, cls) { return bindText(link('',url,cls),key); }
const pageTitle = document.querySelector('title');
function folderCount(count, outlets) {
  const language=locale(), form=new Intl.PluralRules(language).select(count);
  const number=new Intl.NumberFormat(language).format(count);
  if(language==='ar'){
    const units=outlets
      ? {zero:'لا توجد منافذ',one:'منفذ واحد',two:'منفذان',few:'{count} منافذ',many:'{count} منفذًا',other:'{count} منفذ'}
      : {zero:'لا توجد بطاقات',one:'بطاقة واحدة',two:'بطاقتان',few:'{count} بطاقات',many:'{count} بطاقةً',other:'{count} بطاقة'};
    return units[form].replace('{count}',number);
  }
  const key=outlets?(form==='one'?'{count} outlet':'{count} outlets'):(form==='one'?'{count} ficha':'{count} fichas');
  return t(key,{count:number});
}
function route(parts) { return ROOT+parts.map(encodeURIComponent).join('/'); }
function setTitle(title, authored=true) {
  bindComputed(pageTitle,()=>t('{section} · Portal CompI',{section:authored?t(title):title}));
  const heading=authored?uiNode('h1',title):node('h1',title);
  if(!authored){heading.translate=false;heading.dir='auto';}
  main.append(heading);
}
function discardView() {
  landingObserver?.disconnect();
  landingObserver=null;
  currentRequest?.abort();
  main=page;
  currentRequest=new AbortController();
  main.replaceChildren();
  return currentRequest.signal;
}
function remember(next) {
  session=next;
  clearTimeout(expiryTimer);
  try {
    if(next) sessionStorage.setItem(STORAGE,JSON.stringify(next));
    else sessionStorage.removeItem(STORAGE);
  } catch { /* La sesión también funciona en memoria. */ }
  if(next) expiryTimer=setTimeout(()=>endSession('Vuelve a iniciar sesión.'),Math.max(0,next.until-Date.now()));
}
function endSession(message='') {
  clearLanguageContent();resetGuideImages();
  remember(null);
  if(!message||homeRoutes.has(location.hash)){
    history.replaceState(null,'','#/inicio');
    showHome();
  }else{
    history.replaceState(null,'','#/acceso');
    login(message);
  }
}
async function api(path, options={}) {
  const {token,signal,payload,upload,mime,upsert=true,method}=options;
  const headers={apikey:PUBLIC_KEY};
  if(token) headers.Authorization='Bearer '+token;
  if(payload) headers['Content-Type']='application/json';
  if(upload){headers['Content-Type']=mime;headers['x-upsert']=String(upsert);}
  const r=await fetch(REMOTE+hotelArtsApiPath(path),{headers,method:method||(upload||payload?'POST':'GET'),body:upload||(payload?JSON.stringify(payload):undefined),
    signal,cache:'no-store',credentials:'omit',redirect:'error'});
  if(!r.ok) {
    const err=new Error('Error del servicio');err.status=r.status;
    const detail=await r.json().catch(()=>({}));
    err.code=detail.code || detail.error;
    err.templateFile=r.status===422&&detail.code==='BRAND_TEMPLATE_UNSUPPORTED'&&path.startsWith('/functions/v1/compi-descarga/');
    if(detail.code==='PT409'||detail.code==='22023'||(r.status===422&&['compi-generar-ficha','compi-descarga'].some(fn=>path.startsWith('/functions/v1/'+fn+'/'))))err.detail=detail.message;
    throw err;
  }
  return r;
}
function login(message='') {
  const signal=discardView();
  signout.hidden=true;claimedToken=null;visibleAccess=null;workspaceHeader(false);
  bindText(pageTitle,'Iniciar sesión · CompI');
  const loginContent=authTemplate.cloneNode(true);
  localize(loginContent);
  const form=loginContent.querySelector('#login');
  const error=form.querySelector('[role=alert]');
  const submit=form.querySelector('button');
  bindText(error,message); submit.disabled=false;
  form.addEventListener('invalid',event=>{
    if(event.target===form.querySelector(':invalid'))motionFor('login-feedback',event.target);
  },true);
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(submit.disabled)return;
    submit.disabled=true;bindText(error,'');
    try {
      const email=form.elements.email.value.trim();
      const response=await api('/auth/v1/token?grant_type=password',{signal,payload:{email,password:form.elements.password.value}});
      const auth=await response.json();
      if(signal.aborted)return;
      if(!auth.access_token || !(auth.expires_in>10)) throw new Error('Sesión inválida');
      form.elements.password.value='';
      remember({token:auth.access_token,until:Date.now()+1000*Math.min(3600,auth.expires_in-10)});
      if(location.hash==='#/acceso')history.replaceState(null,'',dashboard);
      await render();
      if(session && !homeRoutes.has(location.hash))main.focus({preventScroll:true});
    } catch(err) {
      if(!signal.aborted){
        bindText(error,err.status===429?'Demasiados intentos. Espera un momento antes de volver a entrar.':
        [400,401,403,422].includes(err.status)?'Comprueba el correo y la contraseña.':'No se ha podido conectar con el servicio de acceso. Vuelve a intentarlo.');
        motionFor('login-feedback',error);
      }
    } finally {submit.disabled=false;}
  });
  main.append(loginContent);
  if(displayedView!=='login')motionFor(displayedView==='recovery'?'recovery':'portal-access',main.querySelector('.auth-content'));
  if(message)motionFor('login-feedback',error);
  displayedView='login';
}
signout.addEventListener('click',()=>{
  const token=session?.token;
  endSession();
  if(token) void api('/auth/v1/logout?scope=local',{token,payload:{}}).catch(()=>{});
});

function breadcrumbs(parts) {
  const nav=node('nav');bindAttr(nav,'aria-label','Ruta');nav.append(uiLink('Mis documentos',ROOT));
  parts.forEach((p,i)=>nav.append(document.createTextNode(' / '),i===2?uiLink('Guías de emplatado',route(parts.slice(0,i+1))):link(p,route(parts.slice(0,i+1)))));
  main.append(nav);
}
function showError(text) {
  main.replaceChildren();breadcrumbs([]);setTitle(text);main.append(uiLink('Volver a Mis documentos',ROOT));
}
function classifyError(err,signal) {
  if(signal.aborted)return;
  if(err.status===401){endSession('Vuelve a iniciar sesión.');return;}
  showError([400,403,404].includes(err.status)?'Carpeta o documento no disponible':'Biblioteca no disponible');
}
async function documentFile(row,fmt,signal,original=false) {
  const key=[row.hotel_key,row.outlet_key,row.guide_key,fmt].map(encodeURIComponent).join('/');
  const response=await api('/functions/v1/compi-descarga/'+key+(original?'?original=1':''),{token:session.token,signal,payload:{}});
  const tag=response.headers.get('X-CompI-Brand-Revision');
  return {blob:new Blob([await response.arrayBuffer()],{type:MIME[fmt]}),
    revision:tag!==null&&/^\d+$/.test(tag)?Number(tag):null};
}
function showOriginalDownload(host,row,fmt,signal){
  const selector='[data-original-format="'+fmt+'"]';
  if(host.querySelector(selector))return;
  const panel=node('div',undefined,'original-document');
  panel.dataset.originalFormat=fmt;
  const notice=uiNode('p','No se ha podido aplicar la marca a esta plantilla. Pide a un editor que revise el archivo original.','error');
  notice.setAttribute('role','alert');
  panel.append(notice,download(fmt==='pdf'?'Descargar el PDF original':'Descargar el Word original',row,fmt,signal,true));
  host.append(panel);
}
async function watchPdf(row,signal,actions){
  const host=main, reader=node('div',undefined,'pdf-preview'),notice=uiNode('p','','feedback');
  const retry=uiNode('button','Reintentar','download pdf-preview-retry');
  const native=uiLink('Abrir el PDF en otra pestaña','','download');
  native.target='_blank';native.rel='noopener noreferrer';native.hidden=true;native.removeAttribute('href');
  actions.append(native);retry.type='button';retry.hidden=true;
  notice.setAttribute('role','status');host.append(notice,retry,reader);
  let revision=null,hasRevision=false,checking=false,previewUrl=null,displayController=null;
  function clearPreview(){
    displayController?.abort();displayController=null;
    if(previewUrl)URL.revokeObjectURL(previewUrl);
    previewUrl=null;native.hidden=true;native.removeAttribute('href');reader.replaceChildren();
  }
  async function refresh(initial=false){
    if(signal.aborted||checking||(!initial&&document.hidden))return;
    checking=true;retry.disabled=true;
    let current=null;
    try{
      if(!initial){
        current=await manage.rpc('compi_document_brand_revision',{h:row.hotel_key},signal);
        if(signal.aborted||(hasRevision&&current===revision))return;
      }
      const result=await documentFile(row,'pdf',signal);
      if(signal.aborted)return;
      clearPreview();
      previewUrl=URL.createObjectURL(result.blob);native.href=previewUrl;native.hidden=false;
      displayController=new AbortController();
      revision=result.revision??current;hasRevision=true;
      bindText(notice,'');retry.hidden=true;
      host.querySelector('[data-original-format="pdf"]')?.remove();
      try{
        await renderPdfPages(reader,result.blob,{signal:displayController.signal,title:row.title,opening:initial});
      }catch{
        if(signal.aborted)return;
        bindText(notice,'No se pudo mostrar el PDF. Puedes abrirlo en otra pestaña o descargarlo.');
        retry.hidden=false;
      }
    }catch(error){
      if(signal.aborted)return;
      if(error.templateFile){
        clearPreview();revision=current;hasRevision=true;bindText(notice,'');retry.hidden=true;
        showOriginalDownload(host,row,'pdf',signal);
      }else if([400,401,403,404].includes(error.status)){
        stop();classifyError(error,signal);
      }else{
        bindText(notice,'No se pudo actualizar la vista previa. Se volverá a intentar.');
        retry.hidden=false;
      }
    }finally{checking=false;retry.disabled=false;}
  }
  const check=()=>{void refresh();};
  const storage=event=>{if(event.key===brandChangeEvent)check();};
  const interval=setInterval(check,30000);
  function stop(){
    clearInterval(interval);clearPreview();
    document.removeEventListener('visibilitychange',check);
    window.removeEventListener('focus',check);
    window.removeEventListener(brandChangeEvent,check);
    window.removeEventListener('storage',storage);
    signal.removeEventListener('abort',stop);
  }
  retry.addEventListener('click',()=>void refresh(true));
  document.addEventListener('visibilitychange',check);
  window.addEventListener('focus',check);
  window.addEventListener(brandChangeEvent,check);
  window.addEventListener('storage',storage);
  signal.addEventListener('abort',stop,{once:true});
  await refresh(true);
}

function download(text,row,fmt,signal,original=false) {
  const b=uiNode('button',text,'download');b.type='button';b.prepend(icon('download'));
  b.addEventListener('click',async ()=>{
    b.disabled=true;
    try {
      const {blob}=await documentFile(row,fmt,signal,original);
      if(signal.aborted)return;
      const u=URL.createObjectURL(blob), a=link('',u);a.download=row.title+'.'+fmt;
      document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);
    } catch(err){
      if(signal.aborted)return;
      if(err.templateFile&&!original)showOriginalDownload(b.closest('.formats')||main,row,fmt,signal);
      else classifyError(err,signal);
    }
    finally {b.disabled=false;}
  });
  return b;
}
function guideStatus(row) {
  const draft=row.guide_state==='draft';
  return uiNode('span',draft?'Borrador':'Publicada',draft?'guide-status draft':'guide-status');
}
async function render() {
  if(session && session.until<=Date.now())remember(null);
  if(homeRoutes.has(location.hash)){showHome();return;}
  if(location.hash==='#/recuperar'){
    const signal=discardView();workspaceHeader(false);
    publicNav.querySelector('[data-portal-link]').removeAttribute('aria-current');
    visibleAccess=null;
    recoveryForm({main,node,link,api,signal,onSuccess:()=>remember(null)});
    displayedView='recovery';
    return;
  }
  if(!session || location.hash==='#/acceso'){login();return;}
  const signal=discardView();signout.hidden=false;
  const pending=mustChange(session.token);
  if(pending){
    workspaceHeader(false);displayedView='password';
    passwordChange({main,node,api,signal,token:session.token,email:pending.email,remember,render});
    return;
  }
  workspaceHeader(true);
  const busy=uiNode('p','Cargando…','status');busy.setAttribute('role','status');main.append(busy);
  try {
    const token=session.token;
    if(claimedToken!==token) {
      const needs=await manage.rpc('compi_needs_mfa',{},signal);
      if(signal.aborted)return;
      if(needs){
        workspaceHeader(false);signout.hidden=true;
        await segundoFactor({main,node,api,token,signal,remember,render,salir:()=>signout.click()});return;
      }
      await manage.rpc('compi_activate_access',{},signal);if(signal.aborted)return;claimedToken=token;
    }
    const [access,outlets]=await Promise.all([manage.rpc('compi_my_access',{},signal),
      api('/rest/v1/compi_outlets?select=hotel_key,outlet_key,hotel,outlet&order=hotel,outlet',{token,signal}).then(r=>r.json())]);
    if(signal.aborted)return;
    visibleAccess=JSON.stringify(access);
    const roles=new Map(access.map(x=>[x.hotel_key,x.access_rank]));
    const admins=access.filter(x=>x.access_rank===1).map(x=>x.hotel_key);
    const hash=location.hash||ROOT;
    const editors=new Set(access.filter(a=>[1,2].includes(a.access_rank)).map(a=>a.hotel_key));
    const active=access.length>0;
    const links={
      inicio:dashboard,horarios:active?'#/horarios':null,equipo:admins.length?'#/equipo':null,
      recetas:active?'#/recetas':null,escandallos:admins.length?'#/escandallos':null,
      plating:active?'#/plating':null,generar:editors.size?'#/generar':null,
      archivo:active?ROOT:null,correo:active?'#/correo':null,seguridad:active?'#/seguridad':null
    };
    const hotels=access.map(a=>({key:a.hotel_key,name:outlets.find(o=>o.hotel_key===a.hotel_key)?.hotel||a.hotel_key}));
    const hotelLabel=hotels.map(h=>h.name).join(' · ');
    const urlSection=hash.split('/')[1];
    const section=({portal:'inicio',empleados:'equipo',costes:'escandallos',empresa:'archivo',marca:'generar'})[urlSection]||urlSection;
    const titles={inicio:'Inicio',equipo:'Equipo',recetas:'Recetas',plating:'Plating Guides',escandallos:'Escandallos',
      generar:'Generación de recetas',archivo:'Mis documentos',correo:'Correo',horarios:'Horarios',seguridad:'Recuperación de cuenta'};
    const title=titles[section]||'Mi entorno de trabajo';
    main=mountShell({main:page,section,title,hotel:hotelLabel,access,links,signal});
    const currentManager=managerFor(main);
    const scopedSignal=extra=>extra && extra!==signal?AbortSignal.any([signal,extra]):signal;
    const documentRpc=(name,args={},requestSignal)=>manage.rpc(name,args,scopedSignal(requestSignal));
    const documentApi=(path,options={})=>api(path,{...options,token,signal:scopedSignal(options.signal)});
    if(['inicio','recetas','escandallos','plating'].includes(section)){
      bindComputed(pageTitle,()=>t('{section} · Portal CompI',{section:t(title)}));
      if(!active){main.append(uiNode('p','Tu cuenta todavía no tiene acceso a un hotel.'));return;}
      if(!links[section]){main.append(uiNode('p','Acceso restringido'));return;}
      const plazaAvailable = section==='escandallos' && admins.includes('hotel-arts-barcelona');
      async function loadPlazaTemplate(){
        const response=location.port==='4173' && ['127.0.0.1','localhost'].includes(location.hostname)
          ? await fetch('/local/plaza/plantilla',{headers:{Authorization:'Bearer '+token,apikey:PUBLIC_KEY},
              signal,cache:'no-store',credentials:'omit',redirect:'error'})
          : await api('/functions/v1/compi-arts-plaza',{token,signal,payload:{}});
        if(!response.ok)throw Error('No se pudo abrir la plantilla de Plaza.');
        return response.json();
      }
      const catalog=await loadCatalog({api:documentApi,rpc:documentRpc,signal});
      if(signal.aborted)return;
      keepNames(catalog.flatMap(row=>[row.hotel,row.outlet]));
      for(const row of catalog)useApproved(row.title,row.nombre_en);
      const visible=section==='escandallos'?catalog.filter(row=>admins.includes(row.hotel_key)):catalog;
      const openDocumentHref=row=>route([row.hotel,row.outlet,'Plating Guides',row.guide_key]);
      const getGuideMedia=async(row,variant,extra)=>{
        const requestSignal=scopedSignal(extra);
        if(variant==='pdf'||variant==='docx')return (await documentFile(row,variant,requestSignal)).blob;
        return loadGuideImage({api:documentApi,row,variant,signal:requestSignal});
      };
      const context={content:main,section,hotel:hotelLabel,links,access,outlets,catalog:visible,guides:visible,signal,
        rpc:documentRpc,openDocumentHref,platingHref,getGuideMedia,userId:currentUserId(token),favoriteScope:currentUserId(token),
        loadRecipeImage:(row,requestSignal)=>getGuideMedia(row,'approved',requestSignal),
        canCreate:!!links.generar,newRecipeHref:links.generar,
        canEdit:row=>section==='escandallos'?admins.includes(row.hotel_key):row.can_classify,
        saveClassification:(row,kind,category)=>documentRpc('compi_classify_guide',{h:row.hotel_key,o:row.outlet_key,g:row.guide_key,kind,category})};
      if(section==='inicio')await renderInicio(context);
      if(section==='recetas')await renderRecipes(context);
      if(section==='escandallos'){
        await renderCostBook({...context,loadPlaza:plazaAvailable?loadPlazaTemplate:null,
          preferCatalog:hash==='#/escandallos/catalogo'});
      }
      if(section==='plating'){
        const selected=hash.startsWith('#/plating/')?visible.find(row=>platingHref(row)===hash):null;
        if(hash!=='#/plating'&&!selected){showError('Documento no disponible');return;}
        await renderPlating({...context,selected});
      }
      return;
    }
    if(hash==='#/horarios'){
      main.replaceChildren();setTitle('Horarios');
      if(!access.length){main.append(uiNode('p','Necesitas acceso activo a un hotel.'));return;}
      const hotels=access.map(a=>({key:a.hotel_key,name:outlets.find(o=>o.hotel_key===a.hotel_key)?.hotel||a.hotel_key}));
      await schedules({main,node,rpc:manage.rpc,hotels,signal});return;
    }
    if(hash==='#/seguridad'){
      main.replaceChildren();setTitle('Recuperación de cuenta');
      if(!access.length){main.append(uiNode('p','Necesitas acceso activo a un hotel.'));return;}
      await backupPanel({main,node,link,rpc:manage.rpc,signal});
      if(!signal.aborted){
        try{
          if(sessionStorage.getItem('compi.invitation.arrival')){
            sessionStorage.removeItem('compi.invitation.arrival');
            motionFor('invitation',main.querySelector('.recovery-settings'));
          }
        }catch{ /* El acceso funciona también sin almacenamiento de sesión. */ }
      }
      return;
    }
    if(hash==='#/correo'||hash.startsWith('#/correo/')){
      main.replaceChildren();setTitle('Correo');
      if(!access.length){main.append(uiNode('p','Necesitas acceso activo a un hotel para abrir tu buzón.'));return;}
      const hotels=access.map(a=>({key:a.hotel_key,name:outlets.find(o=>o.hotel_key===a.hotel_key)?.hotel||a.hotel_key}));
      await mailbox({main,node,icon,rpc:manage.rpc,hotels,signal});
      return;
    }
    const brandHotels=admins.map(key=>({key,name:outlets.find(o=>o.hotel_key===key)?.hotel||key}));
    if(hash==='#/marca'||hash.startsWith('#/marca/')){
      main.replaceChildren();
      const selected=hash==='#/marca'?brandHotels[0]?.key:decodeURIComponent(hash.slice('#/marca/'.length));
      if(!brandHotels.some(h=>h.key===selected)){setTitle('Acceso restringido');main.append(uiLink('Volver a mi entorno de trabajo',dashboard));return;}
      setTitle('Marca de las fichas');
      main.append(uiLink('Generación de recetas','#/generar'));
      brandSettings({main,node,rpc:documentRpc,api:documentApi,hotels:brandHotels,selected,signal});
      return;
    }
    if(hash==='#/generar'||hash.startsWith('#/generar/')){
      main.replaceChildren();setTitle('Generación de recetas');
      if(!editors.size){main.append(uiNode('p','Esta función requiere permiso de edición de documentos.'));return;}
      const destinations=outlets.filter(o=>editors.has(o.hotel_key));
      const parts=hash.split('/').slice(2).map(decodeURIComponent);
      let selected;
      if(parts.length){
        selected=destinations.find(o=>o.hotel_key===parts[0]&&o.outlet_key===parts[1]&&(parts.length===2||parts.length===3));
        if(!selected){showError('Outlet no disponible para edición');return;}
      }
      const initialSource=parts.length===3?await loadGuideSource({api:documentApi,rpc:documentRpc,h:parts[0],o:parts[1],g:parts[2]}):undefined;
      if(signal.aborted)return;
      if(parts.length===3&&!initialSource){showError('Documento no disponible');return;}
      const selectedHotel=brandHotels.some(h=>h.key===selected?.hotel_key)?selected.hotel_key:undefined;
      const recipePanel=generatorPanels({main,node,signal,rpc:documentRpc,api:documentApi,hotels:brandHotels,selectedHotel});
      generator({main:recipePanel,node,link,route,api:documentApi,rpc:documentRpc,signal,destinations,selected,MIME,initialSource});
      return;
    }
    if(section==='equipo'){
      main.replaceChildren();setTitle('Equipo');
      if(!admins.length){main.append(uiNode('p','No tienes acceso a la gestión de empleados.'));return;}
      const h=hash.split('/').length===2?admins[0]:decodeURIComponent(hash.split('/')[2]);
      if(!admins.includes(h)){showError('Hotel no disponible');return;}
      const hotelName=k=>outlets.find(o=>o.hotel_key===k)?.hotel||k;
      if(admins.length>1){const nav=node('nav');for(const k of admins)nav.append(link(hotelName(k),'#/equipo/'+encodeURIComponent(k)));main.append(nav);}
      main.append(node('h2',hotelName(h)));await currentManager.panel(admins,h,signal);return;
    }
    if(!hash.startsWith(ROOT)){showError('Carpeta no disponible');return;}
    const parts=hash===ROOT?[]:hash.slice(ROOT.length).split('/').map(decodeURIComponent);
    if(parts.length>4||parts.some(p=>!p||p.includes('/')||p==='.'||p==='..')){showError('Carpeta no disponible');return;}
    const answer=await api('/rest/v1/compi_guides?select=hotel_key,outlet_key,hotel,outlet,guide_key,title,object_prefix,guide_state&order=hotel,outlet,title',{token:session.token,signal});
    const guides=await answer.json();if(signal.aborted)return;
    const folder=r=>[r.hotel,r.outlet,'Plating Guides'];
    const rows=guides.filter(r=>parts.slice(0,3).every((p,i)=>folder(r)[i]===p));
    main.replaceChildren();
    const available=outlets.filter(o=>parts.slice(0,3).every((p,i)=>folder(o)[i]===p));
    const company=access.find(a=>a.hotel_key===parts[0] && !outlets.some(o=>o.hotel_key===a.hotel_key));
    const ctx=available[0]||(company?{hotel_key:company.hotel_key,hotel:parts[0]}:null);
    if(parts.length && !available.length && !(company && parts.length===1)){showError('Carpeta o documento no disponible');return;}
    if(parts.length)breadcrumbs(parts.slice(0,3));
    if(parts.length<3) {
      setTitle(parts.at(-1)||'Mis documentos',!parts.length);
      if(!parts.length)main.append(uiNode('p','Selecciona un hotel para consultar sus guías de emplatado.','intro'));
      const folders=node('div',undefined,'folders');
      const names=new Set(available.map(r=>folder(r)[parts.length]));
      if(!parts.length)for(const a of access)if(a.access_rank===1&&!outlets.some(o=>o.hotel_key===a.hotel_key))names.add(a.hotel_key);
      for(const name of names) {
        const a=link('',route([...parts,name]),'folder');
        const mark=node('span',undefined,'folder-icon');
        mark.append(icon(['hotel','folder','book'][parts.length]));
        const copy=node('span',undefined,'folder-copy');
        copy.append(parts.length===2?uiNode('strong','Guías de emplatado'):node('strong',name));
        const count=parts.length===0
          ? new Set(available.filter(r=>r.hotel===name).map(r=>r.outlet_key)).size
          : rows.filter(r=>parts.length===2 || r.outlet===name).length;
        copy.append(bindComputed(node('small'),()=>folderCount(count,parts.length===0)));
        if(parts.length===2)bindAttr(a,'aria-label','Guías de emplatado');else a.setAttribute('aria-label',name);
        a.append(mark,copy,icon('arrow'));folders.append(a);
      }
      main.append(folders.childElementCount?folders:uiNode('p','Todavía no hay documentos disponibles para tu cuenta.'));
      if(ctx&&parts.length)currentManager.folderControls(parts.length,ctx,roles.get(ctx.hotel_key),parts,signal);
    } else if(parts.length===3) {
      setTitle('Guías de emplatado');
      if(editors.has(ctx.hotel_key))main.append(uiLink('Generación de recetas', '#/generar/'+encodeURIComponent(ctx.hotel_key)+'/'+encodeURIComponent(ctx.outlet_key),'download primary generate-here'));
      const list=node('div',undefined,'rows');
      for(const row of rows){
        const entry=node('div',undefined,'row'),actions=node('div',undefined,'formats');
        let openLabel='Ver ficha';
        if(row.guide_state==='draft')openLabel=editors.has(row.hotel_key)?'Completar borrador':'Ver estado del borrador';
        actions.append(uiLink(openLabel,row.guide_state==='ready'?platingHref(row):route([...parts,row.guide_key]),'download'));
        if(row.guide_state==='ready')actions.append(download('Descargar Word',row,'docx',signal));
        const copy=node('div',undefined,'row-copy'), mark=node('span',undefined,'folder-icon');
        mark.append(icon('file'));
        const dish=node('strong',row.title,'dish');dish.translate=false;dish.dir='auto';
        copy.append(dish,guideStatus(row));
        entry.append(mark,copy,actions);list.append(entry);
      }
      main.append(rows.length?list:uiNode('p','Todavía no hay guías de emplatado en esta carpeta.'));
      currentManager.folderControls(3,ctx,roles.get(ctx.hotel_key),parts,signal);
    } else {
      const row=rows.find(r=>r.guide_key===parts[3]);
      if(!row){showError('Documento no disponible');return;}
      setTitle(row.title,false);
      main.append(guideStatus(row));
      currentManager.guideControls(row,roles.get(row.hotel_key)??3,signal,parts);
      if(row.guide_state==='draft'){
        if(editors.has(row.hotel_key)){
          const keys={h:row.hotel_key,o:row.outlet_key,g:row.guide_key};
          const source=await documentRpc('compi_guide_source',keys);
          if(!signal.aborted&&source)main.append(uiLink('Volver a editar','#/generar/'+Object.values(keys).map(encodeURIComponent).join('/'),'download primary'));
        }
        return;
      }
      const actions=node('div',undefined,'toolbar');
      actions.append(download('Descargar PDF',row,'pdf',signal),download('Descargar Word',row,'docx',signal));main.append(actions);
      await watchPdf(row,signal,actions);
    }
  } catch(err){classifyError(err,signal);}
  finally{
    if(!signal.aborted&&main.classList.contains('ws-main-content'))workspaceArrival(location.hash);
  }
}

async function syncAccess() {
  if(!session || !visibleAccess || checkingAccess || document.hidden)return;
  const previous=session;
  checkingAccess=true;
  try {
    const next=await manage.rpc('compi_my_access');
    if(session===previous && visibleAccess && visibleAccess!==JSON.stringify(next)){
      await render();
      if(session===previous && visibleAccess){
        const message=uiNode('p','Tus permisos se han actualizado.','status');
        message.setAttribute('role','status');main.prepend(message);
      }
    }
  } catch(err){if(err.status===401 && session===previous)endSession('Vuelve a iniciar sesión.');}
  finally{checkingAccess=false;}
}
window.addEventListener('focus',syncAccess);
document.addEventListener('visibilitychange',syncAccess);
setInterval(syncAccess,10000);
window.addEventListener('hashchange',()=>{
  if(!homeRoutes.has(location.hash))window.scrollTo({top:0,behavior:'instant'});
  render();
});
document.querySelector('.skip').addEventListener('click',event=>{
  event.preventDefault();
  main.focus();
  main.scrollIntoView({behavior:'instant'});
});
document.addEventListener('click',event=>{
  const metric=event.target.closest?.('a.ws-metric');
  if(metric&&!event.defaultPrevented&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey)metricDestination=metric.hash;
  if(location.hash==='#/inicio'&&event.target.closest?.('a[href="#/inicio"]'))window.scrollTo(0,0);
});
window.addEventListener('pageshow',e=>{if(e.persisted)render();});
try {
  const saved=JSON.parse(sessionStorage.getItem(STORAGE));
  if(typeof saved?.token==='string' && saved.until>Date.now()) remember(saved);
  else remember(null);
} catch { remember(null); }
render();

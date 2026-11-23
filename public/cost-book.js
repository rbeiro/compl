import {bindText,t} from './i18n.js';
import {motionFor} from './motion-choices.js';
import {restaurantChoices,restaurantKey} from './workspace-catalog.js';
import {costFigures} from './workspace-cost-math.js';
import {renderCosts} from './workspace-costs.js';
import {renderPlaza} from './plaza-costs.js';

const guideKey=r=>JSON.stringify([r.hotel_key,r.outlet_key,r.guide_key]);
const fold=s=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const statusNames={empty:'Sin ingredientes',pending:'Pendientes',complete:'Completos',provisional:'Provisionales',unknown:'Sin comprobar'};
function element(tag,cls,copy){
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(copy)bindText(node,copy);
  return node;
}
function option(value,copy){const node=element('option','',copy);node.value=value;return node;}
function field(copy,input){
  const label=element('label','cb-field');
  label.append(element('span','',copy),input);return label;
}
function matchesState(item,filter){
  if(!filter)return true;
  if(filter==='loaded')return item.count>0;
  if(filter==='pending')return ['pending','empty','provisional'].includes(item.status);
  return item.status===filter;
}
export async function renderCostBook(context){
  const {content,catalog,rpc,signal,loadPlaza,preferCatalog}=context;
  const root=element('section','cb-workspace'),head=element('header','cb-heading');
  head.append(element('h1','','Escandallos'));
  const filters=element('div','cb-filters'),restaurant=element('select'),status=element('select');
  restaurant.name='costRestaurant';status.name='costStatus';
  status.append(...[['','Todos los estados'],['loaded','Con ingredientes'],...Object.entries(statusNames).filter(([v])=>v!=='unknown')].map(([v,k])=>option(v,k)));
  const pick=element('button','cb-pick','Elegir un plato');pick.type='button';pick.setAttribute('aria-haspopup','dialog');
  filters.append(field('Restaurante',restaurant),field('Estado del escandallo',status),pick);
  const count=element('p','cb-count'),message=element('p','cb-message'),reset=element('button','cb-plain','Mostrar todas');
  count.setAttribute('role','status');reset.type='button';reset.hidden=true;
  const plazaHost=element('div','cb-plaza'),guideHost=element('div','cb-guide');
  plazaHost.hidden=guideHost.hidden=true;
  root.append(head,filters,count,message,reset,plazaHost,guideHost);content.replaceChildren(root);
  const rows=new Map(),guideRows=catalog.filter(r=>r.guide_key&&r.guide_state!=='archived');
  for(const row of guideRows){
    const key=guideKey(row);rows.set(key,{key,row,title:row.title,status:'unknown',count:null});
  }
  let plaza,guide,selected,plazaSelected,dialog,refreshList,allowed=[],reading=false,template;
  let sequence=0,indexFailed=false,plazaFailed=false;
  const busy=new Set(),edited=new Set();
  function list(){
    return [...rows.values()].filter(item=>(!restaurant.value || restaurantKey(item.row)===restaurant.value)&&matchesState(item,status.value));
  }
  function refresh(){
    allowed=list();
    bindText(count,allowed.length===1?'1 plato':'{n} platos',{n:allowed.length});
    pick.disabled=!allowed.length;reset.hidden=allowed.length>0||(!restaurant.value&&!status.value);
    refreshList?.();
  }
  function showMessage(){
    message.replaceChildren();
    if(indexFailed && !reading && guideRows.length){
      message.append(element('span','','No se pudo comprobar el estado de todas las fichas.'),' ');
      const retry=element('button','cb-plain','Reintentar');retry.type='button';retry.onclick=()=>void readIndex();message.append(retry);
    }
    if(plazaFailed && !busy.has('plaza')){
      message.append(element('span','','No se pudo cargar Plaza.'),' ');
      const retry=element('button','cb-plain','Reintentar');retry.type='button';retry.onclick=()=>void startPlaza();message.append(retry);
    }
    message.hidden=!message.childNodes.length;
  }
  function updateRestaurants(){
    const selectedRestaurant=restaurant.value;
    restaurant.replaceChildren(option('','Todos los restaurantes'));
    for(const {key,label} of restaurantChoices([...rows.values()].map(x=>x.row)))restaurant.add(new Option(label,key));
    restaurant.value=selectedRestaurant;refresh();
  }
  function choose(item,animate=false){
    if(!item){selected=null;plazaHost.hidden=guideHost.hidden=true;return;}
    const changed=selected!==item;
    selected=item;plazaHost.hidden=!item.plaza;guideHost.hidden=Boolean(item.plaza);
    if(changed){
      const serial=++sequence;
      const done=item.plaza?plaza.select(item.id):guide.select(item.row);
      if(animate)Promise.resolve(done).then(()=>{
        if(!signal.aborted&&serial===sequence)motionFor('cost-picker',item.plaza?plazaHost.querySelector('.ec-selected h2'):guideHost.querySelector('.wc-selected-name'));
      });
    }
  }
  function applyFilters(){
    refresh();choose(allowed.includes(selected)?selected:allowed[0],true);
    motionFor('filter',count);
  }
  restaurant.addEventListener('change',applyFilters);status.addEventListener('change',applyFilters);
  reset.onclick=()=>{restaurant.value=status.value='';applyFilters();restaurant.focus();};
  function openPicker(){
    if(dialog?.open||!allowed.length)return;
    const win=element('dialog','wc-dialog cb-dialog');dialog=win;
    const title=element('h2','','Elegir un plato');title.id='cost-book-picker-title';win.setAttribute('aria-labelledby',title.id);
    const header=element('header'),close=element('button','wc-icon-btn');close.type='button';close.textContent='×';close.setAttribute('aria-label',t('Cerrar'));close.onclick=()=>win.close();
    header.append(title,close);
    const body=element('div','wc-picker'),search=element('input'),results=element('div','wc-options');
    search.type='search';search.autocomplete='off';body.append(field('Buscar por nombre u outlet',search),results);
    win.append(header,body);root.append(win);
    function draw(){
      const words=fold(search.value.trim()).split(/\s+/).filter(Boolean);
      const found=allowed.filter(i=>{const haystack=fold(i.title+' '+i.row.outlet+' '+(i.service||''));return words.every(w=>haystack.includes(w));});
      results.replaceChildren();
      for(const item of found){
        const b=element('button','wc-option'),desc=element('span'),name=element('strong'),detail=element('small');
        name.textContent=item.title;detail.textContent=[item.row.outlet,item.service,t(statusNames[item.status])].filter(Boolean).join(' · ');
        desc.append(name,detail);b.type='button';b.append(desc);b.dataset.key=item.key;
        b.setAttribute('aria-pressed',String(selected===item));results.append(b);
      }
      if(!found.length)results.append(element('p','wc-muted','No hay coincidencias.'));
    }
    results.onclick=e=>{const b=e.target.closest('button[data-key]');if(b){choose(rows.get(b.dataset.key),true);win.close();}};
    win.addEventListener('close',()=>{refreshList=null;dialog=null;win.remove();if(!signal.aborted)pick.focus({preventScroll:true});},{once:true});
    win.onclick=e=>{if(e.target===win)win.close();};
    search.oninput=()=>{draw();motionFor('cost-picker',results,{items:[...results.children]});};
    refreshList=draw;draw();win.showModal();search.focus();motionFor('cost-picker',results,{items:[...results.children]});
  }
  pick.onclick=openPicker;
  async function readIndex(){
    if(reading)return;reading=true;showMessage();
    try{
      for(let start=0;start<guideRows.length;start+=200){
        const keys=guideRows.slice(start,start+200).map(r=>({h:r.hotel_key,o:r.outlet_key,g:r.guide_key}));
        const items=await rpc('compi_arts_cost_overview',{guides:keys},signal);
        if(signal.aborted)return;
        if(!Array.isArray(items)||items.length!==keys.length)throw Error('Invalid cost index');
        for(const result of items){
          const key=guideKey(result),item=rows.get(key);if(!item||edited.has(key))continue;
          item.count=result.settings?.ingredients?.length??result.ingredient_count;
          item.status=!item.count?'empty':result.settings&&costFigures(result.settings).complete?'complete':'pending';
        }
      }
      indexFailed=false;
    }catch{indexFailed=true;}
    finally{reading=false;if(!signal.aborted){refresh();showMessage();if(!selected&&allowed.length)choose(allowed[0]);}}
  }
  async function startPlaza(){
    if(!loadPlaza||busy.has('plaza'))return;
    busy.add('plaza');plazaFailed=false;showMessage();
    try{
      const data=await loadPlaza();if(signal.aborted)return;template=data;
      for(const r of data.recipes){
        const key='plaza/'+r.id;
        rows.set(key,{key,id:r.id,title:r.name,service:r.service,plaza:true,status:'unknown',row:{hotel_key:'hotel-arts-barcelona',outlet_key:'plaza',outlet:'Plaza',hotel:'Hotel Arts Barcelona'}});
      }
      plaza=renderPlaza({main:plazaHost,data,userId:context.userId,signal,openPicker,onIndex(items,current){
        for(const info of items){const item=rows.get('plaza/'+info.id);item.status=info.status;item.count=info.count;}
        plazaSelected=rows.get('plaza/'+current);if(selected?.plaza)selected=plazaSelected;
        refresh();
      }});
      updateRestaurants();
    }catch{template=null;plazaFailed=true;}
    finally{busy.delete('plaza');if(!signal.aborted)showMessage();}
  }
  await renderCosts({...context,content:guideHost,connect:api=>{guide=api;},openPicker,onCost(row,n,complete){
    const key=guideKey(row),item=rows.get(key);if(!item)return;
    edited.add(key);const state=n?(complete?'complete':'pending'):'empty';
    if(item.count!==n||item.status!==state){item.count=n;item.status=state;refresh();}
  },loadTariffs:loadPlaza?async()=>{
    const data=template||await loadPlaza();let overrides={};
    try{const saved=JSON.parse(localStorage.getItem('compi.costes.plaza.v1.'+encodeURIComponent(context.userId)));
      if(saved?.sourceHash===data.metadata.sourceSha256)overrides=saved.referencePrices||{};}catch{}
    return data.tariffs.map(r=>({...r,unitPrice:overrides[r.reference]??r.unitPrice}));
  }:null});
  signal.addEventListener('abort',()=>dialog?.close(),{once:true});
  window.addEventListener('compi:languagechange',()=>{refresh();showMessage();},{signal});
  updateRestaurants();await startPlaza();if(signal.aborted)return;
  if(!selected)choose(!preferCatalog&&allowed.includes(plazaSelected)?plazaSelected:allowed[0]);
  await readIndex();
}

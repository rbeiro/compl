import {bindAttr,bindText} from './i18n.js';
import {motionFor} from './motion-choices.js';

const assetBase=new URL('./vendor/pdfjs-5.6.205/',import.meta.url);
const readers=new WeakMap();
let engine;
async function pdfEngine(){
  engine??=import('./vendor/pdfjs-5.6.205/pdf.js').then(pdf=>{
    pdf.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.js',assetBase).href;
    return pdf;
  }).catch(error=>{engine=null;throw error;});
  return engine;
}
const assetDir=name=>new URL(name+'/',assetBase).href;
function element(tag,className){
  const item=document.createElement(tag);
  if(className)item.className=className;
  return item;
}
function pageButton(source,glyph){
  const button=element('button','pdf-step');
  button.type='button';
  bindAttr(button,'aria-label',source);
  const mark=element('span');mark.textContent=glyph;mark.setAttribute('aria-hidden','true');
  button.append(mark);return button;
}

// Every instance owns its worker, text layers and canvases. The caller supplies the
// authorized bytes and a signal for its active route or selected recipe.
export async function renderPdfPages(host,blob,{signal,title='',opening=false}={}){
  signal?.throwIfAborted();
  readers.get(host)?.();
  const root=element('section','compi-pdf-document');
  bindAttr(root,'aria-label','PDF · {title}',{title});
  root.dataset.pdfState='loading';root.setAttribute('aria-busy','true');
  const status=bindText(element('p','pdf-status'),'Cargando documento…');
  status.setAttribute('role','status');root.append(status);host.replaceChildren(root);
  const lifetime=new AbortController(), scope=lifetime.signal;
  let task,resize,near,scrollFrame=0,rendering=false;
  const pages=[], queued=new Set();
  function stop(){
    if(scope.aborted)return;
    lifetime.abort();resize?.disconnect();near?.disconnect();if(scrollFrame)cancelAnimationFrame(scrollFrame);
    signal?.removeEventListener('abort',stop);queued.clear();
    for(const item of pages){
      item.paint?.cancel();item.text?.cancel();
      const canvas=item.paper.querySelector('canvas');
      if(canvas){canvas.width=0;canvas.height=0;}
    }
    if(task)void task.destroy().catch(()=>{});
    root.remove();
    if(readers.get(host)===stop)readers.delete(host);
  }
  readers.set(host,stop);signal?.addEventListener('abort',stop,{once:true});
  try{
    const [pdf,bytes]=await Promise.all([pdfEngine(),blob.arrayBuffer()]);
    scope.throwIfAborted();
    task=pdf.getDocument({data:new Uint8Array(bytes),cMapUrl:assetDir('cmaps'),cMapPacked:true,
      standardFontDataUrl:assetDir('standard_fonts'),wasmUrl:assetDir('wasm'),iccUrl:assetDir('iccs'),
      isEvalSupported:false,enableXfa:false,useSystemFonts:false});
    const doc=await task.promise;scope.throwIfAborted();
    const first=await doc.getPage(1);scope.throwIfAborted();
    const initial=first.getViewport({scale:1}),total=doc.numPages;
    const toolbar=element('div','pdf-controls'), label=element('label','pdf-page-label');
    const previous=pageButton('Página anterior','‹'),next=pageButton('Página siguiente','›');
    const selector=element('select','pdf-page-select');
    bindAttr(selector,'aria-label','Ir a la página');
    label.append(bindText(element('span'),'Página'),selector,bindText(element('span'),'de {total}',{total}));
    toolbar.append(previous,label,next);
    const stack=element('div','pdf-pages');
    let current=1,pendingPage=null;
    function showNumber(number){
      current=number;selector.value=String(number);
      previous.disabled=number<=1;next.disabled=number>=total;
    }
    function go(number){
      const item=pages[number-1];if(!item||number===current)return;
      pendingPage=item;showNumber(number);
      item.figure.scrollIntoView({behavior:'instant',block:'start'});
      revealPage(item);queue(item);
    }
    function revealPage(item){
      if(pendingPage!==item||item.figure.dataset.rendered!=='true')return;
      pendingPage=null;
      if(current===item.number)motionFor('document-page',item.figure,{items:[...item.figure.children]});
    }
    previous.addEventListener('click',()=>go(current-1));
    next.addEventListener('click',()=>go(current+1));
    selector.addEventListener('change',()=>go(Number(selector.value)));
    for(let number=1;number<=total;number++){
      const figure=element('figure','pdf-page'),paper=element('div','pdf-paper');
      paper.style.aspectRatio=initial.width+' / '+initial.height;
      figure.dataset.page=String(number);
      const caption=bindText(element('figcaption'),'Página {number} de {total}',{number,total});
      figure.append(paper,caption);stack.append(figure);
      const option=element('option');option.value=String(number);option.textContent=String(number);selector.append(option);
      pages.push({number,figure,paper,near:false,width:0,page:number===1?first:null});
    }
    showNumber(1);root.replaceChildren(toolbar,stack);
    async function paintPage(item){
      const page=item.page??=await doc.getPage(item.number);scope.throwIfAborted();
      const width=Math.max(1,Math.round(item.paper.getBoundingClientRect().width));
      if(item.width===width && item.paper.querySelector('canvas'))return;
      const base=page.getViewport({scale:1});
      item.paper.style.aspectRatio=base.width+' / '+base.height;
      const viewport=page.getViewport({scale:width/base.width});
      const density=Math.min(window.devicePixelRatio||1,2,Math.sqrt(4000000/(viewport.width*viewport.height)),
        8192/viewport.width,8192/viewport.height);
      const canvas=element('canvas');canvas.setAttribute('aria-hidden','true');
      canvas.width=Math.max(1,Math.floor(viewport.width*density));
      canvas.height=Math.max(1,Math.floor(viewport.height*density));
      const textLayer=element('div','pdf-text');
      textLayer.style.setProperty('--total-scale-factor',viewport.scale*page.userUnit);
      const context=canvas.getContext('2d',{alpha:false});
      if(!context)throw new Error('Canvas unavailable');
      item.paint=page.render({canvasContext:context,viewport,
        transform:[canvas.width/viewport.width,0,0,canvas.height/viewport.height,0,0]});
      try{
        await item.paint.promise;scope.throwIfAborted();
        item.text=new pdf.TextLayer({textContentSource:page.streamTextContent(),container:textLayer,viewport});
        await item.text.render().catch(()=>{});scope.throwIfAborted();
        const old=item.paper.querySelector('canvas');
        item.paper.replaceChildren(canvas,textLayer);
        if(old){old.width=0;old.height=0;}
        item.width=width;item.figure.dataset.rendered='true';
        revealPage(item);
      }finally{item.paint=null;item.text=null;page.cleanup();}
    }
    function showPageError(item){
      const box=element('div','pdf-page-error');
      const message=bindText(element('p'),'No se pudo mostrar esta página.');
      const retry=bindText(element('button','download'),'Reintentar');retry.type='button';
      retry.addEventListener('click',()=>{retry.disabled=true;queue(item);});
      box.append(message,retry);item.paper.replaceChildren(box);
    }
    async function drain(){
      if(rendering||scope.aborted)return;
      rendering=true;
      try{
        for(const item of queued){
          queued.delete(item);
          try{await paintPage(item);}catch{if(scope.aborted)return;showPageError(item);}
        }
      }finally{rendering=false;}
    }
    function queue(item){if(!scope.aborted){queued.add(item);void drain();}}
    function followScroll(){
      if(scrollFrame)return;
      scrollFrame=requestAnimationFrame(()=>{
        scrollFrame=0;
        const target=Math.min(window.innerHeight*.35,220), visibles=pages.filter(item=>item.near);
        let active;
        for(const item of visibles){
          const box=item.figure.getBoundingClientRect();
          if(box.top<=target && box.bottom>target){active=item;break;}
          if(!active&&box.bottom>0&&box.top<window.innerHeight)active=item;
        }
        if(active)showNumber(active.number);
      });
    }
    await paintPage(pages[0]);scope.throwIfAborted();
    root.dataset.pdfState='ready';root.setAttribute('aria-busy','false');
    if(opening&&current===1&&!pendingPage)motionFor('guide-document',root,{items:[toolbar,pages[0].paper]});
    if('IntersectionObserver' in window){
      near=new IntersectionObserver(entries=>{
        for(const entry of entries){
          const item=pages[Number(entry.target.dataset.page)-1];item.near=entry.isIntersecting;
          if(item.near)queue(item);
          else if(total>6){
            queued.delete(item);
            const canvas=item.paper.querySelector('canvas');
            if(canvas){canvas.remove();canvas.width=0;canvas.height=0;item.width=0;delete item.figure.dataset.rendered;}
          }
        }
        followScroll();
      },{rootMargin:'650px 0px'});
      pages.forEach(item=>near.observe(item.figure));
    }else{for(const item of pages){item.near=true;queue(item);}}
    if('ResizeObserver' in window){
      let oldWidth=stack.clientWidth;
      resize=new ResizeObserver(()=>{
        if(stack.clientWidth===oldWidth)return;
        oldWidth=stack.clientWidth;
        for(const item of pages)if(item.near)queue(item);
      });
      resize.observe(stack);
    }
    window.addEventListener('scroll',followScroll,{passive:true,signal:scope});
  }catch(error){stop();throw error;}
}

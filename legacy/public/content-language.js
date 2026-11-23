// Only public language models are downloaded. The worker processes hotel content on this device.
import {locale,lookupTranslation,isLocalized,canonicalText} from './i18n.js';
const memo=new Map(),knownNames=new Set(['CompI','Hotel Arts Barcelona','Marina','IRD','Oleos','Óleos','Plaza','Bites & Sips','Bites and Sips']);
let engine,engineLanguage,chain=Promise.resolve(),generation=0;
export function keepNames(names){for(const s of names)if(s)knownNames.add(s);}
const token=/\b(?:[A-Z]{2,}(?:[-_/][\w-]+)+|\d+(?:[.,:/-]\d+)*(?:\s?°[CF])?)\b/gu;
const numbers=s=>s.match(token)?.join('|')||'';
function fixed(s){return !/\p{L}/u.test(s)||knownNames.has(s)||/^(?:[^\s@]+@[^\s@]+|https?:\/\/\S+|[\d\s.,/%()+–−€°-]*(?:g|kg|ml|cl|l|cm|mm|min|kcal|°C|€|%)[\d\s./%°-]*)$/iu.test(s);}
function key(s,to,from){return from+'\0'+to+'\0'+s;}
export function shownText(s,to=locale(),from='es'){return memo.get(key(s,to,from))||s;}
export function useApproved(es,en){if(es&&en&&es!==en)memo.set(key(es,'en','es'),en);}
async function runtime(target){
  // All calls are serialized. Release the previous pair before loading another language on tablets.
  if(engine&&engineLanguage!==target){engine.dispose();engine=null;}
  engineLanguage=target;
  if(!engine){const {BergamotEngine}=await import('./vendor/bergamot/engine.js');engine??=new BergamotEngine({runtimePath:'/vendor/bergamot/'});}
  return engine;
}
export function clearLanguageContent(){++generation;memo.clear();engine?.dispose();engine=null;}
export async function translateTexts(values,to=locale(),from='es'){
  if(from===to)return [...values];
  const rev=generation;
  const run=async()=>{
    if(rev!==generation)throw new DOMException('Session changed','AbortError');
    const missing=[];
    for(const s of new Set(values)){
      if(!s||fixed(s)||memo.has(key(s,to,from)))continue;
      const official=from==='es'?lookupTranslation(s,to):null;
      if(official!=null){memo.set(key(s,to,from),official);continue;}
      missing.push(s);
    }
    if(missing.length){
      const mt=await runtime(to);
      for(let i=0;i<missing.length;i+=32){
        const raw=missing.slice(i,i+32),translated=await mt.translate(from,to,raw);
        if(rev!==generation)throw new DOMException('Session changed','AbortError');
        for(let j=0;j<raw.length;j++){
          const s=raw[j];let value=translated[j]?.trim();
          if(!value)throw Error('Empty translation');
          if(numbers(value)!==numbers(s)){
            // Translate only the surrounding words if the model reformats a quantity or document code.
            const parts=s.split(new RegExp('('+token.source+')',token.flags));
            const words=parts.filter((p,i)=>i%2===0&&p.trim()&&!fixed(p));
            const output=words.length?await mt.translate(from,to,words.map(x=>x.trim())):[];
            const dict=new Map(words.map((p,k)=>[p,p.replace(p.trim(),output[k]||p.trim())]));
            value=parts.map((p,k)=>k%2===0?(dict.get(p)||p):p).join('');
          }
          if(rev!==generation)throw new DOMException('Session changed','AbortError');
          memo.set(key(s,to,from),value);
        }
      }
    }
    return values.map(s=>shownText(s,to,from));
  };
  const task=chain.then(run,run);chain=task.catch(()=>{});return task;
}
const status={
 es:['Traduciendo…','No se pudo cargar la traducción. Reintentar'],
 en:['Translating…','Translation could not load. Retry'],
 ca:['S’està traduint…','No s’ha pogut carregar la traducció. Torna-ho a provar'],
 it:['Traduzione in corso…','Impossibile caricare la traduzione. Riprova'],
 pt:['A traduzir…','Não foi possível carregar a tradução. Tentar novamente'],
 fr:['Traduction en cours…','Impossible de charger la traduction. Réessayer'],
 ar:['جارٍ الترجمة…','تعذّر تحميل الترجمة. أعد المحاولة']
};
const skip='script,style,svg,code,textarea,[contenteditable="true"],[translate="no"],[data-language-picker],.pdf-page-canvas';
const records=new WeakMap(),targets=new Set();
let timer,pending=0,failed=false,notice;
function banner(){
 if(!document.body)return;
 if(!notice){
   notice=document.createElement('button');notice.type='button';notice.className='language-progress';notice.translate=false;
   notice.setAttribute('aria-live','polite');notice.onclick=()=>{failed=false;queue(document.body);};document.body.append(notice);
 }
 const l=locale();notice.hidden=l==='es'||(!pending&&!failed);const value=status[l][failed?1:0];
 if(notice.textContent!==value)notice.textContent=value;
}
function queue(root){if(!root||root===notice||notice?.contains(root))return;targets.add(root);if(!timer)timer=setTimeout(flush,35);}
async function flush(){
 timer=0;const roots=[...targets];targets.clear();const lang=locale(),groups=new Map();
 function collect(node,attr){
   const parent=attr?node:node.parentElement;if(!parent||parent.closest(skip))return;
   const read=()=>attr?node.getAttribute(attr):node.data;const value=read();if(!value?.trim())return;
   let states=records.get(node);if(!states)records.set(node,states=new Map());
   let state=states.get(attr);
   if(!state||value!==state.last){state={source:value,last:value,lang:''};states.set(attr,state);}
   if(state.lang===lang)return;
   const original=state.source.trim(),from=parent.closest('[data-content-lang]')?.dataset.contentLang||'es';
   const source=from==='es'?canonicalText(original):original;
   const write=v=>{
     if(!node.isConnected||lang!==locale()||read()!==state.last)return;
     const out=state.source.replace(original,()=>v);
     state.lang=lang;state.last=out;
     if(out!==value){
       if(!attr&&parent.tagName==='OPTION'&&!parent.hasAttribute('value'))parent.value=parent.textContent;
       if(attr)node.setAttribute(attr,out);else node.data=out;
     }
   };
   if(lang===from||fixed(source)){write(source);return;}
   if(isLocalized(original,lang)){write(original);return;}
   if(!groups.has(from))groups.set(from,new Map());const group=groups.get(from);
   if(!group.has(source))group.set(source,[]);group.get(source).push(write);
 }
 const attrs=['placeholder','title','aria-label','alt'];
 function element(el){if(el.closest(skip))return;for(const attr of attrs)if(el.hasAttribute(attr))collect(el,attr);}
 for(const root of roots){
   if(!root.isConnected)continue;
   if(root.nodeType===3){collect(root,'');continue;}
   if(root.nodeType!==1||root.closest(skip))continue;element(root);
   const walker=document.createTreeWalker(root,5,{acceptNode:n=>n.nodeType===1&&n.matches(skip)?2:1});
   let n;while(n=walker.nextNode()){if(n.nodeType===3)collect(n,'');else element(n);}
 }
 if(!groups.size){if(notice)banner();return;}
 ++pending;banner();
 try{
   for(const [from,group] of groups){
     const originals=[...group.keys()],texts=await translateTexts(originals,lang,from);
     originals.forEach((s,i)=>group.get(s).forEach(write=>write(texts[i])));
   }
 }catch(e){if(lang===locale()&&e.name!=='AbortError')failed=true;}
 finally{--pending;banner();}
}
export function observeContent(){
 if(!document.body||!globalThis.MutationObserver)return;
 const observer=new MutationObserver(changes=>{for(const m of changes){
   if(m.type==='childList'){for(const n of m.addedNodes)queue(n);}else queue(m.target);
 }});
 observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','placeholder','alt']});
 window.addEventListener('compi:languagechange',()=>{failed=false;queue(document.body);});
 queue(document.body);
}

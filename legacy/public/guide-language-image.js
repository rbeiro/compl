import {locale} from './i18n.js';
import {translateTexts} from './content-language.js';
let readLabels;
const labelRequests=new Map(),pictures=new Map();
export function configureGuideLabels(rpc){readLabels=row=>rpc('compi_arts_image_labels',{h:row.hotel_key,o:row.outlet_key,g:row.guide_key});}
export function resetGuideImages(){for(const url of [...pictures.keys()])releaseGuideURL(url);labelRequests.clear();}
async function metadata(row){
 if(!readLabels||!row)return null;
 const id=[row.hotel_key,row.outlet_key,row.guide_key].join('/');
 if(!labelRequests.has(id))labelRequests.set(id,readLabels(row).catch(e=>{labelRequests.delete(id);throw e;}));
 return labelRequests.get(id);
}
const signature=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
export async function translatedPicture(blob,row,lang){
 if(lang==='es'||!blob?.size)return blob;
 const meta=await metadata(row);if(!meta?.labels?.length||meta.sha!==await signature(blob))return blob;
 const labels=meta.labels,words=await translateTexts(labels.map(x=>x.s),lang);
 const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');
 canvas.width=bitmap.width;canvas.height=bitmap.height;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);bitmap.close();
 for(const [i,item] of labels.entries()){
   if(words[i]===item.s)continue;
   const [x,y,w,h]=item.box.map((v,k)=>Math.round(v*(k%2?canvas.height:canvas.width)));
   if(w<4||h<4)continue;
   // Sample a light edge beside the original label, retaining the photographed dish and arrows.
   const left=Math.max(0,x-2),top=Math.max(0,y-2),width=Math.min(canvas.width-left,w+4),height=Math.min(canvas.height-top,h+4);
   const pixels=ctx.getImageData(left,top,width,height).data,samples=[];
   for(let k=0;k<width;k+=Math.max(1,Math.floor(width/30))){for(const dy of [0,height-1]){const off=(width*dy+k)*4;samples.push([...pixels.slice(off,off+3)]);}}
   samples.sort((a,b)=>a.reduce((s,n)=>s+n,0)-b.reduce((s,n)=>s+n,0));
   const rgb=samples[Math.floor(samples.length*.65)],light=rgb.reduce((s,n)=>s+n,0)>400;
   ctx.fillStyle='rgb('+rgb.join(',')+')';ctx.fillRect(left,top,width,height);
   ctx.direction=lang==='ar'?'rtl':'ltr';ctx.textAlign='center';ctx.textBaseline='middle';
   ctx.fillStyle=light?'#222':'#fff';ctx.font='500 '+Math.max(8,Math.round(h*1.08))+'px Arial, sans-serif';
   ctx.fillText(words[i],x+w/2,y+h/2,w+2);
 }
 const out=await new Promise(resolve=>canvas.toBlob(resolve,blob.type,0.96));return out||blob;
}
export function guideURL(blob,row){
 const url=URL.createObjectURL(blob);pictures.set(url,{blob,row,versions:new Map()});return url;
}
export function releaseGuideURL(url){
 const entry=pictures.get(url);pictures.delete(url);
 if(entry)for(const promise of entry.versions.values())promise.then(u=>{if(u!==url)URL.revokeObjectURL(u);},()=>{});
 URL.revokeObjectURL(url);
}
async function paint(img){
 const original=pictures.has(img.src)?img.src:img.dataset.guideOriginal,entry=pictures.get(original);
 if(!entry)return;img.dataset.guideOriginal=original;
 const lang=locale();
 if(lang==='es'){if(img.src!==original)img.src=original;return;}
 if(!entry.versions.has(lang))entry.versions.set(lang,translatedPicture(entry.blob,entry.row,lang).then(b=>b===entry.blob?original:URL.createObjectURL(b)).catch(e=>{entry.versions.delete(lang);throw e;}));
 try{const url=await entry.versions.get(lang);if(img.isConnected&&img.dataset.guideOriginal===original&&locale()===lang&&img.src!==url)img.src=url;}catch{/* Retain the approved original while language resources are unavailable. */}
}
if(typeof Worker!=='undefined'&&document.body){
 new MutationObserver(changes=>{for(const c of changes){if(c.type==='attributes')void paint(c.target);else for(const n of c.addedNodes){
   if(n.nodeType!==1)continue;if(n.matches('img'))void paint(n);else for(const img of n.querySelectorAll('img'))void paint(img);
 }}}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
 window.addEventListener('compi:languagechange',()=>{for(const img of document.images)void paint(img);});
}

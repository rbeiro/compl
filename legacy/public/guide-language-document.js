import {unzipSync,zipSync,strFromU8,strToU8} from './vendor/zip/zip.js';
import {translateTexts,useApproved} from './content-language.js';
import {translatedPicture} from './guide-language-image.js';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const elements=(n,name)=>Array.from(n.getElementsByTagNameNS('*',name));
const wordTexts=p=>Array.from(p.getElementsByTagNameNS(W,'t')).filter(t=>{let n=t.parentElement;while(n&&n!==p){if(n.localName==='p')return false;n=n.parentElement;}return n===p;});
const xml=b=>{const s=strFromU8(b);if(/<!DOCTYPE|<!ENTITY/i.test(s))throw Error('Invalid document');const d=new DOMParser().parseFromString(s,'application/xml');if(d.getElementsByTagName('parsererror').length)throw Error('Invalid document');return d;};
const mediaType=n=>/\.png$/i.test(n)?'image/png':'image/jpeg';
const cache=new Map();
export function resetDocumentLanguages(){cache.clear();}
async function localize(blob,row,lang){
 if(blob.size>25*1024*1024)throw Error('Guide too large');
 let bytes=0;
 const files=unzipSync(new Uint8Array(await blob.arrayBuffer()),{filter:f=>{
   bytes+=f.originalSize;if(f.originalSize>32*1024*1024||bytes>100*1024*1024)throw Error('Guide too large');return true;
 }});
 const parts=new Map(),groups={es:[],en:[]},altFields=[];
 for(const name of Object.keys(files)){
   if(!/^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(name))continue;
   const doc=xml(files[name]);parts.set(name,doc);
   const entries=elements(doc,'p').map(p=>({p,runs:wordTexts(p)})).filter(e=>e.runs.length);
   const text=e=>e.runs.map(n=>n.textContent).join('').trim();
   const titleIndex=entries.findIndex(e=>text(e).toLocaleLowerCase()===row.title?.toLocaleLowerCase());
   if(titleIndex>=0&&entries[titleIndex+1]&&!/^\d/.test(text(entries[titleIndex+1])))useApproved(text(entries[titleIndex]),text(entries[titleIndex+1]));
   for(const [i,entry] of entries.entries()){
     const raw=text(entry);if(!raw)continue;
     const code=raw.match(/^(EN|ES|Original)\s+(.+)$/su);
     const from=code?.[1]==='EN'||(titleIndex>=0&&i===titleIndex+1&&!/^\d/.test(raw))?'en':'es';
     const source=code?code[2].trim():raw;
     groups[from].push({...entry,source,prefix:code?lang.toUpperCase()+'  ':''});
   }
   for(const prop of elements(doc,'docPr'))for(const attr of ['title','descr']){
     const s=prop.getAttribute(attr);if(s&&!/^\S+\.(png|jpg)$/i.test(s))altFields.push([prop,attr,s]);
   }
   for(const field of elements(doc,'lang')){field.setAttributeNS(W,'w:val',lang);field.setAttributeNS(W,'w:bidi',lang);}
 }
 for(const [from,entries] of Object.entries(groups)){
   const result=await translateTexts(entries.map(x=>x.source),lang,from);
   for(const [i,{p,runs,prefix}] of entries.entries()){
     runs[0].textContent=prefix+result[i];for(const r of runs.slice(1))r.textContent='';
     if(lang==='ar'){
       let pr=Array.from(p.children).find(n=>n.localName==='pPr');if(!pr){pr=p.ownerDocument.createElementNS(W,'w:pPr');p.prepend(pr);}
       if(!elements(pr,'bidi').length)pr.append(p.ownerDocument.createElementNS(W,'w:bidi'));
     }
   }
 }
 const alt=await translateTexts(altFields.map(x=>x[2]),lang);altFields.forEach(([n,a],i)=>n.setAttribute(a,alt[i]));
 for(const [name,part] of parts)files[name]=strToU8(new XMLSerializer().serializeToString(part));
 for(const name of Object.keys(files).filter(n=>/^word\/media\/[^/]+\.(?:jpe?g|png)$/i.test(n))){
   const original=new Blob([files[name]],{type:mediaType(name)}),localized=await translatedPicture(original,row,lang);
   if(localized!==original)files[name]=new Uint8Array(await localized.arrayBuffer());
 }
 return {files,parts,lang};
}
async function makePdf({files,parts,lang}){
 const {jsPDF}=await import('./vendor/pdf/pdf.js');
 const pdf=new jsPDF({unit:'pt',format:'a4',compress:true}),width=1190,height=1684,margin=85,max=width-2*margin;
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext('2d'),rtl=lang==='ar';let y=margin,pages=0;
 function blank(){ctx.fillStyle='white';ctx.fillRect(0,0,width,height);y=margin;}
 function finish(){if(pages++)pdf.addPage();pdf.addImage(canvas,'JPEG',0,0,595.28,841.89,undefined,'FAST');blank();}
 function room(n){if(y+n>height-margin&&y>margin)finish();}
 function style(size,bold){ctx.font=(bold?'600 ':'400 ')+size+'px Arial, sans-serif';ctx.direction=rtl?'rtl':'ltr';ctx.textAlign=rtl?'right':'left';ctx.textBaseline='top';ctx.fillStyle='#19392c';}
 function wrap(text,w,size,bold=false){
   style(size,bold);const a=[];let line='';
   for(const token of text.split(/\s+/u)){const next=line?line+' '+token:token;if(line&&ctx.measureText(next).width>w){a.push(line);line=token;}else line=next;}if(line)a.push(line);return a;
 }
 async function part(name){
  const doc=parts.get(name);if(!doc)return;
  const relPath=name.replace(/\/([^/]+)$/,'/_rels/$1.rels'),links=new Map();
  if(files[relPath])for(const r of elements(xml(files[relPath]),'Relationship'))if(!r.hasAttribute('TargetMode')&&/^media\/[\w. -]+$/u.test(r.getAttribute('Target')||''))links.set(r.getAttribute('Id'),'word/'+r.getAttribute('Target'));
  async function images(el){
    for(const n of elements(el,'blip')){
      const key=links.get(n.getAttributeNS(REL,'embed'));if(!files[key])continue;
      const bitmap=await createImageBitmap(new Blob([files[key]],{type:mediaType(key)}));
      const small=name.includes('header')||name.includes('footer')||/\bqr\b/i.test(elements(el,'docPr')[0]?.getAttribute('descr')||'');
      const scale=Math.min(max/bitmap.width,(small?95:470)/bitmap.height,1),w=bitmap.width*scale,h=bitmap.height*scale;
      room(h+12);ctx.drawImage(bitmap,(width-w)/2,y,w,h);bitmap.close();y+=h+12;
    }
  }
  async function table(tbl){
    for(const [index,tr] of Array.from(tbl.children).filter(e=>e.localName==='tr').entries()){
      const cells=Array.from(tr.children).filter(e=>e.localName==='tc');if(!cells.length)continue;
      if(elements(tr,'blip').length)await images(tr);
      const cw=max/cells.length;const lines=cells.map(c=>elements(c,'p').flatMap(p=>wrap(wordTexts(p).map(n=>n.textContent).join(''),cw-20,20,index===0)));
      const count=Math.max(1,...lines.map(a=>a.length));let offset=0;
      while(offset<count){
        room(Math.min(count-offset,5)*26+12);
        const take=Math.min(count-offset,Math.max(1,Math.floor((height-margin-y-12)/26))),h=take*26+12;
        for(let i=0;i<cells.length;i++){
          const x=margin+(rtl?cells.length-1-i:i)*cw;
          ctx.fillStyle=index===0?'#e5eee6':'#ffffff';ctx.fillRect(x,y,cw,h);ctx.strokeStyle='#c9d7cb';ctx.strokeRect(x,y,cw,h);
          style(20,index===0);(lines[i]||[]).slice(offset,offset+take).forEach((s,j)=>ctx.fillText(s,rtl?x+cw-10:x+10,y+6+j*26,cw-20));
        }
        y+=h;offset+=take;if(offset<count)finish();
      }
    }
    y+=10;
  }
  const parent=elements(doc,'body')[0]||doc.documentElement;
  for(const e of parent.children){
    if(e.localName==='tbl'){await table(e);continue;}
    if(e.localName!=='p')continue;
    await images(e);const text=wordTexts(e).map(n=>n.textContent).join('').trim();if(!text)continue;
    const heading=/^\d\d\s{2}|^\d\d\s?[·/]/u.test(text)||text===text.toLocaleUpperCase()&&text.length<100;
    const size=heading?27:22,step=size*1.42;for(const line of wrap(text,max,size,heading)){
      room(step);style(size,heading);ctx.fillText(line,rtl?width-margin:margin,y,max);y+=step;
    }y+=8;
  }
 }
 blank();
 for(const name of [...parts.keys()].filter(n=>n.includes('header')))await part(name);
 await part('word/document.xml');
 for(const name of [...parts.keys()].filter(n=>/footer|endnotes|footnotes/.test(n)))await part(name);
 if(y>margin||!pages)finish();return pdf.output('blob');
}
export async function localizedDocument(row,fmt,signal,read,lang){
 const {blob,revision}=await read(row,'docx',signal);signal?.throwIfAborted();
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
 const key=[row.hotel_key,row.outlet_key,row.guide_key,hash,lang].join('/');let entry=cache.get(key);
 if(!entry){if(cache.size>=2)cache.delete(cache.keys().next().value);entry={data:localize(blob,row,lang)};cache.set(key,entry);}
 try{const data=await entry.data;signal?.throwIfAborted();
   if(!entry[fmt])entry[fmt]=fmt==='pdf'?makePdf(data):Promise.resolve(new Blob([zipSync(data.files,{level:1})],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));
   const output=await entry[fmt];signal?.throwIfAborted();return {blob:output,revision};
 }catch(err){if(err.name!=='AbortError')cache.delete(key);throw err;}
}

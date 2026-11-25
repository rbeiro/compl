import JSZip from 'jszip';
import {PDFDocument, PDFName, PDFRef, PDFRawStream, PDFDict, PDFArray, PDFString} from 'pdf-lib';
import {Buffer} from 'node:buffer';
import {inflateSync} from 'node:zlib';
import {palette} from './palette.js';
import {logoCanvas,qrCanvas} from './brand-assets.js';
import {emptyHeaderDrawing} from './legacy-drawing.js';

export class UnsupportedLegacyTemplate extends Error {
  constructor() { super('Este archivo no tiene una plantilla de CompI reconocible para actualizar su identidad visual.'); this.name='UnsupportedLegacyTemplate'; }
}
const required = condition => { if (!condition) throw new UnsupportedLegacyTemplate(); };
const colorPattern = /^[0-9a-f]{6}$/i;
const headerPart='word/header1.xml';
const headerRels='word/_rels/header1.xml.rels';
const oldColors={
  arts:['345B6F','263338','667177','717A7D','D9DFE1','EDF0F2','E7EBEE','F3F5F6'],
  bruma:['833F28','382720','67534A','725F54','D6C3B7','F6EBE2','F1E1D5','FBF5EF'],
  neutral:['46494A','282A2A','5B5F60','686C6D','D6D7D7','EFEFEF','E7E8E8','F6F6F6'],
};
const colorMap=(source,target)=>new Map(oldColors.arts.map((key,i)=>[source[i].toUpperCase(),target[key].toUpperCase()]));
function markedXml(xml,target){
  return xml.replace(/(<!--CompIColor:([a-f\d]{6})-->\s*)(<[^<>]+>)/gi,(all,marker,key,tag)=>{
    const next=target[key.toUpperCase()];
    required(next);
    if(tag.startsWith('<v:'))return marker+tag.replace(/((?:fillcolor|strokecolor)="#?)[a-f\d]{6}"/gi,'$1'+next+'"');
    return marker+tag.replace(/(\b(?:w:val|w:fill|w:color|val)=")[a-f\d]{6}"/i,'$1'+next+'"');
  });
}
const styleKey = source => source.match(/<!--CompIAccent:([\da-f]{6})-->/i)?.[1]?.toUpperCase();
function oldPalette(source) {
  const styles=[...source.matchAll(/<w:(?:color|bottom)\b[^>]*\bw:(?:val|color)="([\da-f]{6})"/gi)].map(m=>m[1].toUpperCase());
  return Object.values(oldColors).find(colors=>styles.includes(colors[0]));
}
const wordText = xml => xml.replace(/<[^>]+>/g,'').replace(/\s+/g,' ');
function colorXml(xml, colors) {
  // Word interprets color on these explicit structural attributes. User text and opaque media stay verbatim.
  return xml.replace(/<[^!?][^<>]*>/g,tag=>tag.replace(/((?:w:(?:val|fill|color)|val)=")([a-f\d]{6})(")/gi,(all,prefix,color,suffix)=>{
    const next=colors.get(color.toUpperCase());
    return next && color.toUpperCase()!==next ? prefix+next+suffix : all;
  }));
}
function getAttr(tag,name) {return tag.match(new RegExp('(?:^|\\s)'+name+'="([^"]*)"'))?.[1];}

async function word(bytes, brand, target, options) {
  const zip=await JSZip.loadAsync(bytes);
  const getText=async part=>zip.file(part)?.async('string');
  let header=await getText(headerPart);
  if(options.onlyMaster && !header?.includes('<!--CompIMaster:true-->'))return bytes;
  const logo=Buffer.from(await logoCanvas(brand.logo_png));
  const body=await getText('word/document.xml'), footer=await getText('word/footer1.xml');
  required(header && body && footer);
  const marker=styleKey(header);
  const sourceColors=marker?oldColors.arts.map(key=>palette(marker)[key]):oldPalette(header);
  const guide=wordText(body);
  required(sourceColors && guide.includes('MANUAL OPERATIVO') && guide.includes('Emplatado paso a paso') &&
    wordText(footer).includes('USO INTERNO') && !zip.file('word/header2.xml'));
  const colors=colorMap(sourceColors,target);
  const relationXml=await getText(headerRels) || '';
  const drawings=header.match(/<w:drawing\b[^>]*>[\s\S]*?<\/w:drawing>/g)||[];
  required(drawings.length<=1);
  let media, changed=false;
  if(drawings.length) {
    const imageId=drawings[0].match(/<a:blip\b[^>]*\br:embed="([^"]+)"/)?.[1];
    const extent=drawings[0].match(/<wp:extent\b[^>]*>/)?.[0] || '';
    required(imageId && getAttr(extent,'cx')==='1224000' && getAttr(extent,'cy')==='475800');
    const rel=(relationXml.match(/<Relationship\s[^>]+>/g)||[]).find(tag=>getAttr(tag,'Id')===imageId);
    const dest=rel && getAttr(rel,'Target');
    required(dest && /^media\/[\w.-]+\.png$/i.test(dest) && getAttr(rel,'Type')?.endsWith('/image'));
    media='word/'+dest;
    const previous=await zip.file(media)?.async('uint8array');
    required(previous);
    if(!Buffer.from(previous).equals(logo)) {
      // Some Word tools change image2/image3 numbering. Resolve the actual header relationship above.
      zip.file(media,logo); changed=true;
      const drawing=drawings[0].replace(/\bdescr="[^"]*"/g,'descr="CompI brand logo"');
      header=header.replace(drawings[0],()=>drawing);
    }
  } else if(brand.logo_png) {
    required(!relationXml && !zip.file('word/media/compi-brand.png'));
    const firstCell=header.match(/<w:tc>[\s\S]*?<\/w:tc>/)?.[0];
    required(firstCell && !wordText(firstCell).trim() && firstCell.includes('</w:p>'));
    header=header.replace(firstCell,()=>firstCell.replace('</w:p>','<w:r>'+emptyHeaderDrawing+'</w:r></w:p>'));
    zip.file('word/media/compi-brand.png',logo);
    zip.file(headerRels,'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="compiBrand" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/compi-brand.png"/></Relationships>');
    changed=true;
  }
  // Only retint the decorative «insert QR» placeholder issued by this generator.
  // A real QR in a manually imported or historical sheet is document content.
  if(marker && marker!==brand.accent && /Id="rIdCompIQR"[^>]*Target="media\/image1.png"/.test(await getText('word/_rels/document.xml.rels')||'')){
    zip.file('word/media/image1.png',qrCanvas(brand.accent),{createFolders:false});changed=true;
  }
  const structural=['word/document.xml',headerPart,'word/footer1.xml','word/styles.xml','word/theme/theme1.xml'];
  for(const part of structural){
    const original=await getText(part); if(!original)continue;
    const source=part===headerPart?header:original;
    let content=marker?markedXml(source,target):colorXml(source,colors);
    if(part===headerPart && marker)content=content.replace(/<!--CompIAccent:[a-f\d]{6}-->/i,'<!--CompIAccent:'+brand.accent+'-->').replace('<!--CompIMaster:true-->','');
    if(content!==original) {zip.file(part,content);changed=true;}
  }
  return changed?zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:3}}):bytes;
}

const n=PDFName.of;
const pdfHex=(r,g,b)=>[r,g,b].map(c=>Math.round(Number(c)*255).toString(16).padStart(2,'0')).join('').toUpperCase();
const pdfRgb=hex=>[0,2,4].map(i=>Number((parseInt(hex.slice(i,i+2),16)/255).toFixed(10))).join(' ');
function contentText(stream,budget) {
  required(stream instanceof PDFRawStream);
  const raw=stream.getContents(),filter=stream.dict.get(n('Filter'));
  let data=raw;
  if(filter){
    required(String(filter)==='/FlateDecode' && !stream.dict.has(n('DecodeParms')));
    data=inflateSync(raw,{maxOutputLength:Math.min(budget.left,8*1024*1024)});
  }
  budget.left-=data.length;required(budget.left>0);
  const text=Buffer.from(data).toString('latin1');
  required(!/(?:^|\s)BI(?:\s|$)/.test(text));
  return text;
}
// Colors and placements in our two historical PDF writers use hex text, with one command per line.
// Do not match operators inside a PDF string or comment, including user-supplied parenthesized text.
function replaceColorCommands(text,colors) {
  return text.replace(/%[^\r\n]*|\((?:\\[\s\S]|[^()\\])*\)|<[a-f\d\s]*>|(?:^|(?<=[\s]))([.\d]+)\s+([.\d]+)\s+([.\d]+)\s+(rg|RG)\b/gim,
    (all,r,g,b,op)=>{
      if(!op)return all;
      const old=pdfHex(r,g,b),next=colors.get(old);
      return next && next!==old?pdfRgb(next)+' '+op:all;
    });
}
function markedPdf(text,target){
  return text.replace(/(\/CompIColor([a-f\d]{6})\s+BMC\b)([\s\S]*?)(\bEMC\b)/gi,(all,label,key,paint,end)=>{
    const next=target[key.toUpperCase()]; required(next);
    const changed=paint.replace(/(?:^|(?<=\s))([.\d]+)\s+([.\d]+)\s+([.\d]+)\s+(rg|RG)\b/g,
      (command,r,g,b,op)=>pdfHex(r,g,b)===next?command:pdfRgb(next)+' '+op);
    return label+changed+end;
  });
}
function pdfLayout(doc, text, page, mark){
  if(mark && colorPattern.test(mark))return {kind:'managed',colors:oldColors.arts.map(key=>palette(mark)[key])};
  const {width,height}=page.getSize();required(Math.abs(width-595)<1 && Math.abs(height-842)<1);
  if(text.includes('42.5 778.239 m') && text.includes('552.8 778.239 l S') && text.includes('42.5 33.339 m')){
    const m=text.match(/([.\d]+) ([.\d]+) ([.\d]+) RG\s+q 1.1 w 0 J 1 j\s+42.5 778.239 m/);
    const scheme=m && Object.values(oldColors).find(s=>s[0]===pdfHex(m[1],m[2],m[3]));
    required(scheme);
    return {kind:'writer',colors:scheme};
  }
  if(text.includes('42.5 16.55 133.3 42.75 re') && text.includes('175.75 16.55 377.05 42.75 re') &&
      text.includes('42.5 58.73 m') && text.includes('42.5 808.25 510.3 0.48 re') &&
      /0\.204 0\.357 0\.435 RG/.test(text)){
    return {kind:'wps',colors:oldColors.arts};
  }
  // Check both masthead and footer rules of the retired JS renderer. They appeared on every page.
  required(text.includes('44 777 m\n44 777 m\n551 777 l') && text.includes('44 47 m\n44 47 m\n551 47 l') && doc.getProducer()?.startsWith('pdf-lib'));
  const m=text.match(/([.\d]+) ([.\d]+) ([.\d]+) RG\s+0.8 w\s+\[\] 0 d\s+44 777 m/);
  required(m);
  const hex=pdfHex(m[1],m[2],m[3]);
  required(['265973','833F28','46494A'].includes(hex));
  return {kind:'flow',accent:hex};
}
const writerSlot=/q 96\.4 0 0 37\.45 42\.5 783\.139 cm\s+\/(\S+) Do\b/;
const wpsSlot=/q 96\.36 0 0 -37\.44 42\.48 54 cm\s+\/(\S+) Do\b/;
const flowSlot=/1 0 0 1 44 785 cm\s+1 0 0 1 0 0 cm\s+93 0 0 36 0 0 cm\s+1 0 0 1 0 0 cm\s+\/(\S+) Do\b/;
function logoReference(page,text,kind,context){
  const resources=page.node.Resources()?.lookup(n('XObject'));
  if(kind==='managed'){
    required(resources instanceof PDFDict);
    const found=resources.entries().filter(([name,ref])=>name.toString()==='/CompIBrandLogo' || context.lookup(ref)?.dict?.get(n('CompIBrandLogo'))?.toString()==='true');
    required(found.length===1 && text.includes(found[0][0].toString()+' Do'));
    return found[0][1];
  }
  const name=text.match(kind==='writer'?writerSlot:kind==='wps'?wpsSlot:flowSlot)?.[1];
  if(!name){required(kind==='flow' && text.includes('1 0 0 1 44 810 Tm'));return null;}
  const ref=resources?.get(n(name));
  required(ref instanceof PDFRef && context.lookup(ref)?.dict?.get(n('Subtype'))===n('Image'));
  return ref;
}
function dependsOn(obj,reference){
  if(obj instanceof PDFRef)return obj===reference;
  if(obj instanceof PDFArray)return obj.asArray().some(entry=>dependsOn(entry,reference));
  if(obj instanceof PDFDict)return obj.entries().some(([,entry])=>dependsOn(entry,reference));
  if(obj instanceof PDFRawStream)return dependsOn(obj.dict,reference);
  return false;
}
async function pdf(bytes,brand,target,options){
  const doc=await PDFDocument.load(bytes,{updateMetadata:false});
  const {context}=doc, marker=doc.catalog.get(n('CompIBrandAccent'))?.decodeText?.();
  if(options.onlyMaster && doc.catalog.get(n('CompIMaster'))?.toString()!=='true')return bytes;
  const logo=Buffer.from(await logoCanvas(brand.logo_png));
  const budget={left:24*1024*1024}, logoRefs=new Set(),qrRefs=new Set(),changedStreams=new Map(),empty=[];
  let layoutKind;
  for(const page of doc.getPages()){
    const contents=page.node.get(n('Contents')),value=context.lookup(contents);
    const refs=value instanceof PDFArray?value.asArray():[contents];
    required(refs.length && refs.every(ref=>ref instanceof PDFRef));
    const streams=refs.map(ref=>contentText(context.lookup(ref),budget));
    const text=streams.join('\n');
    const layout=pdfLayout(doc,text,page,marker);
    required(!layoutKind || layoutKind===layout.kind);layoutKind=layout.kind;
    const ref=logoReference(page,text,layout.kind,context);
    if(ref)logoRefs.add(ref);else empty.push(page);
    if(marker && marker!==brand.accent){
      const objects=page.node.Resources()?.lookup(n('XObject'));
      if(objects instanceof PDFDict)for(const [,imageRef] of objects.entries()){
        const dict=context.lookup(imageRef)?.dict;
        if(dict?.get(n('CompIBrandQR'))?.toString()==='true' && dict.get(n('Subtype'))===n('Image'))qrRefs.add(imageRef);
      }
    }
    const colors=layout.kind==='flow'?new Map([[layout.accent,target['345B6F']]]):colorMap(layout.colors,target);
    streams.forEach((stream,i)=>{
      const next=marker?markedPdf(stream,target):replaceColorCommands(stream,colors);
      if(next!==stream)changedStreams.set(refs[i],next);
    });
  }
  required(logoRefs.size<=1);
  const newLogo=await doc.embedPng(logo);
  await doc.flush();
  const newObj=context.lookup(newLogo.ref),oldMasks=new Set();
  let changed=changedStreams.size>0;
  for(const ref of logoRefs){
    const old=context.lookup(ref),mask=old.dict.get(n('SMask'));
    const equalStream=(a,b)=>a instanceof PDFRawStream && b instanceof PDFRawStream && Buffer.from(a.contents).equals(Buffer.from(b.contents));
    const newMask=newObj.dict.get(n('SMask'));
    if(equalStream(old,newObj) && ((!mask && !newMask) || equalStream(context.lookup(mask),context.lookup(newMask))))continue;
    if(mask instanceof PDFRef)oldMasks.add(mask);
    if(layoutKind==='managed')newObj.dict.set(n('CompIBrandLogo'),context.obj(true));
    context.assign(ref,newObj);changed=true;
  }
  if(qrRefs.size){
    required(qrRefs.size===1);
    const image=await doc.embedPng(qrCanvas(brand.accent));await doc.flush();
    const replacement=context.lookup(image.ref),qrRef=[...qrRefs][0];
    const mask=context.lookup(qrRef).dict.get(n('SMask'));if(mask instanceof PDFRef)oldMasks.add(mask);
    replacement.dict.set(n('CompIBrandQR'),context.obj(true));
    context.assign(qrRef,replacement);context.delete(image.ref);changed=true;
  }
  if(brand.logo_png)for(const page of empty){
    // The old neutral PDF placed the hotel name at the left of the header.
    // This reserved top margin above that text can accept a logo without moving or occluding it.
    page.drawImage(newLogo,{x:504,y:821,width:47,height:18.25});changed=true;
  }
  if(marker && doc.catalog.has(n('CompIMaster'))){doc.catalog.delete(n('CompIMaster'));changed=true;}
  if(!changed)return bytes;
  for(const [ref,text] of changedStreams)context.assign(ref,context.flateStream(Buffer.from(text,'latin1')));
  for(const mask of oldMasks)if(!context.enumerateIndirectObjects().some(([,obj])=>dependsOn(obj,mask)))context.delete(mask);
  if(!empty.length)context.delete(newLogo.ref);
  if(marker){
    doc.catalog.set(n('CompIBrandAccent'),PDFString.of(brand.accent));
    const subject=doc.getSubject();if(subject?.endsWith(marker))doc.setSubject(subject.slice(0,-marker.length)+brand.accent);
  }
  return doc.save({addDefaultPage:false,useObjectStreams:false});
}

// The caller has already validated the source guide and resolved this brand under the hotel's authorization.
export async function rebrandLegacy(format,bytes,brand,options={}) {
  required(brand && colorPattern.test(brand.accent));
  const accent=brand.accent.toUpperCase();
  if(format==='docx')return word(bytes,{...brand,accent},palette(accent),options);
  if(format==='pdf')return pdf(bytes,{...brand,accent},palette(accent),options);
  throw new UnsupportedLegacyTemplate();
}


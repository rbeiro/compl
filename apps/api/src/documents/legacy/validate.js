import { Buffer } from 'node:buffer';
import { inflateRawSync, inflateSync } from 'node:zlib';
import sax from 'sax';
import { PDFParser, PDFName, PDFRef, PDFDict, PDFRawStream, PDFArray, PDFNumber } from 'pdf-lib';

const MiB = 1024 * 1024;
export const MAX_GUIDE_BYTES = 10 * MiB;
const MAX_UNPACKED = 48 * MiB;
const MAX_XML = 8 * MiB;

export class InvalidGuideFile extends Error {}
function requireFile(ok, reason) {
  if (!ok) throw new InvalidGuideFile(reason);
}

const zipError = 'El Word no es un paquete DOCX válido.';
const sizeError = 'El documento supera los límites de tamaño o complejidad permitidos.';
const contentError = 'La ficha contiene contenido activo, incrustado o vinculado que no se permite.';
const pdfError = 'El PDF está dañado, cifrado o tiene una estructura no admitida.';

const crcTable = new Uint32Array(256).map((_,index) => {
  let crc=index;
  for (let j=0;j<8;j++) crc=(crc&1) ? 0xedb88320^(crc>>>1) : crc>>>1;
  return crc>>>0;
});
function crc32(data) {
  let crc=0xffffffff;
  for (const byte of data) crc=crcTable[(crc^byte)&255]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}
const utf8 = new TextDecoder('utf-8',{fatal:true});
function xmlText(data) {
  const [a,b]=data;
  if (a===0xff && b===0xfe) return new TextDecoder('utf-16le',{fatal:true}).decode(data);
  if (a===0xfe && b===0xff) return new TextDecoder('utf-16be',{fatal:true}).decode(data);
  return utf8.decode(data);
}

function safeZipPath(name) {
  const path=decodeURIComponent(name);
  return path.length<=512 && !/[\\:\x00-\x1f\x7f?#]/.test(path) &&
    !path.startsWith('/') && !path.includes('//') &&
    !path.split('/').some(part=>part==='.'||part==='..') &&
    !/%(?:2f|5c|25)/i.test(name);
}

function checkZipExtras(buf,start,length) {
  const end=start+length;
  while(start<end) {
    requireFile(start+4<=end,zipError);
    const field=buf.readUInt16LE(start),size=buf.readUInt16LE(start+2);
    // Accept timestamp, alignment and UID/GID fields. Name overrides, ZIP64,
    // and other alternate representations require a different ZIP profile.
    requireFile([0x5455,0x000a,0x5855,0x7875,0xd935].includes(field) && start+4+size<=end,zipError);
    start+=4+size;
  }
}

// File sizes in the directory are untrusted. Limit the inflater itself and check
// each local record so alternative ZIP readers cannot select different parts.
function readZip(bytes, visit) {
  const buf=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  requireFile(buf.length>=22 && buf.readUInt32LE(0)===0x04034b50,zipError);
  let end=buf.length-22;
  for (;end>=Math.max(0,buf.length-65557);end--) {
    if (buf.readUInt32LE(end)===0x06054b50 && end+22+buf.readUInt16LE(end+20)===buf.length) break;
  }
  requireFile(end>=0 && buf.readUInt32LE(end)===0x06054b50 && buf.readUInt32LE(end+4)===0,zipError);
  const entries=buf.readUInt16LE(end+10),directory=buf.readUInt32LE(end+16);
  requireFile(entries>0 && entries<=768 && buf.readUInt16LE(end+8)===entries,sizeError);
  requireFile(directory+buf.readUInt32LE(end+12)===end,zipError);
  const names=new Set(),parts=new Set(),ranges=[];
  let cursor=directory,total=0;
  for(let i=0;i<entries;i++) {
    requireFile(cursor+46<=end && buf.readUInt32LE(cursor)===0x02014b50,zipError);
    const flags=buf.readUInt16LE(cursor+8),method=buf.readUInt16LE(cursor+10);
    const crc=buf.readUInt32LE(cursor+16),compressed=buf.readUInt32LE(cursor+20),size=buf.readUInt32LE(cursor+24);
    const n=buf.readUInt16LE(cursor+28),l=buf.readUInt32LE(cursor+30),comment=buf.readUInt16LE(cursor+32);
    const local=buf.readUInt32LE(cursor+42),unixType=buf.readUInt32LE(cursor+38)>>>28;
    requireFile([0,4,8].includes(unixType),zipError);
    requireFile((flags & ~0x80e)===0 && (method===0||method===8) && buf.readUInt16LE(cursor+34)===0,zipError);
    requireFile(cursor+46+n+l+comment<=end && local+30<=directory && buf.readUInt32LE(local)===0x04034b50,zipError);
    const nameBytes=buf.subarray(cursor+46,cursor+46+n),name=utf8.decode(nameBytes);
    const normalized=decodeURIComponent(name).normalize('NFC').toLowerCase();
    requireFile(name.length && safeZipPath(name) && !names.has(normalized),zipError);names.add(normalized);
    const extra=buf.readUInt16LE(local+28),dataStart=local+30+n+extra,dataEnd=dataStart+compressed;
    requireFile(dataEnd<=directory && buf.readUInt16LE(local+6)===flags && buf.readUInt16LE(local+8)===method &&
      buf.readUInt16LE(local+26)===n && buf.subarray(local+30,local+30+n).equals(nameBytes),zipError);
    checkZipExtras(buf,cursor+46+n,l);checkZipExtras(buf,local+30+n,extra);
    let recordEnd=dataEnd;
    if (flags&8) {
      if (buf.readUInt32LE(recordEnd)===0x08074b50) recordEnd+=4;
      requireFile(recordEnd+12<=directory && buf.readUInt32LE(recordEnd)===crc &&
        buf.readUInt32LE(recordEnd+4)===compressed && buf.readUInt32LE(recordEnd+8)===size,zipError);
      recordEnd+=12;
    } else requireFile(buf.readUInt32LE(local+14)===crc && buf.readUInt32LE(local+18)===compressed &&
      buf.readUInt32LE(local+22)===size,zipError);
    ranges.push([local,recordEnd]);cursor+=46+n+l+comment;
    const xml=/\.(xml|rels)$/i.test(name);
    requireFile(size<=(xml?MAX_XML:MAX_GUIDE_BYTES) && (total+=size)<=MAX_UNPACKED,sizeError);
    const stored=buf.subarray(dataStart,dataEnd);
    const data=method===0 ? stored : inflateRawSync(stored,{maxOutputLength:Math.max(1,size)});
    requireFile(data.length===size && crc32(data)===crc,zipError);
    if(name.endsWith('/')) {requireFile(size===0,zipError);continue;}
    parts.add(name);visit(name,data,xml);
  }
  requireFile(cursor===end,zipError);
  ranges.sort((a,b)=>a[0]-b[0]);
  let offset=0;for (const [start,stop] of ranges) {requireFile(start===offset,zipError);offset=stop;}
  requireFile(offset===directory,zipError);
  return parts;
}

const wordNS=new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main','http://purl.oclc.org/ooxml/wordprocessingml/main']);
const officeRel=new Set(['http://schemas.openxmlformats.org/officeDocument/2006/relationships/','http://purl.oclc.org/ooxml/officeDocument/relationships/']);
const typesNS='http://schemas.openxmlformats.org/package/2006/content-types';
const relsNS='http://schemas.openxmlformats.org/package/2006/relationships';
const docType='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const badPart=/(?:^|\/)(?:embeddings|activex|customui|macrosheets)(?:\/|$)|(?:vbaproject|vbadata)|\.(?:exe|dll|vbs|ps1|js|htm|html|mht|bin|svg)$/i;
const badType=/macroenabled|vbaproject|activex|oleobject|vba|javascript|text\/html|svg\+xml/i;
const badRel=/\/(?:oleObject|package|attachedTemplate|control|aFChunk|vbaProject|vbaData|externalLink|externalLinkPath|webExtension|subDocument)$/i;
const safeLink = value=>/^(?:https?:\/\/[^\s\\]+|mailto:[^\s\\]+)$/i.test(value);
const fieldAllowed=new Set(('PAGE NUMPAGES SECTION SECTIONPAGES PAGEREF REF SEQ TOC STYLEREF DATE TIME CREATEDATE SAVEDATE PRINTDATE AUTHOR TITLE SUBJECT FILENAME DOCPROPERTY HYPERLINK SYMBOL LISTNUM AUTONUM AUTONUMLGL AUTONUMOUTL').split(' '));
function checkField(raw) {
  const instruction=raw.trim(),name=/^([a-z]+)/i.exec(instruction)?.[1]?.toUpperCase();
  requireFile(fieldAllowed.has(name),contentError);
  if(name==='HYPERLINK') {
    const target=/^HYPERLINK\s+(?:"([^"]+)"|(\S+))/i.exec(instruction);
    const url=target?.[1]||target?.[2]||'';
    requireFile(url==='\\l' || safeLink(url),contentError);
  }
}
function readWord(bytes) {
  let officeDocument=false,wordDocument=false,body=false,typesPresent=false;
  const declared=new Map(),defaults=new Map(),targets=[];
  const parts=readZip(bytes,(name,data,isXml)=>{
    requireFile(!badPart.test(decodeURIComponent(name)),contentError);
    if(!isXml) {
      const png=name.toLowerCase().endsWith('.png'),jpeg=/\.jpe?g$/i.test(name);
      const gif=/\.gif$/i.test(name),bmp=/\.bmp$/i.test(name),tiff=/\.tiff?$/i.test(name);
      const bitmap=(png&&data.subarray(0,8).toString('hex')==='89504e470d0a1a0a') ||
        (jpeg&&data[0]===255&&data[1]===216&&data[2]===255) ||
        (gif&&/^GIF8[79]a$/.test(data.toString('ascii',0,6))) || (bmp&&data.toString('ascii',0,2)==='BM') ||
        (tiff&&['49492a00','4d4d002a'].includes(data.subarray(0,4).toString('hex')));
      requireFile(bitmap || (/^word\/fonts\/[^/]+\.odttf$/i.test(name) && data.length>=32),contentError);
      return;
    }
    let depth=0,nodes=0,root=false,relsRoot=false,instrDepth=0;
    const fields=[];const relIds=new Set();
    const parser=sax.parser(true,{xmlns:true,strictEntities:true,position:false});
    parser.onerror=()=>{throw new InvalidGuideFile(zipError);};
    parser.ondoctype=()=>{throw new InvalidGuideFile(contentError);};
    parser.onprocessinginstruction=p=>requireFile(p.name.toLowerCase()==='xml',contentError);
    const isRel=/\.rels$/i.test(name);
    function setType(map,key,ct) {requireFile(!!key && !!ct && !map.has(key) && !badType.test(ct),contentError);map.set(key,ct);}
    parser.onopentag=t=>{
      requireFile(++depth<=150 && ++nodes<=200000 && Object.keys(t.attributes).length<=192,sizeError);
      const attr=k=>t.attributes[k]?.value||'';
      const wAttr=k=>Object.values(t.attributes).find(a=>wordNS.has(a.uri)&&a.local===k)?.value||'';
      if(!root) {
        root=true;
        if(name==='word/document.xml') {requireFile(wordNS.has(t.uri)&&t.local==='document',zipError);wordDocument=true;}
        if(name==='[Content_Types].xml') {requireFile(t.uri===typesNS&&t.local==='Types',zipError);typesPresent=true;}
        if(isRel) {requireFile(t.uri===relsNS&&t.local==='Relationships',zipError);relsRoot=true;}
      }
      if(name==='[Content_Types].xml' && depth>1) {
        requireFile(depth===2 && t.uri===typesNS,zipError);
        if(t.local==='Default')setType(defaults,attr('Extension').toLowerCase(),attr('ContentType'));
        else {requireFile(t.local==='Override'&&attr('PartName').startsWith('/'),zipError);setType(declared,attr('PartName').slice(1),attr('ContentType'));}
      }
      if(isRel && depth>1) {
        const type=attr('Type'),target=attr('Target'),id=attr('Id'),mode=attr('TargetMode')||'Internal';
        requireFile(relsRoot && depth===2 && t.uri===relsNS && t.local==='Relationship' && !!target && !!type && !!id && !relIds.has(id),zipError);
        relIds.add(id);requireFile(!badRel.test(type),contentError);
        if(mode==='External') {
          requireFile([...officeRel].some(ns=>type===ns+'hyperlink')&&safeLink(target),contentError);
        } else {
          requireFile(mode==='Internal' && !/^[a-z][a-z0-9+.-]*:|^\/\/|[\\\x00-\x1f]|%(?:2f|5c|25)/i.test(target),contentError);
          const source=name==='_rels/.rels'?'':name.replace(/(^|\/)\_rels\/([^/]+)\.rels$/,'$1$2');
          requireFile(source!==name,zipError);
          const path=new URL(target,'https://package.invalid/'+source).pathname.slice(1);
          targets.push(decodeURI(path));
          if(name==='_rels/.rels' && [...officeRel].some(ns=>type===ns+'officeDocument')) {
            requireFile(!officeDocument && path==='word/document.xml',zipError);officeDocument=true;
          }
        }
      }
      if(wordNS.has(t.uri)) {
        if(name==='word/document.xml' && depth===2 && t.local==='body') {requireFile(!body,zipError);body=true;}
        requireFile(!['object','altChunk','subDoc','control','attachedTemplate'].includes(t.local),contentError);
        if(t.local==='fldSimple') checkField(wAttr('instr'));
        if(t.local==='fldChar') {
          const k=wAttr('fldCharType');
          if(k==='begin')fields.push({text:'',checked:false});
          if(k==='separate'||k==='end') {
            const field=fields.at(-1);requireFile(!!field,zipError);
            if(!field.checked){checkField(field.text);field.checked=true;}
            if(k==='end')fields.pop();
          }
        }
        if(t.local==='instrText'||t.local==='delInstrText') {requireFile(fields.length>0,zipError);instrDepth=depth;}
      }
    };
    const fieldText=s=>{if(instrDepth){const current=fields.at(-1);requireFile(!current.checked && current.text.length+s.length<=8192,sizeError);current.text+=s;}};
    parser.ontext=fieldText;parser.oncdata=fieldText;
    parser.onclosetag=()=>{if(instrDepth===depth)instrDepth=0;depth--;};
    parser.write(xmlText(data)).close();requireFile(root&&depth===0&&fields.length===0,zipError);
  });
  requireFile(wordDocument && body && officeDocument && typesPresent && declared.get('word/document.xml')===docType,zipError);
  for(const name of parts) {
    const extension=name.slice(name.lastIndexOf('.')+1).toLowerCase();
    if(name==='[Content_Types].xml')continue;
    const type=declared.get(name)||defaults.get(extension);
    requireFile(!!type,zipError);
    if(extension==='xml'||extension==='rels') requireFile(/(?:\+xml|\/xml)$/i.test(type),zipError);
  }
  for(const target of targets) requireFile(parts.has(target),zipError);
  for(const name of declared.keys()) requireFile(parts.has(name),zipError);
}

const prohibitedPdfNames=new Set(['JavaScript','JS','AA','Launch','SubmitForm','ImportData','GoToR','GoToE',
  'Rendition','RichMedia','Movie','Sound','3D','3DD','EmbeddedFiles','EmbeddedFile','FileAttachment',
  'Filespec','XFA','AcroForm','Encrypt','Crypt']);
const pdfKey=name=>PDFName.of(name);
const nameOf=value=>value instanceof PDFName ? value.decodeText() : '';
function checkPdfName(name) {
  // PDF names may use upper- or lower-case hex. Disallow pre-escaped literal
  // names that the pinned parser and a reader could interpret differently.
  requireFile(!/#[a-f0-9]{2}/i.test(name) && !prohibitedPdfNames.has(name),contentError);
}
function checkCompressedPdfNames(data) {
  const names=Buffer.from(data).toString('latin1').matchAll(/\/([^\x00\t\n\f\r ()<>\[\]{}\/%]+)/g);
  for(const [,raw] of names)checkPdfName(raw.replace(/#([a-f0-9]{2})/gi,(_,v)=>String.fromCharCode(parseInt(v,16))));
}
function parseNumber(value,min,max) {
  const n=value instanceof PDFNumber ? value.asNumber() : NaN;
  requireFile(Number.isSafeInteger(n) && n>=min && n<=max,sizeError);
  return n;
}
function checkParserStream(stream,budget) {
  const dict=stream.dict,type=nameOf(dict.lookup(pdfKey('Type')));
  if(type!=='XRef' && type!=='ObjStm')return;
  const filter=dict.lookup(pdfKey('Filter'));
  const filtered=filter instanceof PDFArray && filter.size()===1 ? filter.lookup(0) : filter;
  requireFile(!filter || nameOf(filtered)==='FlateDecode',pdfError);
  requireFile(budget.remaining>0,sizeError);
  let binary=stream.getContents();
  if(filter)binary=inflateSync(binary,{maxOutputLength:Math.min(8*MiB,budget.remaining)});
  requireFile(binary.length<=8*MiB && (budget.remaining-=binary.length)>=0,sizeError);
  if(type==='ObjStm') {
    const n=parseNumber(dict.lookup(pdfKey('N')),1,4096);
    const first=parseNumber(dict.lookup(pdfKey('First')),1,binary.length-1);
    requireFile(first<=150000,sizeError);
    const header=Buffer.from(binary.subarray(0,first)).toString('latin1').trim().split(/\s+/);
    requireFile(header.length===2*n,pdfError);
    let previous=-1;
    for(let i=0;i<header.length;i+=2) {
      const offset=Number(header[i+1]);
      requireFile(/^\d{1,10}$/.test(header[i]) && /^\d{1,10}$/.test(header[i+1]) && offset>previous && first+offset<binary.length,pdfError);
      previous=offset;
    }
    checkCompressedPdfNames(binary);return;
  }
  parseNumber(dict.lookup(pdfKey('Size')),1,100000);
  const index=dict.lookup(pdfKey('Index'));
  if(index) {
    requireFile(index instanceof PDFArray && index.size()%2===0 && index.size()<=20000,sizeError);
    let total=0;for(let i=0;i<index.size();i+=2){
      parseNumber(index.lookup(i),0,100000);total+=parseNumber(index.lookup(i+1),0,100000);
    }
    requireFile(total<=100000,sizeError);
  }
  const widths=dict.lookup(pdfKey('W'));
  requireFile(widths instanceof PDFArray && widths.size()===3,pdfError);
  for(let i=0;i<3;i++)parseNumber(widths.lookup(i),0,8);
}

function scanPdfGraph(context) {
  const entries=context.enumerateIndirectObjects();
  requireFile(entries.length<=50000 && !context.trailerInfo.Encrypt,sizeError);
  let queue=entries.map(pair=>pair[1]),nodes=0;
  while(queue.length) {
    const obj=queue.pop();
    requireFile(++nodes<=500000,sizeError);
    if(obj instanceof PDFName){checkPdfName(nameOf(obj));continue;}
    if(obj instanceof PDFArray){for(let i=0;i<obj.size();i++)queue.push(obj.get(i));continue;}
    const dict=obj instanceof PDFRawStream?obj.dict:obj;
    if(!(dict instanceof PDFDict))continue;
    for(const [key,value] of dict.entries()) {
      const name=nameOf(key);checkPdfName(name);
      if(name==='OpenAction') {
        const open=context.lookup(value);
        requireFile(open instanceof PDFArray || (open instanceof PDFDict && nameOf(open.lookup(pdfKey('S')))==='GoTo'),contentError);
      }
      if(name==='URI') {
        const uri=context.lookup(value);
        requireFile(typeof uri?.decodeText==='function' && safeLink(uri.decodeText()),contentError);
      }
      if(name==='EF' || (obj instanceof PDFRawStream && name==='F'))throw new InvalidGuideFile(contentError);
      queue.push(value);
    }
    // Allow local destinations and ordinary clickable links, not exotic or
    // viewer-specific actions. /S also has unrelated uses (e.g. transparency).
    if(nameOf(dict.lookup(pdfKey('Type')))==='Action') {
      requireFile(['GoTo','URI'].includes(nameOf(dict.lookup(pdfKey('S')))),contentError);
    }
    if(nameOf(dict.lookup(pdfKey('Subtype')))==='Image') {
      const w=parseNumber(dict.lookup(pdfKey('Width')),1,65535), h=parseNumber(dict.lookup(pdfKey('Height')),1,65535);
      requireFile(w*h<=50000000,sizeError);
    }
  }
  const root=context.lookup(context.trailerInfo.Root);
  requireFile(root instanceof PDFDict && nameOf(root.lookup(pdfKey('Type')))==='Catalog',pdfError);
  const stack=[root.get(pdfKey('Pages'))],seen=new Set();
  let pages=0;
  while(stack.length) {
    const ref=stack.pop();
    requireFile(ref instanceof PDFRef && !seen.has(ref),pdfError);seen.add(ref);
    const item=context.lookup(ref);
    requireFile(item instanceof PDFDict,pdfError);
    const type=nameOf(item.lookup(pdfKey('Type')));
    if(type==='Page') {requireFile(++pages<=2000,sizeError);continue;}
    const kids=item.lookup(pdfKey('Kids'));
    requireFile(type==='Pages' && kids instanceof PDFArray && kids.size()<=2000,pdfError);
    for(let i=0;i<kids.size();i++)stack.push(kids.get(i));
  }
  requireFile(pages>0,pdfError);
}
async function readPdf(bytes) {
  const buf=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  requireFile(/^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n)/.test(buf.toString('ascii',0,12)),pdfError);
  const end=/startxref\s+(\d+)\s+%%EOF\s*$/.exec(buf.toString('latin1',Math.max(0,buf.length-1024)));
  const xref=Number(end?.[1]);
  requireFile(Number.isSafeInteger(xref) && xref>0 && xref<buf.length &&
    /^(?:xref\b|\d+\s+\d+\s+obj\b)/.test(buf.toString('ascii',xref,xref+60)),pdfError);
  const parser=PDFParser.forBytesWithOptions(bytes,1000,true);
  // pdf-lib expands xref/object streams during parsing. Inspect each parsed
  // stream before that internal step so an attacker cannot inflate unbounded
  // data or manufacture unbounded xref indices. Pin the parser version.
  const base=parser.parseObject.bind(parser),budget={remaining:24*MiB};
  let depth=0,objects=0;
  parser.parseObject=function() {
    requireFile(++depth<=150 && ++objects<=500000,sizeError);
    try {
      const value=base();
      if(value instanceof PDFRawStream)checkParserStream(value,budget);
      if(value instanceof PDFName)checkPdfName(nameOf(value));
      return value;
    } finally {depth--;}
  };
  scanPdfGraph(await parser.parseDocument());
}

export async function validateGuideFile(format, bytes) {
  requireFile(bytes instanceof Uint8Array && bytes.length>0 && bytes.length<=MAX_GUIDE_BYTES,sizeError);
  try {
    if(format==='docx')readWord(bytes);
    else if(format==='pdf')await readPdf(bytes);
    else throw new InvalidGuideFile('Formato no permitido.');
  } catch(error) {
    if(error instanceof InvalidGuideFile)throw error;
    throw new InvalidGuideFile(format==='pdf'?pdfError:zipError);
  }
}


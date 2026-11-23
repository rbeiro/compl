import {PDFDocument, PDFName, PDFString, PDFHexString, PDFBool, rgb, beginMarkedContent, endMarkedContent} from 'npm:pdf-lib@1.17.1';
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {guideFonts} from './guide-fonts.js';
import {fontData} from './font.js';
import {brandForHotel} from './template.js';
import {palette} from './palette.js';
import {logoCanvas,qrCanvas} from './brand-assets.js';
import {composeGuide,ingredientText,logoBox,paper} from './guide-layout.js';
import {preserveApprovedImage} from './approved-image.js';
import {wordDocument} from './word-layout.js';

export class InputError extends Error {}
const fieldLimits={nombre_es:120,nombre_en:120,header_subtitle:160,codigo:60,fecha:12,version:24,partida:80,vajilla:120,racion:60,pase:60,sala_es:600,sala_en:600,canal_zona:160,servicio_exterior:160,contiene:260,trazas:260,adaptaciones:260};
function text(value,max){
  if(value==null)return '';
  if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))throw new InputError('Revisa la longitud y los caracteres de los campos.');
  return value.trim().normalize('NFC');
}
function lines(list,columns,max){
  if(!Array.isArray(list)||!list.length||list.length>max)throw new InputError('Indica al menos una fila y respeta el máximo de '+max+'.');
  return list.map(row=>{
    const result={};
    for(const [key,limit] of Object.entries(columns))result[key]=text(row?.[key],limit);
    if(!result[Object.keys(columns)[0]])throw new InputError('Hay una fila sin completar.');
    return result;
  });
}
export function recipe(input) {
  const r={};
  for(const [key,limit] of Object.entries(fieldLimits))r[key]=text(input?.[key],limit);
  if(!r.nombre_es||r.nombre_es.includes('/')||/[\r\n]/.test(r.nombre_es))throw new InputError('Introduce un nombre de plato válido, sin barras.');
  r.ingredientes_en_foto=input?.ingredientes_en_foto===true;
  r.ingredientes=lines(input.ingredientes,{nombre:120,cantidad:40,unidad:40},40);
  r.pasos=lines(input.pasos,{accion:600,control:300},24);
  if(input.foto){
    if(typeof input.foto!=='string'||input.foto.length>4*Math.ceil(8*1024*1024/3)||
       input.foto.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.foto))
      throw new InputError('No se ha podido leer la fotografía.');
    r.foto=Buffer.from(input.foto,'base64');
    if(r.foto.length>8*1024*1024)throw new InputError('No se ha podido leer la fotografía.');
    if(r.foto.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
      r.foto_extension='png';
      if(r.foto.length<33||r.foto.toString('ascii',12,16)!=='IHDR'||
          !r.foto.readUInt32BE(16)||!r.foto.readUInt32BE(20)||
          r.foto.readUInt32BE(16)*r.foto.readUInt32BE(20)>4000000)
        throw new InputError('Las dimensiones de la foto son demasiado grandes.');
    }else if(r.foto.readUInt8(0)===255&&r.foto[1]===216&&r.foto[2]===255){
      r.foto_extension='jpg';
    }else throw new InputError('No se ha podido leer la fotografía.');
    r.foto_sha256=createHash('sha256').update(r.foto).digest('hex');
    if(input.imagen_aprobada && (!['foto','acuarela'].includes(input.imagen_aprobada.tipo)||
       input.imagen_aprobada.sha256!==r.foto_sha256))throw new InputError('No se ha podido leer la fotografía.');
  }else if(input.imagen_aprobada)throw new InputError('No se ha podido leer la fotografía.');
  return r;
}
const fontCache=new Map();
function fontBytes(style) {
  if(!fontCache.has(style))fontCache.set(style,inflateSync(Buffer.from(guideFonts[style],'base64')));
  return fontCache.get(style);
}
const pdfColor=hex=>{
  const [r,g,b]=Buffer.from(hex,'hex');
  return rgb(r/255,g/255,b/255);
};
export async function documents(r,ctx) {
  const defaults=brandForHotel(ctx.hotel_key), profile=ctx.brand??defaults;
  const accent=profile.accent.replace(/^#/,'').toUpperCase();
  const colours=palette(accent);
  const logoBytes=logoCanvas(profile.logo_png),qrBytes=qrCanvas(accent);
  const doc=await PDFDocument.create();
  doc.registerFontkit(fontkit);doc.setTitle(r.nombre_es);doc.setAuthor(ctx.hotel);doc.setSubject('CompI Plating Guide v23 | '+accent);
  doc.catalog.set(PDFName.of('CompIBrandAccent'),PDFString.of(accent));
  if(ctx.master)doc.catalog.set(PDFName.of('CompIMaster'),PDFBool.True);
  const fonts=Object.fromEntries(await Promise.all(Object.keys(guideFonts).map(async style=>[style,await doc.embedFont(fontBytes(style),{subset:true})])));
  const latin=new Set(fonts.regular.getCharacterSet());
  const texts=[ctx.hotel,ctx.outlet,...Object.values(r).filter(v=>typeof v==='string'),...r.pasos.flatMap(s=>[s.accion,s.control]),...r.ingredientes.map(ingredientText)];
  const needsFallback=s=>Array.from(s).some(c=>!latin.has(c.codePointAt(0))&&!/\s/.test(c));
  let fallback;
  if(texts.some(needsFallback)){
    fallback=await doc.embedFont(Buffer.from(fontData,'base64'),{subset:true});
    const supported=new Set(fallback.getCharacterSet());
    for(const value of texts)for(const c of value)if(!/\s/.test(c)&&!latin.has(c.codePointAt(0))&&!supported.has(c.codePointAt(0)))throw new InputError('El PDF no admite el carácter «'+c+'».');
  }
  const font=(s,style)=>fallback&&needsFallback(s)?fallback:fonts[style];
  const measure=(s,size,style)=>font(s,style).widthOfTextAtSize(s,size);
  let photo;
  if(r.foto){
    try{photo=r.foto_extension==='png'?await doc.embedPng(r.foto):await doc.embedJpg(r.foto);}catch{throw new InputError('No se ha podido leer la fotografía.');}
    if(!photo.width||!photo.height||photo.width*photo.height>20000000)throw new InputError('Las dimensiones de la foto son demasiado grandes.');
  }
  const layout=composeGuide(r,ctx,measure,photo),logo=await doc.embedPng(logoBytes),qr=await doc.embedPng(qrBytes);
  const H=paper.height;
  for(const [index,content] of layout.entries()){
    const page=doc.addPage([paper.width,H]);
    function draw(n){
      if(n.type==='photo'||n.type==='qr'){page.drawImage(n.type==='photo'?photo:qr,{x:n.x,y:H-n.y-n.h,width:n.w,height:n.h});return;}
      page.pushOperators(beginMarkedContent('CompIColor'+n.color));
      const colour=pdfColor(colours[n.color]);
      if(n.type==='text')page.drawText(n.value,{x:n.x,y:H-n.y,size:n.size,font:font(n.value,n.style),color:colour});
      if(n.type==='rule')page.drawLine({start:{x:n.x,y:H-n.y},end:{x:n.x+n.w,y:H-n.y},thickness:n.h,color:colour});
      if(n.type==='rect')page.drawRectangle({x:n.x,y:H-n.y-n.h,width:n.w,height:n.h,color:colour});
      page.pushOperators(endMarkedContent());
    }
    page.drawImage(logo,{x:logoBox.x,y:H-logoBox.y-logoBox.h,width:logoBox.w,height:logoBox.h});
    for(const [label,y,requestedSize,style,color] of [[ctx.outlet,39.3,12.5,'bold','345B6F'],[r.header_subtitle||ctx.hotel,50.3,8,'regular','667177']]){
      const size=Math.min(requestedSize,374*requestedSize/Math.max(1,measure(label,requestedSize,style)));
      draw({type:'text',value:label,x:552.75-measure(label,size,style),y,size,style,color});
    }
    draw({type:'rule',x:42.5,y:63.65,w:510.3,h:1.1,color:'345B6F'});
    content.forEach(draw);
    draw({type:'rule',x:42.5,y:808.55,w:510.25,h:.5,color:'D9DFE1'});
    const prefix='USO INTERNO  ·  '+ctx.outlet+' ·  '+(r.codigo?'['+r.codigo+']':'')+' / '+(r.version?'['+r.version+']':'')+'     Página ';
    const runs=[[prefix,7.5,'667177'],[String(index+1),10,'263338'],[' de ',7.5,'667177'],[String(layout.length),10,'263338']];
    const ratio=Math.min(1,510/runs.reduce((n,[value,size])=>n+measure(value,size,'regular'),0));
    let x=42.6;
    for(const [value,size,color] of runs){
      draw({type:'text',value,x,y:822.15,size:size*ratio,style:'regular',color});
      x+=measure(value,size*ratio,'regular');
    }
  }
  await doc.flush();
  doc.context.lookup(logo.ref).dict.set(PDFName.of('CompIBrandLogo'),PDFBool.True);
  doc.context.lookup(qr.ref).dict.set(PDFName.of('CompIBrandQR'),PDFBool.True);
  if(photo){
    const dict=preserveApprovedImage(doc,photo,r).dict;
    dict.set(PDFName.of('Alt'),PDFHexString.fromText('Fotografía de emplatado. '+r.ingredientes.map(ingredientText).join(' · ')));
  }
  const [pdf,word]=await Promise.all([doc.save(),wordDocument(layout,r,ctx,accent,logoBytes,qrBytes,measure)]);
  return {pdf:Buffer.from(pdf).toString('base64'),docx:Buffer.from(word).toString('base64')};
}


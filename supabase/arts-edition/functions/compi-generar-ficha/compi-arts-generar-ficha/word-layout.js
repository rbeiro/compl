import JSZip from 'npm:jszip@3.10.1';
import {Buffer} from 'node:buffer';
import {wordTemplate} from './template.js';
import {palette} from './palette.js';
const escape=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const twip=point=>Math.round(point*20);
const emu=point=>Math.round(point*12700);
function frame(node,colours) {
  const {value,x,y,size,style,room,color,link,bookmark}=node;
  const bold=style==='bold'||style==='boldItalic',ital=style==='italic'||style==='boldItalic';
  const half=Math.max(2,Math.round(size*2)),height=half/2;
  const props='<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/>'+(bold?'<w:b/>':'')+(ital?'<w:i/>':'')+
    '<!--CompIColor:'+color+'--><w:color w:val="'+colours[color]+'"/><w:sz w:val="'+half+'"/><w:szCs w:val="'+half+'"/>';
  let run='<w:r><w:rPr>'+props+'</w:rPr><w:t xml:space="preserve">'+escape(value)+'</w:t></w:r>';
  if(link)run='<w:hyperlink w:anchor="'+link+'">'+run+'</w:hyperlink>';
  if(bookmark){const id=bookmark==='VistaServicio'?0:1;run='<w:bookmarkStart w:id="'+id+'" w:name="'+bookmark+'"/>'+run+'<w:bookmarkEnd w:id="'+id+'"/>';}
  return '<w:p><w:pPr><w:keepNext w:val="0"/><w:framePr w:w="'+twip(room+4)+'" w:hAnchor="page" w:vAnchor="page" w:wrap="none" w:x="'+twip(x-.1)+'" w:y="'+twip(y-.8*height)+'"/>'+
    '<w:spacing w:before="0" w:after="0" w:line="'+twip(height)+'" w:lineRule="exact"/>'+
    '<w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="left"/></w:pPr>'+run+'</w:p>';
}
function shape(node,id,colours) {
  const {x,y,w,h,color}=node, top=node.type==='rule'?y-h/2:y;
  return '<w:r><w:pict><!--CompIColor:'+color+'--><v:rect id="CompIShape'+id+'" style="position:absolute;margin-left:'+x+'pt;margin-top:'+top+'pt;width:'+w+'pt;height:'+h+'pt;z-index:-2;mso-position-horizontal-relative:page;mso-position-vertical-relative:page" fillcolor="#'+colours[color]+'" stroked="f"/></w:pict></w:r>';
}
function picture(node,id) {
  const isQR=node.type==='qr', name=isQR?'Espacio QR':'Fotografía de emplatado',rel=isQR?'rIdCompIQR':'rIdCompIPhoto';
  const {x,y,w,h,description}=node,ext='cx="'+emu(w)+'" cy="'+emu(h)+'"';
  return '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">'+
    '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>'+emu(x)+'</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>'+emu(y)+'</wp:posOffset></wp:positionV>'+
    '<wp:extent '+ext+'/><wp:wrapNone/><wp:docPr id="'+id+'" name="'+name+'" descr="'+escape(description)+'"/><wp:cNvGraphicFramePr/>'+
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="'+id+'" name="'+name+'"/><pic:cNvPicPr/></pic:nvPicPr>'+
    '<pic:blipFill><a:blip r:embed="'+rel+'"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext '+ext+'/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';
}
function tint(xml,colours) {
  return xml.replace(/<[^!?/][^<>]+>/g,tag=>{
    const hit=tag.match(/\b(?:w:val|w:color|w:fill|val)="([\dA-Fa-f]{6})"/);
    if(!hit||!Object.hasOwn(colours,hit[1].toUpperCase()))return tag;
    const key=hit[1].toUpperCase();
    return '<!--CompIColor:'+key+'-->'+tag.replace(hit[0],hit[0].replace(hit[1],colours[key]));
  });
}
export async function wordDocument(pages,r,ctx,accent,logo,qr,measure) {
  const zip=await JSZip.loadAsync(Buffer.from(wordTemplate,'base64'));
  const read=n=>zip.file(n).async('string'), colours=palette(accent);
  let id=100;
  const anchor='<w:pPr><w:keepNext w:val="0"/><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>';
  const blocks=pages.map((page,i)=>{
    const ornaments=page.filter(n=>n.type!=='text').map(n=>['photo','qr'].includes(n.type)?picture(n,id++):shape(n,id++,colours)).join('');
    return '<w:p>'+anchor+ornaments+'</w:p>'+page.filter(n=>n.type==='text').map(n=>frame(n,colours)).join('')+
      '<w:p>'+anchor+(i+1<pages.length?'<w:r><w:br w:type="page"/></w:r>':'')+'</w:p>';
  }).join('');
  zip.file('word/document.xml',(await read('word/document.xml')).replace('<!--LAYOUT-->',()=>blocks));
  zip.file('word/media/image1.png',qr,{createFolders:false});
  const relFile='word/_rels/document.xml.rels';
  zip.file(relFile,(await read(relFile)).replace('</Relationships>','<Relationship Id="rIdCompIQR" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>'));
  if(r.foto){
    const filename='foto.'+r.foto_extension;
    zip.file('word/media/'+filename,r.foto,{createFolders:false});
    let rels=await read('word/_rels/document.xml.rels');
    zip.file('word/_rels/document.xml.rels',rels.replace('</Relationships>','<Relationship Id="rIdCompIPhoto" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/'+filename+'"/></Relationships>'));
    let types=await read('[Content_Types].xml');
    if(r.foto_extension==='jpg'&&!/Extension="jpg"/.test(types))zip.file('[Content_Types].xml',types.replace('</Types>','<Default Extension="jpg" ContentType="image/jpeg"/></Types>'));
  }
  for(const name of ['word/header1.xml','word/footer1.xml','word/styles.xml','word/theme/theme1.xml']){
    const b=v=>v?'['+v+']':'';
    const fields={restaurante:ctx.outlet,subtitulo_cabecera:r.header_subtitle||ctx.hotel,codigo:b(r.codigo),version:b(r.version)};
    let xml=tint(await read(name),colours);
    if(name==='word/header1.xml'){
      xml=xml.replace(/<w:r(?: [^>]*)?>[\s\S]*?<\/w:r>/g,run=>{
        const field=run.match(/\$\{(restaurante|subtitulo_cabecera)\}/)?.[1];
        if(!field)return run;
        const size=field==='restaurante'?12.5:8, weight=field==='restaurante'?'bold':'regular';
        const measured=measure(fields[field],size,weight);
        if(measured<=374)return run;
        const half=Math.max(2,Math.floor(748*size/measured));
        return run.replace(/(<w:sz(?:Cs)? w:val=")\d+(")/g,(_,open,close)=>open+half+close);
      });
      xml=xml.replace('</w:hdr>','<!--CompIAccent:'+accent+'-->'+(ctx.master?'<!--CompIMaster:true-->':'')+'</w:hdr>');
    }
    zip.file(name,xml.replace(/\$\{(\w+)\}/g,(_,key)=>escape(fields[key]??'')));
  }
  zip.file('word/media/image3.png',logo,{createFolders:false});
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:3}});
}


// Assets are immutable. Only the final RPC makes the complete recipe and its two renditions visible.
const slots=['original','photo','art','image'];
const formats={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pdf:'application/pdf'};
const root=(h,o,g)=>'/functions/v1/compi-subir-ficha/'+[h,o,g].map(encodeURIComponent).join('/')+'/';
function asBlob(encoded,type){
  const binary=atob(encoded),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return new Blob([bytes],{type});
}
async function asBase64(blob){
  const bytes=new Uint8Array(await blob.arrayBuffer()),parts=[];
  for(let i=0;i<bytes.length;i+=24576)parts.push(btoa(String.fromCharCode(...bytes.subarray(i,i+24576))));
  return parts.join('');
}
async function sha256(blob){
  const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function saveGuideSource({api,rpc,dest,guideKey,data,media={},files,previous=null}){
  const h=dest.hotel_key,o=dest.outlet_key,g=guideKey,path=root(h,o,g);
  const mediaFields={...media},assets={};
  for(const slot of slots){
    const value=mediaFields[slot];
    delete mediaFields[slot];
    if(!value)continue;
    const upload=slot==='original'?value:asBlob(value,slot==='photo'?'image/jpeg':'image/png');
    const response=await api(path+'source-'+slot,{upload,mime:upload.type||'application/octet-stream'});
    assets[slot]=await response.json();
    if(slot==='original')assets.original.name=upload.name||'foto';
  }
  const {foto,imagen_aprobada,...recipe}=data;
  const chosen=media.kind==='acuarela'?assets.image:assets.photo;
  const approved=chosen?{tipo:media.kind==='acuarela'?'acuarela':'foto',ruta:chosen.ruta,sha256:chosen.sha256}:null;
  if(Boolean(foto)!==Boolean(approved)||(approved&&
    (foto!==(approved.tipo==='acuarela'?media.image:media.photo)||
    (imagen_aprobada&&imagen_aprobada.sha256!==approved.sha256))))throw Error('No se ha podido leer la fotografía.');
  const source={data:recipe,media:mediaFields,assets,imagen_aprobada:approved};
  const [docx,pdf]=await Promise.all(Object.keys(formats).map(async format=>{
    const response=await api(path+format+'?stage=1',{upload:files[format],mime:formats[format]});
    return (await response.json()).sha256;
  }));
  return rpc('compi_save_guide_source',{h,o,g,source,docx,pdf,previous});
}
export async function loadGuideSource({api,rpc,h,o,g}){
  const snapshot=await rpc('compi_guide_source',{h,o,g});
  if(!snapshot)return null;
  const {source,revision}=snapshot,media={...source.media};
  for(const slot of slots){
    const asset=source.assets[slot];
    if(!asset)continue;
    const url=root(h,o,g)+'source-'+slot+'?read=1&sha='+encodeURIComponent(asset.sha256);
    const blob=await (await api(url,{payload:{}})).blob();
    if(await sha256(blob)!==asset.sha256)throw Error('No se ha podido leer la fotografía.');
    media[slot]=slot==='original'?new File([blob],asset.name||'foto',{type:blob.type}):await asBase64(blob);
  }
  const approved=source.imagen_aprobada,data={...source.data};
  if(approved){
    media.kind=approved.tipo;
    data.foto=approved.tipo==='acuarela'?media.image:media.photo;
    data.imagen_aprobada=approved;
  }
  return {guideKey:g,revision,data,media};
}

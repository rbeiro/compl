import {validateGuideFile, InvalidGuideFile, MAX_GUIDE_BYTES} from './validate.js';
const base=Deno.env.get('SUPABASE_URL')!;
const admin=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anon=Deno.env.get('SUPABASE_ANON_KEY')!;
const site='https://compi-hotel-arts.leonardo-vincere.chatgpt.site';
const mediaSlots=['original','photo','art','image'];
function mediaType(slot:string,data:Uint8Array){
  const png=[137,80,78,71,13,10,26,10].every((value,i)=>data[i]===value);
  const jpeg=data[0]===255&&data[1]===216&&data[2]===255;
  const webp=String.fromCharCode(...data.subarray(0,4))==='RIFF'&&String.fromCharCode(...data.subarray(8,12))==='WEBP';
  if(slot==='original'&&webp)return 'image/webp';
  if(slot==='original'&&data.length>=16&&String.fromCharCode(...data.subarray(4,8))==='ftyp'){
    const boxLength=new DataView(data.buffer,data.byteOffset,4).getUint32(0);
    if(boxLength>=16&&boxLength<=data.length&&boxLength<=65536){
      const brands=[String.fromCharCode(...data.subarray(8,12))];
      for(let i=16;i+4<=boxLength;i+=4)brands.push(String.fromCharCode(...data.subarray(i,i+4)));
      if(brands.some(b=>['heic','heix','hevc','hevx','heim','heis','hevm','hevs'].includes(b)))return 'image/heic';
      if(!brands.some(b=>['avif','avis'].includes(b))&&brands.some(b=>['mif1','msf1'].includes(b)))return 'image/heif';
    }
  }
  if(['photo','original'].includes(slot)&&jpeg)return 'image/jpeg';
  if(slot!=='photo'&&png)return 'image/png';
  throw new InvalidGuideFile('No se ha podido leer la fotografía.');
}
const types:Record<string,string>={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
async function bytes(req:Request|Response){
  if(Number(req.headers.get('content-length'))>MAX_GUIDE_BYTES)throw new InvalidGuideFile('Archivo demasiado grande.');
  const reader=req.body?.getReader();if(!reader)throw new InvalidGuideFile('Archivo vacío.');
  const chunks=[];let total=0;
  while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;
    if(total>MAX_GUIDE_BYTES){await reader.cancel();throw new InvalidGuideFile('Archivo demasiado grande.');}chunks.push(value);}
  const out=new Uint8Array(total);let at=0;for(const chunk of chunks){out.set(chunk,at);at+=chunk.length;}return out;
}
type Rebrand=(format:string,source:Uint8Array,brand:{accent:string;logo_png:string|null;configured:boolean;revision:number},
  options:{onlyMaster:boolean})=>Promise<Uint8Array>;
export function guideFiles(editing:boolean,rebrand?:Rebrand){
 return async(req:Request)=>{
  const origin=req.headers.get('origin');
  const headers=new Headers({'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Vary':'Origin, Authorization','X-Content-Type-Options':'nosniff'});
  const reply=(status:number,message?:string)=>new Response(message?JSON.stringify({message}):null,{headers,status});
  if(origin&&![site,'https://compichef.com','https://compi-web.mcgradi3000.workers.dev','http://127.0.0.1:4173','http://localhost:4173'].includes(origin))return reply(403);
  if(origin){
    headers.set('Access-Control-Allow-Origin',origin);
    headers.set('Access-Control-Expose-Headers','X-CompI-Brand-Revision, X-CompI-Drive-Original');
  }
  if(req.method==='OPTIONS'){headers.set('Access-Control-Allow-Headers','authorization,apikey,content-type,x-upsert');headers.set('Access-Control-Allow-Methods','POST,OPTIONS');return reply(204);}
  if(req.method!=='POST')return reply(405);
  const url=new URL(req.url);
  const originalIfUnsupported=url.searchParams.get('original')==='1';
  const [fn,h,o,g,fmt]=url.pathname.split('/').filter(Boolean).slice(-5);
  if(fn!==(editing?'compi-arts-subir-ficha':'compi-arts-descarga')||![h,o,g].every(v=>/^[a-z0-9-]{1,200}$/.test(v)))return reply(404);
  const slot=fmt.startsWith('source-')?fmt.slice(7):'';
  const workspaceVariant=!editing && (fmt==='workspace-approved' || fmt==='workspace-clean') ? fmt.slice(10) : '';
  if(!Object.hasOwn(types,fmt)&&!(editing&&mediaSlots.includes(slot))&&!workspaceVariant)return reply(404);
  const jwt=req.headers.get('authorization')||'';
  if(!/^Bearer [a-zA-Z0-9._-]+$/i.test(jwt))return reply(401);
  const rpc=(name:string,args:object)=>fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:anon,Authorization:jwt,'Content-Type':'application/json'},body:JSON.stringify(args),redirect:'error'});
  const stage=editing&&url.searchParams.get('stage')==='1';
  const staging=stage||(slot&&url.searchParams.get('read')!=='1');
  const args={h,o,g,fmt:slot?'docx':fmt};
  const access=()=>staging?rpc('compi_arts_stage_guide_access',args):rpc('compi_arts_file_access',{...args,editing});
  const storage=(path:string,bucket='compi-arts-catalog')=>base+'/storage/v1/object/'+bucket+'/'+path.split('/').map(encodeURIComponent).join('/');
  const serviceHeaders={apikey:admin,Authorization:'Bearer '+admin};
  const failure=(r:Response)=>r.status===401?401:[400,403,404].includes(r.status)?403:r.status===409?409:503;
  try{
   if(workspaceVariant){
    const reference=()=>rpc('compi_arts_workspace_media',{h,o,g,variant:workspaceVariant});
    const record=await reference();if(!record.ok)return reply(failure(record));
    const asset=await record.json();
    if(!asset || !/^[0-9a-f]{64}$/.test(asset.sha256) ||
      !(workspaceVariant==='clean'?asset.slot==='art':['photo','image'].includes(asset.slot)))return reply(404);
    const permitted=await rpc('compi_arts_file_access',{h,o,g,fmt:'pdf',editing:asset.draft===true});
    if(!permitted.ok)return reply(failure(permitted));
    const {prefix}=await permitted.json();
    const object=await fetch(storage(prefix+'source/'+asset.slot+'/'+asset.sha256,'compi-arts-media'),
      {headers:serviceHeaders,redirect:'error',cache:'no-store'});
    if(!object.ok)return reply(object.status>=500?503:404);
    const data=await bytes(object);
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
    if(digest!==asset.sha256)return reply(409);
    const current=await reference();if(!current.ok)return reply(failure(current));
    const latest=await current.json();if(latest?.revision!==asset.revision||latest?.sha256!==asset.sha256||latest?.slot!==asset.slot)return reply(409);
    headers.set('Content-Type',mediaType(asset.slot,data));
    return new Response(data,{headers});
   }
   const allowed=await access();if(!allowed.ok)return reply(failure(allowed));
   const info=await allowed.json();
   if(slot && url.searchParams.get('read')==='1'){
    const getSource=()=>rpc('compi_arts_guide_source',{h,o,g});
    const record=await getSource();
    if(!record.ok)return reply(failure(record));
    const source=await record.json(),asset=source?.source?.assets?.[slot];
    if(!asset||asset.sha256!==url.searchParams.get('sha'))return reply(404);
    const object=await fetch(storage(asset.ruta,'compi-arts-media'),{headers:serviceHeaders,redirect:'error',cache:'no-store'});
    if(!object.ok)return reply(object.status>=500?503:404);
    const current=await getSource();
    if(!current.ok)return reply(failure(current));
    if((await current.json())?.revision!==source.revision)return reply(409);
    headers.set('Content-Type',object.headers.get('Content-Type')||'application/octet-stream');
    return new Response(object.body,{headers});
   }
   if(!editing){
    const source=await fetch(storage(info.path),{headers:serviceHeaders,redirect:'error',cache:'no-store'});
    if(!source.ok)return reply(source.status>=500?503:404);
    const data=await bytes(source);
    if(info.drive_original){
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
      if(hash!==info.digest)return reply(409);
      const final=await access();if(!final.ok)return reply(failure(final));
      if((await final.json()).path!==info.path)return reply(409);
      headers.set('Content-Type',types[fmt]);headers.set('Content-Length',String(data.length));
      headers.set('X-CompI-Drive-Original','1');
      return new Response(data,{headers});
    }
    if(!info.digest)await validateGuideFile(fmt,data);
    if(!rebrand)return reply(503);
    for(let attempt=0;attempt<2;attempt++){
      const profile=await rpc('compi_document_brand',{h});
      if(!profile.ok)return reply(failure(profile));
      const brand=await profile.json();
      let rendered;
      try{rendered=await rebrand(fmt,data,brand,{onlyMaster:!brand.configured});}
      catch(error){
        if(!originalIfUnsupported || !(error instanceof Error) || error.name!=='UnsupportedLegacyTemplate')throw error;
        rendered=data;
      }
      const [final,rev]=await Promise.all([access(),rpc('compi_document_brand_revision',{h})]);
      if(!final.ok)return reply(failure(final));
      if(!rev.ok)return reply(failure(rev));
      if((await final.json()).path!==info.path)return reply(409);
      if(await rev.json()!==brand.revision)continue;
      headers.set('X-CompI-Brand-Revision',String(brand.revision));
      headers.set('Content-Type',types[fmt]);headers.set('Content-Length',String(rendered.length));
      return new Response(rendered,{headers});
    }
    return reply(409);
   }
   const data=await bytes(req);
   const mime=slot?mediaType(slot,data):types[fmt];
   if(!slot)await validateGuideFile(fmt,data);
   const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',data));
   const sha=Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');
   if(!slot&&!stage&&req.headers.get('x-upsert')==='false'&&info.digest&&info.digest!==sha)return reply(409);
   const dest=slot?info.prefix+'source/'+slot+'/'+sha:info.prefix+'validated/'+sha+'/ficha.'+fmt;
   const put=await fetch(storage(dest,slot?'compi-arts-media':'compi-arts-catalog'),{method:'POST',headers:{...serviceHeaders,'Content-Type':mime,'x-upsert':'false','cache-control':'0'},body:data,redirect:'error'});
   if(!put.ok){
    const err=await put.json().catch(()=>({}));
    if(err.error!=='Duplicate'&&err.code!=='Duplicate'&&String(err.statusCode)!=='409')return reply(503);
   }
   if(slot||stage)return Response.json({sha256:sha,ruta:dest},{headers});
   const commit=await rpc('compi_arts_commit_file',{...args,sha,previous:info.digest});return reply(commit.ok?200:failure(commit));
  }catch(e){if(e instanceof InvalidGuideFile)return reply(422,e.message);
    if(e instanceof Error && e.name==='UnsupportedLegacyTemplate')return Response.json({code:'BRAND_TEMPLATE_UNSUPPORTED',message:e.message},{status:422,headers});
    return reply(503);}
 };
}


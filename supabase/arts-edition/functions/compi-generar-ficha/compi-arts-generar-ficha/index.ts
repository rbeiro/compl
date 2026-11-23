import {documents, InputError, recipe} from './documents.js';

const site='https://compi-hotel-arts.leonardo-vincere.chatgpt.site';
const base=Deno.env.get('SUPABASE_URL')!;
const publicKey=Deno.env.get('SUPABASE_ANON_KEY')!;
const maxBytes=4*Math.ceil(8*1024*1024/3)+128*1024;
async function readBody(req:Request){
  if(Number(req.headers.get('Content-Length'))>maxBytes)throw new InputError('Reduce el tamaño de la foto.');
  const reader=req.body?.getReader();
  if(!reader)throw new InputError('Faltan los datos del plato.');
  const chunks:Uint8Array[]=[];let total=0;
  while(true){
    const {done,value}=await reader.read();if(done)break;
    total+=value.length;
    if(total>maxBytes){await reader.cancel();throw new InputError('Reduce el tamaño de la foto.');}
    chunks.push(value);
  }
  try{return JSON.parse(await new Blob(chunks).text());}catch{throw new InputError('Los datos del plato no tienen un formato válido.');}
}
Deno.serve(async req=>{
  const origin=req.headers.get('Origin');
  const headers=new Headers({'Cache-Control':'private, no-store','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff'});
  const output=(value:unknown,status=200)=>Response.json(value,{status,headers});
  if(origin&&![site,'https://compichef.com','https://compi-web.mcgradi3000.workers.dev','http://127.0.0.1:4173','http://localhost:4173'].includes(origin))return output({},403);
  if(origin)headers.set('Access-Control-Allow-Origin',origin);
  if(req.method==='OPTIONS'){
    headers.set('Access-Control-Allow-Headers','authorization, apikey, content-type');
    headers.set('Access-Control-Allow-Methods','POST, OPTIONS');
    return new Response(null,{status:204,headers});
  }
  if(req.method!=='POST')return output({},405);
  const url=new URL(req.url);
  const master=url.searchParams.get('rendition')==='master';
  const [endpoint,h,o]=url.pathname.split('/').filter(Boolean).slice(-3);
  if(endpoint!=='compi-arts-generar-ficha'||![h,o].every(v=>/^[a-z0-9-]{1,200}$/.test(v)))return output({},404);
  const authorization=req.headers.get('Authorization')||'';
  if(!/^Bearer [a-z0-9_.-]+$/i.test(authorization))return output({},401);
  // PostgREST verifies the JWT. The RPC checks its live session and current hotel-specific editing rank.
  const rpc=(name:string,args:object)=>fetch(base+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',cache:'no-store',
    headers:{apikey:publicKey,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify(args)});
  const permission=()=>rpc('compi_arts_generator_outlet',{h,o});
  try{
    const check=await permission();
    if(!check.ok)return output({},[401,403].includes(check.status)?check.status:503);
    const [ctx]=await check.json();if(!ctx)return output({message:'Tu cuenta no tiene permiso de edición en este outlet.'},403);
    const r=recipe(await readBody(req));
    for(let attempt=0;attempt<2;attempt++){
      const profile=await rpc('compi_document_brand',{h});
      if(!profile.ok)return output({},profile.status===401?401:profile.status===403?403:503);
      const brand=await profile.json();
      const files=await documents(r,{...ctx,hotel_key:h,master,brand:master?{accent:'345B6F',logo_png:null}:brand});
      const [current,revision]=await Promise.all([permission(),rpc('compi_document_brand_revision',{h})]);
      if(!current.ok||!revision.ok||!(await current.json()).length)return output({},403);
      const latest=await revision.json();
      if(master||latest===brand.revision)return output({...files,brand_revision:latest});
    }
    return output({},409);
  }catch(e){
    if(e instanceof InputError)return output({message:e.message},422);
    console.error('generator failed',e instanceof Error?e.name:'unknown');
    return output({message:'No se pudo generar la ficha. Vuelve a intentarlo.'},503);
  }
});


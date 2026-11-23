import {Buffer} from 'node:buffer';
import {cleanPng} from './png.js';

const site='https://compi-hotel-arts.leonardo-vincere.chatgpt.site';
const base=Deno.env.get('SUPABASE_URL')!;
const anon=Deno.env.get('SUPABASE_ANON_KEY')!;
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function body(req:Request) {
  const max=352000;
  if(Number(req.headers.get('content-length'))>max)throw Error();
  const reader=req.body?.getReader();if(!reader)throw Error();
  const chunks=[];let length=0;
  while(true){
    const {done,value}=await reader.read();if(done)break;
    length+=value.length;if(length>max){await reader.cancel();throw Error();}
    chunks.push(value);
  }
  return JSON.parse(await new Blob(chunks).text());
}
Deno.serve(async req=>{
  const origin=req.headers.get('Origin');
  const headers=new Headers({'Cache-Control':'private, no-store','Vary':'Origin, Authorization','X-Content-Type-Options':'nosniff'});
  const output=(code:number,data:unknown={})=>Response.json(data,{status:code,headers});
  if(origin && ![site,'https://compichef.com','https://compi-web.mcgradi3000.workers.dev','http://127.0.0.1:4173','http://localhost:4173'].includes(origin))return output(403);
  if(origin)headers.set('Access-Control-Allow-Origin',origin);
  if(req.method==='OPTIONS'){
    headers.set('Access-Control-Allow-Headers','authorization,apikey,content-type');
    headers.set('Access-Control-Allow-Methods','POST,OPTIONS');
    return new Response(null,{status:204,headers});
  }
  if(req.method!=='POST')return output(405);
  const [fn,h]=new URL(req.url).pathname.split('/').filter(Boolean).slice(-2);
  if(fn!=='compi-arts-marca-documental'||!/^[a-z0-9-]{1,200}$/.test(h))return output(404);
  const token=req.headers.get('Authorization')||'';
  if(!/^Bearer [A-Za-z0-9_.-]+$/i.test(token))return output(401);
  const rpc=(name:string,key:string,authorization:string,payload:unknown)=>fetch(base+'/rest/v1/rpc/'+name,{
    method:'POST',headers:{apikey:key,Authorization:authorization,'Content-Type':'application/json'},
    body:JSON.stringify(payload),redirect:'error',cache:'no-store'
  });
  try{
    // The user's JWT is verified by PostgREST before its signed claims are consumed.
    const permission=await rpc('compi_my_access',anon,token,{});
    if(!permission.ok)return output(permission.status===401?401:permission.status===403?403:503);
    if(!(await permission.json()).some((row:{hotel_key:string;access_rank:number})=>row.hotel_key===h&&row.access_rank===1))return output(403);
    const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
    const profile=await rpc('compi_document_brand',anon,token,{h});
    if(!profile.ok)return output(profile.status===401?401:403);
    const current=await profile.json();let accent,logo,revision;
    try{
      const input=await body(req);
      if(typeof input.accent!=='string'||!/^[0-9a-f]{6}$/i.test(input.accent)||!Number.isSafeInteger(input.expected_revision)||input.expected_revision<0||input.expected_revision>2147483646)throw Error();
      accent=input.accent.toUpperCase();revision=input.expected_revision;
      logo=input.logo_png===null?null:input.logo_png===current.logo_png?current.logo_png:cleanPng(input.logo_png);
    }catch{return output(422);}
    const commit=await rpc('compi_commit_document_brand',service,'Bearer '+service,{h,accent,logo_png:logo,
      expected_revision:revision,verified_sub:claims.sub,verified_session:claims.session_id,verified_aal:claims.aal});
    if(!commit.ok)return output([401,403,409].includes(commit.status)?commit.status:503);
    return output(200,await commit.json());
  }catch{return output(503);}
});


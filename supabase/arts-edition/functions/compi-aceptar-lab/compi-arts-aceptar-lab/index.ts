import {authInput} from '../_shared/auth-input.ts';
const base=Deno.env.get("SUPABASE_URL")!;
const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const site="https://compi-hotel-arts.leonardo-vincere.chatgpt.site";
const headers={apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"};
Deno.serve(async req=>{
  const responseHeaders=new Headers({"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin"});
  const reply=(code:number,data:object={})=>new Response(JSON.stringify(data),{status:code,headers:responseHeaders});
  const origin=req.headers.get("origin");
  if(origin && ![site,'https://compichef.com','https://compi-web.mcgradi3000.workers.dev','http://127.0.0.1:4173','http://localhost:4173'].includes(origin))return reply(403);
  if(origin)responseHeaders.set("Access-Control-Allow-Origin",origin);
  if(req.method==="OPTIONS"){
    responseHeaders.set("Access-Control-Allow-Headers","apikey,content-type,authorization");
    responseHeaders.set("Access-Control-Allow-Methods","POST,OPTIONS");
    return new Response(null,{status:204,headers:responseHeaders});
  }
  if(req.method!=="POST")return reply(405);
  try{
    const {ticket,password}=await authInput(req,'accept');
    if(typeof ticket!=="string" || !/^v7_[a-f0-9]{64}$/.test(ticket) || typeof password!=="string" || password.length<8 || password.length>128)return reply(400);
    const begin=await fetch(base+"/rest/v1/rpc/compi_begin_accept",{method:"POST",headers,body:JSON.stringify({ticket})});
    if(!begin.ok)return reply(begin.status===409?409:begin.status>=500?503:403);
    const info=await begin.json();
    const user={password,email_confirm:true,app_metadata:{compi_lab_attempt:info.attempt,compi_lab_staff:info.employee}};
    const create=await fetch(base+"/auth/v1/admin/users"+(info.legacy_id?"/"+info.legacy_id:""),{
      method:info.legacy_id?"PUT":"POST",headers,redirect:"error",
      body:JSON.stringify(info.legacy_id?user:{...user,email:info.email})
    });
    if(!create.ok)return reply(create.status===422?422:409);
    return reply(200,{email:info.email});
  }catch(e){return reply(typeof e==='number'?e:503);}
});


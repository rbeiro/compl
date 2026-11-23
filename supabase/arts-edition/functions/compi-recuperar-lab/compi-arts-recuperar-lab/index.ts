import {authInput} from '../_shared/auth-input.ts';
const base = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const site = "https://compi-hotel-arts.leonardo-vincere.chatgpt.site";
const serviceHeaders = {apikey:key, Authorization:"Bearer "+key, "Content-Type":"application/json"};
function call(path:string, method:string, payload:object) {
  return fetch(base+path, {method, headers:serviceHeaders, body:JSON.stringify(payload), redirect:"error"});
}
Deno.serve(async req => {
  const headers = new Headers({"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin"});
  const reply=(status:number)=>new Response(JSON.stringify({ok:status===200}),{status,headers});
  const origin=req.headers.get("Origin");
  if(origin && ![site,'https://compichef.com','https://compi-web.mcgradi3000.workers.dev','http://127.0.0.1:4173','http://localhost:4173'].includes(origin))return reply(403);
  if(origin)headers.set("Access-Control-Allow-Origin",origin);
  if(req.method==="OPTIONS"){
    headers.set("Access-Control-Allow-Headers","apikey,content-type,authorization");
    headers.set("Access-Control-Allow-Methods","POST,OPTIONS");
    return new Response(null,{status:204,headers});
  }
  if(req.method!=="POST")return reply(405);
  try{
    const {email,code,password}=await authInput(req,'recover');
    if(typeof email!=="string"||email.length>254||typeof code!=="string"||code.length>80||typeof password!=="string"||password.length<8||password.length>128)return reply(400);
    const address=email.trim().toLowerCase(), normalized=code.replace(/[\s-]/g,"").toUpperCase();
    if(!/^[a-z0-9._+-]+@compichef[.]com$/.test(address)||!/^[0-9A-F]{40}$/.test(normalized))return reply(403);
    const begin=await call("/rest/v1/rpc/compi_begin_recovery","POST",{address,code:normalized});
    if(!begin.ok)return reply(begin.status>=500?503:403);
    const {uid,attempt}=await begin.json();
    const updated=await call("/auth/v1/admin/users/"+uid,"PUT",{password,app_metadata:{compi_recovery_attempt:attempt}});
    if(updated.ok)return reply(200);
    await call("/rest/v1/rpc/compi_release_recovery","POST",{uid,lease:attempt});
    return reply(updated.status===422?422:updated.status>=500?503:403);
  }catch(e){return reply(typeof e==='number'?e:503);}
});


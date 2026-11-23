const supabase = Deno.env.get('SUPABASE_URL')!;
const publicKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const template = 'arts-plaza/plantilla/b8cb75011a6699965b81c427b312908bf8d2cd720504936044d8aaedd6189a1c.json';
const origins = new Set(['https://compi-hotel-arts.leonardo-vincere.chatgpt.site', 'https://compichef.com','https://compi-web.mcgradi3000.workers.dev', 'http://127.0.0.1:4173', 'http://localhost:4173']);

Deno.serve(async request => {
  const origin = request.headers.get('Origin');
  const headers = new Headers({'Cache-Control':'private, no-store','Vary':'Origin, Authorization','X-Content-Type-Options':'nosniff'});
  const reply = (status:number) => new Response(null,{status,headers});
  if (origin && !origins.has(origin)) return reply(403);
  if (origin) headers.set('Access-Control-Allow-Origin',origin);
  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods','POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers','apikey, authorization, content-type');
    return reply(204);
  }
  if (request.method !== 'POST') return reply(405);
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return reply(401);
  const access = await fetch(supabase+'/rest/v1/rpc/compi_my_access', {
    method:'POST',headers:{apikey:publicKey,Authorization:authorization,'Content-Type':'application/json'},
    body:'{}',redirect:'error',signal:AbortSignal.timeout(12000)
  });
  if (!access.ok) return reply([401,403].includes(access.status)?access.status:503);
  const roles = await access.json();
  if (!Array.isArray(roles) || !roles.some(row=>row.hotel_key==='hotel-arts-barcelona' && row.access_rank===1)) return reply(403);
  const data = await fetch(supabase+'/storage/v1/object/compi-arts-catalog/'+template,{
    headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey},redirect:'error',cache:'no-store'
  });
  if (!data.ok) return reply(503);
  headers.set('Content-Type','application/json; charset=utf-8');
  return new Response(data.body,{headers});
});


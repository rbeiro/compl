import {providers} from './providers.js';
import {assistantEnvironment} from './settings.js';
import {createCompositor} from './compositor.js';
import {deadlines,imageBytes,safePlan,readJson,ServiceError} from './inputs.js';

const site = 'https://compi-hotel-arts.leonardo-vincere.chatgpt.site';
const maxImageRequest = 14_100_000;
const operations = {
  status:[256,8000], watercolor:[maxImageRequest,140000],
  annotations:[maxImageRequest,130000], compose:[maxImageRequest,55000], prepare:[maxImageRequest,55000]
};
const publicCodes = new Set(['provider_quota','provider_error','provider_unavailable',
  'invalid_plan','invalid_input','invalid_image','unsupported_image','heic_unsupported','image_too_large',
  'payload_too_large','timeout','compositor_unavailable','compositor_timeout','reference_unavailable','forbidden','unauthenticated']);

export function createHandler({env:environment,request,compositorFactory = createCompositor}) {
  const masterReference = {};
  return async function handler(req) {
    const headers = {'Cache-Control':'private, no-store','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff'};
    const output = (value,status=200) => Response.json(value,{headers,status});
    const origin = req.headers.get('Origin');
    if (origin && ![site,'https://compichef.com','https://compi-web.mcgradi3000.workers.dev','http://127.0.0.1:4173','http://localhost:4173'].includes(origin)) return output({error:'forbidden'},403);
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    if (req.method === 'OPTIONS') {
      headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type';
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
      return new Response(null,{headers,status:204});
    }
    if (req.method !== 'POST') return output({error:'method_not_allowed'},405);
    const [endpoint,h,o,op] = new URL(req.url).pathname.split('/').filter(Boolean).slice(-4);
    if (endpoint !== 'compi-arts-asistente-ficha' || ![h,o].every(s => /^[a-z0-9-]{1,200}$/.test(s)) || !Object.hasOwn(operations,op))
      return output({error:'not_found'},404);
    const auth = req.headers.get('Authorization') || '';
    if (!/^Bearer [a-z0-9_.-]+$/i.test(auth)) return output({error:'unauthenticated'},401);
    const [limit,timeout] = operations[op];
    const signal = deadlines(req.signal,AbortSignal.timeout(timeout));
    async function authorize() {
      const authSignal = deadlines(signal,AbortSignal.timeout(6000));
      const response = await request(environment('SUPABASE_URL') + '/rest/v1/rpc/compi_arts_generator_outlet',{
        method:'POST',headers:{apikey:environment('SUPABASE_ANON_KEY'),Authorization:auth,'Content-Type':'application/json'},
        body:JSON.stringify({h,o}),redirect:'error',cache:'no-store',signal:authSignal
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401) throw new ServiceError('unauthenticated',401);
        if (response.status === 403) throw new ServiceError('forbidden',403);
        throw new ServiceError('provider_unavailable',503);
      }
      const allowed = await readJson(response.body,32768,authSignal);
      if (!Array.isArray(allowed) || !allowed[0]) throw new ServiceError('forbidden',403);
    }
    let candidate;
    try {
      await authorize();
      if (Number(req.headers.get('Content-Length')) > limit) throw new ServiceError('payload_too_large',413);
      if (req.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ServiceError('invalid_input',415);
      const data = await readJson(req.body,limit,signal);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ServiceError('invalid_input');
      const env = await assistantEnvironment(environment,request,op,signal);
      const compositor = compositorFactory(env,request);
      let result;
      if (op === 'status') {
        const composition = compositor.compositionAvailable() && await compositor.compositorHealthy({signal});
        return output({translation:false,composition,watercolor:!!(env('OPENAI_API_KEY') && composition && env('SUPABASE_SERVICE_ROLE_KEY'))});
      } else if (op === 'prepare') {
        imageBytes(data.photo);
        const photo = await compositor.preparePhoto(data.photo,{signal});
        imageBytes(photo);
        result = {photo};
      } else if (op === 'compose') {
        imageBytes(data.art,true);
        candidate = safePlan(data.plan);
        const {image,qa,plan} = await compositor.compose(data.art,candidate,{signal});
        imageBytes(image,true);
        result = {image,qa,plan:safePlan(plan)};
      } else {
        const ai = providers({env,request,compositor,masterReference});
        result = await ai[op](data,signal);
      }
      // A grant may have been withdrawn during a provider call.
      await authorize();
      return output(result);
    } catch (error) {
      if (signal.aborted || ['TimeoutError','AbortError'].includes(error?.name)) return output({error:'timeout'},504);
      if (publicCodes.has(error?.code) && Number.isInteger(error?.status)) {
        const details = {error:error.code};
        if (error.code === 'invalid_plan') {
          const proposal = error.plan || candidate;
          if (proposal) details.plan = proposal;
        }
        return output(details,error.status);
      }
      return output({error:'provider_unavailable'},503);
    }
  };
}


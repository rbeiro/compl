import {deadlines,readJson} from './inputs.js';

const key = 'OPENAI_API_KEY';
const worker = ['COMPI_COMPOSITOR_URL','COMPI_COMPOSITOR_TOKEN'];
const fallback = [key,...worker];
const server = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','COMPI_VISION_MODEL','COMPI_IMAGE_MODEL'];

export async function assistantEnvironment(environment,request,operation,signal) {
  const values = Object.create(null);
  for (const name of [...server,...fallback]) values[name] = environment(name);
  const needed = ['prepare','compose'].includes(operation) ? worker : fallback;
  const missing = needed.filter(name => !values[name]);
  if (missing.length && values.SUPABASE_URL && values.SUPABASE_SERVICE_ROLE_KEY) {
    const lookupSignal = deadlines(signal,AbortSignal.timeout(2000));
    try {
      const role = values.SUPABASE_SERVICE_ROLE_KEY;
      const response = await request(values.SUPABASE_URL + '/rest/v1/rpc/compi_assistant_settings',{
        method:'POST',redirect:'error',cache:'no-store',signal:lookupSignal,body:'{}',
        headers:{apikey:role,Authorization:'Bearer ' + role,'Content-Type':'application/json'}
      });
      if (response.ok) {
        const settings = await readJson(response.body,32768,lookupSignal);
        for (const name of missing) {
          if (settings && Object.hasOwn(settings,name) && typeof settings[name] === 'string' && settings[name].trim())
            values[name] = settings[name];
        }
      } else {
        await response.body?.cancel();
      }
    } catch {
      // Missing Vault access or a failed lookup leaves each hosted setting usable independently.
      if (signal.aborted) signal.throwIfAborted();
    }
  }
  Object.freeze(values);
  return name => values[name];
}


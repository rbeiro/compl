import {deadlines} from './inputs.js';

const key = 'OPENAI_API_KEY';
const worker = ['COMPI_COMPOSITOR_URL','COMPI_COMPOSITOR_TOKEN'];
const fallback = [key,...worker];
const server = ['COMPI_VISION_MODEL','COMPI_IMAGE_MODEL'];

/**
 * Assistant configuration: environment variables first, then the values the
 * database keeps for this deployment (`lookup`, e.g. Supabase Vault through
 * compi_assistant_settings). Each setting falls back independently.
 */
export async function assistantEnvironment(environment,lookup,operation,signal) {
  const values = Object.create(null);
  for (const name of [...server,...fallback]) values[name] = environment(name);
  const needed = ['prepare','compose'].includes(operation) ? worker : fallback;
  const missing = needed.filter(name => !values[name]);
  if (missing.length && lookup) {
    try {
      const settings = await lookup(deadlines(signal,AbortSignal.timeout(2000)));
      for (const name of missing) {
        if (settings && Object.hasOwn(settings,name) && typeof settings[name] === 'string' && settings[name].trim())
          values[name] = settings[name];
      }
    } catch {
      if (signal.aborted) signal.throwIfAborted();
    }
  }
  Object.freeze(values);
  return name => values[name];
}

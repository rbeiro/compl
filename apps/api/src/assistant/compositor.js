// Server-to-server only. Provider, gateway and worker error bodies are never sent to the client.
function configuration(env) {
  const value = env('COMPI_COMPOSITOR_URL');
  const token = env('COMPI_COMPOSITOR_TOKEN');
  if (!value || !token) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return { base: url.href.replace(/\/+$/, ''), token };
  } catch {
    return null;
  }
}

function failure(code, status, detail) {
  return Object.assign(new Error(code), { code, status, detail });
}

export function createCompositor(env,transport) {
  const config = configuration(env);
  async function request(path, payload, signal) {
    if (!config) throw failure('compositor_unavailable', 503);
    let response;
    try {
      const timeout = AbortSignal.timeout(payload ? 45000 : 4000);
      response = await transport(config.base + path, {
        method: payload ? 'POST' : 'GET',
        redirect: 'error',
        headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' },
        body: payload ? JSON.stringify(payload) : undefined,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout
      });
      const result = await response.json();
      if (response.ok) return result;
      const publicErrors = { invalid_plan: 422, heic_unsupported: 415, image_too_large: 413, invalid_image: 400 };
      if (Object.hasOwn(publicErrors, result?.code)) {
        const details = ['margin', 'overlap', 'label', 'label_count', 'label_text', 'duplicate_label', 'coordinates', 'arrow', 'crossing'];
        throw failure(result.code, publicErrors[result.code], details.includes(result.detail) ? result.detail : undefined);
      }
    } catch (error) {
      if (error?.status && error?.code) throw error;
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw failure('compositor_timeout', 504);
    }
    throw failure('compositor_unavailable', 503);
  }

  async function compositorHealthy({signal} = {}) {
    try {
      return (await request('/health', undefined, signal)).available === true;
    } catch {
      return false;
    }
  }

  async function normalize(art, {signal} = {}) {
    return (await request('/normalize', { art }, signal)).image;
  }

  async function preparePhoto(art, {signal} = {}) {
    return (await request('/prepare-photo', { art }, signal)).image;
  }

  function compose(art, plan, { reflow = false, signal } = {}) {
    return request('/compose', { art, plan, reflow }, signal);
  }
  return {compositionAvailable:() => Boolean(config),compositorHealthy,normalize,preparePhoto,compose};
}


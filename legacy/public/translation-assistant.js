import {bindText} from './i18n.js';

// Each pair owns its request, suggestion and undo history.
export function attachTranslation({source, target, field, request, signal}) {
  const panel = document.createElement('div');
  panel.className = 'recipe-translation';
  const live = document.createElement('div');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  const message = document.createElement('span');
  const preview = document.createElement('bdi');
  preview.lang = 'en';
  preview.dir = 'ltr';
  live.append(message, preview);
  const actions = document.createElement('div');
  panel.append(live, actions);
  target.closest('label').after(panel);

  let availability = null;
  let version = 0;
  let timer, controller, proposal, previous;
  let applying = false;

  function button(key, callback) {
    const el = document.createElement('button');
    el.type = 'button';
    el.hidden = true;
    bindText(el, key);
    el.addEventListener('click', callback, {signal});
    actions.append(el);
    return el;
  }
  function writeEnglish(value, manual) {
    applying = true;
    try {
      target.value = value;
      target.dataset.manualEdit = String(manual);
      target.dispatchEvent(new Event('input', {bubbles: true}));
    } finally {
      applying = false;
    }
  }

  const use = button('Usar sugerencia', () => {
    if (!proposal || source.value.trim() !== proposal.source) return;
    previous = target.value ? {text: target.value, manual: target.dataset.manualEdit === 'true'} : null;
    writeEnglish(proposal.text, false);
    show('applied');
    target.focus();
  });
  const discard = button('Descartar', () => {
    show('idle');
    target.focus();
  });
  const undo = button('Deshacer reemplazo', () => {
    if (!previous) return;
    writeEnglish(previous.text, previous.manual);
    previous = null;
    undo.hidden = true;
    if (!proposal) bindText(message, 'Se ha recuperado el texto anterior.');
    target.focus();
  });
  const retry = button('Reintentar', () => {
    source.focus();
    schedule(0);
  });

  const labels = {
    idle: '', unavailable: 'La sugerencia de traducción no está disponible en este outlet.',
    loading: 'Traduciendo al inglés…', ready: 'Sugerencia en inglés',
    failed: 'No se pudo traducir el texto.', applied: 'Sugerencia aplicada.'
  };
  function show(state, nextProposal = null) {
    proposal = nextProposal;
    bindText(message, labels[state]);
    preview.textContent = proposal?.text || '';
    use.hidden = discard.hidden = state !== 'ready';
    undo.hidden = !previous;
    retry.hidden = state !== 'failed';
  }
  function invalidate() {
    version++;
    clearTimeout(timer);
    controller?.abort();
    controller = null;
  }
  function schedule(delay) {
    invalidate();
    const text = source.value.trim();
    if (!text || availability !== true || signal.aborted) {
      show(availability === false ? 'unavailable' : 'idle');
      return;
    }
    show('idle');
    const id = version;
    const current = () => !signal.aborted && id === version && text === source.value.trim();
    timer = setTimeout(async () => {
      if (!current()) return;
      controller = new AbortController();
      show('loading');
      try {
        const result = await request({field, text}, controller.signal);
        if (!current()) return;
        const suggestion = typeof result === 'string' ? result.trim() : '';
        if (!suggestion || (target.maxLength > 0 && suggestion.length > target.maxLength)) {
          throw Error('invalid_suggestion');
        }
        show('ready', {text: suggestion, source: text});
      } catch {
        if (current()) show('failed');
      }
    }, delay);
  }
  function reset() {
    invalidate();
    previous = null;
    target.dataset.manualEdit = String(Boolean(target.value));
    show(availability === false ? 'unavailable' : 'idle');
  }
  reset();
  source.addEventListener('input', () => schedule(800), {signal});
  target.addEventListener('input', () => {
    if (applying) return;
    target.dataset.manualEdit = 'true';
    previous = null;
    undo.hidden = true;
  }, {signal});
  signal.addEventListener('abort', invalidate, {once: true});
  return {
    reset,
    setAvailable(value) {
      if (value === availability) return;
      availability = value;
      schedule(800);
    }
  };
}

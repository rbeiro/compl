import {motionFor} from './motion-choices.js';
import {bindText} from './i18n.js';

// El servidor marca las cuentas creadas por un ejecutivo; el token lo lleva en sus metadatos de aplicacion.
export function mustChange(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.app_metadata?.compi_must_change === 'true' && typeof payload.email === 'string' ? payload : null;
  } catch { return null; }
}

function translated(node, tag, key, cls) {
  const el = node(tag, undefined, cls);
  bindText(el, key);
  return el;
}

function field(node, form, caption, complete) {
  const label = node('label'), input = node('input');
  input.type = 'password'; input.autocomplete = complete; input.required = true; input.minLength = 10; input.maxLength = 128;
  label.append(translated(node, 'span', caption), input); form.append(label); return input;
}

export function passwordChange({main, node, api, signal, token, email, remember, render}) {
  bindText(document.querySelector('title'), 'Cambia tu contraseña · CompI');
  const content = node('div', undefined, 'auth-content recovery-view'), form = node('form');
  content.append(translated(node, 'h1', 'Elige una contraseña nueva'),
    translated(node, 'p', 'Has entrado con una contraseña temporal. Elige una propia para continuar.', 'intro'), form);
  main.append(content);
  const password = field(node, form, 'Nueva contraseña', 'new-password');
  const repeat = field(node, form, 'Repite la nueva contraseña', 'new-password');
  form.append(translated(node, 'p', 'Elige una contraseña de al menos 10 caracteres, distinta de la temporal.', 'hint'));
  const submit = translated(node, 'button', 'Guardar y continuar', 'download primary');
  submit.type = 'submit';
  const status = node('p', undefined, 'feedback'); status.setAttribute('role', 'status');
  form.append(submit); content.append(status);
  motionFor('recovery', content);
  const feedback = (key) => { bindText(status, key); motionFor('recovery', status); };
  password.focus();
  form.onsubmit = async (event) => {
    event.preventDefault(); if (submit.disabled) return;
    bindText(status, '');
    if (password.value !== repeat.value) { feedback('Las dos contraseñas deben coincidir.'); repeat.focus(); return; }
    submit.disabled = true;
    try {
      await api('/auth/v1/user', {token, signal, method: 'PUT', payload: {password: password.value}});
      await api('/rest/v1/rpc/compi_finish_password_change', {token, signal, payload: {}});
      // Sesion nueva: el token anterior aun lleva la marca de cambio pendiente.
      const fresh = await (await api('/auth/v1/token?grant_type=password', {signal, payload: {email, password: password.value}})).json();
      if (signal.aborted) return;
      if (!fresh.access_token || !(fresh.expires_in > 10)) throw new Error('Sesión inválida');
      password.value = ''; repeat.value = '';
      remember({token: fresh.access_token, until: Date.now() + 1000 * Math.min(3600, fresh.expires_in - 10)});
      await render();
    } catch (error) {
      if (signal.aborted) return;
      feedback(error.status === 422 ? 'Elige una contraseña de al menos 10 caracteres, distinta de la temporal.'
        : 'No se pudo cambiar la contraseña. Inténtalo de nuevo.');
    } finally { submit.disabled = false; }
  };
}

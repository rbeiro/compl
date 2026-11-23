import {bindText} from './i18n.js';

// Confirmacion dentro de la pagina. Sustituye a window.confirm, que algunos navegadores (y los visores integrados)
// no muestran: el boton quedaba "sin funcionar" y la accion se cancelaba en silencio.
// `message` ya viene traducido; `accept` es la clave de traduccion del boton de aceptar. Devuelve una promesa con true/false.
export function confirmDialog({message, accept, danger = false}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'mail-folder-dialog';
    dialog.setAttribute('role', 'alertdialog');
    const description = document.createElement('p');
    description.id = 'confirm-dialog-description';
    description.textContent = message;
    dialog.setAttribute('aria-describedby', description.id);
    const buttons = document.createElement('div');
    buttons.className = 'mail-actions';
    const cancel = document.createElement('button'), ok = document.createElement('button');
    cancel.type = ok.type = 'button';
    cancel.className = 'download';
    ok.className = danger ? 'download danger' : 'download primary';
    bindText(cancel, 'Cancelar');
    bindText(ok, accept);
    cancel.autofocus = true;
    cancel.onclick = () => dialog.close('cancel');
    ok.onclick = () => dialog.close('accept');
    buttons.append(cancel, ok);
    dialog.append(description, buttons);
    // Escape o clic fuera cierran sin valor: se trata como cancelar.
    dialog.addEventListener('close', () => { const accepted = dialog.returnValue === 'accept'; dialog.remove(); resolve(accepted); });
    document.body.append(dialog);
    dialog.showModal();
  });
}

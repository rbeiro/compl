// Only established brigade roles have translated display names. A custom role keeps its spelling.
import {bindComputed, locale, t} from './i18n.js';

const roles = new Map([
  ['chef ejecutivo','Chef ejecutivo'], ['chef ejecutiva','Chef ejecutivo'], ['executive chef','Chef ejecutivo'],
  ['chef de cocina','Chef de cocina'], ['jefe de cocina','Chef de cocina'], ['jefa de cocina','Chef de cocina'], ['head chef','Chef de cocina'],
  ['sous chef','Sous chef'], ['sous-chef','Sous chef'],
  ['chef de partida','Chef de partida'], ['jefe de partida','Jefe de partida'], ['jefa de partida','Jefe de partida'],
  ['cocinero','Cocinero'], ['cocinera','Cocinero'],
  ['cocinero de noche','Cocinero de noches'], ['cocinero de noches','Cocinero de noches'], ['cocinera de noche','Cocinero de noches'], ['cocinera de noches','Cocinero de noches'],
  ['ayudante de cocina','Ayudante de cocina']
]);
export function displayPosition(element, name) {
  const key=roles.get(String(name||'').trim().toLowerCase());
  if (key) bindComputed(element,()=>locale()==='es'?name:t(key));
  else element.textContent=name || '';
  return element;
}

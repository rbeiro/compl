import {attachColorPicker} from './workspace-pickers.js';
import { motionFor } from './motion-choices.js';
import {bindAttr, bindText} from './i18n.js';

export const brandChangeEvent='compi.documentBrandUpdate';
const MAX_UPLOAD = 5 * 1024 * 1024;
const LOGO_WIDTH = 402;
const LOGO_HEIGHT = 156;
const invalidImage = 'Elige una imagen PNG o JPG válida de hasta 5 MB.';
const oversizedImage = 'El logotipo supera el máximo de 8192 píxeles por lado o 16 megapíxeles.';
const invalidColor = 'Introduce un código de seis dígitos, por ejemplo #23603F.';

function colorCode(value) {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return match ? match[1].toUpperCase() : null;
}

// Check the pixel budget before asking the browser to decode the image.
function imageHeader(bytes) {
  const view = new DataView(bytes);
  if (view.byteLength >= 24 && view.getUint32(0) === 0x89504e47 &&
      view.getUint32(4) === 0x0d0a1a0a && view.getUint32(12) === 0x49484452) {
    return {width:view.getUint32(16), height:view.getUint32(20), type:'image/png'};
  }
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) throw Error(invalidImage);
  let p = 2;
  while (p + 4 <= view.byteLength && view.getUint8(p) === 0xff) {
    while (p < view.byteLength && view.getUint8(p) === 0xff) p++;
    if (p + 3 > view.byteLength) break;
    const tag = view.getUint8(p++);
    if (tag === 0xda || tag === 0xd9) break;
    const size = view.getUint16(p);
    if (size < 2 || p + size > view.byteLength) break;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(tag) && size >= 8) {
      return {height:view.getUint16(p + 3), width:view.getUint16(p + 5), type:'image/jpeg'};
    }
    p += size;
  }
  throw Error(invalidImage);
}
async function readLogo(file) {
  if (!file.size || file.size > MAX_UPLOAD) throw Error(invalidImage);
  const bytes = await file.arrayBuffer();
  const {width, height, type} = imageHeader(bytes);
  if (!width || !height) throw Error(invalidImage);
  if (width > 8192 || height > 8192 || width * height > 16_000_000) throw Error(oversizedImage);
  const image = await createImageBitmap(new Blob([bytes], {type})).catch(() => {throw Error(invalidImage);});
  try {
    const canvas = document.createElement('canvas');
    canvas.width = LOGO_WIDTH;
    canvas.height = LOGO_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw Error(invalidImage);
    const factor = Math.min(LOGO_WIDTH / image.width, LOGO_HEIGHT / image.height);
    const w = image.width * factor, h = image.height * factor;
    context.drawImage(image, (LOGO_WIDTH - w) / 2, (LOGO_HEIGHT - h) / 2, w, h);
    const data = context.getImageData(0, 0, LOGO_WIDTH, LOGO_HEIGHT).data;
    let visible = false;
    for (let i = 3; i < data.length; i += 4) if (data[i]) {visible = true; break;}
    if (!visible) throw Error('El logotipo es completamente transparente.');
    return canvas.toDataURL('image/png').split(',')[1];
  } finally {
    image.close();
  }
}
function label(tag, key, cls) {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  return bindText(element, key);
}
function button(key, cls = 'download') {
  const element = label('button', key, cls);
  element.type = 'button';
  return element;
}
function readProfile(value) {
  if (!value || !colorCode(String(value.accent)) || !Number.isSafeInteger(value.revision) ||
      value.revision < 0 || (value.logo_png !== null && typeof value.logo_png !== 'string')) throw Error();
  return {accent:colorCode(value.accent), logo_png:value.logo_png, revision:value.revision};
}

export function brandSettings({main, node, rpc, api, hotels, selected, signal}) {
  if (!hotels.length) return;
  const panel = node('div', undefined, 'document-brand'), editor = node('div', undefined, 'brand-editor');
  const description = label('p', 'El logotipo y el color se aplican a las fichas nuevas y a las que ya están en la biblioteca del hotel.', 'intro');
  const hotelLabel = label('label','Hotel'), select = node('select');
  for (const item of hotels) {
    const option = node('option', item.name);
    option.value = item.key;
    select.append(option);
  }
  select.value = selected || hotels[0].key;
  hotelLabel.append(select);
  const notice = node('p', undefined, 'feedback');
  notice.setAttribute('role','status');
  const retry = button('Volver a cargar');
  retry.hidden = true;
  panel.append(description, hotelLabel, notice, retry, editor);
  main.append(panel);

  const form = node('form', undefined, 'brand-form'), fields = node('fieldset');
  fields.append(label('legend','Identidad del hotel'));
  const colorLabel = label('label','Color de las fichas'), color = node('input');
  color.type = 'color';
  colorLabel.append(color);
  const syncColor=attachColorPicker(color,colorLabel,signal);
  const hexLabel = label('label','Código de color'), hex = node('input');
  hex.type = 'text'; hex.dir = 'ltr'; hex.autocomplete = 'off'; hex.spellcheck = false; hex.maxLength = 7;
  hexLabel.append(hex);
  const colorControls = node('div', undefined, 'brand-colors');
  colorControls.append(colorLabel, hexLabel);
  const logoLabel = label('label','Logotipo del hotel'), upload = node('input');
  upload.type = 'file'; upload.accept = 'image/png,image/jpeg';
  upload.id = 'document-brand-logo';
  logoLabel.htmlFor = upload.id;
  const picker = node('span', undefined, 'localized-file');
  picker.append(label('span','Elegir logotipo','download'), upload);
  const remove = button('Quitar logotipo');
  const logoActions = node('div', undefined, 'brand-actions');
  logoActions.append(picker, remove);
  const help = label('small','PNG o JPG de hasta 5 MB. El logotipo se ajusta a la cabecera sin recortarse.', 'hint');
  fields.append(colorControls, logoLabel, logoActions, help);
  const save = button('Guardar marca del hotel','download primary');
  save.type = 'submit';
  const undo = button('Descartar cambios'), actions = node('div', undefined, 'brand-actions');
  actions.append(save, undo);
  form.append(fields, actions);

  const preview = node('figure', undefined, 'brand-preview');
  const canvas = node('div', undefined, 'brand-header-preview');
  canvas.dir = 'ltr'; // The document header keeps its fixed positions in every portal language.
  const logo = node('img');
  logo.alt = '';
  const slot = node('div', undefined, 'brand-logo-slot');
  slot.append(logo);
  const name = node('bdi');
  canvas.append(slot, name);
  preview.append(label('figcaption','Vista previa de la cabecera'), canvas);
  editor.append(form, preview);
  editor.hidden = true;

  let original, draftLogo, loading = false, importing = false, saving = false, conflict = false, sequence = 0;
  const drafts = new Map();
  let currentHotel = select.value;
  function status(key, error = false) {
    bindText(notice, key);
    notice.classList.toggle('error', error);
  }
  function dirty() {
    return !!original && (colorCode(hex.value) !== original.accent || draftLogo !== original.logo_png);
  }
  let previewAccent, outgoingLogo;
  function refresh(animate = false) {
    const accent = colorCode(hex.value);
    const busy = loading || saving || importing;
    fields.disabled = busy;
    select.disabled = saving || importing;
    save.disabled = busy || !dirty() || !accent || conflict;
    undo.disabled = busy || !dirty() || conflict;
    remove.disabled = !draftLogo;
    if (accent) {
      color.value = '#' + accent;
      syncColor();
      canvas.style.borderBottomColor = '#' + accent;
      if (animate && previewAccent !== accent) motionFor('brand-color',canvas);
      previewAccent = accent;
    }
    hex.setAttribute('aria-invalid',String(!accent));
    const previousLogo = logo.getAttribute('src');
    if (previousLogo || draftLogo || !animate) outgoingLogo?.remove();
    logo.hidden = !draftLogo;
    if (draftLogo) {
      const src = 'data:image/png;base64,' + draftLogo;
      if (previousLogo !== src) {
        logo.src = src;
        if (animate) motionFor('brand-logo',logo);
      }
    } else {
      if (animate && previousLogo) {
        const departing = logo.cloneNode();
        departing.hidden = false;
        departing.alt = '';
        departing.setAttribute('aria-hidden','true');
        outgoingLogo = departing;
        slot.append(departing);
        motionFor('brand-logo',departing,{positive:false,finished:() => {
          departing.remove();
          if (outgoingLogo === departing) outgoingLogo = null;
        }});
      }
      logo.removeAttribute('src');
    }
    name.textContent = hotels.find(h => h.key === currentHotel).name;
  }
  async function loadHotel(restoreDraft = true) {
    const turn = ++sequence;
    original = null; draftLogo = null; logo.removeAttribute('src'); hex.value = ''; upload.value = '';
    loading = true; conflict = false; retry.hidden = true; editor.hidden = true;
    select.disabled = false;
    status('Cargando…');
    try {
      const server = readProfile(await rpc('compi_document_brand',{h:currentHotel}));
      if (turn !== sequence || signal.aborted) return;
      const saved = restoreDraft && drafts.get(currentHotel);
      original = saved && saved.revision !== server.revision ? {...server,revision:saved.revision} : server;
      hex.value = saved ? saved.hex : '#' + server.accent;
      draftLogo = saved ? saved.logo : server.logo_png;
      conflict = !!saved && saved.revision !== server.revision;
      editor.hidden = false;
      if (conflict) showConflict();
      else status('');
    } catch (error) {
      if (turn !== sequence || signal.aborted) return;
      retry.hidden = false;
      status(error.status === 403 ? 'Tu cuenta no puede cambiar la marca de este hotel.' : 'No se pudo cargar la marca del hotel.', true);
    } finally {
      if (turn === sequence && !signal.aborted) {loading = false;refresh();}
    }
  }
  function showConflict() {
    conflict = true; retry.hidden = false;
    status('Otra persona ha actualizado la marca. Vuelve a cargar la versión guardada antes de editarla.', true);
  }
  select.onchange = () => {
    if (original) {
      if (dirty()) drafts.set(currentHotel,{hex:hex.value,logo:draftLogo,revision:original.revision});
      else drafts.delete(currentHotel);
    }
    currentHotel = select.value;
    void loadHotel();
  };
  retry.onclick = () => {drafts.delete(currentHotel); void loadHotel(false);};
  color.oninput = () => {hex.value = color.value.toUpperCase(); if (!conflict) status(''); refresh(true);};
  hex.oninput = () => {if (!conflict) status(colorCode(hex.value) ? '' : invalidColor, !colorCode(hex.value)); refresh(true);};
  hex.onblur = () => {if (colorCode(hex.value)) hex.value = '#' + colorCode(hex.value);};
  remove.onclick = () => {draftLogo = null;upload.value = '';if (!conflict) status('');refresh(true);};
  undo.onclick = () => {
    hex.value = '#' + original.accent; draftLogo = original.logo_png;
    upload.value = ''; drafts.delete(currentHotel); status(''); refresh(true);
  };
  upload.onchange = async () => {
    const file = upload.files[0];
    if (!file || !original) return;
    importing = true;refresh();
    try {
      const png = await readLogo(file);
      if (!signal.aborted) {draftLogo = png;if (!conflict) status('');}
    } catch (e) {
      if (!signal.aborted) status([invalidImage,oversizedImage,'El logotipo es completamente transparente.'].includes(e.message) ? e.message : invalidImage,true);
    } finally {
      if (!signal.aborted) {importing = false;upload.value = '';refresh(true);}
    }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (save.disabled || !original) return;
    const h = currentHotel, accent = colorCode(hex.value);
    saving = true;refresh();status('Guardando la marca…');
    try {
      const saved = readProfile(await (await api('/functions/v1/compi-marca-documental/'+encodeURIComponent(h),
        {payload:{accent,logo_png:draftLogo,expected_revision:original.revision}})).json());
      if (signal.aborted) return;
      original = saved;draftLogo = saved.logo_png;hex.value = '#' + saved.accent;
      drafts.delete(h);
      window.dispatchEvent(new window.Event(brandChangeEvent));
      try {localStorage.setItem(brandChangeEvent,crypto.randomUUID());} catch { /* Optional cross-tab notification. */ }
      status('Marca guardada. Las fichas de este hotel ya utilizan estos ajustes.');
    } catch (error) {
      if (signal.aborted) return;
      if (error.status === 409 || error.code === 'PT409') showConflict();
      else if (error.status === 422) status('El servidor no ha podido validar el logotipo o el color. Revisa los cambios.',true);
      else status(error.status === 403 ? 'Tu cuenta no puede cambiar la marca de este hotel.' : 'No se pudo guardar la marca. Tus cambios siguen en pantalla.',true);
    } finally {
      if (!signal.aborted) {saving = false;refresh();}
    }
  };
  void loadHotel();
}

export function generatorPanels({main,node,signal,rpc,api,hotels,selectedHotel}) {
  if (!hotels.length) return main;
  const nav = node('div', undefined, 'generator-tabs');
  nav.setAttribute('role','tablist');
  bindAttr(nav,'aria-label','Generación de recetas');
  const tabs = [button('Crear receta'),button('Marca de las fichas')];
  const panels = tabs.map(() => node('section'));
  let opened = false;
  function activate(index) {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected',String(i === index)); tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    if (index === 1 && !opened) {
      opened = true;
      const outlet=panels[0].querySelector('select[name=recipeDestination]')?.selectedOptions[0];
      const hotel=hotels.some(item=>item.key===outlet?.dataset.hotelKey)?outlet.dataset.hotelKey:selectedHotel;
      brandSettings({main:panels[1],node,rpc,api,hotels,selected:hotel,signal});
    }
  }
  tabs.forEach((tab,i) => {
    tab.id = 'generator-tab-' + i; panels[i].id = 'generator-panel-' + i;
    tab.setAttribute('role','tab');tab.setAttribute('aria-controls',panels[i].id);
    panels[i].setAttribute('role','tabpanel');panels[i].setAttribute('aria-labelledby',tab.id);
    tab.onclick = () => activate(i);
    tab.onkeydown = event => {
      const target = ({ArrowRight:1-i,ArrowLeft:1-i,Home:0,End:1})[event.key];
      if (target === undefined) return;
      event.preventDefault();activate(target);tabs[target].focus();
    };
  });
  nav.append(...tabs);main.append(nav,...panels);activate(0);
  return panels[0];
}

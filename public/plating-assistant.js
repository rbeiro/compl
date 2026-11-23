import {bindAttr, bindText} from './i18n.js';
import { motionFor } from './motion-choices.js';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const badFile = 'Elige una foto JPG, PNG o WebP de hasta 10 MB.';
const badHeic = 'Exporta la foto HEIC o HEIF como JPG desde tu móvil y vuelve a elegirla.';
const failed = 'No se pudo completar la acuarela. Puedes reintentar o usar la foto.';
const heic = file => /image\/hei[cf](?:-sequence)?$/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

function fileData(file) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(Error('No se ha podido abrir la imagen seleccionada.'));
    reader.readAsDataURL(file);
  });
}

async function decodePhoto(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, {imageOrientation:'from-image'}); }
    catch { /* Some mobile browsers only decode their native formats on an img. */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally { URL.revokeObjectURL(url); }
}

async function preparePhoto(file) {
  if (file.size > MAX_PHOTO_BYTES || !file.size) throw Error(badFile);
  const native = ['image/jpeg','image/png','image/webp'].includes(file.type)
    || (!file.type && /\.(?:jpe?g|png|webp)$/i.test(file.name));
  if (!native && !heic(file)) throw Error(badFile);
  const image = await decodePhoto(file).catch(() => {
    throw Error(heic(file) ? badHeic : 'No se ha podido abrir la imagen seleccionada.');
  });
  try {
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    const ratio = Math.min(1, 1250 / Math.max(width,height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(width * ratio));
    canvas.height = Math.max(1,Math.round(height * ratio));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',.83).split(',')[1];
  } finally { image.close?.(); }
}

function newArrow(arrow, target) {
  const [start, first, second, end] = arrow;
  const penultimate = second.map((v,i) => Math.max(0,Math.min(1,v + (target[i] - end[i]) * 2 / 3)));
  return [start,first,penultimate,target];
}

export function attachPlating({box,node,caption,button,withHelp,request,signal,readDish}) {
  let source = null, kind = 'foto', result = null, work = null;
  let availability = null, canPrepare = false, hasOutlet = false, checking = false, operation, pendingPhoto, photoVersion = 0;
  let editing = -1, retry = null;
  const photoLabel = node('bdi');
  const gallery = node('input'), camera = node('input');
  for (const input of [gallery,camera]) {
    input.type = 'file';
    input.hidden = true;
    input.addEventListener('change', () => {
      const file = input.files[0];
      input.value = '';
      if (file) selectFile(file);
    });
  }
  gallery.accept = 'image/jpeg,image/png,image/webp,.heic,.heif';
  camera.accept = 'image/*';
  camera.setAttribute('capture','environment');

  const pick = button('Elegir foto', () => gallery.click());
  const snap = button('Tomar foto', () => camera.click());
  snap.hidden = !window.isSecureContext || !('capture' in camera)
    || !(navigator.maxTouchPoints || window.matchMedia('(pointer: coarse)').matches);
  const emptyLabel = caption('bdi','Ninguna foto seleccionada');
  const selectTools = node('div',undefined,'toolbar');
  selectTools.append(pick,snap,emptyLabel,photoLabel);

  const run = button('Generar acuarela con flechas', () => generate(!work || !!result));
  const again = button('Reintentar', () => retry?.());
  again.hidden = true;
  const actions = node('div',undefined,'toolbar plating-actions');
  actions.append(run,again);
  const status = node('p',undefined,'hint');
  status.setAttribute('role','status');

  const compare = node('div',undefined,'plating-compare');
  function card(title,choice) {
    const figure = node('figure');
    const heading = caption('figcaption',title);
    const viewer = node('div',undefined,'plating-viewer');
    const img = node('img');
    bindAttr(img,'alt',title);
    viewer.append(img);
    const label = node('label',undefined,'recipe-photo-label');
    const radio = node('input');
    radio.type = 'radio';
    radio.name = 'imagen_aprobada';
    radio.value = choice;
    radio.addEventListener('change', () => {
      if (!radio.checked || kind === choice) return;
      kind = choice;
      invalidateCheck();
      renderChoice();
    });
    label.append(radio,caption('span',choice === 'foto' ? 'Usar foto' : 'Usar acuarela'));
    figure.append(heading,viewer,label);
    compare.append(figure);
    return {figure,viewer,img,radio};
  }
  const original = card('Foto del plato','foto');
  const drawing = card('Acuarela con flechas','acuarela');
  const hotspots = node('div',undefined,'plating-hotspots');
  drawing.viewer.append(hotspots);

  const editor = node('div',undefined,'plating-editor');
  const selectLabel = caption('label','Toca un rótulo para corregirlo.');
  const labels = node('select');
  selectLabel.append(labels);
  const editFields = node('div',undefined,'plating-edit-fields');
  const editLabel = caption('label','Texto del rótulo');
  const text = node('textarea');
  text.rows = 3;
  text.maxLength = 180;
  text.lang = 'es';
  editLabel.append(text);
  const coords = node('div',undefined,'plating-coords');
  const inputs = ['Destino horizontal (%)','Destino vertical (%)'].map(key => {
    const label = caption('label',key);
    const input = node('input');
    input.type = 'number';
    // Corrections are submitted independently of the recipe review form.
    input.setAttribute('form','plating-coordinate-editor');
    input.min = '0';
    input.max = '100';
    input.step = 'any';
    label.append(input);
    coords.append(label);
    return input;
  });
  const apply = button('Aplicar corrección', () => correct(),true);
  const cancel = button('Cancelar', () => {
    closeEditor();
    labels.focus();
    motionFor('guide-caption-edit',selectLabel);
  });
  const editActions = node('div',undefined,'toolbar');
  editActions.append(apply,cancel);
  editFields.append(editLabel,caption('small','Toca la imagen para mover la punta de la flecha.'),coords,editActions);
  editor.append(selectLabel,editFields);

  const manual = node('input');
  manual.type = 'checkbox';
  manual.name = 'ingredientes_en_foto';
  const manualLabel = node('label',undefined,'recipe-photo-label');
  manualLabel.append(manual,caption('span','La foto ya incluye la lista completa de ingredientes'));
  const reminder = caption('small','Revisa si la imagen incluye la lista completa de ingredientes.','hint');
  reminder.setAttribute('role','status');
  reminder.hidden = true;
  manual.addEventListener('change',() => { reminder.hidden = true; });
  box.append(caption('p','Foto del plato (opcional)'),gallery,camera,withHelp(selectTools,'foto',pick,snap),
    caption('small','JPG, PNG o WebP · Hasta 10 MB.'),actions,status,compare,editor,
    withHelp(manualLabel,'ingredientes_en_foto',manual),reminder);

  function invalidateCheck() {
    manual.checked = false;
    reminder.hidden = !source;
  }
  function renderChoice() {
    original.radio.checked = kind === 'foto';
    drawing.radio.checked = kind === 'acuarela';
    manual.disabled = !source;
  }
  function message(key, onRetry = null) {
    bindText(status,key);
    retry = onRetry;
    again.hidden = !onRetry;
  }
  function idleMessage() {
    if (!hasOutlet) message('Selecciona un outlet para generar la acuarela.');
    else if (checking) message('Comprobando disponibilidad…');
    else if (!availability) message('La acuarela no está disponible en este outlet. Puedes usar la foto.');
    else message('');
  }
  function stopOperation() {
    operation?.abort();
    operation = null;
  }
  function isActive(controller) {
    return operation === controller && !controller.signal.aborted && !signal.aborted;
  }
  function closeEditor() {
    editing = -1;
    labels.value = '';
    editFields.hidden = true;
    apply.disabled = cancel.disabled = false;
    hotspots.hidden = false;
    drawing.viewer.classList.remove('is-targeting');
    // Hidden inputs must never affect form validation.
    for (const input of inputs) input.disabled = true;
  }
  function chooseLabel(index) {
    if (operation || !result?.plan[index]) return;
    editing = index;
    labels.value = String(index);
    const item = result.plan[index];
    text.value = item.text;
    item.arrow[3].forEach((value,i) => {
      inputs[i].disabled = false;
      inputs[i].value = String(Number((value * 100).toFixed(4)));
    });
    editFields.hidden = false;
    hotspots.hidden = true;
    drawing.viewer.classList.add('is-targeting');
    text.focus();
    motionFor('guide-caption-edit',editFields);
  }
  labels.addEventListener('change',() => labels.value === '' ? closeEditor() : chooseLabel(Number(labels.value)));
  drawing.viewer.addEventListener('click',event => {
    if (editing < 0 || operation) return;
    const rect = drawing.viewer.getBoundingClientRect();
    const ratios = [(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height];
    inputs.forEach((input,i) => { input.value = String(Number((Math.max(0,Math.min(1,ratios[i]))*100).toFixed(4))); });
  });
  function rebuildEditor() {
    hotspots.replaceChildren();
    labels.replaceChildren();
    const blank = caption('option','Toca un rótulo para corregirlo.');
    blank.value = '';
    labels.append(blank);
    for (const [index,item] of (result?.plan || []).entries()) {
      const name = item.text.replace(/\s+/g,' ');
      const opt = node('option',name);
      opt.value = String(index);
      labels.append(opt);
      const hit = node('button',undefined,'plating-hotspot');
      hit.type = 'button';
      hit.setAttribute('aria-label',name);
      hit.lang = 'es';
      hit.style.left = (item.xy[0]*100)+'%';
      hit.style.top = (item.xy[1]*100)+'%';
      const lines = item.text.split('\n');
      const context = document.createElement('canvas').getContext('2d');
      context.font = '44px "Liberation Serif", "Times New Roman", serif';
      hit.style.width = (Math.max(...lines.map(line => context.measureText(line).width))/1600*100)+'%';
      hit.style.height = (lines.length*51/1200*100)+'%';
      hit.addEventListener('click',event => { event.stopPropagation(); chooseLabel(index); });
      hotspots.append(hit);
    }
    closeEditor();
  }
  function draw() {
    compare.hidden = !source;
    drawing.figure.hidden = !result?.image;
    editor.hidden = !result?.image;
    emptyLabel.hidden = !!source;
    photoLabel.hidden = !source;
    photoLabel.textContent = source?.original?.name || '';
    const photoURL = source && 'data:image/jpeg;base64,'+source.photo;
    if (!photoURL) original.img.removeAttribute('src');
    else if (photoURL !== original.img.getAttribute('src')) original.img.src = photoURL;
    const artURL = result?.image && 'data:image/png;base64,'+result.image;
    if (!artURL) drawing.img.removeAttribute('src');
    else if (artURL !== drawing.img.getAttribute('src')) drawing.img.src = artURL;
    bindText(run,result ? 'Regenerar acuarela' : 'Generar acuarela con flechas');
    run.disabled = !!operation || !!pendingPhoto || !source || !availability;
    labels.disabled = !!operation || !availability;
    renderChoice();
  }
  async function selectFile(file) {
    const version = ++photoVersion;
    stopOperation();
    closeEditor();
    message('Preparando la foto…');
    pendingPhoto = (async () => {
      try {
        const photo = await preparePhoto(file).catch(async error => {
          if (error.message !== badHeic || !canPrepare) throw error;
          try { return (await request('prepare',{photo:await fileData(file)},signal)).photo; }
          catch { throw Error(badHeic); }
        });
        if (version !== photoVersion || signal.aborted) return;
        const replaced = !!source;
        source = {original:file,photo};
        if (replaced) invalidateCheck();
        kind = 'foto';
        result = work = null;
        rebuildEditor();
        idleMessage();
      } catch (error) {
        if (version === photoVersion && !signal.aborted) message([badFile,badHeic].includes(error.message) ? error.message : 'No se ha podido abrir la imagen seleccionada.');
      }
    })();
    draw();
    await pendingPhoto;
    if (version === photoVersion && !signal.aborted) {
      pendingPhoto = null;
      draw();
      if (source?.original === file) {
        // Large phone photos can take a frame or two to paint after the DOM updates.
        if (original.img.decode) await original.img.decode().catch(() => {});
        if (version === photoVersion && !signal.aborted) motionFor('photo-preview',original.img);
      }
    }
  }
  function finish(next) {
    if (kind === 'acuarela' && result?.image !== next.image) invalidateCheck();
    result = next;
    rebuildEditor();
    draw();
  }
  async function generate(fresh) {
    if (operation || !source || !availability || pendingPhoto) return;
    const dish = readDish();
    if (!dish.name || !dish.ingredients.length || dish.ingredients.some(row => !row.nombre)) {
      message('Indica el nombre del plato y sus ingredientes para generar la acuarela.');
      return;
    }
    closeEditor();
    const snapshot = JSON.stringify(dish);
    if (fresh || work?.snapshot !== snapshot) work = {snapshot};
    const job = work;
    const controller = new AbortController();
    operation = controller;
    draw();
    try {
      if (!job.art) {
        message('Generando la acuarela…');
        const photo = await fileData(source.original);
        if (!isActive(controller)) return;
        const response = await request('watercolor',{photo,...dish},controller.signal);
        if (!isActive(controller)) return;
        Object.assign(job,response);
      }
      if (!job.plan) {
        message('Situando los rótulos…');
        const response = await request('annotations',{art:job.art,...dish},controller.signal);
        if (!isActive(controller)) return;
        job.plan = response.plan;
        if (response.image && response.qa) {
          job.image = response.image;
          job.qa = response.qa;
        }
      }
      message('Componiendo las flechas…');
      const composed = job.image ? job : await request('compose',{art:job.art,plan:job.plan},controller.signal);
      if (!isActive(controller)) return;
      finish({...job,...composed,plan:composed.plan || job.plan});
      work = null;
      message('Se ha actualizado la acuarela.');
    } catch (error) {
      if (!isActive(controller)) return;
      if (error.status === 422 && job.plan) delete job.plan;
      message(failed,() => generate(false));
    } finally {
      if (isActive(controller)) { operation = null; draw(); }
    }
  }
  async function correct() {
    if (operation || editing < 0 || !availability || !result) return;
    const typed = text.value.trim();
    if (!typed || inputs.some(input => input.value === '' || !input.reportValidity())) { text.focus(); return; }
    const index = editing, entry = result.plan[index], target = inputs.map(input => Number(input.value)/100);
    const plan = result.plan.map((item,i) => i === index ? {...entry,text:typed,arrow:newArrow(entry.arrow,target)} : item);
    const controller = new AbortController();
    operation = controller;
    draw();
    apply.disabled = cancel.disabled = true;
    message('Componiendo las flechas…');
    try {
      const revised = await request('compose',{art:result.art,plan},controller.signal);
      if (!isActive(controller)) return;
      finish({...result,...revised,plan:revised.plan || plan});
      message('La imagen fue corregida.');
      motionFor('guide-caption-edit',drawing.img);
    } catch {
      if (isActive(controller)) message(failed,correct);
    } finally {
      if (isActive(controller)) {
        operation = null;
        apply.disabled = cancel.disabled = false;
        draw();
      }
    }
  }
  function dishChanged(ingredientsChanged) {
    if (ingredientsChanged && source) invalidateCheck();
    if (operation || work) {
      stopOperation();
      work = null;
      closeEditor();
      idleMessage();
      draw();
    }
  }
  function changeOutlet() {
    ++photoVersion;
    pendingPhoto = null;
    stopOperation();
    work = result = null;
    if (kind === 'acuarela') invalidateCheck();
    kind = 'foto';
    rebuildEditor();
    draw();
  }
  function setOutlet(selected, available, loading = false, prepare = false) {
    canPrepare = prepare;
    hasOutlet = selected;
    availability = available;
    checking = loading;
    stopOperation();
    closeEditor();
    idleMessage();
    draw();
  }
  function reset() {
    ++photoVersion;
    pendingPhoto = null;
    stopOperation();
    source = result = work = null;
    kind = 'foto';
    manual.checked = false;
    reminder.hidden = true;
    rebuildEditor();
    idleMessage();
    draw();
  }
  signal.addEventListener('abort',() => { ++photoVersion; stopOperation(); },{once:true});
  reset();
  return {
    setOutlet, changeOutlet, reset, dishChanged,
    restore(media,checked) {
      if (!media?.photo || !media.original) return;
      source = {original:media.original,photo:media.photo};
      result = media.art && media.image ? media : null;
      if (!result && media.art) {
        work = {art:media.art,plan:media.plan,master_sha256:media.master_sha256,
          prompt_sha256:media.prompt_sha256,snapshot:media.snapshot || JSON.stringify(readDish())};
      }
      kind = result && media.kind === 'acuarela' ? 'acuarela' : 'foto';
      manual.checked = !!checked;
      rebuildEditor();
      draw();
    },
    async getMedia() {
      if (pendingPhoto) await pendingPhoto;
      if (!source) return null;
      const media = {original:source.original,photo:source.photo,kind};
      const saved = result || work;
      if (saved?.art) {
        for (const key of ['art','image','plan','qa','master_sha256','prompt_sha256','snapshot']) {
          if (saved[key] !== undefined) media[key] = saved[key];
        }
      }
      return {...media,checked:manual.checked};
    }
  };
}

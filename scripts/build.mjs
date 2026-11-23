import {constants} from 'node:fs';
import {copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm} from 'node:fs/promises';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const minimumNode = '22.12';
const moduleFile = fileURLToPath(import.meta.url);
const exactExceptions = new Set([
  'brand/fonts/FUENTES_Y_LICENCIAS.txt',
  'vendor/bergamot/NOTICE.txt',
  'vendor/bergamot/LICENSE',
  'vendor/zip/LICENSE',
  'vendor/pdf/LICENSE',
  'vendor/pdfjs-5.6.205/LICENSE'
]);

function checkRuntime() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    throw Error('Se necesita Node.js ' + minimumNode + ' o posterior.');
  }
}

function allowedType(path) {
  return /\.(?:html|css|js|svg|png|ico|webp|woff2|webmanifest)$/.test(path)
    || exactExceptions.has(path)
    || /^brand\/fonts\/OFL-.*\.txt$/.test(path)
    || /^vendor\/bergamot\/.*\.wasm$/.test(path)
    || /^vendor\/pdfjs-5\.6\.205\/.*\.(?:bcmap|pfb|ttf|wasm|icc)$/.test(path)
    || /^vendor\/pdfjs-5\.6\.205\/.*\/LICENSE[^/]*$/.test(path);
}

function checkPath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.endsWith('/')) {
    throw Error('El manifiesto contiene una ruta relativa no valida.');
  }
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..'
      || /[<>:"\\|?*\x00-\x1f]/u.test(part)
      || /[. ]$/.test(part)
      || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part))) {
    throw Error('Ruta no portable o fuera de public: ' + path);
  }
  return parts;
}

function inside(parent, path) {
  const part = relative(parent, path);
  return part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part);
}

async function plainDirectory(path, label) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw Error(label + ' debe ser una carpeta normal, sin enlaces.');
  }
}

async function existing(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function loadManifest(root) {
  await plainDirectory(join(root, 'scripts'), 'scripts');
  const path = join(root, 'scripts', 'public-files.json');
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw Error('public-files.json debe ser un archivo normal, sin enlaces.');
  }
  // Para anadir recursos, revisa cada archivo y edita manualmente esta lista de
  // rutas relativas a public/. El build nunca incorpora archivos nuevos por si solo.
  const files = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(files) || !files.length) {
    throw Error('public-files.json debe contener una lista no vacia de rutas.');
  }
  const seen = new Set();
  const names = new Map();
  const directories = new Set();
  for (const file of files) {
    const parts = checkPath(file);
    if (seen.has(file)) throw Error('Ruta duplicada en el manifiesto: ' + file);
    seen.add(file);
    for (let i = 1; i <= parts.length; i++) {
      const name = parts.slice(0, i).join('/');
      const kind = i === parts.length ? 'file' : 'directory';
      const key = name.toLowerCase();
      const previous = names.get(key);
      if (previous && (previous.name !== name || previous.kind !== kind)) {
        throw Error('Colision de nombres en Windows: ' + previous.name + ' / ' + name);
      }
      names.set(key, {name, kind});
      if (kind === 'directory') directories.add(name);
    }
    if (!allowedType(file)) throw Error('Tipo de archivo no autorizado: ' + file);
  }
  if (!seen.has('index.html')) throw Error('El manifiesto debe incluir index.html.');
  return {files: [...seen].sort(), approved: seen, directories};
}

async function checkSource(source, manifest) {
  await plainDirectory(source, 'public');
  const found = new Set();
  async function visit(path, prefix = '') {
    for (const name of (await readdir(path)).sort()) {
      const file = prefix ? prefix + '/' + name : name;
      checkPath(file);
      const full = join(path, name);
      const info = await lstat(full);
      if (info.isSymbolicLink()) throw Error('Enlace no autorizado en public: ' + file);
      if (info.isDirectory()) {
        if (!manifest.directories.has(file)) throw Error('Directorio no aprobado en public: ' + file);
        await visit(full, file);
      } else if (info.isFile()) {
        if (!manifest.approved.has(file)) throw Error('Archivo no aprobado en public: ' + file);
        if (file === 'index.html' && !info.size) throw Error('public/index.html esta vacio.');
        found.add(file);
      } else {
        throw Error('Tipo de archivo especial no autorizado en public: ' + file);
      }
    }
  }
  await visit(source);
  const missing = manifest.files.filter(file => !found.has(file));
  if (missing.length) throw Error('Recurso aprobado ausente: ' + missing.join(', '));
}

async function copyApproved(source, target, files) {
  await mkdir(target);
  for (const file of files) {
    const input = join(source, ...file.split('/'));
    const output = join(target, ...file.split('/'));
    const info = await lstat(input);
    if (info.isSymbolicLink() || !info.isFile() || !inside(source, await realpath(input))) {
      throw Error('Recurso ausente, especial o enlazado: ' + file);
    }
    await mkdir(dirname(output), {recursive: true});
    await copyFile(input, output, constants.COPYFILE_EXCL);
  }
}

export async function build(projectRoot) {
  checkRuntime();
  if (typeof projectRoot !== 'string' || !projectRoot) throw Error('Falta la carpeta del proyecto.');
  await plainDirectory(resolve(projectRoot), 'El proyecto');
  const root = await realpath(resolve(projectRoot));
  const source = join(root, 'public');
  const output = join(root, 'dist');
  const manifest = await loadManifest(root);
  await checkSource(source, manifest);

  // This exclusive directory also prevents simultaneous builds or reuse of a
  // previous interrupted build that might still hold the original dist.
  const work = join(root, '.compi-build');
  try { await mkdir(work); }
  catch (error) {
    if (error.code === 'EEXIST') {
      throw Error('Ya existe .compi-build. Revisa una posible compilacion interrumpida antes de continuar.');
    }
    throw error;
  }
  const next = join(work, 'next');
  const previous = join(work, 'previous');
  let moved = false;
  let preserve = false;
  try {
    await copyApproved(source, next, manifest.files);
    // Recheck the closed inventory and file types before replacing dist.
    await checkSource(source, manifest);
    const index = await lstat(join(next, 'index.html'));
    if (!index.isFile() || !index.size) throw Error('La copia de index.html esta vacia.');
    const old = await existing(output);
    if (old) {
      if (old.isSymbolicLink() || !old.isDirectory()) {
        throw Error('dist debe ser una carpeta normal, sin enlaces.');
      }
      await rename(output, previous);
      moved = true;
    }
    try { await rename(next, output); }
    catch (error) {
      if (moved) {
        try { await rename(previous, output); }
        catch (restoreError) {
          preserve = true;
          throw new AggregateError([error, restoreError],
            'No se pudo restaurar dist. Su contenido anterior se conserva en ' + previous);
        }
      }
      throw error;
    }
  } finally {
    if (!preserve) await rm(work, {recursive: true, force: true});
  }
  return {files: manifest.files.length, directory: output};
}

if (process.argv[1] && resolve(process.argv[1]) === moduleFile) {
  try {
    if (process.argv.length > 2) throw Error('Uso: node scripts/build.mjs');
    const result = await build(resolve(dirname(moduleFile), '..'));
    console.log('Compilacion lista: ' + result.files + ' archivos en ' + result.directory);
  } catch (error) {
    console.error('CompI: ' + error.message);
    process.exitCode = 1;
  }
}

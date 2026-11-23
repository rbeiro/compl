import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {build} from '../scripts/build.mjs';

const basicFiles = {
  'index.html': '<!doctype html><title>CompI fixture</title>\n',
  'app.js': 'export const fixture = true;\r\n'
};

async function put(root, path, value) {
  const file = join(root, ...path.split('/'));
  await mkdir(dirname(file), {recursive: true});
  await writeFile(file, value);
}

async function fixture(t, files = basicFiles, manifest = Object.keys(files)) {
  const root = await mkdtemp(join(tmpdir(), 'compi-build-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'public'));
  await put(root, 'scripts/public-files.json', JSON.stringify(manifest));
  for (const [path, content] of Object.entries(files)) await put(root, 'public/' + path, content);
  return root;
}

async function paths(root, prefix = '') {
  const result = [];
  for (const item of await readdir(join(root, prefix), {withFileTypes: true})) {
    const path = prefix ? prefix + '/' + item.name : item.name;
    if (item.isDirectory()) result.push(...await paths(root, path));
    else result.push(path);
  }
  return result.sort();
}

async function previousDist(root) {
  await put(root, 'dist/index.html', 'Previous working release\r\n');
  await put(root, 'dist/assets/keep.txt', Buffer.from([0, 1, 2, 255]));
}

async function unchangedDist(root) {
  assert.deepEqual(await paths(join(root, 'dist')), ['assets/keep.txt', 'index.html']);
  assert.equal(await readFile(join(root, 'dist/index.html'), 'utf8'), 'Previous working release\r\n');
  assert.deepEqual(await readFile(join(root, 'dist/assets/keep.txt')), Buffer.from([0, 1, 2, 255]));
}

test('copies only approved public bytes and removes stale output on rebuild', async t => {
  const files = {
    ...basicFiles,
    'vendor/bergamot/engine.wasm': Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
    'vendor/bergamot/LICENSE': 'Fixture license notice\n',
    'brand/fonts/OFL-Fixture.txt': 'Fixture font license\n'
  };
  const root = await fixture(t, files);
  await put(root, '.env', 'PRIVATE_FIXTURE_NOT_A_REAL_SECRET\n');
  await put(root, 'datos-locales/private.json', '{"fixture":"private"}\n');
  await put(root, 'supabase/private.sql', '-- Must not be published\n');
  await previousDist(root);

  const result = await build(root);
  assert.equal(result.files, Object.keys(files).length);
  assert.deepEqual(await paths(join(root, 'dist')), Object.keys(files).sort());
  for (const [path, content] of Object.entries(files)) {
    assert.deepEqual(await readFile(join(root, 'dist', ...path.split('/'))), Buffer.from(content));
  }
  assert.equal(await readFile(join(root, 'datos-locales/private.json'), 'utf8'), '{"fixture":"private"}\n');
  await put(root, 'dist/stale.js', 'Old output that must disappear\n');
  await build(root);
  assert.deepEqual(await paths(join(root, 'dist')), Object.keys(files).sort());
});

test('rejects unapproved public files without changing the existing dist', async t => {
  for (const extra of ['debug.js', '.env']) {
    await t.test(extra, async t => {
      const root = await fixture(t);
      await previousDist(root);
      await put(root, 'public/' + extra, 'Unapproved fixture content\n');
      await assert.rejects(build(root), /Archivo no aprobado/);
      await unchangedDist(root);
    });
  }
});

test('rejects a missing approved asset without changing the existing dist', async t => {
  const root = await fixture(t, {'index.html': basicFiles['index.html']}, ['index.html', 'app.js']);
  await previousDist(root);
  await assert.rejects(build(root), /Recurso aprobado ausente: app\.js/);
  await unchangedDist(root);
});

test('manifest cannot escape public or create Windows output collisions', async t => {
  const unsafe = [
    ['outside path', ['index.html', '../outside.js'], /Ruta no portable/],
    ['Windows path', ['index.html', 'C:\\outside.js'], /Ruta no portable/],
    ['duplicate', ['index.html', 'index.html'], /Ruta duplicada/],
    ['case collision', ['index.html', 'app.js', 'App.js'], /Colision de nombres/],
    ['directory case collision', ['index.html', 'Brand/a.js', 'brand/b.js'], /Colision de nombres/],
    ['unapproved file type', ['index.html', 'private.env'], /Tipo de archivo no autorizado/]
  ];
  for (const [name, manifest, error] of unsafe) {
    await t.test(name, async t => {
      const root = await fixture(t, basicFiles, manifest);
      await put(root, 'outside.js', 'Outside fixture bytes\n');
      await previousDist(root);
      await assert.rejects(build(root), error);
      await unchangedDist(root);
      assert.equal(await readFile(join(root, 'outside.js'), 'utf8'), 'Outside fixture bytes\n');
    });
  }
});

test('rejects a listed asset symlink without exposing the external file', async t => {
  const root = await fixture(t);
  await previousDist(root);
  await put(root, 'outside.js', 'Outside fixture bytes\n');
  await rm(join(root, 'public/app.js'));
  try { await symlink(join(root, 'outside.js'), join(root, 'public/app.js'), 'file'); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('This Windows account cannot create file symlinks.');
      return;
    }
    throw error;
  }
  await assert.rejects(build(root), /Enlace no autorizado/);
  await unchangedDist(root);
  assert.equal(await readFile(join(root, 'outside.js'), 'utf8'), 'Outside fixture bytes\n');
});

test('rejects an extra linked directory before traversing it', async t => {
  const root = await fixture(t);
  await previousDist(root);
  await put(root, 'datos-locales/private.json', '{"fixture":"private"}\n');
  await symlink(join(root, 'datos-locales'), join(root, 'public/private'), 'junction');
  await assert.rejects(build(root), /Enlace no autorizado/);
  await unchangedDist(root);
  assert.equal(await readFile(join(root, 'datos-locales/private.json'), 'utf8'), '{"fixture":"private"}\n');
});

test('rejects a linked dist and leaves its external target untouched', async t => {
  const root = await fixture(t);
  await put(root, 'outside-dist/keep.txt', 'External release\n');
  await symlink(join(root, 'outside-dist'), join(root, 'dist'), 'junction');
  await assert.rejects(build(root), /dist debe ser una carpeta normal, sin enlaces/);
  assert.deepEqual(await paths(join(root, 'outside-dist')), ['keep.txt']);
  assert.equal(await readFile(join(root, 'outside-dist/keep.txt'), 'utf8'), 'External release\n');
});

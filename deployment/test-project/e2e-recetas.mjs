// Prueba de las recetas estructuradas contra el PROYECTO DE PRUEBAS (nunca produccion), con cuentas reales de ese proyecto.
// Uso: node e2e-recetas.mjs <ruta-claves.json>
import {readFileSync} from 'node:fs';
import {createHmac, randomBytes, randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {resetTestData} from './_reset.mjs';

const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!/^https:\/\/urtxakicjonkfmewktip\.supabase\.co$/.test(cfg.url)) { console.error('Solo se ejecuta contra el proyecto de pruebas.'); process.exit(1); }
const HOTEL = 'hotel-arts-barcelona', OTHER = 'hotel-otro', OUTLET = 'oleos';
const ej = (n) => JSON.parse(readFileSync(new URL(`../local-recetas/ejemplos/${n}.json`, import.meta.url), 'utf8'));
const tostada = ej('tostada'), boniato = ej('boniato');
const admin = {apikey: cfg.service, Authorization: 'Bearer ' + cfg.service, 'Content-Type': 'application/json'};
let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + extra)); if (!ok) fails++; };
const j = async (r) => { const t = await r.text(); try { return t ? JSON.parse(t) : null; } catch { return t; } };
const rest = (path, init = {}) => fetch(cfg.url + '/rest/v1/' + path, {...init, headers: {...admin, Prefer: 'return=representation', ...(init.headers || {})}});
const hdr = (t) => ({apikey: cfg.anon, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json'});
const rpc = async (token, fn, body) => { const r = await fetch(cfg.url + '/rest/v1/rpc/' + fn, {method: 'POST', headers: hdr(token), body: JSON.stringify(body)}); return {status: r.status, body: await j(r)}; };
const login = async (email, password) => (await j(await fetch(cfg.url + '/auth/v1/token?grant_type=password', {method: 'POST', headers: {apikey: cfg.anon, 'Content-Type': 'application/json'}, body: JSON.stringify({email, password})}))).access_token;
function base32(s) { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totp(secret) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = createHmac('sha1', base32(secret)).update(c).digest(); const o = h[19] & 15; return String(((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0'); }

// ---- arranque: solo en el proyecto de pruebas ----
const list = await j(await fetch(cfg.url + '/auth/v1/admin/users?per_page=200', {headers: admin}));
for (const u of list.users || []) await fetch(cfg.url + '/auth/v1/admin/users/' + u.id, {method: 'DELETE', headers: admin});
resetTestData();
await rest('compi_arts_outlets?hotel_key=in.(' + HOTEL + ',' + OTHER + ')', {method: 'DELETE'});
await rest('compi_arts_outlets', {method: 'POST', body: JSON.stringify([
  {hotel_key: HOTEL, outlet_key: OUTLET, hotel: 'Hotel Arts', outlet: 'Oleos', archived: false},
  {hotel_key: HOTEL, outlet_key: 'viejo', hotel: 'Hotel Arts', outlet: 'Viejo', archived: true}])});
async function person(email, rank, hotel = HOTEL) {
  const pass = randomBytes(12).toString('base64url') + 'aA1';
  const u = await j(await fetch(cfg.url + '/auth/v1/admin/users', {method: 'POST', headers: admin, body: JSON.stringify({email, password: pass, email_confirm: true})}));
  await rest('compi_staff', {method: 'POST', body: JSON.stringify({id: randomUUID(), hotel_key: hotel, user_id: u.id, email, employee_name: 'Prueba ' + rank, position_name: 'Prueba', outlet_name: 'Bites', access_rank: rank, invite_state: 'accepted'})});
  await rest('compi_memberships', {method: 'POST', body: JSON.stringify({user_id: u.id, hotel_key: hotel})});
  return {email, pass};
}
async function withMfa({email, pass}) {
  const t0 = await login(email, pass);
  const enroll = await j(await fetch(cfg.url + '/auth/v1/factors', {method: 'POST', headers: hdr(t0), body: JSON.stringify({factor_type: 'totp', friendly_name: 'prueba', issuer: 'CompI'})}));
  const ch = await j(await fetch(cfg.url + '/auth/v1/factors/' + enroll.id + '/challenge', {method: 'POST', headers: hdr(t0), body: '{}'}));
  return (await j(await fetch(cfg.url + '/auth/v1/factors/' + enroll.id + '/verify', {method: 'POST', headers: hdr(t0), body: JSON.stringify({challenge_id: ch.id, code: totp(enroll.totp.secret)})}))).access_token;
}
const exec = await person('j.garcia.arts@compichef.com', 1), editor = await person('m.lopez.arts@compichef.com', 2), reader = await person('r.vidal.arts@compichef.com', 3);
const other = await person('o.exec.otro@compichef.com', 1, OTHER);
const T1 = await withMfa(exec), T2 = await login(editor.email, editor.pass), T3 = await login(reader.email, reader.pass), TO = await withMfa(other);
check('cuentas de prueba listas (ejecutivo con segundo factor, rango 2 y 3, otro hotel)', !!(T1 && T2 && T3 && TO));

const save = (t, rec, st = 'borrador', prev = null, o = OUTLET, g = rec.dish_id) => rpc(t, 'compi_arts_save_recipe', {h: HOTEL, o, g, rec, st, previous: prev});
const get = (t, g) => rpc(t, 'compi_arts_get_recipe', {h: HOTEL, o: OUTLET, g});
const mut = (base, fn) => { const c = structuredClone(base); fn(c); return c; };

// ---- guardado, lectura y revision ----
const s1 = await save(T1, tostada);
check('ejecutivo guarda la tostada (200)', s1.status === 200 && typeof s1.body === 'string', s1.status + ' ' + JSON.stringify(s1.body).slice(0, 150));
const g1 = await get(T1, tostada.dish_id);
check('se lee igual que se guardo', isDeepStrictEqual(g1.body?.record, tostada) && g1.body?.revision === s1.body && g1.body?.status === 'borrador');
check('receta inexistente: null', (await get(T1, 'no-existe')).body === null);
check('guardar lo mismo no cambia la revision', (await save(T1, tostada, 'borrador', s1.body)).body === s1.body);
const edit = mut(tostada, (c) => { c.name_es = 'Tostada (editada)'; });
check('sin revision previa: 409', (await save(T1, edit)).status === 409);
check('revision antigua: 409', (await save(T1, edit, 'borrador', randomUUID())).status === 409);
const s2 = await save(T1, edit, 'borrador', s1.body);
check('revision correcta: guarda con revision nueva', s2.status === 200 && s2.body !== s1.body, s2.status);

// ---- permisos con cuentas reales ----
check('rango 2 guarda (boniato)', (await save(T2, boniato)).status === 200);
check('rango 3 lee', (await get(T3, boniato.dish_id)).body?.record?.name_es === boniato.name_es);
check('rango 3 no guarda (403)', (await save(T3, mut(boniato, (c) => { c.name_es = 'X'; }))).status === 403);
check('ejecutivo de otro hotel no lee ni guarda (403)', (await get(TO, boniato.dish_id)).status === 403 && (await save(TO, boniato)).status === 403);
check('anonimo no puede usar las funciones', [401, 403, 404].includes((await get(cfg.anon, boniato.dish_id)).status));
const direct = await fetch(cfg.url + '/rest/v1/arts_recipes', {headers: {...hdr(T1), 'Accept-Profile': 'compi_private'}});
check('la tabla no es accesible por la API', direct.status >= 400, direct.status);

// ---- validacion y aprobacion ----
const bad = async (name, rec) => { const r = await save(T1, rec, 'borrador', null, OUTLET, rec.dish_id); check(name, r.status === 400, r.status + ' ' + JSON.stringify(r.body).slice(0, 120)); };
await bad('clave desconocida: rechazada', mut(boniato, (c) => { c.extra = 1; }));
await bad('unidad desconocida con cantidad inventada: rechazada', mut(boniato, (c) => { c.ingredients[0].unit = 'desconocida'; c.ingredients[0].quantity = 30; }));
await bad('pasos no consecutivos: rechazados', mut(boniato, (c) => { c.steps[1].number = 5; }));
check('outlet archivado: 404', (await save(T1, mut(boniato, (c) => { c.outlet_id = 'viejo'; }), 'borrador', null, 'viejo')).status === 404);
const hummus = mut(tostada, (c) => { c.dish_id = 'tostada-hummus'; c.ingredients.push({id: 'h1', name_es: 'Hummus', quantity: null, unit: 'desconocida', original_measure: '', optional: false, preparation: '', image_label: 'Hummus', source_refs: [], evidence_status: 'pendiente'}); });
check('cantidad de hummus desconocida: aceptada', (await save(T1, hummus)).status === 200);
const approved = (c) => { c.metadata.document_status = 'APROBADO'; c.metadata.approval_evidence_id = 'ev-1'; };
const cur = async () => (await get(T1, boniato.dish_id)).body;
check('APROBADO en el documento con estado borrador: rechazado', (await save(T1, mut((await cur()).record, approved), 'borrador', (await cur()).revision)).status === 400);
check('rango 2 no puede aprobar (403)', (await save(T2, mut((await cur()).record, approved), 'aprobada', (await cur()).revision)).status === 403);
check('ejecutivo con evidencia aprueba', (await save(T1, mut((await cur()).record, approved), 'aprobada', (await cur()).revision)).status === 200 && (await cur()).status === 'aprobada');
const lst = await rpc(T1, 'compi_arts_list_recipes', {h: HOTEL, o: OUTLET});
check('el listado devuelve las 3 recetas', Array.isArray(lst.body) && lst.body.length === 3, JSON.stringify(lst.body).slice(0, 120));
check('el listado de otro hotel: 403', (await rpc(TO, 'compi_arts_list_recipes', {h: HOTEL, o: OUTLET})).status === 403);

console.log(fails ? `\n${fails} PRUEBA(S) FALLARON` : '\nTODAS LAS PRUEBAS PASARON');
process.exit(fails ? 1 : 0);

// Prueba de la eliminacion de empleados contra el PROYECTO DE PRUEBAS (nunca produccion).
// Uso: node e2e-eliminar.mjs <ruta-claves.json>
import {readFileSync} from 'node:fs';
import {createHmac, randomBytes, randomUUID} from 'node:crypto';
import {resetTestData} from './_reset.mjs';

const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!/^https:\/\/urtxakicjonkfmewktip\.supabase\.co$/.test(cfg.url)) { console.error('Solo se ejecuta contra el proyecto de pruebas.'); process.exit(1); }
const HOTEL = 'hotel-arts-barcelona', OTHER = 'hotel-otro';
const admin = {apikey: cfg.service, Authorization: 'Bearer ' + cfg.service, 'Content-Type': 'application/json'};
let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + extra)); if (!ok) fails++; };
const j = async (r) => { const t = await r.text(); try { return t ? JSON.parse(t) : null; } catch { return t; } };
const rest = (path, init = {}) => fetch(cfg.url + '/rest/v1/' + path, {...init, headers: {...admin, Prefer: 'return=representation', ...(init.headers || {})}});
const rpc = (token, fn, body) => fetch(cfg.url + '/rest/v1/rpc/' + fn, {method: 'POST', headers: {apikey: cfg.anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
const login = async (email, password) => { const r = await fetch(cfg.url + '/auth/v1/token?grant_type=password', {method: 'POST', headers: {apikey: cfg.anon, 'Content-Type': 'application/json'}, body: JSON.stringify({email, password})}); return {status: r.status, body: await j(r)}; };
const userExists = async (id) => (await fetch(cfg.url + '/auth/v1/admin/users/' + id, {headers: admin})).status === 200;
const staffRow = async (email) => (await j(await rest('compi_staff?email=eq.' + encodeURIComponent(email) + '&select=id,user_id,withdrawn_at,access_rank')))[0];

function base32(s) { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totp(secret) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = createHmac('sha1', base32(secret)).update(c).digest(); const o = h[19] & 15; return String(((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0'); }

// ---- arranque: reinicio y un ejecutivo con segundo factor ----
const list = await j(await fetch(cfg.url + '/auth/v1/admin/users?per_page=200', {headers: admin}));
for (const u of list.users || []) await fetch(cfg.url + '/auth/v1/admin/users/' + u.id, {method: 'DELETE', headers: admin});
resetTestData();
const EXEC = 'j.garcia.arts@compichef.com', execPass = randomBytes(12).toString('base64url') + 'aA1';
const eu = await j(await fetch(cfg.url + '/auth/v1/admin/users', {method: 'POST', headers: admin, body: JSON.stringify({email: EXEC, password: execPass, email_confirm: true})}));
await rest('compi_staff', {method: 'POST', body: JSON.stringify({id: randomUUID(), hotel_key: HOTEL, user_id: eu.id, email: EXEC, employee_name: 'Juan Garcia', position_name: 'Ejecutivo', outlet_name: 'Direccion', access_rank: 1, invite_state: 'accepted'})});
await rest('compi_memberships', {method: 'POST', body: JSON.stringify({user_id: eu.id, hotel_key: HOTEL})});
const l1 = await login(EXEC, execPass);
const hdr = (t) => ({apikey: cfg.anon, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json'});
const enroll = await j(await fetch(cfg.url + '/auth/v1/factors', {method: 'POST', headers: hdr(l1.body.access_token), body: JSON.stringify({factor_type: 'totp', friendly_name: 'prueba', issuer: 'CompI'})}));
const ch = await j(await fetch(cfg.url + '/auth/v1/factors/' + enroll.id + '/challenge', {method: 'POST', headers: hdr(l1.body.access_token), body: '{}'}));
const T = (await j(await fetch(cfg.url + '/auth/v1/factors/' + enroll.id + '/verify', {method: 'POST', headers: hdr(l1.body.access_token), body: JSON.stringify({challenge_id: ch.id, code: totp(enroll.totp.secret)})}))).access_token;
check('ejecutivo con segundo factor listo', !!T);
const create = (given, surname, rank = 3) => fetch(cfg.url + '/functions/v1/compi-arts-crear-cuenta', {method: 'POST', headers: hdr(T), body: JSON.stringify({h: HOTEL, request_id: randomUUID(), given_name: given, surname, position_name: 'Camarera', outlet_name: 'Bites', access_rank: rank})});

// ---- 1. retirar y eliminar un empleado con cuenta: el usuario de acceso tambien se borra ----
const a = await j(await create('Maria', 'Lopez')); const rowA = await staffRow(a.email);
check('empleado con cuenta creado', !!rowA?.user_id && await userExists(rowA.user_id));
const retire = await rpc(T, 'compi_set_staff_access', {h: HOTEL, employee: rowA.id, enabled: false, expected_rank: 3});
check('se retira el acceso (204)', retire.status === 204, retire.status);
const withdrawn = (await staffRow(a.email)).withdrawn_at;
const del = await rpc(T, 'compi_delete_withdrawn_employee', {h: HOTEL, employee: rowA.id, withdrawal: withdrawn});
check('se elimina la ficha (204)', del.status === 204, del.status + ' ' + (await del.text()).slice(0, 120));
check('la ficha ya no existe', !(await staffRow(a.email)));
check('el usuario de acceso tambien se ha borrado', !(await userExists(rowA.user_id)));

// ---- 2. un usuario que tambien pertenece a otro hotel conserva su cuenta ----
const b = await j(await create('Marta', 'Gomez')); const rowB = await staffRow(b.email);
await rest('compi_staff', {method: 'POST', body: JSON.stringify({id: randomUUID(), hotel_key: OTHER, user_id: rowB.user_id, email: 'b.gomez.otro@compichef.com', employee_name: 'Marta Gomez', position_name: 'X', outlet_name: 'Y', access_rank: 3, invite_state: 'accepted'})});
await rest('compi_memberships', {method: 'POST', body: JSON.stringify({user_id: rowB.user_id, hotel_key: OTHER})});
await rpc(T, 'compi_set_staff_access', {h: HOTEL, employee: rowB.id, enabled: false, expected_rank: 3});
const wB = (await staffRow(b.email)).withdrawn_at;
await rpc(T, 'compi_delete_withdrawn_employee', {h: HOTEL, employee: rowB.id, withdrawal: wB});
check('con otro hotel: la ficha de este hotel se borra', !(await staffRow(b.email)));
check('con otro hotel: el usuario de acceso se conserva', await userExists(rowB.user_id));

// ---- 3. filas pendientes (sin cuenta) ----
const reg = await rpc(T, 'compi_register_employee', {h: HOTEL, request_id: randomUUID(), given_name: 'Pablo', surname: 'Ruiz', position_name: 'Cocinero', outlet_name: 'Bites', access_rank: 3});
const pendEmail = await j(reg); const rowP = await staffRow(pendEmail);
check('se crea una fila pendiente sin cuenta', reg.status === 200 && rowP && rowP.user_id === null, reg.status);
const rm = await rpc(T, 'compi_remove_pending_employee', {h: HOTEL, employee: rowP.id});
check('se elimina la fila pendiente (204)', rm.status === 204, rm.status + ' ' + (await rm.text()).slice(0, 120));
check('la fila pendiente ya no existe', !(await staffRow(pendEmail)));
const reg2 = await rpc(T, 'compi_register_employee', {h: HOTEL, request_id: randomUUID(), given_name: 'Pablo', surname: 'Ruiz', position_name: 'Cocinero', outlet_name: 'Bites', access_rank: 3});
const again = await j(reg2);
check('su direccion reservada se libera: se puede reutilizar', again === pendEmail, JSON.stringify(again));

// ---- 4. proteccion ----
const c = await j(await create('Carla', 'Vidal')); const rowC = await staffRow(c.email);
const rmAcc = await rpc(T, 'compi_remove_pending_employee', {h: HOTEL, employee: rowC.id});
check('no se puede eliminar como pendiente a quien ya tiene cuenta (409)', rmAcc.status === 409, rmAcc.status);
check('...y su cuenta sigue intacta', await userExists(rowC.user_id));
const empLogin = await login(c.email, c.password);
const asEmp = await rpc(empLogin.body.access_token, 'compi_remove_pending_employee', {h: HOTEL, employee: rowP.id});
check('un empleado no puede usar la funcion (403)', asEmp.status === 403 || asEmp.status === 401, asEmp.status);
const anon = await rpc(cfg.anon, 'compi_remove_pending_employee', {h: HOTEL, employee: rowP.id});
check('anonimo no puede usar la funcion', [401, 403, 404].includes(anon.status), anon.status);
const noOther = await rpc(T, 'compi_remove_pending_employee', {h: OTHER, employee: rowP.id});
check('un ejecutivo no puede actuar en otro hotel (403)', noOther.status === 403, noOther.status);
const rmUnk = await rpc(T, 'compi_remove_pending_employee', {h: HOTEL, employee: randomUUID()});
check('fila inexistente: 404', rmUnk.status === 404, rmUnk.status);

console.log(fails ? `\n${fails} PRUEBA(S) FALLARON` : '\nTODAS LAS PRUEBAS PASARON');
process.exit(fails ? 1 : 0);

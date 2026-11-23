// Prueba de extremo a extremo de "cuentas directas" contra el PROYECTO DE PRUEBAS (nunca produccion).
// Uso: node e2e-cuentas.mjs <ruta-claves.json>   (claves de pruebas, fuera de Git: {url, anon, service})
import {readFileSync} from 'node:fs';
import {createHmac, randomBytes, randomUUID} from 'node:crypto';
import {resetTestData} from './_reset.mjs';

const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!/^https:\/\/urtxakicjonkfmewktip\.supabase\.co$/.test(cfg.url)) { console.error('Solo se ejecuta contra el proyecto de pruebas.'); process.exit(1); }
const FN = cfg.url + '/functions/v1/compi-arts-crear-cuenta';
const HOTEL = 'hotel-arts-barcelona';
const admin = {apikey: cfg.service, Authorization: 'Bearer ' + cfg.service, 'Content-Type': 'application/json'};
const j = async (res) => { const t = await res.text(); try { return t ? JSON.parse(t) : null; } catch { return t; } };
let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + extra)); if (!ok) fails++; };

function base32(s) { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totp(secret) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = createHmac('sha1', base32(secret)).update(c).digest(); const o = h[19] & 15; return String(((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0'); }

const rest = (path, init = {}) => fetch(cfg.url + '/rest/v1/' + path, {...init, headers: {...admin, Prefer: 'return=representation', ...(init.headers || {})}});
async function login(email, password) { const r = await fetch(cfg.url + '/auth/v1/token?grant_type=password', {method: 'POST', headers: {apikey: cfg.anon, 'Content-Type': 'application/json'}, body: JSON.stringify({email, password})}); return {status: r.status, body: await j(r)}; }
const userRpc = (token, fn, body) => fetch(cfg.url + '/rest/v1/rpc/' + fn, {method: 'POST', headers: {apikey: cfg.anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
const create = (token, body, origin) => fetch(FN, {method: 'POST', headers: {apikey: cfg.anon, ...(token ? {Authorization: 'Bearer ' + token} : {}), 'Content-Type': 'application/json', ...(origin ? {Origin: origin} : {})}, body: JSON.stringify(body)});
const person = (given, surname, rank = 2) => ({h: HOTEL, request_id: randomUUID(), given_name: given, surname, position_name: 'Camarera', outlet_name: 'Bites', access_rank: rank});

// ---- limpieza e inicio: ejecutivo de prueba (solo en el proyecto de pruebas) ----
const EXEC = 'j.garcia.arts@compichef.com', execPass = randomBytes(12).toString('base64url') + 'aA1';
const list = await j(await fetch(cfg.url + '/auth/v1/admin/users?per_page=200', {headers: admin}));
for (const u of list.users || []) await fetch(cfg.url + '/auth/v1/admin/users/' + u.id, {method: 'DELETE', headers: admin});
resetTestData();
const eu = await j(await fetch(cfg.url + '/auth/v1/admin/users', {method: 'POST', headers: admin, body: JSON.stringify({email: EXEC, password: execPass, email_confirm: true})}));
await rest('compi_staff', {method: 'POST', body: JSON.stringify({id: randomUUID(), hotel_key: HOTEL, user_id: eu.id, email: EXEC, employee_name: 'Juan Garcia', position_name: 'Ejecutivo', outlet_name: 'Direccion', access_rank: 1, invite_state: 'accepted'})});
await rest('compi_memberships', {method: 'POST', body: JSON.stringify({user_id: eu.id, hotel_key: HOTEL})});

// ---- ejecutivo: inicio de sesion y segundo factor ----
let ex = await login(EXEC, execPass);
check('el ejecutivo inicia sesion', ex.status === 200, JSON.stringify(ex.body).slice(0, 120));
const noMfa = await create(ex.body.access_token, person('Maria', 'Lopez'));
check('ejecutivo sin segundo factor: rechazado (403)', noMfa.status === 403, noMfa.status);
const enroll = await j(await fetch(cfg.url + '/auth/v1/factors', {method: 'POST', headers: {apikey: cfg.anon, Authorization: 'Bearer ' + ex.body.access_token, 'Content-Type': 'application/json'}, body: JSON.stringify({factor_type: 'totp', friendly_name: 'prueba', issuer: 'CompI'})}));
const ch = await j(await fetch(cfg.url + '/auth/v1/factors/' + enroll.id + '/challenge', {method: 'POST', headers: {apikey: cfg.anon, Authorization: 'Bearer ' + ex.body.access_token, 'Content-Type': 'application/json'}, body: '{}'}));
const ver = await j(await fetch(cfg.url + '/auth/v1/factors/' + enroll.id + '/verify', {method: 'POST', headers: {apikey: cfg.anon, Authorization: 'Bearer ' + ex.body.access_token, 'Content-Type': 'application/json'}, body: JSON.stringify({challenge_id: ch.id, code: totp(enroll.totp.secret)})}));
const T = ver.access_token; check('el ejecutivo completa el segundo factor', !!T, JSON.stringify(ver).slice(0, 120));

// ---- creacion de cuenta ----
const body1 = person('Maria', 'Lopez');
const r1 = await create(T, body1, 'https://compichef.com'); const a1 = await j(r1);
check('crea la cuenta (200)', r1.status === 200 && a1?.email === 'm.lopez.arts@compichef.com' && a1?.password?.length === 16, r1.status + ' ' + JSON.stringify(a1).replace(/"password":"[^"]*"/, '"password":"***"'));
check('la respuesta no se guarda en cache', r1.headers.get('cache-control') === 'no-store');
const r1b = await create(T, body1); check('repetir la misma peticion: 409 y no repite la contrasena', r1b.status === 409 && !JSON.stringify(await j(r1b)).includes('password'), r1b.status);
const r2 = await create(T, person('Marta', 'Lopez')); const a2 = await j(r2);
check('segundo empleado con el mismo apellido: correo distinto', r2.status === 200 && a2?.email !== a1?.email && /@compichef\.com$/.test(a2?.email || ''), JSON.stringify(a2).replace(/"password":"[^"]*"/, '"password":"***"'));

// ---- validaciones y permisos ----
check('sin token: 401', (await create(null, person('A', 'Bravo'))).status === 401);
check('rango 1 (ejecutivo) no se puede crear: 400', (await create(T, person('Ana', 'Bravo', 1))).status === 400);
check('datos incompletos: 400', (await create(T, {h: HOTEL})).status === 400);
check('origen ajeno: 403', (await create(T, person('Ana', 'Bravo'), 'https://evil.example')).status === 403);
const otherHotel = await create(T, {...person('Ana', 'Bravo'), h: 'otro-hotel'}); check('hotel ajeno: 403', otherHotel.status === 403, otherHotel.status);

// ---- el empleado: contrasena temporal y cambio obligatorio ----
const emp = await login(a1.email, a1.password);
check('el empleado inicia sesion con la contrasena generada', emp.status === 200, emp.status);
const emp0 = emp.body.access_token;
const blocked = await userRpc(emp0, 'compi_mail_read', {h: HOTEL, box: 'inbox', p: 0});
check('antes de cambiarla, el buzon esta bloqueado', blocked.status === 403 || blocked.status === 401, blocked.status);
const tryCreate = await create(emp0, person('Eva', 'Ruiz')); check('un empleado no puede crear cuentas (403)', tryCreate.status === 403, tryCreate.status);
const early = await userRpc(emp0, 'compi_finish_password_change', {}); check('no se puede saltar el cambio sin cambiar la contrasena', early.status >= 400, early.status);
const newPass = randomBytes(12).toString('base64url') + 'bB2';
const put = await fetch(cfg.url + '/auth/v1/user', {method: 'PUT', headers: {apikey: cfg.anon, Authorization: 'Bearer ' + emp0, 'Content-Type': 'application/json'}, body: JSON.stringify({password: newPass})});
check('el empleado cambia su contrasena', put.status === 200, put.status + ' ' + JSON.stringify(await j(put)).slice(0, 160));
const fin = await userRpc(emp0, 'compi_finish_password_change', {}); check('se levanta la marca de cambio obligatorio', fin.status === 200, fin.status);
const open = await userRpc(emp0, 'compi_mail_read', {h: HOTEL, box: 'inbox', p: 0}); check('despues del cambio, el buzon abre (200)', open.status === 200, open.status);
check('la contrasena antigua ya no sirve', (await login(a1.email, a1.password)).status !== 200);
check('la nueva contrasena sirve', (await login(a1.email, newPass)).status === 200);

console.log(fails ? `\n${fails} PRUEBA(S) FALLARON` : '\nTODAS LAS PRUEBAS PASARON');
process.exit(fails ? 1 : 0);

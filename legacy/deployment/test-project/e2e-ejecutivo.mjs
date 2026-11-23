// Prueba de extremo a extremo del script crear-ejecutivo.mjs contra el PROYECTO DE PRUEBAS (nunca produccion).
// Uso: node e2e-ejecutivo.mjs <ruta-claves.json>
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHmac, randomBytes, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {resetTestData} from './_reset.mjs';

const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!/^https:\/\/urtxakicjonkfmewktip\.supabase\.co$/.test(cfg.url)) { console.error('Solo se ejecuta contra el proyecto de pruebas.'); process.exit(1); }
const REF = 'urtxakicjonkfmewktip', HOTEL = 'hotel-arts-barcelona';
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'crear-ejecutivo.mjs');
const admin = {apikey: cfg.service, Authorization: 'Bearer ' + cfg.service, 'Content-Type': 'application/json'};
let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + extra)); if (!ok) fails++; };
const j = async (r) => { const t = await r.text(); try { return t ? JSON.parse(t) : null; } catch { return t; } };
const run = (args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], {encoding: 'utf8', env: {...process.env, COMPI_SERVICE_KEY: cfg.service, ...env}});
const exec = (name, last) => run(['--proyecto', REF, '--hotel', HOTEL, '--nombre', name, '--apellido', last, '--json']);

function base32(s) { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totp(secret) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = createHmac('sha1', base32(secret)).update(c).digest(); const o = h[19] & 15; return String(((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0'); }
const login = async (email, password) => { const r = await fetch(cfg.url + '/auth/v1/token?grant_type=password', {method: 'POST', headers: {apikey: cfg.anon, 'Content-Type': 'application/json'}, body: JSON.stringify({email, password})}); return {status: r.status, body: await j(r)}; };
const user = (token, extra = {}) => ({apikey: cfg.anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...extra});
const claims = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

// ---- limpieza: solo en el proyecto de pruebas ----
const list = await j(await fetch(cfg.url + '/auth/v1/admin/users?per_page=200', {headers: admin}));
for (const u of list.users || []) await fetch(cfg.url + '/auth/v1/admin/users/' + u.id, {method: 'DELETE', headers: admin});
resetTestData();

// ---- el script ----
const r1 = exec('Carla', 'Nunez'); const a1 = r1.status === 0 ? JSON.parse(r1.stdout) : null;
check('crea al ejecutivo (salida 0)', r1.status === 0 && a1?.email === 'c.nunez.arts@compichef.com' && a1?.password?.length === 16, (r1.stderr || r1.stdout).slice(0, 200));
check('la clave de administrador no aparece en la salida', !(r1.stdout + r1.stderr).includes(cfg.service));
const r2 = exec('Carla', 'Nunez'); const a2 = r2.status === 0 ? JSON.parse(r2.stdout) : null;
check('el mismo nombre otra vez da un correo distinto', r2.status === 0 && a2.email !== a1.email, (r2.stderr || '').slice(0, 200));
check('hotel sin codigo: falla', run(['--proyecto', REF, '--hotel', 'otro-hotel', '--nombre', 'A', '--apellido', 'B', '--json']).status !== 0);
check('falta un dato: falla', run(['--proyecto', REF, '--hotel', HOTEL, '--nombre', 'Solo', '--json']).status !== 0);
const prod = run(['--proyecto', 'dzfwdxhbldnfqowrnhxf', '--hotel', HOTEL, '--nombre', 'No', '--apellido', 'Debe', '--json']);
check('produccion exige modo interactivo: se niega con --json', prod.status !== 0 && /interactiv/i.test(prod.stderr), prod.stderr.slice(0, 200));

// ---- el ejecutivo creado ----
const l1 = await login(a1.email, a1.password);
check('el ejecutivo inicia sesion con la contrasena temporal', l1.status === 200, l1.status);
check('su token lleva la marca de cambio obligatorio', claims(l1.body.access_token).app_metadata?.compi_must_change === 'true');
const blocked = await fetch(cfg.url + '/rest/v1/rpc/compi_mail_read', {method: 'POST', headers: user(l1.body.access_token), body: JSON.stringify({h: HOTEL, box: 'inbox', p: 0})});
check('antes de cambiarla, todo esta bloqueado', blocked.status === 403 || blocked.status === 401, blocked.status);
const newPass = randomBytes(12).toString('base64url') + 'cC3';
check('cambia su contrasena', (await fetch(cfg.url + '/auth/v1/user', {method: 'PUT', headers: user(l1.body.access_token), body: JSON.stringify({password: newPass})})).status === 200);
check('se levanta la marca', (await fetch(cfg.url + '/rest/v1/rpc/compi_finish_password_change', {method: 'POST', headers: user(l1.body.access_token), body: '{}'})).status === 200);
const l2 = await login(a1.email, newPass);
check('con la contrasena nueva la marca ya no esta', l2.status === 200 && !claims(l2.body.access_token).app_metadata?.compi_must_change);
const needs = await j(await fetch(cfg.url + '/rest/v1/rpc/compi_needs_mfa', {method: 'POST', headers: user(l2.body.access_token), body: '{}'}));
check('un ejecutivo nuevo debe registrar el segundo factor', needs === true, JSON.stringify(needs));

// ---- segundo factor y cadena completa: el ejecutivo crea un empleado ----
const enroll = await j(await fetch(cfg.url + '/auth/v1/factors', {method: 'POST', headers: user(l2.body.access_token), body: JSON.stringify({factor_type: 'totp', friendly_name: 'prueba', issuer: 'CompI'})}));
const ch = await j(await fetch(cfg.url + '/auth/v1/factors/' + enroll.id + '/challenge', {method: 'POST', headers: user(l2.body.access_token), body: '{}'}));
const ver = await j(await fetch(cfg.url + '/auth/v1/factors/' + enroll.id + '/verify', {method: 'POST', headers: user(l2.body.access_token), body: JSON.stringify({challenge_id: ch.id, code: totp(enroll.totp.secret)})}));
check('registra el segundo factor', !!ver.access_token, JSON.stringify(ver).slice(0, 120));
const make = await fetch(cfg.url + '/functions/v1/compi-arts-crear-cuenta', {method: 'POST', headers: user(ver.access_token), body: JSON.stringify({h: HOTEL, request_id: randomUUID(), given_name: 'Marta', surname: 'Lopez', position_name: 'Camarera', outlet_name: 'Bites', access_rank: 2})});
const made = await j(make);
check('el ejecutivo creado por el script ya puede crear a un empleado', make.status === 200 && made?.email === 'm.lopez.arts@compichef.com', make.status + ' ' + JSON.stringify(made).replace(/"password":"[^"]*"/, '"password":"***"'));

// ---- las funciones de alta no son publicas ----
const anon = await fetch(cfg.url + '/rest/v1/rpc/compi_reserve_executive', {method: 'POST', headers: user(cfg.anon), body: JSON.stringify({h: HOTEL, given_name: 'X', surname: 'Y', position_name: 'Z', outlet_name: 'W'})});
const emp = await fetch(cfg.url + '/rest/v1/rpc/compi_activate_executive', {method: 'POST', headers: user(ver.access_token), body: JSON.stringify({employee: randomUUID(), uid: randomUUID()})});
check('anonimo no puede reservar ejecutivos', anon.status === 401 || anon.status === 403 || anon.status === 404, anon.status);
check('ni un usuario autenticado puede activar ejecutivos', emp.status === 401 || emp.status === 403 || emp.status === 404, emp.status);

console.log(fails ? `\n${fails} PRUEBA(S) FALLARON` : '\nTODAS LAS PRUEBAS PASARON');
process.exit(fails ? 1 : 0);

#!/usr/bin/env node
// Alta de un EJECUTIVO (rango 1) de un hotel. Solo lo ejecuta el propietario, desde su equipo.
//
//   node scripts/crear-ejecutivo.mjs --proyecto <ref> --hotel hotel-arts-barcelona --nombre Juan --apellido Garcia
//        [--puesto "Ejecutivo"] [--outlet "Dirección"] [--json]
//
// La clave de administrador (service_role) se toma de la variable de entorno COMPI_SERVICE_KEY o, si no existe, de la sesion del CLI
// de Supabase de este equipo. Nunca se pasa por argumentos ni se imprime. La contrasena temporal se muestra UNA vez en esta terminal.
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline/promises';

const PRODUCTION = 'dzfwdxhbldnfqowrnhxf';
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // sin 0/O, 1/l/I

function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error('Argumento no reconocido: ' + a);
    const key = a.slice(2);
    if (key === 'json') { out.json = true; continue; }
    out[key] = argv[++i];
    if (out[key] === undefined) throw new Error('Falta el valor de --' + key);
  }
  return out;
}
const fail = (message) => { console.error('Error: ' + message); process.exit(1); };

function generatePassword() {
  while (true) {
    let out = '';
    while (out.length < 16) for (const b of randomBytes(32)) if (b < 228 && out.length < 16) out += alphabet[b % alphabet.length];
    if (/[A-Z]/.test(out) && /[a-z]/.test(out) && /[2-9]/.test(out)) return out;
  }
}

function serviceKey(ref) {
  if (process.env.COMPI_SERVICE_KEY) return process.env.COMPI_SERVICE_KEY;
  const r = spawnSync(`npx --yes supabase@latest projects api-keys --project-ref ${ref} --output-format json`, {shell: true, encoding: 'utf8', maxBuffer: 1 << 24});
  const text = r.stdout || '';
  try {
    const json = JSON.parse(text.slice(text.search(/[\[{]/)));
    const list = Array.isArray(json) ? json : json.keys || json.api_keys || Object.values(json).find(Array.isArray) || [];
    const key = list.find((k) => k.name === 'service_role' || k.id === 'service_role')?.api_key;
    if (key) return key;
  } catch { /* se informa abajo */ }
  fail('No se pudo obtener la clave de administrador. Inicia sesion con "npx supabase@latest login" o define COMPI_SERVICE_KEY.');
}

let args;
try { args = parse(process.argv.slice(2)); } catch (e) { fail(e.message); }
const ref = args.proyecto, hotel = args.hotel;
const given = args.nombre, surname = args.apellido, position = args.puesto || 'Ejecutivo', outlet = args.outlet || 'Dirección';
if (!/^[a-z0-9]{20}$/.test(ref || '')) fail('--proyecto debe ser la referencia del proyecto de Supabase (20 caracteres).');
if (!/^[a-z0-9-]{3,60}$/.test(hotel || '')) fail('--hotel no es valido.');
for (const [name, value] of [['--nombre', given], ['--apellido', surname], ['--puesto', position], ['--outlet', outlet]]) {
  if (typeof value !== 'string' || !value.trim() || value.length > 60) fail(name + ' es obligatorio (maximo 60 caracteres).');
}

if (ref === PRODUCTION) {
  if (args.json || !process.stdin.isTTY) fail('En produccion solo se ejecuta de forma interactiva, sin --json.');
  console.log(`\nVas a crear un EJECUTIVO en PRODUCCION:\n  hotel: ${hotel}\n  nombre: ${given} ${surname}\n  puesto: ${position}`);
  const rl = createInterface({input: process.stdin, output: process.stdout});
  const answer = await rl.question(`Para confirmar, escribe el nombre del hotel (${hotel}): `);
  rl.close();
  if (answer.trim() !== hotel) fail('Confirmacion incorrecta. No se ha creado nada.');
}

const base = `https://${ref}.supabase.co`;
const key = serviceKey(ref);
const headers = {apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'};
const rpc = (name, body) => fetch(`${base}/rest/v1/rpc/${name}`, {method: 'POST', headers, body: JSON.stringify(body)});
const remove = (id) => fetch(`${base}/auth/v1/admin/users/${id}`, {method: 'DELETE', headers}).catch(() => {});

const reserved = await rpc('compi_reserve_executive', {h: hotel, given_name: given, surname, position_name: position, outlet_name: outlet});
if (!reserved.ok) fail('No se pudo reservar al ejecutivo: ' + ((await reserved.json().catch(() => ({}))).message || reserved.status));
const {employee, email} = await reserved.json();

const password = generatePassword();
const created = await fetch(`${base}/auth/v1/admin/users`, {method: 'POST', headers, body: JSON.stringify({email, password, email_confirm: true})});
if (!created.ok) fail('No se pudo crear la cuenta (' + created.status + '). La fila de personal reservada queda sin activar.');
const userId = (await created.json()).id;

const activated = await rpc('compi_activate_executive', {employee, uid: userId});
if (!activated.ok) {
  await remove(userId); // sin cuentas huerfanas
  fail('No se pudo activar al ejecutivo: ' + ((await activated.json().catch(() => ({}))).message || activated.status));
}

if (args.json) console.log(JSON.stringify({email, password, hotel, employee}));
else {
  console.log(`\nEjecutivo creado en el proyecto ${ref}${ref === PRODUCTION ? ' (PRODUCCION)' : ''}.\n`);
  console.log(`  Correo:      ${email}`);
  console.log(`  Contrasena:  ${password}\n`);
  console.log('Esta contrasena solo se muestra ahora: copiala y entregasela por un canal privado.');
  console.log('En su primer acceso tendra que elegir una contrasena propia y registrar el segundo factor (aplicacion de autenticacion).');
}

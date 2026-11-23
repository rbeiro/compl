// Prueba LOCAL (Postgres en memoria, sin red ni proyectos de Supabase) de deployment/pending/recetas.sql.
// Los stubs de abajo imitan my_rank / active_download_session / auth.uid. Uso: npm install && npm test
import {PGlite} from '@electric-sql/pglite';
import Ajv from 'ajv/dist/2020.js';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const H = 'hotel-arts-barcelona', O = 'oleos', OTHER = 'hotel-otro';
const ej = (n) => JSON.parse(read(`./ejemplos/${n}.json`));
const tostada = ej('tostada'), boniato = ej('boniato');
let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + extra)); if (!ok) fails++; };

// ---- los ejemplos del paquete cumplen el esquema completo ----
const validate = new Ajv({strict: false}).compile(JSON.parse(read('./ejemplos/recipe.schema.json')));
check('tostada cumple recipe.schema.json', validate(tostada), JSON.stringify(validate.errors)?.slice(0, 200));
check('boniato cumple recipe.schema.json', validate(boniato), JSON.stringify(validate.errors)?.slice(0, 200));

// ---- base local con stubs y la migracion real ----
const db = new PGlite();
const ids = {r1: randomUUID(), r2: randomUUID(), r3: randomUUID(), outsider: randomUUID(), other: randomUUID()};
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema compi_private; create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
  create table public.compi_arts_outlets(hotel_key text, outlet_key text, hotel text, outlet text, archived boolean default false);
  insert into public.compi_arts_outlets values ('${H}','${O}','Hotel Arts','Oleos',false), ('${H}','viejo','Hotel Arts','Viejo',true);
  create table compi_private.test_ranks(uid uuid, hotel text, rank int);
  insert into compi_private.test_ranks values ('${ids.r1}','${H}',1),('${ids.r2}','${H}',2),('${ids.r3}','${H}',3),('${ids.other}','${OTHER}',1);
  create function compi_private.my_rank(h text) returns int language sql stable security definer as $$ select rank from compi_private.test_ranks where uid=auth.uid() and hotel=h $$;
  create function compi_private.active_download_session() returns boolean language sql stable as $$ select auth.uid() is not null $$;
  grant usage on schema compi_private, auth, public to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
  grant execute on function compi_private.my_rank(text), compi_private.active_download_session() to authenticated, anon;
`);
await db.exec(read('../pending/recetas.sql'));
check('la migracion se aplica sin errores', true);

const as = async (uid, role = 'authenticated') => { await db.exec(`reset role; select set_config('test.uid','${uid ?? ''}',false); set role ${role}`); };
const run = async (sql, params = []) => { try { return {rows: (await db.query(sql, params)).rows}; } catch (e) { return {err: e}; } };
const save = (rec, st = 'borrador', prev = null, o = O, h = H, g = rec.dish_id) => run('select public.compi_arts_save_recipe($1,$2,$3,$4::jsonb,$5,$6::uuid) as r', [h, o, g, JSON.stringify(rec), st, prev]);
const get = (g, h = H, o = O) => run('select public.compi_arts_get_recipe($1,$2,$3) as r', [h, o, g]);
const code = (x) => x.err?.code;
const mut = (base, fn) => { const c = structuredClone(base); fn(c); return c; };

// ---- guardado y lectura ----
await as(ids.r1);
const s1 = await save(tostada);
check('ejecutivo guarda la tostada (borrador)', !!s1.rows?.[0]?.r, s1.err?.message);
const rev1 = s1.rows?.[0]?.r;
const g1 = await get(tostada.dish_id);
check('se lee igual que se guardo', isDeepStrictEqual(g1.rows?.[0]?.r?.record, tostada) && g1.rows[0].r.revision === rev1 && g1.rows[0].r.status === 'borrador');
check('receta inexistente: devuelve null', (await get('no-existe')).rows?.[0]?.r === null);
const same = await save(tostada, 'borrador', rev1);
check('guardar lo mismo no cambia la revision', same.rows?.[0]?.r === rev1, same.err?.message);

// ---- control de revision ----
const edit = mut(tostada, (c) => { c.name_es = 'Tostada de aguacate (editada)'; });
const noPrev = await save(edit, 'borrador', null);
check('guardar sin revision previa sobre una receta existente: 409', code(noPrev) === 'PT409', code(noPrev));
const stale = await save(edit, 'borrador', randomUUID());
check('revision antigua: 409', code(stale) === 'PT409', code(stale));
const ok2 = await save(edit, 'borrador', rev1);
check('revision correcta: guarda y cambia la revision', !!ok2.rows?.[0]?.r && ok2.rows[0].r !== rev1, ok2.err?.message);
check('la edicion afecta solo a su receta', (await get(tostada.dish_id)).rows[0].r.record.name_es.includes('editada') && (await get('inexistente')).rows[0].r === null);

// ---- permisos ----
await as(ids.r2);
check('rango 2 guarda (boniato)', !!(await save(boniato)).rows?.[0]?.r);
await as(ids.r3);
check('rango 3 lee', !!(await get(boniato.dish_id)).rows?.[0]?.r);
check('rango 3 no guarda (42501)', code(await save(mut(boniato, (c) => { c.name_es = 'X'; }), 'borrador', null)) === '42501');
await as(ids.outsider);
check('sin rango en el hotel: no lee (42501)', code(await get(boniato.dish_id)) === '42501');
check('sin rango en el hotel: no guarda (42501)', code(await save(boniato)) === '42501');
await as(ids.other);
check('ejecutivo de otro hotel no puede actuar en este (42501)', code(await save(boniato)) === '42501' && code(await get(boniato.dish_id)) === '42501');
await as(null, 'anon');
check('anonimo no puede usar las funciones (42501)', code(await get(boniato.dish_id)) === '42501');
await as(ids.r1);
const direct = await run('select * from compi_private.arts_recipes');
check('acceso directo a la tabla denegado', code(direct) === '42501', code(direct));

// ---- validacion ----
const bad = async (name, rec) => { const r = await save(rec, 'borrador', null, O, H, rec.dish_id); check(name, code(r) === '22023', code(r) + ' ' + (r.err?.message ?? 'guardado')); };
await bad('clave desconocida: rechazada', mut(boniato, (c) => { c.extra = 1; }));
await bad('falta una clave obligatoria: rechazada', mut(boniato, (c) => { delete c.unresolved; }));
await bad('ingrediente con campo desconocido: rechazado', mut(boniato, (c) => { c.ingredients[0].otro = 1; }));
await bad('id de ingrediente repetido: rechazado', mut(boniato, (c) => { c.ingredients[1].id = c.ingredients[0].id; }));
await bad('unidad desconocida con cantidad inventada: rechazado', mut(boniato, (c) => { c.ingredients[0].unit = 'desconocida'; c.ingredients[0].quantity = 30; }));
await bad('cantidad negativa: rechazada', mut(boniato, (c) => { c.ingredients[0].quantity = -1; }));
await bad('pasos no consecutivos: rechazados', mut(boniato, (c) => { c.steps[1].number = 5; }));
await bad('alergeno de un ingrediente inexistente: rechazado', mut(boniato, (c) => { c.allergens.push({name: 'x', ingredient_ids: ['zz'], source_refs: [], verification: 'pendiente'}); }));
await bad('nombre de 201 caracteres: rechazado', mut(boniato, (c) => { c.name_es = 'a'.repeat(201); }));
const prevB = (await get(boniato.dish_id)).rows[0].r.revision;
check('nombre de 200 caracteres: aceptado', !!(await save(mut(boniato, (c) => { c.name_es = 'a'.repeat(200); }), 'borrador', prevB)).rows?.[0]?.r);
const noOutlet = await save(mut(boniato, (c) => { c.outlet_id = 'viejo'; }), 'borrador', null, 'viejo');
check('outlet archivado: 404', code(noOutlet) === 'PT404', code(noOutlet));
const mismatch = await save(boniato, 'borrador', null, O, H, 'otro-plato');
check('la clave del plato debe coincidir con dish_id', code(mismatch) === '22023', code(mismatch));
check('guide_key con mayusculas: rechazada', !!(await save(mut(boniato, (c) => { c.dish_id = 'Mal_Id'; }))).err);
const hummus = mut(tostada, (c) => { c.dish_id = 'tostada-hummus'; c.ingredients.push({id: 'h1', name_es: 'Hummus', quantity: null, unit: 'desconocida', original_measure: '', optional: false, preparation: '', image_label: 'Hummus', source_refs: [], evidence_status: 'pendiente'}); });
check('cantidad de hummus desconocida (null): aceptada', !!(await save(hummus)).rows?.[0]?.r);

// ---- aprobacion ----
const approvedMeta = (c) => { c.metadata.document_status = 'APROBADO'; c.metadata.approval_evidence_id = 'ev-1'; };
const cur = async () => (await get(boniato.dish_id)).rows[0].r;
const rev = async () => (await cur()).revision;
const draftApproved = await save(mut((await cur()).record, approvedMeta), 'borrador', await rev());
check('APROBADO en el documento con estado borrador: rechazado', code(draftApproved) === '22023', code(draftApproved));
const noEvid = await save(mut((await cur()).record, (c) => { c.metadata.document_status = 'APROBADO'; c.metadata.approval_evidence_id = null; }), 'aprobada', await rev());
check('estado aprobada sin evidencia de aprobacion: rechazado', code(noEvid) === '22023', code(noEvid));
const stillDraft = await save(mut((await cur()).record, (c) => { c.metadata.document_status = 'BORRADOR'; c.metadata.approval_evidence_id = 'ev-1'; }), 'aprobada', await rev());
check('estado aprobada con el documento en BORRADOR: rechazado', code(stillDraft) === '22023', code(stillDraft));
await as(ids.r2);
const byR2 = await save(mut((await cur()).record, approvedMeta), 'aprobada', await rev());
check('rango 2 no puede aprobar (42501)', code(byR2) === '42501', code(byR2));
await as(ids.r1);
const byR1 = await save(mut((await cur()).record, approvedMeta), 'aprobada', await rev());
check('ejecutivo con evidencia aprueba', !!byR1.rows?.[0]?.r, byR1.err?.message);
check('queda como aprobada', (await cur()).status === 'aprobada');

// ---- listado ----
const list = await run('select * from public.compi_arts_list_recipes($1,$2)', [H, O]);
check('el listado devuelve las recetas del outlet', list.rows?.length === 3 && list.rows.some((r) => r.guide_key === boniato.dish_id && r.status === 'aprobada'), JSON.stringify(list.rows ?? list.err?.message));
await as(ids.other);
check('el listado de otro hotel: denegado', code(await run('select * from public.compi_arts_list_recipes($1,$2)', [H, O])) === '42501');

console.log(fails ? `\n${fails} PRUEBA(S) FALLARON` : '\nTODAS LAS PRUEBAS PASARON');
process.exit(fails ? 1 : 0);

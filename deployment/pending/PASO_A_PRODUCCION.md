# Paso a producción: cuentas directas

Estado (22/11/2026): **preparado y ensayado; NADA aplicado en producción** (`dzfwdxhbldnfqowrnhxf`). Cada paso exige confirmación expresa del propietario.
Probado a fondo en `compi-pruebas` (`urtxakicjonkfmewktip`): 21/21 (cuentas), 17/17 (ejecutivo), pantalla web comprobada a mano.

## Antes de empezar (ya hecho)

- Producción verificada: `active_download_session` MD5 `c763b007…`, `register_address` MD5 `27584da0…` (las que la migración espera), ninguna pieza nueva creada, 25 cuentas, 0 con marca de cambio.
- Definiciones originales guardadas en `CompI_Publicacion\respaldo_cuentas_directas_2026-11-22\funciones_originales.sql` (fuera de Git).
- Ensayo de ambas migraciones en producción con `ROLLBACK`: sin errores, producción sin cambios.
- Vuelta atrás `revertir-cuentas-directas.sql` ensayada con `ROLLBACK` en pruebas: sin errores.
- La migración no modifica datos de personas: crea 2 tablas y 5 funciones nuevas y reemplaza 2 funciones. Las 25 cuentas actuales no cambian
  (ninguna tiene la marca de cambio de contraseña), y las direcciones nuevas llevarán el sufijo del hotel (`.arts`).

## Pasos (en este orden; verificar cada uno antes del siguiente)

1. **SQL** — `cuentas-directas.sql` y después `cuentas-directas-ejecutivo.sql`:
   `npx supabase@latest db query --remote=dzfwdxhbldnfqowrnhxf --yes -f deployment/pending/<archivo>.sql`
   Verificar: 5 funciones nuevas y 2 tablas existen; huellas de las 2 funciones modificadas iguales a las de `compi-pruebas`; `anon`/`authenticated` sin permiso de ejecución en las 4 funciones de servicio; 25 cuentas intactas.
2. **Edge Function** `compi-arts-crear-cuenta` (`supabase/arts-edition/functions/compi-arts-crear-cuenta/index.ts`), con `--use-api --no-verify-jwt`.
   Verificar: CORS 204 para `https://compichef.com` y 403 para un origen ajeno; sin token 401. **No** ejecutar los bancos e2e contra producción (crean cuentas).
3. **Web**: fusionar la rama `cuentas-directas` en `main`, `npm test`, `npm run build`, `wrangler deploy`.
   Verificar: `https://compichef.com/password-change.js` 200 y `management.js` apunta a `compi-arts-crear-cuenta`; la portada y el Correo siguen abriendo.
4. **Ejecutivo**: `node scripts/crear-ejecutivo.mjs --proyecto dzfwdxhbldnfqowrnhxf --hotel hotel-arts-barcelona --nombre <nombre> --apellido <apellido>`
   (interactivo; pide escribir el nombre del hotel). Entregar la contraseña por un canal privado. Primer acceso: cambia la contraseña y registra el segundo factor.
5. **Limpieza**: retirar el registro de prueba de Erik Ramirez desde Equipo. Más adelante, retirar el flujo de invitaciones antiguo.

## Vuelta atrás

- **Web**: `wrangler rollback` a la versión anterior (o volver a desplegar el commit previo de `main`).
- **Edge Function**: `npx supabase@latest functions delete compi-arts-crear-cuenta --project-ref dzfwdxhbldnfqowrnhxf` (la función no existía antes).
- **SQL**: `revertir-cuentas-directas.sql` (comprueba la huella de las funciones nuevas, restaura las originales y borra lo creado). Si `account_creations`
  ya tiene filas, conservarlas antes de borrar la tabla. Las cuentas creadas con la función no se borran con este SQL: se retiran desde Equipo.
- Las 25 cuentas existentes no se tocan en ningún paso, así que la vuelta atrás no afecta a su acceso.

## Riesgos y límites

- No hay segundo entorno para ensayar la web contra producción: la verificación posterior a cada paso es de solo lectura o con una cuenta que se retira.
- Un ejecutivo nuevo necesita registrar el segundo factor antes de operar (comportamiento actual, no cambia).
- El flujo antiguo de invitaciones queda inutilizable desde la pantalla (el botón se retira) pero sus funciones siguen en la base de datos hasta retirarlas aparte.

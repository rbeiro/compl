# Diseño: cuentas creadas directamente (sin invitaciones)

Estado: **propuesta, nada implementado ni desplegado** (22/11/2026). Sustituye al flujo de invitaciones, que depende de un relé
externo del laboratorio que no está en este repositorio (ver `ESTADO_PUBLICACION.md`).

## Decisiones del propietario

- Contraseña generada por el sistema, **mostrada una sola vez** y **cambio obligatorio en el primer acceso**.
- Correo de empleado automático (inicial + apellido + sufijo del hotel, p. ej. `m.lopez.arts@compichef.com`); ya existe
  `compi_register_employee` / `compi_private.register_address`, que evita duplicados.
- Solo el ejecutivo (rango 1) de cada hotel crea cuentas de ese hotel.
- La cuenta del ejecutivo la crea el propietario con un script local, sin pantalla pública.

## Cómo está hoy una cuenta activa

Una cuenta activa es: usuario en `auth.users` (correo confirmado) + `compi_staff.user_id` enlazado + una fila en
`compi_memberships(user_id, hotel_key)`. Hoy eso lo hace el disparador `finish_lab_identity` al aceptar una invitación.
Las comprobaciones de permisos pasan por `compi_private.my_rank` y `active_download_session()`, que exige además no necesitar MFA.
**Los ejecutivos (rango 1) exigen segundo factor** (`compi_needs_mfa`): un ejecutivo nuevo debe registrar su segundo factor
antes de poder gestionar nada.

## Piezas a construir

1. **Función de servidor `compi-crear-cuenta`** (Edge Function). Verifica con el token del llamante que es rango 1 del hotel
   indicado y de sesión válida; llama a `compi_register_employee` con ese mismo token (idempotente por `request_id`); con la clave de
   administrador (solo en el servidor) crea el usuario con contraseña aleatoria de 16+ caracteres (CSPRNG) y `email_confirm`;
   enlaza `user_id` y la fila de `compi_memberships` mediante una función SQL restringida al rol de servicio; devuelve correo y
   contraseña una vez, con `Cache-Control: no-store`. La contraseña no se guarda ni se escribe en registros.
2. **Cambio obligatorio**: marca `must_change_password` en los metadatos de aplicación (el usuario no puede editarlos). Mientras esté
   puesta, `active_download_session()` devuelve falso, lo que bloquea todas las RPC protegidas hasta que cambie la contraseña. Una
   pantalla de primer acceso llama a `PUT /auth/v1/user` y después a una función que quita la marca solo si la contraseña cambió.
3. **Interfaz**: en "Registrar empleado" el botón crea la cuenta y muestra correo y contraseña con aviso de "no se volverá a mostrar";
   se retira "Enviar invitación". Botón "Restablecer contraseña" (nueva contraseña temporal, misma regla de cambio obligatorio).
4. **Script del propietario** `scripts/crear-ejecutivo.mjs`: crea el ejecutivo (correo p. ej. `j.garcia.arts@compichef.com`), su fila de
   personal con rango 1 y su pertenencia. Lee la clave de administrador de una variable de entorno de tu equipo; nunca se guarda en Git.
5. **Retirada** del flujo de invitaciones: botón, textos y funciones sin uso, en un cambio posterior y aparte.

## Seguridad y riesgos

- La clave de administrador nunca llega al navegador ni a Git. El hotel se toma de la pertenencia del llamante, no de lo que envíe.
- Límite de cuentas por minuto por ejecutivo y registro de quién creó a quién y cuándo (sin contraseñas).
- Una contraseña temporal visible en pantalla puede copiarse o fotografiarse: de ahí el cambio obligatorio y su caducidad.
- Olvido de contraseña: la recuperación actual también usa el relé externo; hasta rediseñarla, el ejecutivo restablece la de sus
  empleados y el propietario la del ejecutivo.
- Los ejecutivos nuevos necesitan segundo factor antes de operar (comportamiento actual, no se cambia).

## Cómo probarlo sin afectar a datos reales

No hay proyecto de pruebas: todo apunta a producción (`chefi-laboratorio`). Recomendado: crear un **proyecto de Supabase de pruebas**
con el mismo esquema y probar ahí antes. Si no, las pruebas en producción usarán solo cuentas marcadas como de prueba, retiradas después,
con una copia previa de lo que se vaya a tocar.

## Orden propuesto (cada paso con su verificación y su confirmación antes de tocar producción)

1. Función SQL de enlace + marca de cambio obligatorio (ensayo con ROLLBACK).
2. Función `compi-crear-cuenta`.
3. Pantalla de primer acceso y cambios en "Registrar empleado".
4. Script del ejecutivo y alta del primero (Hotel Arts).
5. Retirada de invitaciones.

## Avance (22/11/2026) — solo en el proyecto de pruebas `urtxakicjonkfmewktip`

Hecho y probado en pruebas (producción sin tocar):
- `deployment/pending/cuentas-directas.sql` aplicado (ensayo con ROLLBACK previo): tabla `hotel_codes` (hotel-arts-barcelona -> `arts`),
  registro `account_creations`, `must_change_password()`, `compi_link_created_account` (solo rol de servicio; fija la marca de cambio),
  `compi_finish_password_change` (solo si la contraseña cambió), y modificadas `active_download_session` y `register_address`
  (sufijo de hotel, apellido a 36 caracteres).
- Edge Function `compi-arts-crear-cuenta` (`supabase/arts-edition/functions/compi-arts-crear-cuenta/index.ts`) desplegada en pruebas.
- Banco `deployment/test-project/e2e-cuentas.mjs`: 21/21 correctas (ejecutivo con y sin segundo factor, creación, repetición,
  rechazos de permisos, bloqueo del buzón hasta cambiar la contraseña, cambio y desbloqueo).

Pendiente: pantalla de la web (mostrar correo y contraseña una vez; pantalla de primer acceso), script `crear-ejecutivo`,
retirada del flujo de invitaciones, y aplicar a producción (migración con ensayo, Edge Function, web) con confirmación expresa.
Nota: la migración de producción debe guardar la misma huella MD5 de `register_address`/`active_download_session` (ya coinciden).

### Script del ejecutivo (22/11/2026) — solo proyecto de pruebas

- `deployment/pending/cuentas-directas-ejecutivo.sql` (después de `cuentas-directas.sql`): `compi_reserve_executive` y `compi_activate_executive`, solo
  ejecutables por el rol de servicio (comprobado: ni `anon` ni `authenticated`). No existe vía pública para crear ejecutivos. Aplicado en pruebas.
- `scripts/crear-ejecutivo.mjs`: `node scripts/crear-ejecutivo.mjs --proyecto <ref> --hotel hotel-arts-barcelona --nombre Juan --apellido Garcia`.
  La clave de administrador sale de `COMPI_SERVICE_KEY` o de la sesión del CLI de Supabase y nunca se imprime. En producción exige modo interactivo y
  escribir el nombre del hotel para confirmar. Muestra correo y contraseña temporal una vez; el ejecutivo debe cambiarla y registrar el segundo factor.
- `deployment/test-project/e2e-ejecutivo.mjs`: 17/17 (script, correo único, hotel sin código, rechazo en producción con `--json`, login, marca de cambio,
  bloqueo, cambio de contraseña, segundo factor obligatorio, creación de un empleado por ese ejecutivo, funciones de alta no públicas). `e2e-cuentas.mjs`: 21/21.
  Ambos reinician los datos del proyecto de pruebas (`_reset.mjs`, solo ese proyecto) y se han ejecutado dos veces seguidas con el mismo resultado.

### Pantalla web (22/11/2026) — rama `cuentas-directas`, NO publicada

Cambios en `public/` (rama aparte para que ningún despliegue accidental de `main` los publique antes de tiempo):
- `password-change.js` (nuevo): pantalla de primer acceso; detecta la marca `compi_must_change` del token y bloquea el portal hasta elegir
  contraseña (`PUT /auth/v1/user` + `compi_finish_password_change` + nuevo inicio de sesión para renovar el token).
- `management.js`: "Registrar empleado" llama a `compi-arts-crear-cuenta`, solo ofrece rangos 2 y 3, y muestra correo y contraseña
  temporal una vez, con botones Copiar y "Entendido, ya la he copiado". Se retira el botón de invitación de las filas
  (la función `labInvite` queda sin uso, para borrarla con el resto del flujo de invitaciones).
- `portal.js`: `api()` admite `method` (PUT) y `render()` muestra el primer acceso si hace falta. `scripts/public-files.json` incluye el módulo nuevo.
- Textos en seis idiomas en `locales/staff.js` y `locales/auth.js`.
Verificado contra `compi-pruebas` con una copia local de la web (CSP ajustado solo en la copia): empleada con contraseña temporal -> pantalla de
primer acceso, aviso de contraseñas distintas, cambio correcto, portal cargado y token sin marca; ejecutivo con segundo factor -> Equipo -> crea
`l.mora.arts@compichef.com`, ve la contraseña una vez, y desaparece del DOM al pulsar el botón. 14 tests y compilación correctos.
NO desplegar esta rama a Cloudflare hasta que la migración SQL y la Edge Function estén en producción.

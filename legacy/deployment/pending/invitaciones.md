# Invitaciones: cambio pendiente para el paso 8

Estado: **ejecutada en producción el 22/11/2026** (ver ESTADO_PUBLICACION.md).

Proyecto Supabase: `dzfwdxhbldnfqowrnhxf` (`chefi-laboratorio`).

La RPC compartida `public.compi_manage_invitation(text,uuid,text,uuid)` crea los enlaces de invitación en el servidor. Actualmente usa:

```text
https://compi-laboratorio.leonardo-vincere.chatgpt.site/invitacion.html#<ticket>
```

Cambiar el Site URL de Supabase Auth no cambia esta URL. La propuesta `invitation-url.sql` sustituye únicamente ese prefijo por:

```text
https://compichef.com/invitacion.html#<ticket>
```

## Cuándo aplicar

En el paso 8, después de comprobar HTTPS en `compichef.com`, servir correctamente la página de invitación y permitir ese origen exacto en `compi-arts-aceptar-lab`. Confirmar que esta RPC compartida debe enviar sus nuevas invitaciones al dominio definitivo.

El efecto alcanza a **todas las nuevas invitaciones generadas por esta RPC compartida**, también desde otras copias del portal. No reescribe los mensajes ya en cola, las invitaciones emitidas ni los datos de usuarios. La restricción `@compi.invalid`, el buzón de laboratorio, la caducidad y los permisos siguen igual; esta propuesta no habilita invitaciones comerciales a direcciones reales.

## Protección frente a cambios concurrentes

La definición leída mediante `pg_get_functiondef` tiene MD5 `a8fc4540901857e81d8b52164c8f955a`, longitud 3536 y una sola aparición del prefijo antiguo. El SQL comprueba la firma exacta, ese MD5 y esa única aparición antes de cambiar nada. Si no coinciden, se detiene: revisar de nuevo la función, sin retirar la protección ni sustituir el hash a ciegas.

El SQL utiliza una transacción y comprueba que el único cambio de definición sea la URL, conservando propietario, permisos, modo de seguridad y configuración. No invoca la función ni envía ninguna invitación.

Este archivo está fuera de `supabase/migrations`: es una **propuesta manual**, no una migración aplicada. En el paso 8 se creará la migración definitiva con el comando que confirme la ayuda de la versión instalada de Supabase CLI, y se registrará el resultado de su validación.

## Comprobaciones de ruta antes de aplicar

1. `/` devuelve el portal y las rutas `/#/...` se abren normalmente.
2. `/invitacion.html#compi_prueba_sin_ticket` conserva el fragmento al redirigirse a `/invitacion`; usar un fragmento ficticio y no pulsar el envío.
3. `/invitacion` carga la página, sus módulos JS y sus estilos. Una invitación ausente o inválida muestra el estado previsto.
4. La preflight `OPTIONS` de la función de aceptación admite `Origin: https://compichef.com` y mantiene el origen anterior durante la transición.
5. Después del cambio, comprobar una invitación con una cuenta de prueba y alcance expresamente autorizado. Los tests HTTP de ruta no validan por sí solos la activación real.

Documentación: https://supabase.com/docs/guides/auth/redirect-urls


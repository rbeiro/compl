# Paso a producción: eliminación de empleados mejorada

Estado (22/11/2026): **preparado y ensayado; NADA aplicado en producción**. El SQL y la web están en la rama `eliminar-empleado` (archivo `deployment/pending/eliminar-empleado.sql`);
`main` solo contiene este procedimiento y la vuelta atrás. Cada paso exige confirmación expresa del propietario.

## Qué cambia
1. "Eliminar empleado" borra también el usuario de acceso (`auth.users`) si ya no tiene otra ficha ni pertenencia a otro hotel (si algo lo referencia, se conserva sin error).
2. Las filas "Pendiente de activación" se pueden eliminar desde Equipo ("Eliminar registro"), con su dirección reservada: nueva `compi_remove_pending_employee` (solo ejecutivo del hotel).
3. El cuadro de confirmación de "Eliminar empleado" avisa de que se borra el usuario de acceso (6 idiomas).

## Hecho antes (verificado)
- Probado en `compi-pruebas`: 18/18 de `e2e-eliminar.mjs` (dos veces seguidas), más 21/21 (cuentas) y 17/17 (ejecutivo) sin regresiones; pantalla comprobada a mano (fila pendiente, aviso nuevo, usuario borrado).
- El banco encontró y corrigió dos fallos propios del SQL (permiso de ejecución de la función privada y columna ambigua); el archivo de la rama ya los incluye.
- Producción: `delete_withdrawn_employee` MD5 `30a9850a…` (la esperada), 0 funciones nuevas, 25 cuentas, 25 fichas, 0 pendientes.
- Definición original guardada en `CompI_Publicacion\respaldo_cuentas_directas_2026-11-22\delete_withdrawn_employee_original.sql` (fuera de Git).
- Ensayo de la migración completa en producción con ROLLBACK: sin errores y sin cambios. Vuelta atrás `revertir-eliminar-empleado.sql` ensayada en pruebas con ROLLBACK.

## Pasos (en orden)
1. **SQL en producción**: `npx supabase@latest db query --remote=dzfwdxhbldnfqowrnhxf --yes -f deployment/pending/eliminar-empleado.sql` (desde la rama).
   Verificar: `delete_withdrawn_employee` contiene `delete from auth.users`; 2 funciones nuevas; `anon` sin permiso sobre `compi_remove_pending_employee` y `authenticated` con permiso; 25 cuentas y 25 fichas intactas.
2. **Web**: fusionar `eliminar-empleado` en `main`, `npm test`, `npm run build`, comprobar que no hay referencias al proyecto de pruebas, `wrangler deploy`.
   Verificar: `management.js` 200 y llama a `compi_remove_pending_employee`; `portal.js` apunta a producción; 404 en `package.json`/`wrangler.jsonc`/`scripts/`.
3. **Comprobación del propietario**: crear un empleado ficticio y eliminarlo desde Equipo; después comprobar (solo lectura) que no queda ni ficha ni usuario de acceso.

## Vuelta atrás
- **Web**: `wrangler rollback` a la versión anterior.
- **SQL**: `revertir-eliminar-empleado.sql` (comprueba la huella de la versión nueva, restaura la original y borra las 2 funciones nuevas).
  Los usuarios de acceso ya borrados por la función nueva no se recuperan con este SQL (son definitivos, como la ficha).

## Riesgos
- Al eliminar un empleado, su usuario de acceso se borra de forma definitiva (si no pertenece a otro hotel); el cuadro de confirmación lo dice.
- El orden importa: la web nueva llama a `compi_remove_pending_employee`, que debe existir antes en producción.

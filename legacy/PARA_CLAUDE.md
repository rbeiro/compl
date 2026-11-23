# Continuidad de CompI

Lee README.md y ESTADO_PUBLICACION.md. Conserva colores, logo, tipografía,
animaciones y funciones. Esta copia prepara el hosting; no solicita un rediseño.

## Base

- CompI · Hotel Arts v6, commit d89ba68558407fcd8ed0477a3083c0d13abd0e40.
- 305 recursos públicos con contenido intacto.
- Supabase: dzfwdxhbldnfqowrnhxf, organización CompI, chefi-laboratorio.
- Workers Static Assets, assets ./dist, Worker compi-web.
- Node >=22.12; Wrangler fijado en package.json y package-lock.json.

## Trabajo preparado

Build portable: npm run build. Lista explícita: scripts/public-files.json.
npm test comprueba riesgos de publicación de archivos.
npm run check:cloudflare simula sin desplegar.
npm run dev inicia una previsualización local.
No usar wrangler preview como prueba local: puede publicar una preview.

Ocho listas CORS contienen compichef.com como cambio local pendiente. Falta el
hostname workers.dev exacto. Conservar origen antiguo y localhost; no relajar
autenticación, permisos ni añadir comodines.

La RPC compartida de invitaciones tiene un dominio Laboratorio fijo. Ver propuesta
en deployment/pending para el paso 8. Site URL de Auth no cambia esa cadena.
La restricción de direcciones internas es ahora @compichef.com (migrado el 22/11/2026; ver ESTADO_PUBLICACION.md).
La recuperación también usa el flujo propio existente.

## Continuar

Paso 3 completado: repositorio privado https://github.com/mcgradi3000/compi-web,
propietario mcgradi3000, rama main, con el código inicial subido.
Siguiente: paso 4, despliegue temporal en Cloudflare. Los pasos 4 a 11 siguen
pendientes. Cambiar DNS, asociar dominios y modificar Supabase corresponden a sus
fases posteriores. No ejecutar SQL al abrir la carpeta ni redesplegar todo el backend.

La carpeta anterior contiene herramientas, compositor y backend adicionales;
no sustituirla por este export. VERSION_DE_LA_COPIA.json y VERSION_PUBLICACION.json
son registros históricos de la entrega del paso 2; no actualizar sus huellas para
representar cambios posteriores. Git registra esos cambios y ESTADO_PUBLICACION.md
mantiene el avance actual.

Resumir cambios y comprobaciones brevemente. Evitar releer todo el proyecto cuando
la tarea pueda resolverse con archivos concretos.

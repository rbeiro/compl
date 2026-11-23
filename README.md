# CompI

Portal CompI · Hotel Arts. Fuente: v6,
commit d89ba68558407fcd8ed0477a3083c0d13abd0e40.

Los 305 archivos de public/ mantienen exactamente los bytes del sitio publicado.
El frontend de la carpeta de trabajo anterior es equivalente: 15 diferencias eran
solo finales de línea. Esa carpeta conserva herramientas y backend adicionales.

## Repositorio

- Propietario: mcgradi3000.
- Repositorio privado de origen (origin): [mcgradi3000/compi-web](https://github.com/mcgradi3000/compi-web).
- Rama principal: main.

Paso 3 completado: repositorio creado y código inicial subido a main.
El despliegue temporal en Cloudflare es el siguiente paso y sigue pendiente.

## Compilar y previsualizar

Requisitos: Node >=22.12 y npm. Comprobado en Windows con Node 24.22.2 y npm 11.19.1.
En PowerShell, usar npm.cmd si la política bloquea npm.ps1.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run check:cloudflare
npm.cmd run dev
```

Abrir http://127.0.0.1:4173. check:cloudflare usa wrangler deploy --dry-run:
valida sin publicar. dev sirve localmente, no crea una preview online.
Si 4173 está ocupado, cerrar el servidor correspondiente antes de iniciar otro;
no detener procesos desconocidos. Una prueba HTTP puede usar otro puerto, pero
Supabase actualmente solo admite 4173 como origen local.

La copia utiliza el Supabase real: editar puede cambiar datos reales. Los tests del
build no inician sesión ni escriben en Supabase.

## Qué se publica

wrangler.jsonc prepara el Worker compi-web, con assets en ./dist.
No contiene un dominio personalizado ni credenciales. No necesita un Worker JS.
npm run build usa Node y scripts/public-files.json, una lista explícita de recursos
aprobados. Rechaza archivos adicionales, rutas no válidas y enlaces simbólicos.
Al añadir un recurso web, revisar su contenido y añadir su ruta al manifiesto.
No aprobar carpetas completas automáticamente. scripts/build.sh se conserva como
referencia original; npm run build ya no depende de Bash ni de un índice Git.

Solo dist se sirve al navegador. supabase, deployment, documentos, dependencias,
datos locales y archivos de la raíz no forman parte de la publicación estática.
La clave publicable de Supabase incluida es pública; las claves privadas nunca
deben añadirse a public.

El portal utiliza rutas /#/...; se mantienen los 404 para recursos ausentes.
Cloudflare normaliza /invitacion.html a /invitacion. Comprobar que el fragmento de
invitación se conserva al activar la URL temporal.

## Backend conservado

Proyecto dzfwdxhbldnfqowrnhxf (chefi-laboratorio), organización CompI.
Panel: https://supabase.com/dashboard/project/dzfwdxhbldnfqowrnhxf

Los 34 JS/TS de las ocho Edge Functions Arts coincidían con las versiones activas
v1 al normalizar blancos finales. Esta carpeta añade únicamente el origen exacto
https://compichef.com a sus listas. PREPARADO, NO DESPLEGADO.
Se conservan Arts y localhost. Añadir workers.dev cuando se conozca su hostname
exacto; no usar comodines. Ver deployment/pending/cors-review.json y
cors-compichef.patch. No aplicar el patch otra vez: la fuente local ya lo contiene.

La RPC compartida compi_manage_invitation todavía genera enlaces a Laboratorio.
Site URL de Auth no cambia esa cadena. deployment/pending/invitation-url.sql es una
propuesta para el paso 8, con control de versión, no ejecutada. Conserva las reglas
existentes, incluido @compichef.com (antes @compi.invalid); no convierte el portal en un alta comercial.
El código de supabase/ es parcial y no reconstruye un proyecto vacío. No ejecutar
todos los SQL ni redesplegar funciones ajenas a este cambio.

## Siguiente fase: paso 4

Preparar el despliegue temporal en Cloudflare. Los pasos 4 a 11 siguen pendientes.
.gitignore excluye dist, node_modules, archivos de entorno y
datos locales; no sustituye revisar secretos en el código.

Más adelante, Cloudflare Builds: raíz de esta carpeta, build npm run build, deploy
npx wrangler deploy y rama main. Wrangler está fijado en 4.166.0,
con package-lock.json. El entorno de build debe cumplir Node >=22.12.

La configuración histórica .openai/hosting.json identifica el sitio fuente, no el
nuevo Worker. No se han cambiado la web activa, DNS, dominios, usuarios, datos,
secretos, Auth ni código remoto de Supabase durante los pasos 2 y 3.

## Procedencia

VERSION_DE_LA_COPIA.json y VERSION_PUBLICACION.json son registros históricos
conservados de la entrega del paso 2: describen el snapshot original y la copia
preparada entonces, respectivamente. Sus huellas no describen los commits
posteriores. Desde el paso 3, Git registra los cambios; ESTADO_PUBLICACION.md
recoge el avance y las comprobaciones de cada fase.

Documentación:
https://developers.cloudflare.com/workers/static-assets/
https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/
https://developers.cloudflare.com/workers/wrangler/commands/workers/

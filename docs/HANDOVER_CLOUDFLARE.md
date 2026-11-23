# Handover de despliegue CompI — 21/11/2026

## Meta y límites
Migrar sin rediseño la web de CompI a Cloudflare Workers Static Assets, con dominio principal `compichef.com`. Mantener backend y datos de Supabase. IONOS sigue registrando los dominios. No cambiar DNS, autenticación, base de datos o la web antigua durante el paso 4.

## Referencias verificadas
- Proyecto local: `C:\Users\mcgra\Desktop\CompI_Publicacion\CompI_Proyecto`.
- GitHub privado: `https://github.com/mcgradi3000/compi-web` (rama `main`; último commit comprobado `31c3eb630fd4cb31caf69c9679fcc42209acec91`). Verificar de nuevo con `git status -sb` y `git log -1 --oneline`.
- Frontend de origen, Sites v6: `https://compi-hotel-arts.leonardo-vincere.chatgpt.site`.
- Supabase real: proyecto `dzfwdxhbldnfqowrnhxf`, organización CompI, nombre `chefi-laboratorio`; panel `https://supabase.com/dashboard/project/dzfwdxhbldnfqowrnhxf`.
- Cloudflare: cuenta autorizada mediante Wrangler OAuth en Windows; Worker deseado `compi-web`. No incluir ID de cuenta ni tokens en informes públicos.

## Progreso
1. Copia y accesos: completado para código, GitHub y Supabase.
2. Build Cloudflare: completado y probado.
3. GitHub privado: completado; 364 archivos subidos.
4. **En curso**: el despliegue falló porque no estaba registrado el subdominio gratuito `workers.dev`. La interfaz de Cloudflare se abrió para activar `compi-staging` si estaba libre. **No hay URL temporal de despliegue confirmada**. Verificar si el usuario completó ese registro.
5–11: pendientes — validar Supabase con origen temporal, DNS, dominio principal/HTTPS, Auth/invitaciones, redirecciones, validación general y mantenimiento.

## Stack y validaciones
Frontend HTML/CSS/JS; `public/` tiene 305 archivos originales. `npm.cmd run build` crea `dist/`, excluida de Git. Node >=22.12; Wrangler fijado en 4.166.0 y configurado en `wrangler.jsonc` para Static Assets. `scripts/public-files.json` es el inventario permitido.

Últimas verificaciones: 14 tests de Windows correctos, uno omitido por enlace simbólico (pasó en Linux); build de 305 archivos; `wrangler deploy --dry-run` correcto; 13 pruebas HTTP locales correctas, incluidos recursos PDF/WASM y 404 de archivos internos. La publicación real **no** se completó.

Comandos desde la raíz (Windows PowerShell):
```powershell
git status -sb
npm.cmd test
npm.cmd run build
npm.cmd run check:cloudflare
.\node_modules\.bin\wrangler.cmd whoami
.\node_modules\.bin\wrangler.cmd deployments list --name compi-web
# Tras confirmar workers.dev:
.\node_modules\.bin\wrangler.cmd deploy
```

## Continuar exactamente aquí
1. Revisar estado real de `workers.dev` y existencia de `compi-web` en Cloudflare. No dar por creado nada a partir del intento anterior.
2. Si falta el subdominio, pedir solo completar esa configuración de cuenta; NO inventar la dirección.
3. Publicar el frontend y recuperar la URL real `workers.dev`.
4. Comprobar portada, invitación, JavaScript, fuentes, WASM, 404 de rutas internas y ausencia de secretos.
5. Verificar integración GitHub → Cloudflare Builds; no darla por conectada solo porque GitHub exista.
6. Documentar comprobaciones y actualizar `ESTADO_PUBLICACION.md`; hacer commit con cambios necesarios.

## Backend: no aplicar todavía
En `deployment/pending/cors-review.json` y `cors-compichef.patch` hay ajustes preparados para ocho Edge Functions; aún **no desplegados**. Falta añadir el origen temporal exacto; conservar origen de Sites y localhost. No usar CORS con `*`. La RPC de invitaciones sigue enviando a Laboratorio: `deployment/pending/invitation-url.sql` es una propuesta **no ejecutada** para el paso 8. Mantiene restricción `@compi.invalid`. Cambiar Site URL de Auth no sustituye automáticamente esa URL. El sitio local comparte datos reales: pruebas de escritura solo con registros controlados.

## Dominios finales
`compichef.com` principal. `www.compichef.com`, `compichef.es`, `compikitchen.com`, `compikitchen.es` y sus `www` redirigirán al principal. Los DNS no se cambian antes de completar la prueba temporal.

## Eficiencia y seguridad
Leer por defecto este handover, no el historial entero. Consultar archivos individuales solo por necesidad. No ejecutar todas las skills, agentes o búsquedas globales. Mostrar resúmenes de comandos, no logs completos. Usar Sonnet con esfuerzo medio; pasar a alto solo para bloqueo técnico. Registrar cada decisión; no ocultar errores ni afirmar pruebas no ejecutadas.

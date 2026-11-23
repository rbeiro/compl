# Proyecto de pruebas de Supabase

`export-schema.mjs` reconstruye el esquema (sin datos) de un proyecto leyendo sus catalogos en modo solo lectura:

    node export-schema.mjs <ref-origen> <carpeta-salida>

La salida contiene funciones con datos de negocio: **guardarla fuera de Git** (aqui se usa
`C:\Users\mcgra\Desktop\CompI_Publicacion\proyecto_pruebas\esquema`). Se aplica con `supabase db query --remote=<ref-pruebas> --yes -f <archivo>`,
en el orden numerico de los archivos. Nunca apuntar `--remote` al proyecto de produccion al aplicar.

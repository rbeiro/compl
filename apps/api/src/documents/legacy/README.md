# Legacy document modules

Copied from the Supabase Edge Functions (`supabase/arts-edition/functions`) so
the API produces byte-for-byte the same files: upload validation (`validate.js`)
and brand re-application on PDF/Word downloads (`rebrand.js` + `palette.js`,
`brand-assets.js`, `legacy-drawing.js`). Only the Deno `npm:` import
specifiers were changed. Keep behavior identical when editing.

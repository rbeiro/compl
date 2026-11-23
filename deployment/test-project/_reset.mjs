// Reinicia los datos de personal/direcciones del PROYECTO DE PRUEBAS (solo ese proyecto) usando la sesion del CLI.
import {spawnSync} from 'node:child_process';
import {writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const TEST_REF = 'urtxakicjonkfmewktip';
export function resetTestData() {
  const file = join(mkdtempSync(join(tmpdir(), 'reset-')), 'q.sql');
  writeFileSync(file, `delete from compi_private.arts_recipes; delete from compi_private.account_creations; delete from compi_private.address_allocations; delete from public.compi_memberships; delete from public.compi_staff;`);
  const r = spawnSync(`npx --yes supabase@latest db query --remote=${TEST_REF} --yes -f "${file}"`, {shell: true, encoding: 'utf8'});
  if (/"_tag":"Error"/.test((r.stdout || '') + (r.stderr || ''))) throw new Error('No se pudo reiniciar el proyecto de pruebas.');
}

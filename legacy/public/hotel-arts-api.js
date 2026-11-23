// Only document routes use the Hotel Arts catalog. Membership, team and schedules use the hotel's existing services.
const catalogNames = new Set([
  'compi_catalog_change',
  'compi_classify_guide',
  'compi_commit_file',
  'compi_file_access',
  'compi_generator_outlet',
  'compi_guide_source',
  'compi_guides',
  'compi_outlets',
  'compi_recipe_cost',
  'compi_reserve_generated_draft',
  'compi_review_guide',
  'compi_save_guide_source',
  'compi_save_recipe_cost',
  'compi_stage_guide_access',
  'compi_workspace_catalog',
  'compi_workspace_guide',
  'compi_workspace_media'
]);
const catalogFunctions = new Set([
  'compi-descarga', 'compi-subir-ficha', 'compi-generar-ficha', 'compi-asistente-ficha',
  'compi-marca-documental', 'compi-recuperar-lab', 'compi-aceptar-lab'
]);

export function hotelArtsApiPath(path) {
  return path.replace(/^(\/rest\/v1\/(?:rpc\/)?|\/functions\/v1\/)([a-zA-Z0-9_-]+)(?=[/?]|$)/, (match, prefix, name) => {
    if (catalogNames.has(name)) return prefix + name.replace('compi_', 'compi_arts_');
    if (catalogFunctions.has(name)) return prefix + name.replace('compi-', 'compi-arts-');
    return match;
  });
}

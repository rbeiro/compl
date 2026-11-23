export function platingHref(row) {
  return '#/plating/'+[row.hotel_key,row.outlet_key,row.guide_key].map(encodeURIComponent).join('/');
}

export const GUIDE_KINDS = Object.freeze({plato:'Plato',elaboracion:'Elaboración'});
export const GUIDE_CATEGORIES = Object.freeze({desayunos:'Desayunos',entrantes:'Entrantes',principales:'Principales',postres:'Postres',fondos:'Fondos',
  salsas:'Salsas',bases:'Bases',guarniciones:'Guarniciones',otros:'Otros'});

export async function loadCatalog({rpc,signal}) {
  const rows = [];
  const batch = 200;
  let after_h = '', after_o = '', after_g = '';
  while (true) {
    signal?.throwIfAborted();
    const page = await rpc('compi_workspace_catalog',{after_h,after_o,after_g,batch},signal);
    if (!Array.isArray(page)) throw Error('No se pudo cargar el catálogo.');
    for (const guide of page) {
      rows.push({...guide,kind:Object.hasOwn(GUIDE_KINDS,guide.kind)?guide.kind:null,
        category:Object.hasOwn(GUIDE_CATEGORIES,guide.category)?guide.category:null});
    }
    if (page.length<batch) break;
    const cursor = page.at(-1);
    if (cursor.hotel_key===after_h && cursor.outlet_key===after_o && cursor.guide_key===after_g)
      throw Error('No se pudo cargar el catálogo.');
    after_h=cursor.hotel_key; after_o=cursor.outlet_key; after_g=cursor.guide_key;
  }
  return rows.sort((a,b)=>a.hotel.localeCompare(b.hotel)||a.outlet.localeCompare(b.outlet)||a.title.localeCompare(b.title));
}

export async function loadGuideImage({api,row,variant='approved',signal}) {
  if (!['approved','clean'].includes(variant)) throw new TypeError('Variante de imagen desconocida.');
  if (variant==='approved' ? !row.has_image : !row.has_clean) return null;
  const key=[row.hotel_key,row.outlet_key,row.guide_key,'workspace-'+variant].map(encodeURIComponent).join('/');
  try {
    return await (await api('/functions/v1/compi-descarga/'+key,{payload:{},signal})).blob();
  } catch (error) {
    if (error.status===404) return null;
    throw error;
  }
}

export const restaurantKey = row => JSON.stringify([row.hotel_key,row.outlet_key]);
export function restaurantChoices(rows){
  const outlets=new Map(), names=new Map();
  for(const row of rows)outlets.set(restaurantKey(row),row);
  for(const row of outlets.values())names.set(row.outlet,(names.get(row.outlet)||0)+1);
  return [...outlets].map(([key,row])=>({key,label:names.get(row.outlet)>1?row.outlet+' · '+row.hotel:row.outlet})).sort((a,b)=>a.label.localeCompare(b.label));
}

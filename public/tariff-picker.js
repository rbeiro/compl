const fold = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
import {locale} from './i18n.js';
const currency = amount => new Intl.NumberFormat(locale(),{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(amount);
export function quantityUnits(unit) {
  return {Kg:['g','Kg'],Litro:['ml','Litro'],Unidad:['Unidad'],Manojo:['Manojo']}[unit] || [];
}

// Keep the reference, rather than the product name, as the identity of a purchase option.
export function mountTariffPicker(host,tariffs,{selected='',priceFor,onSelect,confirmedOnly=false,translate=value=>value}) {
  const search=document.createElement('input'), choices=document.createElement('select');
  const searchLabel=document.createElement('label'), listLabel=document.createElement('label');
  searchLabel.className=listLabel.className='ec-field wc-field';
  searchLabel.textContent=translate('Buscar en Tarifas');listLabel.textContent=translate('Producto y tarifa de compra');
  search.type='search';search.placeholder=translate('Producto, proveedor o referencia');
  searchLabel.append(search);listLabel.append(choices);host.replaceChildren(searchLabel,listLabel);
  const entries=tariffs.map(row=>({row,text:fold([row.name,row.reference,row.supplier].join(' '))}));
  function update() {
    const q=fold(search.value.trim());
    const matches=entries.filter(item=>item.text.includes(q));
    choices.replaceChildren(new Option(matches.length?translate('Selecciona una tarifa'):translate('Sin coincidencias'),''));
    for(const {row} of matches){
      const price=priceFor(row);
      const cost=price>0?currency(price)+' / '+row.unit:translate('Precio pendiente');
      const option=new Option([row.name,cost,row.supplier,row.reference,row.control!=='Lista'?row.control:''].filter(Boolean).join(' · '),row.reference);
      option.disabled=!quantityUnits(row.unit).length || (confirmedOnly && (row.control!=='Lista'||!(price>0)));
      choices.add(option);
    }
    choices.value=selected;
    if(!choices.value){choices.value='';selected='';}
    onSelect(tariffs.find(row=>row.reference===selected)||null);
  }
  search.addEventListener('input',update);
  choices.addEventListener('change',()=>{selected=choices.value;onSelect(tariffs.find(row=>row.reference===selected)||null);});
  update();
  return {search,choices};
}

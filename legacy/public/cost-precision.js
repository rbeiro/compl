// Keep the underlying rate when a user opens and saves an existing line without editing it.
const values=new WeakMap(),minimum=new WeakMap(),bound=new WeakSet();
export function amountField(input,exact=input.value){
 if(!input)return;
 if(!minimum.has(input))minimum.set(input,input.getAttribute('min'));
 if(!bound.has(input)){
   bound.add(input);
   input.addEventListener('input',()=>{values.delete(input);const min=minimum.get(input);if(min!==null)input.min=min;});
   input.addEventListener('blur',()=>{if(input.value!==''&&input.checkValidity())amountField(input,readAmount(input));});
 }
 if(exact===''||exact==null){input.value='';values.delete(input);return;}
 const n=Number(exact);if(!Number.isFinite(n))return;
 const display=String(Math.round((n+Number.EPSILON)*100)/100);input.value=display;
 if(Number(display)===0&&n>0&&Number(minimum.get(input))>0)input.min='0';
 values.set(input,{exact:n,display});
}
export function readAmount(input){
 const item=values.get(input);
 return item&&input.value===item.display?item.exact:input.value===''?null:input.valueAsNumber;
}
export function setupAmounts(host){for(const input of host.querySelectorAll('input[type="number"][step="any"],input[type="number"][step="0.0001"]'))amountField(input);}

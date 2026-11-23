import {bindAttr,bindText} from './i18n.js';

// GoTrue validates the code and issues a new, signed AAL2 access token.
export async function segundoFactor({main,node,api,token,signal,remember,render,salir}){
  main.replaceChildren();bindText(document.querySelector('title'),'Verificación en dos pasos · CompI');
  const box=node('section',undefined,'auth-content'),title=node('h1'),info=node('p'),form=node('form'),status=node('p',undefined,'feedback');
  bindText(title,'Verificación en dos pasos');status.setAttribute('role','status');
  const cancel=node('button',undefined,'download');bindText(cancel,'Volver al acceso');cancel.type='button';cancel.onclick=salir;
  box.append(title,info,form,status,cancel);main.append(box);
  const user=await (await api('/auth/v1/user',{token,signal})).json();
  if(signal.aborted)return;
  let factor=user.factors?.find(f=>f.factor_type==='totp'&&f.status==='verified');
  const label=node('label'),caption=node('span'),input=node('input');
  bindText(caption,'Código de seis dígitos');input.dir='ltr';
  input.type='text';input.required=true;input.inputMode='numeric';input.pattern='[0-9٠-٩۰-۹]{6}';input.maxLength=6;input.autocomplete='one-time-code';label.append(caption,input);
  const submit=node('button',undefined,'download primary');bindText(submit,'Verificar y entrar');submit.type='submit';
  function showCode(){form.replaceChildren(label,submit);input.focus();}
  if(factor){
    bindText(info,'Introduce el código actual de tu aplicación de autenticación.');showCode();
  }else{
    bindText(info,'Para proteger tu cuenta de rango 1, vincula tu aplicación de autenticación. Guárdala en tu dispositivo personal.');
    const start=node('button',undefined,'download primary');bindText(start,'Vincular mi autenticador');start.type='button';form.append(start);
    start.onclick=async()=>{
      start.disabled=true;bindText(status,'');
      try{
        const r=await (await api('/auth/v1/factors',{token,signal,payload:{factor_type:'totp',issuer:'CompI',friendly_name:'CompI '+crypto.randomUUID().slice(0,8)}})).json();
        if(signal.aborted)return;
        factor=r;
        const manual=node('p'),caption=node('span'),secret=node('code',r.totp.secret);
        bindText(caption,'Clave de configuración manual');secret.dir='ltr';manual.append(caption,' ',secret);
        if(r.totp.qr_code?.startsWith('data:image/')){
          const qr=node('img');qr.src=r.totp.qr_code;qr.width=180;qr.height=180;bindAttr(qr,'alt','Código QR para vincular el autenticador');box.insertBefore(qr,form);
        }
        box.insertBefore(manual,form);showCode();
      }catch{if(!signal.aborted){bindText(status,'No se pudo vincular el autenticador. Vuelve a intentarlo.');start.disabled=false;}}
    };
  }
  form.onsubmit=async event=>{
    event.preventDefault();if(submit.disabled||!factor?.id)return;
    submit.disabled=true;bindText(status,'');
    try{
      const path='/auth/v1/factors/'+encodeURIComponent(factor.id);
      const challenge=await (await api(path+'/challenge',{token,signal,payload:{}})).json();
      // Auth expects ASCII digits, including when the user types on an Arabic keyboard.
      const code=input.value.replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x0660))
        .replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x06f0));
      const signed=await (await api(path+'/verify',{token,signal,payload:{challenge_id:challenge.id,code}})).json();
      if(signal.aborted)return;
      if(!signed.access_token||!(signed.expires_in>10))throw Error();
      remember({token:signed.access_token,until:Date.now()+1000*Math.min(3600,signed.expires_in-10)});await render();
    }catch{if(!signal.aborted){bindText(status,'No se pudo verificar el código. Prueba con el siguiente que muestre la aplicación.');input.select();}}
    finally{submit.disabled=false;}
  };
}

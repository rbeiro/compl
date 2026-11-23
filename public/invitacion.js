import {motionFor} from './motion-choices.js';
import {bindText} from './i18n.js';
import './motion.js?v=27';
import './ui.js';
const ROOT='https://dzfwdxhbldnfqowrnhxf.supabase.co/auth/v1';
const KEY='sb_publishable_wp2Qs4vSJgFvqFd6qiPEAg_TmHKv60S';
const progressKey='compi.laboratorio.activacion';
const sessionKey='compi.laboratorio.session';
const form=document.querySelector('#activate'),hint=document.querySelector('#intro'),status=document.querySelector('#feedback');
bindText(hint,'Establece una contraseña para entrar con tu cuenta de prueba.');
const hash=location.hash.slice(1);
let progress;
function save(value){
  progress=value;
  if(value)sessionStorage.setItem(progressKey,JSON.stringify(value));
  else sessionStorage.removeItem(progressKey);
}
function feedback(key){
  bindText(status,key);
  if(key)motionFor('invitation',status);
}
function activated(){
  sessionStorage.setItem('compi.invitation.arrival','1');
  save(null);
  location.replace('/#/seguridad');
}
function unavailable(){
  form.hidden=true;
  bindText(hint,'Invitación no disponible. Pide al Chef Ejecutivo que compruebe el enlace de prueba.');
  motionFor('invitation',hint);
}
try {
  if(hash){
    history.replaceState(null,'',location.pathname);
    if(/^[a-zA-Z0-9_-]{24,180}$/.test(hash))save({hash});
    else save(null);
  } else {
    progress=JSON.parse(sessionStorage.getItem(progressKey));
  }
  if(progress?.hash || (progress?.token && progress.until>Date.now())){form.hidden=false;motionFor('invitation',form);}
  else {save(null);unavailable();}
} catch {
  unavailable();
  feedback('Para abrir la invitación, permite el almacenamiento de sesión en este navegador.');
}
async function auth(path,method,payload,token){
  const headers={apikey:KEY,'Content-Type':'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  return fetch(ROOT+path,{method,headers,body:JSON.stringify(payload),cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'});
}
form.onsubmit=async event=>{
  event.preventDefault();
  const submit=form.querySelector('button'),pwd=form.elements.password,repeat=form.elements.repeat;
  if(submit.disabled || !progress)return;
  if(pwd.value!==repeat.value){feedback('Las dos contraseñas deben coincidir.');repeat.focus();return;}
  submit.disabled=true;feedback('');
  try{
    if(progress.hash?.startsWith('v7_')){
      const accepted=await fetch(ROOT.replace('/auth/v1','/functions/v1/compi-arts-aceptar-lab'),{
        method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},
        body:JSON.stringify({ticket:progress.hash,password:pwd.value}),cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'
      });
      if(!accepted.ok){
        if(accepted.status===403){save(null);unavailable();feedback('El enlace ha caducado, ha sido cancelado o ya se ha usado. Si ya elegiste tu contraseña, entra desde el acceso de CompI.');return;}
        feedback(accepted.status===422?'Elige otra contraseña de al menos ocho caracteres.':'No se pudo confirmar la activación. Vuelve a intentarlo o entra en CompI si ya guardaste tu contraseña.');return;
      }
      const {email}=await accepted.json();
      const signed=await auth('/token?grant_type=password','POST',{email,password:pwd.value});
      if(!signed.ok){save(null);unavailable();feedback('Cuenta activada. Entra en CompI con tu correo y tu contraseña.');return;}
      const data=await signed.json();
      if(!data.access_token || data.user?.email!==email)throw Error('Sesión no disponible');
      pwd.value='';repeat.value='';
      sessionStorage.setItem(sessionKey,JSON.stringify({token:data.access_token,until:Date.now()+1000*Math.min(3600,data.expires_in-10)}));
      activated();return;
    }
    if(!progress.token){
      const verified=await auth('/verify','POST',{type:'invite',token_hash:progress.hash});
      if(!verified.ok){
        if(verified.status===429){feedback('Espera un momento antes de volver a intentarlo.');return;}
        if(verified.status>=500)throw Error('Conexión');
        save(null);unavailable();feedback('El enlace es incorrecto, ha caducado o ya se ha usado.');return;
      }
      const data=await verified.json();
      if(!data.access_token || !(data.expires_in>10) || !data.user?.email?.endsWith('@compichef.com')){
        save(null);unavailable();return;
      }
      save({token:data.access_token,until:Date.now()+1000*Math.min(3600,data.expires_in-10)});
    }
    const changed=await auth('/user','PUT',{password:pwd.value},progress.token);
    if(!changed.ok){
      if(changed.status===401){save(null);unavailable();return;}
      if(changed.status>=500)throw Error('Conexión');
      const error=await changed.json().catch(()=>({}));
      if(error.error_code!=='same_password'){
        feedback('No se pudo guardar la contraseña. Prueba con otra de al menos ocho caracteres.');return;
      }
    }
    pwd.value='';repeat.value='';
    sessionStorage.setItem(sessionKey,JSON.stringify({token:progress.token,until:progress.until}));
    activated();
  } catch {feedback('Se interrumpió la conexión. Vuelve a intentarlo aquí. Si ya se guardó la contraseña, entra desde el acceso de CompI.');}
  finally {submit.disabled=false;}
};

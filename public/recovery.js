import {motionFor} from './motion-choices.js';
import {bindText,t} from './i18n.js';
import {confirmDialog} from './confirm-dialog.js';

function translated(node,tag,key,cls){
  const el=node(tag,undefined,cls);
  bindText(el,key);
  return el;
}

function field(node,form,caption,type,complete){
  const label=node('label'),input=node('input');
  input.type=type;input.autocomplete=complete;input.required=true;
  label.append(translated(node,'span',caption),input);form.append(label);return input;
}

export function recoveryForm({main,node,link,api,signal,onSuccess}){
  bindText(document.querySelector('title'),'Recuperar contraseña · CompI');
  const content=node('div',undefined,'auth-content recovery-view'),form=node('form');
  content.append(translated(node,'h1','Recuperar contraseña'),
    translated(node,'p','Usa el código personal que guardaste al activar tu cuenta o desde tu entorno de trabajo.','intro'),form);
  main.append(content);
  const email=field(node,form,'Correo del empleado','email','username');
  email.maxLength=254;email.dir='ltr';
  const code=field(node,form,'Código de recuperación','text','off');
  code.maxLength=80;code.spellcheck=false;code.autocapitalize='characters';code.dir='ltr';
  const password=field(node,form,'Nueva contraseña','password','new-password');
  const repeat=field(node,form,'Repite la nueva contraseña','password','new-password');
  for(const input of [password,repeat]){input.minLength=8;input.maxLength=128;}
  const submit=translated(node,'button','Guardar nueva contraseña','download primary');
  submit.type='submit';
  const status=node('p',undefined,'feedback');status.setAttribute('role','status');
  const back=link('','#/acceso');
  bindText(back,'Volver a iniciar sesión');
  form.append(submit);content.append(status,back);
  motionFor('recovery',content);
  function feedback(key){
    bindText(status,key);
    motionFor('recovery',status);
  }
  form.onsubmit=async event=>{
    event.preventDefault();if(submit.disabled)return;
    bindText(status,'');
    if(password.value!==repeat.value){feedback('Las dos contraseñas deben coincidir.');repeat.focus();return;}
    submit.disabled=true;
    try{
      await api('/functions/v1/compi-recuperar-lab',{signal,payload:{email:email.value.trim(),code:code.value,password:password.value}});
      if(signal.aborted)return;
      onSuccess();form.reset();form.remove();
      feedback('Contraseña cambiada. Entra con la nueva contraseña y guarda un nuevo código de recuperación.');
      back.focus();
    }catch(error){
      if(signal.aborted)return;
      feedback(error.status===422?'Elige otra contraseña de al menos ocho caracteres.':
        [400,403].includes(error.status)?'No se pudo validar el correo y el código. Comprueba los datos y que tu cuenta siga activa.':
        'No se pudo confirmar el cambio. Si la conexión se interrumpió, prueba a entrar con tu nueva contraseña.');
    }finally{submit.disabled=false;}
  };
}

export async function backupPanel({main,node,link,rpc,signal}){
  const box=node('section',undefined,'recovery-settings'),status=node('p',undefined,'feedback');
  status.setAttribute('role','status');
  box.append(translated(node,'p','Guarda tu código en un lugar privado fuera de CompI. Permite elegir una contraseña nueva aunque no puedas entrar al buzón. Cada código sirve una sola vez.'));
  const back=link('','#/portal','security-link');bindText(back,'Volver a mi entorno de trabajo');
  main.append(box,back);
  const {configured}=await rpc('compi_personal_backup',{issue:false},signal);
  if(signal.aborted)return;
  const info=translated(node,'p',configured?'Tu cuenta ya tiene un código. Si generas otro, el anterior dejará de funcionar.':'Todavía no tienes un código de recuperación.');
  const issue=translated(node,'button',configured?'Sustituir mi código':'Generar mi código','download primary');
  issue.type='button';box.append(info,issue,status);
  issue.onclick=async()=>{
    if(issue.disabled || (configured && !await confirmDialog({message:t('¿Sustituir el código anterior por uno nuevo?'),accept:'Sustituir mi código',danger:true})))return;
    issue.disabled=true;bindText(status,'');
    try{
      const result=await rpc('compi_personal_backup',{issue:true},signal);
      if(signal.aborted)return;
      const grouped=result.code.match(/.{1,5}/g).join('-');
      const label=node('label'),output=node('input');
      output.readOnly=true;output.value=grouped;output.spellcheck=false;output.dir='ltr';
      label.append(translated(node,'span','Tu código personal'),output);
      bindText(status,'Copia este código ahora. Solo se muestra en esta pantalla.');
      info.remove();issue.remove();box.append(label);
      output.focus();output.select();
      motionFor('security-code',label);
    }catch(error){
      if(signal.aborted)return;
      bindText(status,error.status===403?'Por seguridad, cierra sesión y vuelve a entrar con tu contraseña antes de generar el código.':'No se pudo generar el código. Inténtalo de nuevo.');
      motionFor('security-code',status);
      issue.disabled=false;
    }
  };
}

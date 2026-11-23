// A separate request commits failed attempts too. Store only minute-rotating client hashes.
export async function authInput(req:Request,endpoint:string){
 const peer=req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim()||'unknown';
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const enc=new TextEncoder();
 const mac=await crypto.subtle.importKey('raw',enc.encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=new Uint8Array(await crypto.subtle.sign('HMAC',mac,enc.encode(Math.floor(Date.now()/60000)+'/'+peer)));
 const client=Array.from(sig,b=>b.toString(16).padStart(2,'0')).join('');
 const r=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/compi_allow_auth_request',{method:'POST',
 headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({endpoint,client})});
 if(!r.ok)throw 503;if(!(await r.json()))throw 429;
 if(Number(req.headers.get('Content-Length'))>4096)throw 413;
 const reader=req.body?.getReader();if(!reader)throw 400;
 const bytes=new Uint8Array(4096);let count=0;
 while(true){const {done,value}=await reader.read();if(done)break;if(count+value.length>bytes.length){await reader.cancel();throw 413;}bytes.set(value,count);count+=value.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes.subarray(0,count)));}catch{throw 400;}
}


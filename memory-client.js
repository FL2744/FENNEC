// FENNEC memory v1. The public SHA-256 identifier is never the encryption key.
$('persistent-memory').checked=false;
const memoryEncoder=new TextEncoder(),memoryDecoder=new TextDecoder();
const memoryEndpoint=new URL('fennec-memory.php',location.href);
let memorySession=null,memoryEpoch=0,memoryOpening=null,memoryTimer=null;
const memoryHex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
function memoryBase64(bytes){let value='';for(const byte of new Uint8Array(bytes))value+=String.fromCharCode(byte);return btoa(value)}
function memoryBytes(value){return Uint8Array.from(atob(value),c=>c.charCodeAt(0))}
function memoryStatus(text){$('memory-status').textContent=text;$('memory-summary').textContent=text;$('memory-summary').hidden=!$('persistent-memory').checked}
function memoryCurrent(session){return memorySession===session&&$('persistent-memory').checked&&session.epoch===memoryEpoch}
function memoryReset(){
 memoryEpoch++;memorySession=null;memoryOpening=null;clearTimeout(memoryTimer);history=[];
 $('memory-history').hidden=true;$('memory-transcript').replaceChildren();$('memory-count').textContent='';
 $('memory-retry').hidden=true;$('memory-older').hidden=true;
 memoryStatus($('persistent-memory').checked?'Enter your API key to unlock previous conversations.':'Persistent memory is off. Conversations stay in this tab.');
}
async function memoryCredentials(rawKey,provider){
 const id=memoryHex(await crypto.subtle.digest('SHA-256',memoryEncoder.encode(rawKey)));
 const source=await crypto.subtle.importKey('raw',memoryEncoder.encode(rawKey),'HKDF',false,['deriveKey','deriveBits']);
 const params=label=>({name:'HKDF',hash:'SHA-256',salt:memoryEncoder.encode('FENNEC memory v1'),info:memoryEncoder.encode('fennec/'+provider+'/'+label+'/v1')});
 const encryptionKey=await crypto.subtle.deriveKey(params('encryption'),source,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const token=memoryHex(await crypto.subtle.deriveBits(params('storage-authentication'),source,256));
 return {id,provider,encryptionKey,token};
}
async function memoryRequest(session,method='GET',body=null,before=null){
 const url=new URL(memoryEndpoint);url.searchParams.set('id',session.id);url.searchParams.set('provider',session.provider);
 if(before!==null)url.searchParams.set('before',String(before));
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch(url,{method,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,
   headers:{'X-Fennec-Memory-Token':session.token,Authorization:'Bearer '+session.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  let data;try{data=await response.json()}catch{throw Error('Upload and configure fennec-memory.php alongside this HTML.');}
  if(!response.ok)throw Error(data.error||'Memory service request failed.');return data;
 }catch(error){if(error.name==='AbortError')throw Error('Memory service timed out.');throw error}finally{clearTimeout(timer)}
}
function memoryAAD(session,id){return memoryEncoder.encode('fennec-memory-v1|'+session.provider+'|'+session.id+'|'+id)}
async function memorySeal(session,entry){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:memoryAAD(session,entry.id)},session.encryptionKey,memoryEncoder.encode(JSON.stringify(entry)));
 return {v:1,id:entry.id,iv:memoryBase64(iv),ciphertext:memoryBase64(ciphertext)};
}
async function memoryUnseal(session,envelope){
 if(envelope.v!==1||typeof envelope.id!=='string'||!/^[a-f0-9-]{36}$/.test(envelope.id)||typeof envelope.iv!=='string'||typeof envelope.ciphertext!=='string')throw Error('Invalid encrypted memory.');
 const iv=memoryBytes(envelope.iv);if(iv.length!==12)throw Error('Invalid memory nonce.');
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:memoryAAD(session,envelope.id)},session.encryptionKey,memoryBytes(envelope.ciphertext));
 const entry=JSON.parse(memoryDecoder.decode(plain));
 if(entry.id!==envelope.id||typeof entry.question!=='string'||typeof entry.answer!=='string'||entry.question.length>30000||entry.answer.length>30000||typeof entry.createdAt!=='string'||!Number.isFinite(Date.parse(entry.createdAt)))throw Error('Invalid conversation record.');
 return entry;
}
function memoryContext(session){history=[...session.entries.values()].sort((a,b)=>a.seq-b.seq).slice(-7).flatMap(e=>[{role:'user',content:e.question},{role:'assistant',content:e.answer}])}
function memoryRender(session){
 if(!memoryCurrent(session))return;
 const entries=[...session.entries.values()].sort((a,b)=>b.seq-a.seq),fragment=document.createDocumentFragment();
 for(const entry of entries){
  const article=document.createElement('article'),date=document.createElement('time');date.dateTime=entry.createdAt;date.textContent=new Date(entry.createdAt).toLocaleString();article.append(date);
  for(const [label,value] of [['You',entry.question],['FENNEC',entry.answer]]){const title=document.createElement('strong'),p=document.createElement('p');title.textContent=label;p.textContent=value;p.dir='auto';article.append(title,p)}fragment.append(article);
 }
 $('memory-transcript').replaceChildren(fragment);$('memory-history').hidden=!entries.length;$('memory-count').textContent='('+entries.length+')';$('memory-older').hidden=session.before===null;
}
async function memoryLoad(session,before=null){
 const data=await memoryRequest(session,'GET',null,before);
 if(!Array.isArray(data.entries)||data.entries.length>50||!(data.before===null||Number.isSafeInteger(data.before)&&data.before>0))throw Error('Invalid memory service response.');
 const decoded=await Promise.all(data.entries.map(async item=>{if(!Number.isSafeInteger(item.seq)||item.seq<1)throw Error('Invalid memory sequence.');return {...await memoryUnseal(session,item.envelope),seq:item.seq}}));
 if(!memoryCurrent(session))return;
 for(const entry of decoded)session.entries.set(entry.id,entry);session.before=data.before;memoryRender(session);
}
async function memoryEnsure(){
 if(!$('persistent-memory').checked)return null;
 if(memorySession?.ready)return memorySession;
 if(memoryOpening)return memoryOpening;
 const rawKey=keyField().value.trim(),provider=currentProvider(),epoch=memoryEpoch;
 if(!rawKey){memoryStatus('Enter your API key to unlock previous conversations.');return null}
 const opening=(async()=>{try{
  if(!window.isSecureContext||!crypto.subtle)throw Error('Persistent memory needs an HTTPS connection.');
  if(!['https:','http:'].includes(location.protocol))throw Error('Upload the HTML and PHP files to your HTTPS website.');
  memoryStatus('Unlocking previous conversations…');$('memory-retry').hidden=true;
  const credentials=await memoryCredentials(rawKey,provider);if(epoch!==memoryEpoch)return null;
  const session={...credentials,epoch,entries:new Map(),pending:new Map(),before:null,ready:false};memorySession=session;
  await memoryLoad(session);if(!memoryCurrent(session))return null;
  session.ready=true;memoryContext(session);
  memoryStatus(session.entries.size?'Memory on. Previous conversations restored.':'Memory on. Completed conversations will be encrypted and saved.');return session;
 }catch(error){if(epoch===memoryEpoch){memorySession=null;memoryStatus('Memory unavailable: '+error.message+' Chat can continue without saving.');$('memory-retry').hidden=false;}return null}})();
 memoryOpening=opening;try{return await opening}finally{if(memoryOpening===opening)memoryOpening=null}
}
async function memorySave(session,entry){
 if(!session||!memoryCurrent(session))return;
 session.pending.set(entry.id,entry);
 try{
  memoryStatus('Encrypting and saving conversation…');const envelope=await memorySeal(session,entry);if(!memoryCurrent(session))return;
  const data=await memoryRequest(session,'POST',{envelope});if(!Number.isSafeInteger(data.seq)||data.seq<1)throw Error('Invalid save confirmation.');
  session.pending.delete(entry.id);if(!memoryCurrent(session))return;
  session.entries.set(entry.id,{...entry,seq:data.seq});memoryRender(session);
  memoryStatus(session.pending.size?'Some conversations are not saved. Click Retry.':'Memory on. Conversation encrypted and saved.');$('memory-retry').hidden=!session.pending.size;
 }catch(error){if(memoryCurrent(session)){memoryStatus('Conversation not saved: '+error.message+' Keep this tab open and click Retry.');$('memory-retry').hidden=false;}}
}
$('persistent-memory').addEventListener('change',()=>{memoryReset();if($('persistent-memory').checked)void memoryEnsure()});
for(const id of ['api-key','arc-key'])$(id).addEventListener('input',()=>{
 if(keyField()!==$(id))return;
 active?.controller.abort();clearSpeechAnswer();memoryReset();memoryTimer=setTimeout(()=>{if($('persistent-memory').checked)void memoryEnsure()},500);
});
$('memory-retry').onclick=async()=>{$('memory-retry').disabled=true;try{const session=await memoryEnsure();if(session)for(const entry of [...session.pending.values()]){if(!memoryCurrent(session))break;await memorySave(session,entry)}}finally{$('memory-retry').disabled=false}};
$('memory-older').onclick=async()=>{
 const session=memorySession;if(!session?.ready||session.before===null)return;$('memory-older').disabled=true;
 try{await memoryLoad(session,session.before)}catch(error){if(memoryCurrent(session))memoryStatus('Could not load older conversations: '+error.message)}finally{$('memory-older').disabled=false}
};
function memorySnapshot(){
 const enabled=$('persistent-memory').checked,session=memorySession;
 const ready=Boolean(enabled&&session?.ready&&memoryCurrent(session));
 return {state:!enabled?'off':!ready?'unavailable':session.pending.size?'ready_unsaved':'ready',
  loadedExchanges:ready?session.entries.size:0,unsavedExchanges:ready?session.pending.size:0};
}
function memoryBusy(busy){for(const id of ['persistent-memory','api-key','arc-key','memory-retry','connection-done'])$(id).disabled=busy}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID,createDecipheriv} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {PHP}=require('@php-wasm/universal');
const {loadNodeRuntime}=require('@php-wasm/node');
const {chromium}=require('playwright');
const base=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
fs.mkdirSync(base+'/tests/artifacts',{recursive:true});
const php=new PHP(await loadNodeRuntime('8.3',{emscriptenOptions:{processId:1001}}));
php.mkdir('/site');php.mkdir('/private-memory');
php.writeFile('/site/fennec-memory.php',fs.readFileSync(base+'/fennec-memory.php'));
const config=limit=>`<?php return ['allowed_origin'=>'https://fennec.test','storage_dir'=>'/private-memory','total_limit_bytes'=>${limit}];`;
php.writeFile('/site/fennec-memory-config.php',config(134217728));
const info=await php.run({code:'<?php echo PHP_VERSION, " ", extension_loaded("pdo_sqlite") ? "SQLite ready" : "SQLite missing";'});
console.log('PHP:',info.text);
let queue=Promise.resolve();
function requestPHP(url,method='GET',headers={},body='',server={}){
 const operation=queue.then(()=>php.run({scriptPath:'/site/fennec-memory.php',relativeUri:url.pathname+url.search,method,headers,body:new TextEncoder().encode(body),protocol:server.HTTPS==='off'?'http':'https',$_SERVER:{HTTPS:'on',DOCUMENT_ROOT:'/site',REMOTE_ADDR:'127.0.0.1',...server,HTTPS:server.HTTPS==='off'?'':'on'}}));
 queue=operation.catch(()=>{});return operation;
}
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
const ctx=await browser.newContext();
let memoryCalls=[],modelCalls=[],posts=[],failSave=false,tamper=false,failLoad=false;
await ctx.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url());
 if(url.hostname==='fennec.test'&&url.pathname==='/fennec.html')return route.fulfill({contentType:'text/html',body:fs.readFileSync(base+'/fennec.html','utf8')});
 if(url.hostname==='fennec.test'&&url.pathname==='/fennec-memory.php'){
  memoryCalls.push({url:url.href,method:request.method(),headers:request.headers(),body:request.postData()});
  if(request.method()==='GET'&&failLoad)return route.fulfill({status:503,json:{error:'Test memory connection unavailable'}});
  if(request.method()==='POST'){posts.push(JSON.parse(request.postData()));if(failSave)return route.fulfill({status:503,json:{error:'Test storage outage'}})}
  const forwardedHeaders={...request.headers()};delete forwardedHeaders.authorization; // Simulate cPanel stripping Authorization.
  const result=await requestPHP(url,request.method(),forwardedHeaders,request.postData()||'');
  let data=result.json;
  if(tamper&&data.entries?.length){data=structuredClone(data);const v=data.entries[0].envelope.ciphertext;data.entries[0].envelope.ciphertext=(v[0]==='A'?'B':'A')+v.slice(1)}
  if(result.errors)console.error('PHP stderr:',result.errors);
  return route.fulfill({status:result.httpStatusCode,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify(data)});
 }
 if(url.hostname==='api.openai.com'){
  const body=JSON.parse(request.postData());modelCalls.push(body);
  const answer='Saved answer: my favorite fruit is mango. العربية 🦊';
  const event={type:'response.completed',response:{output:[{type:'message',content:[{type:'output_text',text:answer,annotations:[]}]}]}};
  return route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify(event)+'\n\ndata: [DONE]\n\n'});
 }
 if(url.hostname==='llm-api.arc.vt.edu'){
  modelCalls.push(JSON.parse(request.postData()));
  return route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:'ARC isolated reply'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\n'});
 }
 return route.abort();
});
const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
async function open(){await page.goto('https://fennec.test/fennec.html');await page.locator('#connection > summary').click()}
async function key(value='sk-test-only-random-long-4aa7c857d9a3418190cc6b349e877e62'){await page.locator('#api-key').fill(value)}
async function enabled(){await page.locator('#persistent-memory').check();await page.waitForFunction(()=>document.querySelector('#memory-status').textContent.startsWith('Memory on.'))}
async function ask(text){await page.locator('#connection').evaluate(el=>el.open=false);await page.locator('#question').fill(text);await page.locator('#send').click();await page.waitForFunction(()=>!document.querySelector('#send').disabled&&document.querySelector('#answer-state').textContent==='Answer ready')}
await open();assert.equal(await page.locator('#persistent-memory').isChecked(),false);await key();await ask('Unsaved private message');assert.equal(memoryCalls.length,0);assert.match(modelCalls.at(-1).instructions,/Persistent memory is OFF/);assert.match(modelCalls.at(-1).instructions,/HKDF-SHA-256/);assert.match(modelCalls.at(-1).instructions,/No key migration or recovery/);console.log('PASS: memory off by default; chat makes no memory requests.');
await page.locator('#connection > summary').click();await enabled();await ask('Remember my favorite fruit is mango. العربية 🦊');
assert.match(await page.locator('#memory-status').textContent(),/encrypted and saved/);
assert.match(modelCalls.at(-1).instructions,/Persistent memory is ENABLED/);assert.match(modelCalls.at(-1).instructions,/0 saved exchanges loaded/);assert.match(modelCalls.at(-1).instructions,/cannot confirm that your current answer has already been saved/);assert.equal(posts.length,1);assert.equal(JSON.stringify(posts[0]).includes('mango'),false);assert.equal(JSON.stringify(posts[0]).includes('sk-test'),false);
const last=memoryCalls.at(-1);assert.notEqual(new URL(last.url).searchParams.get('id'),last.headers.authorization.slice(7));
assert.equal(memoryCalls.some(call=>JSON.stringify(call).includes('sk-test-only')),false);
console.log('PASS: encrypted save works with Authorization stripped by the host; raw API key and plaintext never reach endpoint.');
await open();await key();await enabled();assert.match(await page.locator('#memory-transcript').textContent(),/mango/);await ask('What is my favorite fruit?');assert.match(modelCalls.at(-1).instructions,/1 saved exchanges loaded/);assert.ok(modelCalls.at(-1).input.some(m=>m.content.includes('Remember my favorite fruit')));console.log('PASS: reload decrypts Unicode conversations and restores prompt context.');
const db=Buffer.from(php.readFileAsBuffer('/private-memory/fennec-memory.sqlite'));
assert.equal(db.includes(Buffer.from('mango')),false);assert.equal(db.includes(Buffer.from('sk-test-only')),false);console.log('PASS: SQLite database contains neither conversation plaintext nor original API key.');
// Auth isolation and idempotency exercise the deployed PHP source, not a mock store.
const savedCall=memoryCalls.find(call=>call.method==='POST');const vaultURL=new URL(savedCall.url);
const wrong=await requestPHP(vaultURL,'GET',{authorization:'Bearer '+'b'.repeat(64)});assert.deepEqual(wrong.json.entries,[]);
const duplicate=await requestPHP(vaultURL,'POST',{'authorization':savedCall.headers.authorization,'content-type':'application/json'},savedCall.body);assert.equal(duplicate.httpStatusCode,200);
const actual=await requestPHP(vaultURL,'GET',{authorization:savedCall.headers.authorization});assert.equal(actual.json.entries.length,2);
const noAuth=await requestPHP(vaultURL);assert.equal(noAuth.httpStatusCode,401);
const cross=await requestPHP(vaultURL,'GET',{authorization:savedCall.headers.authorization,origin:'https://evil.test'});assert.equal(cross.httpStatusCode,403);
const insecure=await requestPHP(vaultURL,'GET',{authorization:savedCall.headers.authorization},'',{HTTPS:'off'});assert.equal(insecure.httpStatusCode,400);
console.log('PASS: identifier alone cannot retrieve history; retries do not duplicate; cross-origin and HTTP rejected.');
await open();await key('sk-another-key-3bdab476074445de8a77607f84f290d2');await enabled();assert.equal(await page.locator('#memory-history').isVisible(),false);await ask('Different vault');assert.equal(modelCalls.at(-1).input.length,1);console.log('PASS: different key gets an isolated vault and context.');
await page.locator('#connection > summary').click();await page.locator('#persistent-memory').uncheck();const beforeCalls=memoryCalls.length;await ask('Off again');assert.equal(memoryCalls.length,beforeCalls);assert.equal(modelCalls.at(-1).input.length,1);console.log('PASS: opting out stops memory requests and clears recalled context.');
await open();await key();tamper=true;await page.locator('#persistent-memory').check();await page.waitForFunction(()=>document.querySelector('#memory-status').textContent.startsWith('Memory unavailable:'));assert.equal(await page.locator('#memory-history').isVisible(),false);tamper=false;await page.locator('#memory-retry').click();await page.waitForFunction(()=>document.querySelector('#memory-status').textContent.startsWith('Memory on.'));console.log('PASS: tampering is rejected without overwriting saved history; reconnect works.');
failSave=true;await ask('Retry this unsaved exchange');assert.match(await page.locator('#memory-status').textContent(),/not saved/);failSave=false;await page.locator('#connection > summary').click();await page.locator('#memory-retry').click();await page.waitForFunction(()=>document.querySelector('#memory-status').textContent.includes('encrypted and saved'));console.log('PASS: failed saves visibly warn and can be retried.');
await page.locator('#provider').selectOption('arc');await page.locator('#arc-key').fill('sk-test-only-random-long-4aa7c857d9a3418190cc6b349e877e62');await page.waitForFunction(()=>document.querySelector('#memory-status').textContent.startsWith('Memory on.'));assert.equal(await page.locator('#memory-history').isVisible(),false);await ask('ARC conversation');assert.equal(modelCalls.at(-1).messages.length,2);assert.match(modelCalls.at(-1).messages[0].content,/FENNEC APPLICATION MEMORY/);assert.match(modelCalls.at(-1).messages[0].content,/Provider labels separate vaults/);console.log('PASS: ARC has independent provider-scoped memory.');
// Public identifiers and storage-access tokens cannot decrypt the ciphertext.
for(const candidate of [new URL(savedCall.url).searchParams.get('id'),savedCall.headers.authorization.slice(7)]){
 const env=JSON.parse(savedCall.body).envelope,encrypted=Buffer.from(env.ciphertext,'base64');
 const decipher=createDecipheriv('aes-256-gcm',Buffer.from(candidate,'hex'),Buffer.from(env.iv,'base64'));
 decipher.setAAD(Buffer.from('fennec-memory-v1|openai|'+new URL(savedCall.url).searchParams.get('id')+'|'+env.id));decipher.setAuthTag(encrypted.subarray(-16));
 assert.throws(()=>Buffer.concat([decipher.update(encrypted.subarray(0,-16)),decipher.final()]));
}
console.log('PASS: neither public identifier nor server-visible access token decrypts saved conversations.');
await open();await key('sk-status-test-4fe76aa381e6489da12c9a9fbf890291');await enabled();failSave=true;await ask('Remember this unsaved message');await ask('Have all of my conversations been saved?');assert.match(modelCalls.at(-1).instructions,/some completed exchanges have NOT been saved/);assert.match(modelCalls.at(-1).instructions,/1 completed exchanges awaiting a successful save/);failSave=false;
await open();await key('sk-status-test-4fe76aa381e6489da12c9a9fbf890291');failLoad=true;await page.locator('#persistent-memory').check();await page.waitForFunction(()=>document.querySelector('#memory-status').textContent.startsWith('Memory unavailable:'));await ask('Is your persistent memory working?');assert.match(modelCalls.at(-1).instructions,/currently UNAVAILABLE/);assert.match(modelCalls.at(-1).instructions,/without saving this exchange/);failLoad=false;
console.log('PASS: both providers receive all memory facts; off, connected, restored, unsaved, and unavailable states are reported accurately in instructions.');
assert.deepEqual(errors,[]);console.log('PASS: no browser JavaScript errors.');
await page.setViewportSize({width:390,height:844});await page.locator('#connection > summary').click();await page.screenshot({path:base+'/tests/artifacts/memory-mobile.png',fullPage:true});
await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:base+'/tests/artifacts/memory-desktop.png',fullPage:true});
// Pagination and concurrent independent appends, including a fresh server vault.
const paginationURL=new URL('https://fennec.test/fennec-memory.php?id='+'c'.repeat(64)+'&provider=openai');
const paginationHeaders={'authorization':'Bearer '+'d'.repeat(64),'content-type':'application/json'};
const template=JSON.parse(savedCall.body).envelope;
const appends=await Promise.all(Array.from({length:55},()=>requestPHP(paginationURL,'POST',paginationHeaders,JSON.stringify({envelope:{...template,id:randomUUID()}}))));
assert.ok(appends.every(r=>r.httpStatusCode===201));assert.equal(new Set(appends.map(r=>r.json.seq)).size,55);
const first=await requestPHP(paginationURL,'GET',paginationHeaders);assert.equal(first.json.entries.length,50);assert.ok(first.json.before>0);
paginationURL.searchParams.set('before',String(first.json.before));const second=await requestPHP(paginationURL,'GET',paginationHeaders);assert.equal(second.json.entries.length,5);assert.equal(second.json.before,null);
assert.equal(new Set([...first.json.entries,...second.json.entries].map(e=>e.seq)).size,55);console.log('PASS: concurrent independent appends and history pagination preserve every entry.');
const invalid=await requestPHP(vaultURL,'POST',{'authorization':savedCall.headers.authorization,'content-type':'application/json'},JSON.stringify({envelope:{...template,iv:'bad'}}));assert.equal(invalid.httpStatusCode,400);
php.writeFile('/site/fennec-memory-config.php',config(1));const quota=await requestPHP(vaultURL,'POST',{'authorization':savedCall.headers.authorization,'content-type':'application/json'},JSON.stringify({envelope:{...template,id:randomUUID()}}));assert.equal(quota.httpStatusCode,507);const preserved=await requestPHP(vaultURL,'GET',{authorization:savedCall.headers.authorization});assert.equal(preserved.json.entries.length,3);console.log('PASS: invalid envelopes rejected and quota exhaustion preserves existing memories.');
php.writeFile('/site/fennec-memory-config.php',"<?php return ['allowed_origin'=>'https://fennec.test','storage_dir'=>'/site'];");const publicStorage=await requestPHP(vaultURL,'GET',{authorization:savedCall.headers.authorization});assert.equal(publicStorage.httpStatusCode,503);console.log('PASS: backend refuses publicly accessible storage folders.');
await browser.close();php.exit();console.log('All end-to-end checks passed.');

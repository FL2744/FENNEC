import fs from 'node:fs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
const context=await browser.newContext({reducedMotion:'reduce'}),page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let calls=[],crossrefQueries=[],choice='whale communication',hasSource=true,malformed=false;
await context.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url());
 if(url.hostname==='fennec.test')return route.fulfill({contentType:'text/html',body:fs.readFileSync(root+'/fennec.html','utf8')});
 if(url.hostname==='api.crossref.org'){
  crossrefQueries.push(url.searchParams.get('query'));
  return route.fulfill({json:{message:{items:[{DOI:'10.1234/test-'+crossrefQueries.length,title:['AI helps decode whale communication'],abstract:'An abstract linking AI and whale communication.',published:{'date-parts':[[2026,10,27]]}}]}}});
 }
 if(['api.openai.com','llm-api.arc.vt.edu'].includes(url.hostname)){
  const payload=JSON.parse(request.postData());calls.push(payload);
  const metadata=malformed?'not json':JSON.stringify({topic:choice,connection:'The article discusses '+choice+'.'});
  const text='**Article**\nAI and whales\n**Brief summary**\nThe article explores whale communication.\n**FENNEC’s critical reflection**\nHow does this change marine research?\n[[FENNEC_NEXT_TOPIC:'+metadata+']]';
  if(url.hostname==='api.openai.com'){
   const event={type:'response.completed',response:{output:[{type:'message',content:[{type:'output_text',text,annotations:hasSource?[{type:'url_citation',url:'https://example.org/article',title:'AI and whales'}]:[]}]}]}};
   return route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({type:'response.output_text.delta',delta:text.slice(0,-15)})+'\n\ndata: '+JSON.stringify({type:'response.output_text.delta',delta:text.slice(-15)})+'\n\ndata: '+JSON.stringify(event)+'\n\n'});
  }
  return route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\n'});
 }
 return route.abort();
});
await page.goto('https://fennec.test/fennec.html');await page.clock.install();
await page.locator('#connection > summary').click();await page.locator('#api-key').fill('sk-research-test-only-1234567890');await page.locator('#connection').evaluate(e=>e.open=false);
assert.equal(await page.locator('#research-focus').isChecked(),false);
const question=call=>(call.input||call.messages).at(-1).content;
async function nextIdle(){const before=calls.length;await page.clock.fastForward(31000);await page.waitForFunction(n=>document.querySelector('#explore-count').textContent.startsWith(String(n+1)),before);await page.waitForFunction(()=>document.querySelector('#stop').hidden);assert.equal(calls.length,before+1)}
async function manual(){const before=calls.length;await page.locator('#research-now').click();await page.waitForFunction(()=>document.querySelector('#answer-state').textContent==='Answer ready'&&!document.querySelector('#send').disabled);assert.equal(calls.length,before+1)}
await manual();assert.match(question(calls[0]),/this reading subject: "artificial intelligence"/);assert.match(await page.locator('#research-trail').textContent(),/Next up: whale communication/);
assert.equal((await page.locator('#answer').textContent()).includes('FENNEC_NEXT_TOPIC'),false);
choice='marine conservation';await nextIdle();assert.match(question(calls.at(-1)),/this reading subject: "whale communication"/);assert.match(await page.locator('#research-trail').textContent(),/Next up: marine conservation/);
choice='coral reefs';await nextIdle();assert.match(question(calls.at(-1)),/this reading subject: "marine conservation"/);
assert.ok(calls.at(-1).input.filter(message=>message.role==='assistant').every(message=>!message.content.includes('FENNEC_NEXT_TOPIC')));
console.log('PASS: AI → whales → marine conservation; metadata is hidden from displayed and prior assistant replies.');
choice='whale communication';await page.locator('#research-focus').check();await nextIdle();assert.match(question(calls.at(-1)),/this reading subject: "artificial intelligence"/);await nextIdle();assert.match(question(calls.at(-1)),/this reading subject: "artificial intelligence — whale communication"/);assert.match(question(calls.at(-1)),/Stay clearly within the original subject/);console.log('PASS: the topic leash resets wandering and anchors subsequent searches to the original subject.');
await page.locator('#research-topic').fill('language teaching');assert.match(await page.locator('#research-trail').textContent(),/Next up: language teaching/);assert.equal((await page.locator('#research-trail').textContent()).includes('whale communication'),false);
choice='bilingual classrooms';await nextIdle();assert.match(question(calls.at(-1)),/this reading subject: "language teaching"/);
malformed=true;await nextIdle();assert.match(await page.locator('#log').textContent(),/No verified next subject/);assert.equal((await page.locator('#answer').textContent()).includes('FENNEC_NEXT_TOPIC'),false);malformed=false;
hasSource=false;choice='unverified detour';await nextIdle();assert.equal((await page.locator('#research-trail').textContent()).includes('unverified detour'),false);hasSource=true;console.log('PASS: editing the topic resets the trail; malformed and uncited suggestions cannot redirect it.');
// Leave the page idle for over five minutes while successive readings complete.
for(let i=0;i<3;i++)await nextIdle();assert.notEqual(await page.locator('#activity').textContent(),'sleeping');console.log('PASS: enabled visible reading continues beyond five minutes of user inactivity.');
await page.locator('#connection > summary').click();await page.locator('#provider').selectOption('arc');await page.locator('#arc-key').fill('arc-research-test-only-1234567890');await page.locator('#connection').evaluate(e=>e.open=false);
await page.locator('#research-focus').uncheck();await page.locator('#research-topic').fill('artificial intelligence');choice='whale communication';await manual();assert.equal(crossrefQueries.at(-1),'artificial intelligence');choice='marine ecology';await nextIdle();assert.equal(crossrefQueries.at(-1),'whale communication');assert.equal((await page.locator('#answer').textContent()).includes('FENNEC_NEXT_TOPIC'),false);console.log('PASS: ARC Crossref queries follow the article-selected next subject too.');
await page.locator('#explore').uncheck();const stoppedAt=calls.length;await page.clock.fastForward(31000);assert.equal(calls.length,stoppedAt);assert.deepEqual(errors,[]);console.log('PASS: disabling reading stops the trail; no browser JavaScript errors.');
await browser.close();

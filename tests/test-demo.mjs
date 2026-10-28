import fs from 'node:fs';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require('playwright'),root=fileURLToPath(new URL('../',import.meta.url));
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
const page=await browser.newPage({viewport:{width:1200,height:1000}}),errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>{if(route.request().url()==='https://fennec.test/fennec.html')return route.fulfill({contentType:'text/html',body:fs.readFileSync(root+'/fennec.html','utf8')});network.push(route.request().url());return route.abort()});
await page.goto('https://fennec.test/fennec.html');await page.clock.install();
await page.locator('#connection > summary').click();await page.locator('#api-key').fill('sk-demo-test-only-1234567890');await page.locator('#connection').evaluate(e=>e.open=false);
await page.locator('#answer').evaluate(e=>e.textContent='My original answer.');await page.locator('#answer-state').evaluate(e=>e.textContent='Original status');await page.locator('#minimize-answer').click();
const button=await page.locator('#demo').boundingBox(),connection=await page.locator('#connection > summary').boundingBox();assert.ok(button.y>=connection.y+connection.height);
await page.locator('#demo').click();await page.clock.fastForward(200);assert.equal(await page.locator('#demo').getAttribute('aria-pressed'),'true');assert.match(await page.locator('#answer-state').textContent(),/DEMO · 1/);
for(const [index,mode] of ['reading','working','writing','speaking','reading','neutral','sleeping','thinking'].entries()){
 await page.clock.fastForward(5000);await page.clock.fastForward(200);assert.equal(await page.locator('#activity').textContent(),mode);assert.equal(await page.locator('#answer-body').isVisible(),true);
}
assert.deepEqual(network,[]);assert.equal(await page.locator('#persistent-memory').isChecked(),false);assert.equal(await page.locator('#api-key').inputValue(),'sk-demo-test-only-1234567890');
await page.locator('#demo').click();assert.equal(await page.locator('#answer').textContent(),'My original answer.');assert.equal(await page.locator('#answer-state').textContent(),'Original status');assert.equal(await page.locator('#answer-body').isVisible(),false);
await page.locator('#demo').click();await page.clock.fastForward(200);await page.keyboard.press('Escape');assert.equal(await page.locator('#demo').getAttribute('aria-pressed'),'false');assert.equal(await page.locator('#answer').textContent(),'My original answer.');assert.deepEqual(errors,[]);
await page.setViewportSize({width:390,height:844});assert.ok(await page.locator('#demo').isVisible());
await browser.close();console.log('PASS: five-second scene cycle and looping, no network requests or memory changes, answer/collapse restoration, Escape, and mobile button placement.');

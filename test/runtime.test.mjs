import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Runtime} from '../dist/runtime.js';
import {DeviceAdapter} from '../dist/accessory.js';
import {fakeServer, makeAPI, silentLog, sleep, until} from './helpers.mjs';

async function device(t, config, options={}, persistPath) {
  const api = await makeAPI(t);
  const runtime = new Runtime(silentLog,options,persistPath); t.after(()=>runtime.shutdown());
  const adapter = new DeviceAdapter(api,runtime,{name:'Test',service:'Switch',...config},'test');
  return {api,runtime,adapter,entry:adapter.entries.get('getOn'),characteristic:adapter.service.getCharacteristic(api.hap.Characteristic.On)};
}
test('GET is synchronous memory state, startup is a HAP error, stale demand is deferred and deduplicated',async t=>{
  const server=await fakeServer(t,async (_req,res)=>{await sleep(30);res.end('1');});
  const {runtime,entry,characteristic}=await device(t,{urls:{getOn:{url:server.url}}});
  await assert.rejects(characteristic.handleGetRequest());
  await Promise.all([runtime.refresh(entry),runtime.refresh(entry),runtime.refresh(entry)]);
  assert.equal(server.requests.length,1);assert.equal(characteristic.value,true);
  entry.lastSuccess=Date.now()-10000;
  const before=server.requests.length;
  for(let i=0;i<100;i++) assert.equal(await characteristic.handleGetRequest(),true);
  assert.equal(server.requests.length,before);
  runtime.tick(); await until(()=>!entry.inFlight);
  assert.equal(server.requests.length,before+1);
});
test('forceRefreshDelay seconds are respected by demand; default demand activates adaptive interval',async t=>{
  const server=await fakeServer(t);
  const {runtime,entry}=await device(t,{forceRefreshDelay:500,urls:{getOn:{url:server.url}}});
  await runtime.refresh(entry); const next=entry.nextEligible;
  assert.equal(runtime.interval(entry),500000);
  runtime.read(entry); assert.equal(entry.nextEligible,next);runtime.tick();assert.equal(entry.inFlight,false);
  entry.config.forceRefreshDelay=0;entry.lastDemand=Date.now()-61000;
  assert.equal(runtime.interval(entry),60000);runtime.read(entry);assert.equal(runtime.interval(entry),5000);
});
test('failed requests back off, stale reads preserve last good state and do not bypass backoff',async t=>{
  let fail=false;
  const server=await fakeServer(t,(_req,res)=>{if(fail)res.destroy();else res.end('0');});
  const {runtime,entry}=await device(t,{urls:{getOn:{url:server.url}}});
  await runtime.refresh(entry);fail=true;
  await runtime.refresh(entry); const first=entry.nextEligible-Date.now();
  await runtime.refresh(entry); const second=entry.nextEligible-Date.now();
  assert.ok(second>first*1.5);const next=entry.nextEligible;
  assert.equal(runtime.read(entry),false);assert.equal(entry.nextEligible,next);
  assert.equal(entry.failures,2);
});
test('persistence restores false values and timestamps, excludes credentials, rejects changed config and corrupt files',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'http-cache-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const server=await fakeServer(t,(_req,res)=>res.end('0'));
  const config={username:'private-test-user',password:'private-test-password',urls:{getOn:{url:server.url}}};
  const first=await device(t,config,{},dir);await first.runtime.refresh(first.entry);first.runtime.persist();
  const cacheFile=join(dir,'http-advanced-state-v1',first.entry.key+'.json');
  const serialized=readFileSync(cacheFile,'utf8');assert.ok(!serialized.includes('private-test'));
  const second=await device(t,config,{},dir);assert.equal(second.runtime.read(second.entry),false);assert.equal(second.runtime.stats.restored,1);
  const changed=await device(t,{...config,password:'changed'}, {},dir);assert.equal(changed.entry.known,false);
  writeFileSync(cacheFile,'broken');
  const corrupt=await device(t,config,{},dir);assert.equal(corrupt.entry.known,false);
});
test('setterDelay acknowledges promptly and sends only last write; failures retain cached state',async t=>{
  const server=await fakeServer(t,(req,res)=>req.url.startsWith('/set')?res.end('ok'):res.end('0'));
  const {runtime,entry,characteristic}=await device(t,{setterDelay:60,urls:{getOn:{url:server.url},setOn:{url:server.url+'/set/{value}'}}});
  let resolveWrite;
  const written=new Promise(resolve=>{resolveWrite=resolve;});
  const originalSet=runtime.set.bind(runtime);
  runtime.set=async(...args)=>{await originalSet(...args);resolveWrite();};
  await runtime.refresh(entry);
  const before=Date.now();await characteristic.handleSetRequest(true);await characteristic.handleSetRequest(false);await characteristic.handleSetRequest(true);
  assert.ok(Date.now()-before<50);assert.equal(server.requests.length,1);
  await written;assert.equal(server.requests.length,2);assert.equal(server.requests[1].url,'/set/true');
  assert.equal(entry.value,false);await runtime.refresh(entry);assert.equal(characteristic.value,false);
});
test('GET completion that predates SET cannot overwrite current cache',async t=>{
  let release;let response='0';
  const server=await fakeServer(t,async (req,res)=>{
    if(req.url.startsWith('/set')){response='1';res.end('ok');return;}
    const captured=response;if(release===null) await new Promise(resolve=>{release=resolve;});res.end(captured);
  });
  const {runtime,entry,characteristic}=await device(t,{urls:{getOn:{url:server.url},setOn:{url:server.url+'/set/{value}'}}});
  await runtime.refresh(entry);release=null;const old=runtime.refresh(entry);await until(()=>typeof release==='function');
  await characteristic.handleSetRequest(true);release();await old;assert.equal(entry.value,false);
  await runtime.refresh(entry);assert.equal(entry.value,true);
});
test('shutdown cancels pending debounces and active refreshes',async t=>{
  const server=await fakeServer(t,async (_req,res)=>{await sleep(100);res.end('1');});
  const {runtime,entry,characteristic}=await device(t,{setterDelay:5000,urls:{getOn:{url:server.url},setOn:{url:server.url+'/set'}}});
  await characteristic.handleSetRequest(true);const refresh=runtime.refresh(entry);await until(()=>server.requests.length===1);runtime.shutdown();await refresh;await sleep(120);
  assert.equal(runtime.setters.size,0);assert.equal(runtime.coordinator.queue.length,0);assert.equal(runtime.coordinator.active.size,0);
  assert.equal(server.requests.length,1);
});

test('legacy template state keeps raw mapper types; resultOnError values still back off',async t=>{
  let fail=false;
  const server=await fakeServer(t,(_req,res)=>{if(fail)res.destroy();else res.end('1');});
  const {runtime,entry,adapter}=await device(t,{urls:{getOn:{url:server.url,resultOnError:0}}});
  await runtime.refresh(entry);assert.equal(adapter.state.getOn,'1');
  const success=entry.lastSuccess;fail=true;await runtime.refresh(entry);
  assert.equal(entry.value,false);assert.equal(entry.failures,1);assert.equal(entry.lastSuccess,success);
  assert.ok(entry.nextEligible>Date.now()+4000);
});

test('a getter started during a pending SET is discarded after the write completes',async t=>{
  const {runtime,entry,adapter}=await device(t,{urls:{getOn:{url:'http://example.invalid'},setOn:{url:'http://example.invalid'}}});
  runtime.actions.get=async()=> '0';await runtime.refresh(entry);
  let finishSet,finishGet;
  runtime.actions.set=()=>new Promise(resolve=>{finishSet=resolve;});
  const write=runtime.set(entry.config,adapter.state,'setOn',true,entry);
  runtime.actions.get=()=>new Promise(resolve=>{finishGet=resolve;});
  const read=runtime.refresh(entry);
  finishSet();await write;finishGet('1');await read;
  assert.equal(entry.value,false);
  runtime.actions.get=async()=> '1';await runtime.refresh(entry);assert.equal(entry.value,true);
});

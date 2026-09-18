import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {Runtime, sharedRuntime} from '../dist/runtime.js';
import {DeviceAdapter, LegacyAccessory} from '../dist/accessory.js';
import {ActionError} from '../dist/types.js';
import {validateSettings} from '../dist/settings.js';
import {validateDevice} from '../dist/config.js';
import {fakeServer, makeAPI, silentLog, sleep, until} from './helpers.mjs';

async function fixture(t, overrides={}, settings={}) {
  const api=await makeAPI(t);
  const runtime=new Runtime(silentLog, {}, api.user.persistPath(), settings);
  t.after(()=>runtime.shutdown());
  const config={name:'Fixture switch',service:'Switch',urls:{getOn:{url:'http://example.invalid/state'},setOn:{url:'http://example.invalid/set/{value}'}},...overrides};
  const adapter=new DeviceAdapter(api,runtime,config,'fixture');
  const entry=adapter.entries.get('getOn');
  const characteristic=adapter.service.getCharacteristic(api.hap.Characteristic.On);
  runtime.actions.get=async()=> '0';
  runtime.actions.set=async()=> {};
  await runtime.refresh(entry);
  return {api,runtime,config,adapter,entry,characteristic};
}

test('stale post-write reads retain the requested value until a matching read; persisted state stays observed',async t=>{
  const {api,runtime,entry,characteristic,adapter}=await fixture(t);
  await characteristic.handleSetRequest(true);
  assert.equal(await characteristic.handleGetRequest(),true);
  assert.equal(entry.value,false);
  for(let i=0;i<3;i++) {
    await runtime.refresh(entry);
    assert.equal(characteristic.value,true);
    assert.equal(await characteristic.handleGetRequest(),true);
  }
  runtime.persist();
  const saved=JSON.parse(readFileSync(join(api.user.persistPath(),'http-advanced-state-v1',entry.key+'.json'),'utf8'));
  assert.equal(saved.value,false);
  assert.equal(adapter.state.getOn,'0');
  runtime.actions.get=async()=> '1';
  await runtime.refresh(entry);
  assert.equal(entry.pendingWrite,undefined);
  assert.equal(characteristic.value,true);
  assert.equal(entry.value,true);
  assert.equal(adapter.state.getOn,'1');
  // once confirmed, a subsequent external change is immediately visible
  runtime.actions.get=async()=> '0';await runtime.refresh(entry);
  assert.equal(characteristic.value,false);
});

test('reads completing during a pending HTTP write cannot replace the intent or cache',async t=>{
  const {runtime,entry,characteristic}=await fixture(t);
  let finish;
  runtime.actions.set=()=>new Promise(resolve=>{finish=resolve;});
  const write=characteristic.handleSetRequest(true);
  assert.equal(await characteristic.handleGetRequest(),true);
  let reads=0;
  runtime.actions.get=async()=>{reads++;return '0';};
  entry.nextEligible=0;runtime.tick();
  assert.equal(reads,0);
  runtime.actions.get=async()=> '1';await runtime.refresh(entry);
  assert.equal(entry.value,false);
  assert.ok(entry.pendingWrite);
  runtime.actions.get=async()=> '0';await runtime.refresh(entry);
  assert.equal(await characteristic.handleGetRequest(),true);
  finish();await write;
  assert.ok(entry.pendingWrite.expires>=Date.now()+9900);
});

test('a plain HTTP server can acknowledge a write before its legacy mapped getter changes without a HomeKit bounce',async t=>{
  let state='OFF';
  const server=await fakeServer(t,(req,res)=>res.end(req.url.startsWith('/set')?'OK':state));
  const api=await makeAPI(t);
  const runtime=new Runtime(silentLog);t.after(()=>runtime.shutdown());
  const adapter=new DeviceAdapter(api,runtime,{
    name:'Delayed light',service:'Switch',urls:{
      getOn:{url:server.url+'/get',mappers:[{type:'static',parameters:{mapping:{OFF:'0',ON:'1'}}}]},
      setOn:{url:server.url+'/set/{value}',mappers:[{type:'static',parameters:{mapping:{true:'ON',false:'OFF'}}}]}
    }
  },'delayed');
  const entry=adapter.entries.get('getOn');
  const characteristic=adapter.service.getCharacteristic(api.hap.Characteristic.On);
  await runtime.refresh(entry);
  const changes=[];characteristic.on('change',event=>changes.push(event.newValue));
  await characteristic.handleSetRequest(true);
  for(let i=0;i<3;i++) {
    await runtime.refresh(entry);
    assert.equal(await characteristic.handleGetRequest(),true);
  }
  state='ON';await runtime.refresh(entry);
  assert.equal(entry.pendingWrite,undefined);
  assert.equal(entry.value,true);
  assert.equal(changes.includes(false),false);
  assert.equal(server.requests.filter(request=>request.url==='/set/ON').length,1);
});

test('confirmation expires even with a blocked queue and GET failures, without replaying the write',async t=>{
  const {runtime,entry,characteristic}=await fixture(t,{writeConfirmationTimeout:120});
  let writes=0;runtime.actions.set=async()=>{writes++;};
  await characteristic.handleSetRequest(true);
  runtime.actions.get=async()=>{throw new ActionError('timeout');};
  await runtime.refresh(entry);
  assert.equal(await characteristic.handleGetRequest(),true);
  const next=entry.nextEligible;
  await sleep(130);
  // expiry is independent of queue admission and does not bypass recovery backoff
  Object.defineProperty(runtime.coordinator,'available',{get:()=>false});
  runtime.tick();
  assert.equal(characteristic.value,false);
  assert.equal(entry.pendingWrite,undefined);
  assert.equal(entry.nextEligible,next);
  assert.equal(writes,1);
});

test('unknown initial state becomes a HAP error if confirmation expires',async t=>{
  const {runtime,entry,characteristic}=await fixture(t,{writeConfirmationTimeout:0});
  entry.known=false;delete entry.value;
  await characteristic.handleSetRequest(true);
  await assert.rejects(characteristic.handleGetRequest());
  assert.equal(entry.pendingWrite,undefined);
  assert.notEqual(characteristic.statusCode,0);
});

test('immediate and debounced failures clear their intent and restore observed state',async t=>{
  for(const setterDelay of [0,10]) {
    const {runtime,entry,characteristic}=await fixture(t,{setterDelay});
    runtime.actions.set=async()=>{throw new ActionError('timeout');};
    if(setterDelay) {
      await characteristic.handleSetRequest(true);
      assert.equal(await characteristic.handleGetRequest(),true);
      await until(()=>!entry.pendingWrite);
    } else await assert.rejects(characteristic.handleSetRequest(true));
    assert.equal(await characteristic.handleGetRequest(),false);
    assert.equal(entry.value,false);
  }
});

test('debounce holds only the newest intent and starts the confirmation clock after HTTP completion',async t=>{
  const {runtime,entry,characteristic}=await fixture(t,{setterDelay:30,writeConfirmationTimeout:100});
  const writes=[];let finish;
  runtime.actions.set=(_action,_config,_owner,_state,value)=>{
    writes.push(value);return new Promise(resolve=>{finish=resolve;});
  };
  for(const value of [true,false,true]) {
    await characteristic.handleSetRequest(value);
    assert.equal(await characteristic.handleGetRequest(),value);
  }
  await until(()=>finish);
  assert.deepEqual(writes,[true]);
  await sleep(110);
  assert.equal(await characteristic.handleGetRequest(),true);
  assert.equal(entry.pendingWrite.expires,undefined);
  finish();await until(()=>entry.pendingWrite.expires!==undefined);
  assert.ok(entry.pendingWrite.expires>Date.now()+80);
});

test('a superseded write success or failure cannot clear a newer pending intent',async t=>{
  for(const failOlder of [false,true]) {
    const {runtime,entry,characteristic}=await fixture(t);
    const finishes=[];
    runtime.actions.set=()=>new Promise((resolve,reject)=>finishes.push({resolve,reject}));
    const older=characteristic.handleSetRequest(true);
    const newer=characteristic.handleSetRequest(false);
    const newestIntent=entry.pendingWrite;
    finishes[1].resolve();await newer;
    if(failOlder) {
      finishes[0].reject(new ActionError('timeout'));await assert.rejects(older);
    } else { finishes[0].resolve();await older; }
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(entry.pendingWrite,newestIntent);
    assert.equal(characteristic.value,false);
    assert.equal(await characteristic.handleGetRequest(),false);
  }
});

test('error fallback values never confirm pending commands or replace observed state',async t=>{
  const {runtime,entry,characteristic}=await fixture(t);
  await characteristic.handleSetRequest(true);
  runtime.actions.get=async(_action,_config,_owner,_state,_seen,onFailure)=>{onFailure('network');return '1';};
  await runtime.refresh(entry);
  assert.equal(entry.value,false);
  assert.ok(entry.pendingWrite);
  assert.equal(entry.failures,1);
  assert.equal(await characteristic.handleGetRequest(),true);
});

test('confirmation overrides, expiry and post-command polling work with legacy long polling intervals',async t=>{
  const {runtime,entry,characteristic}=await fixture(t,{forceRefreshDelay:500},{writeConfirmationTimeout:100});
  await characteristic.handleSetRequest(true);await runtime.refresh(entry);
  assert.ok(entry.nextEligible<=Date.now()+100);
  await sleep(110);
  assert.equal(await characteristic.handleGetRequest(),false);
  assert.equal(entry.pendingWrite,undefined);
  entry.config.writeConfirmationTimeout=0;
  await characteristic.handleSetRequest(true);
  assert.equal(await characteristic.handleGetRequest(),false);
});

test('write confirmation accepts zero and rejects invalid timings at both configuration scopes',()=>{
  for(const value of [0,10000,45000]) {
    validateSettings({writeConfirmationTimeout:value});
    validateDevice({name:'Fixture',service:'Switch',writeConfirmationTimeout:value});
  }
  for(const value of [-1,'10000',NaN,Infinity,null]) {
    assert.throws(()=>validateSettings({writeConfirmationTimeout:value}),{category:'config'});
    assert.throws(()=>validateDevice({name:'Fixture',service:'Switch',writeConfirmationTimeout:value}),{category:'config'});
  }
});

test('shared runtime uses its own Homebridge log prefix and preserves legacy accessory identity',async t=>{
  const require=createRequire(import.meta.url);
  const root=dirname(require.resolve(process.env.HB_TEST_VERSION==='1'?'homebridge-v1':'homebridge'));
  const {Logger}=await import(pathToFileURL(join(root,'logger.js')).href);
  const messages=[];
  t.mock.method(console,'log',message=>messages.push(message));
  t.mock.method(console,'error',message=>messages.push(message));
  const log=Logger.withPrefix('Mischief');
  const api=await makeAPI(t);
  const accessory=new LegacyAccessory(log,{name:'Mischief',service:'Switch'},api);
  const runtime=sharedRuntime(api,log);
  runtime.log.info('shared info');runtime.log.warn('shared warning');runtime.log('shared callable');
  log.info('accessory info');log('accessory callable');
  const plain=messages.map(message=>message.replace(/\u001b\[[0-9;]*m/g,''));
  for(const message of plain.slice(0,3)) {assert.match(message,/\[HTTP Advanced\]/);assert.doesNotMatch(message,/Mischief/);}
  for(const message of plain.slice(3)) assert.match(message,/\[Mischief\]/);
  assert.equal(log.prefix,'Mischief');assert.equal(accessory.name,'Mischief');
});

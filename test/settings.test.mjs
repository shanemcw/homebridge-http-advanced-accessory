import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Runtime, sharedRuntime } from '../dist/runtime.js';
import { HTTPPlatform } from '../dist/platform.js';
import { LegacyAccessory } from '../dist/accessory.js';
import { validateSettings } from '../dist/settings.js';
import { ActionError } from '../dist/types.js';
import { Coordinator } from '../dist/coordinator.js';
import { fakeServer, makeAPI, silentLog, sleep } from './helpers.mjs';

test('global settings load in a legacy-only bridge and per-device refresh values win',async t=>{
  const api=await makeAPI(t);const settings={requestTimeout:40000,refresh:{activeInterval:9,idleInterval:120,idleAfter:30},coordinator:{concurrency:2,perOrigin:1},recovery:{quietPeriod:150}};
  writeFileSync(api.user.configPath(),JSON.stringify({httpAdvanced:settings}));
  new LegacyAccessory(silentLog,{name:'Legacy only',accessory:'HttpAdvancedAccessory',service:'Switch',urls:{getOn:{url:'http://example.invalid'}}},api);
  const runtime=sharedRuntime(api,silentLog);assert.deepEqual(runtime.settings,settings);assert.equal(runtime.coordinator.limits.concurrency,2);
  const entry=[...runtime.entries.values()][0];const original=JSON.stringify(entry.config);
  assert.equal(runtime.interval(entry,entry.lastDemand),9000);assert.equal(runtime.interval(entry,entry.lastDemand+31000),120000);
  assert.equal(JSON.stringify(entry.config),original);
  entry.config.refresh={activeInterval:3};assert.equal(runtime.interval(entry,entry.lastDemand),3000);
  entry.config.forceRefreshDelay=20;assert.equal(runtime.interval(entry,entry.lastDemand),20000);
});

test('invalid shared settings fall back without exposing their content',async t=>{
  const api=await makeAPI(t);const warnings=[];
  writeFileSync(api.user.configPath(),JSON.stringify({httpAdvanced:{requestTimeout:'private fixture'}}));
  const runtime=sharedRuntime(api,{...silentLog,warn:m=>warnings.push(m)});
  assert.deepEqual(runtime.settings,{});assert.equal(warnings.length,1);assert.ok(!warnings[0].includes('private fixture'));
  for(const value of [null,[],{coordinator:{perOrigin:0}},{recovery:{retryInterval:40}},{refresh:{activeInterval:0}}])assert.throws(()=>validateSettings(value));
});

test('global HTTP timeout and spacing apply to unchanged legacy actions; explicit action timeout wins',async t=>{
  const server=await fakeServer(t,async(_req,res)=>{await sleep(60);res.end('1');});
  const runtime=new Runtime(silentLog,{},undefined,{requestTimeout:20,uriCallsDelay:80});t.after(()=>runtime.shutdown());
  const submitted=t.mock.method(runtime.coordinator,'submit');
  const action={url:server.url};const config={name:'Legacy',service:'Switch'};
  await assert.rejects(runtime.transport.request(action,config,'owner'),{category:'timeout'});
  await runtime.transport.request({...action,timeout:300},config,'owner');
  assert.deepEqual(submitted.mock.calls.map(({arguments:args})=>args.slice(0,4)),[
    [new URL(server.url).origin,'owner',80,false],
    [new URL(server.url).origin,'owner',80,false],
  ]);
  assert.deepEqual(action,{url:server.url});assert.deepEqual(config,{name:'Legacy',service:'Switch'});
});

test('disabled platform retains cached accessories and legacy remains operational beside it',async t=>{
  const api=await makeAPI(t);const p=new HTTPPlatform(silentLog,{name:'Optional',platform:'HttpAdvanced',enabled:false,devices:[]},api);
  const cached=new api.platformAccessory('Existing',api.hap.uuid.generate('existing'));p.configureAccessory(cached);p.discover();
  assert.equal(api.removals.length,0);assert.equal(api.registrations.length,0);
  const legacy=new LegacyAccessory(silentLog,{name:'Legacy beside platform',accessory:'HttpAdvancedAccessory',service:'Switch',urls:{}},api);
  assert.ok(legacy.getServices().length);
  p.config.enabled=true;p.config.devices=[{id:'new',name:'New platform device',service:'Switch',urls:{}}];p.discover();
  assert.equal(api.registrations.length,1);assert.equal(api.removals.length,1);
});

test('shared recovery settings control probe spacing, warning grace and reminders',async t=>{
  const start=Date.now();t.mock.timers.enable({apis:['Date'],now:start});
  const warnings=[];const runtime=new Runtime({...silentLog,warn:m=>warnings.push(m)}, {}, undefined,
    {recovery:{retryInterval:7,maxRetryInterval:11,quietPeriod:140,reminderInterval:250}});
  t.after(()=>runtime.shutdown());
  runtime.actions.get=async()=>{throw new ActionError('network');};
  const entry=runtime.register('legacy','getOn',{name:'Legacy',service:'Switch',urls:{getOn:{url:'http://example.invalid'}}},{},String,()=>{});
  await runtime.refresh(entry);assert.equal(runtime.snapshot().recovering[0].nextProbe,7000);
  t.mock.timers.tick(7000);await runtime.refresh(entry);assert.equal(runtime.snapshot().recovering[0].nextProbe,11000);
  entry.nextEligible=Infinity;
  t.mock.timers.tick(83000);runtime.tick();assert.equal(warnings.length,0);
  t.mock.timers.tick(50000);runtime.tick();assert.equal(warnings.length,1);
  t.mock.timers.tick(249000);runtime.tick();assert.equal(warnings.length,1);
  t.mock.timers.tick(1000);runtime.tick();assert.equal(warnings.length,2);
});

test('platform coordinator overrides retain the documented process-wide precedence', async t => {
  const api = await makeAPI(t);
  writeFileSync(api.user.configPath(), JSON.stringify({httpAdvanced: {coordinator: {concurrency: 4, perOrigin: 2, maxQueue: 100}}}));
  const runtime = sharedRuntime(api, silentLog);
  new HTTPPlatform(silentLog, {name: 'First', platform: 'HttpAdvanced', devices: [], coordinator: {concurrency: 3}}, api).discover();
  assert.deepEqual(runtime.coordinator.limits, {concurrency: 3, perOrigin: 2, maxQueue: 100});
  new HTTPPlatform(silentLog, {name: 'Second', platform: 'HttpAdvanced', devices: [], coordinator: {perOrigin: 1}}, api).discover();
  assert.deepEqual(runtime.coordinator.limits, {concurrency: 3, perOrigin: 1, maxQueue: 100});
  new HTTPPlatform(silentLog, {name: 'Disabled', platform: 'HttpAdvanced', enabled: false, devices: [], coordinator: {concurrency: 1}}, api).discover();
  assert.equal(runtime.coordinator.limits.concurrency, 3);
  const coordinator = new Coordinator();
  assert.throws(() => coordinator.configure({constructor: 1}), {category: 'config'});
});

test('separate Homebridge API processes read shared defaults without sharing platform overrides', async t => {
  const {fork}=await import('node:child_process');
  const {once}=await import('node:events');
  const {dirname}=await import('node:path');
  const api=await makeAPI(t);const configPath=api.user.configPath();
  const settings={requestTimeout:45000,setterDelay:75,uriCallsDelay:20,writeConfirmationTimeout:12000,refresh:{activeInterval:7,idleInterval:90,idleAfter:30},recovery:{quietPeriod:120},coordinator:{concurrency:3,perOrigin:2,maxQueue:64}};
  writeFileSync(configPath,JSON.stringify({httpAdvanced:settings}));
  const run=async mode=>{
    const child=fork(new URL('./fixtures/settings-process.mjs',import.meta.url),[dirname(configPath),mode],{stdio:['ignore','ignore','pipe','ipc']});
    const watchdog=setTimeout(()=>child.kill(),5000);t.after(()=>child.kill());
    const exit=once(child,'exit');let stderr='';child.stderr.on('data',data=>stderr+=data);
    try{const [result]=await Promise.race([once(child,'message'),exit.then(()=>{throw new Error('Settings worker exited before reporting');})]);const [code]=await exit;assert.equal(code,0,stderr);return result;}
    finally{clearTimeout(watchdog);}
  };
  const [legacy,overridden]=await Promise.all([run('legacy'),run('override')]);
  assert.notEqual(legacy.pid,overridden.pid);
  assert.deepEqual(legacy.settings,settings);assert.deepEqual(overridden.settings,settings);
  assert.equal(legacy.configPath,configPath);assert.equal(overridden.configPath,configPath);
  assert.equal(legacy.limits.concurrency,3);assert.equal(overridden.limits.concurrency,1);
  assert.equal(legacy.limits.maxQueue,64);assert.equal(overridden.limits.maxQueue,64);
});

test('zero per-device timing overrides beat nonzero defaults and action timeouts beat the shared budget',async t=>{
  const api=await makeAPI(t);
  const {DeviceAdapter}=await import('../dist/accessory.js');
  const runtime=new Runtime(silentLog,{},undefined,{setterDelay:300,uriCallsDelay:300,writeConfirmationTimeout:12000,requestTimeout:20,refresh:{activeInterval:9,idleInterval:90,idleAfter:30}});
  t.after(()=>runtime.shutdown());
  const config={name:'Overrides',service:'Switch',setterDelay:0,uriCallsDelay:0,writeConfirmationTimeout:0,refresh:{activeInterval:2},urls:{getOn:{url:'http://example.invalid'},setOn:{url:'http://example.invalid'}}};
  const adapter=new DeviceAdapter(api,runtime,config,'overrides');const entry=adapter.entries.get('getOn');
  runtime.actions.get=async()=> '0';runtime.actions.set=async()=>{};
  await runtime.refresh(entry);await adapter.service.getCharacteristic(api.hap.Characteristic.On).handleSetRequest(true);
  assert.equal(runtime.setters.size,0);
  assert.ok(entry.pendingWrite.expires<=Date.now());
  assert.equal(runtime.read(entry),false);
  assert.equal(runtime.interval(entry,entry.lastDemand),2000);assert.equal(runtime.interval(entry,entry.lastDemand+31000),90000);
  const server=await fakeServer(t,async(_req,res)=>{await sleep(60);res.end('1');});
  await assert.rejects(runtime.transport.request({url:server.url},config,'override-owner'),{category:'timeout'});
  await runtime.transport.request({url:server.url,timeout:500},config,'override-owner');
  assert.ok(server.requests[1].time-server.requests[0].time<250,'explicit zero spacing must override the 300ms shared delay');
});

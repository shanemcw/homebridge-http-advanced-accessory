import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime} from '../dist/runtime.js';
import {DeviceAdapter} from '../dist/accessory.js';
import {fakeServer, makeAPI, silentLog, until} from './helpers.mjs';

function harness(t) {
  const messages = {warn: [], info: [], debug: []};
  const log = {...silentLog};
  for (const level of Object.keys(messages)) log[level] = message => messages[level].push(message);
  const runtime = new Runtime(log);
  t.after(() => runtime.shutdown());
  const register = (url, id, options = {}) => runtime.register(id, 'getOn', {
    name: id, service: 'Switch', debug: true, urls: {getOn: {url, ...options}},
  }, {}, value => String(value), () => {});
  return {runtime, messages, register};
}

test('44 getters share recovery beyond 30 seconds, retain cache, leave other origins and writes responsive, and recover together', async t => {
  t.mock.timers.enable({apis: ['Date'], now: Date.now()});
  let unavailable = false;
  const server = await fakeServer(t, (_req, res) => {
    if (unavailable) { res.writeHead(503, {'Retry-After': '5'}); res.end('Controller temporarily unavailable'); }
    else res.end('1');
  });
  const healthy = await fakeServer(t);
  const {runtime, messages, register} = harness(t);
  const entries = Array.from({length: 44}, (_, i) => register(server.url, `Device ${i}`));
  await Promise.all(entries.map(entry => runtime.refresh(entry)));
  unavailable = true;
  for (const entry of entries) entry.nextEligible = 0;
  runtime.tick();
  await until(() => runtime.stats.failedRefreshes >= 2 && runtime.coordinator.active.size === 0);
  const firstFailures = runtime.stats.failedRefreshes;
  assert.ok(firstFailures <= 4, 'queued siblings should wait, not fail in a burst');
  assert.equal(messages.warn.length, 0);
  for (const entry of entries) assert.equal(runtime.read(entry), '1');
  assert.equal(runtime.snapshot().recovering.length, 1);
  const other = register(healthy.url, 'Healthy');
  await runtime.refresh(other);
  assert.equal(other.value, '1');
  const beforeWrite = server.requests.length;
  await assert.rejects(runtime.set({urls: {setOn: {url: server.url}}}, {}, 'setOn', true), {category: 'unavailable'});
  assert.equal(server.requests.length, beforeWrite + 1, 'a failed write is sent once and not replayed');

  // advance wall time while keeping real HTTP and scheduling; each recovery round admits one probe
  for (let round = 0; round < 4; round++) {
    const failed = runtime.stats.failedRefreshes;
    t.mock.timers.tick(31000);
    runtime.tick();
    await until(() => runtime.stats.failedRefreshes >= failed + 1 && runtime.coordinator.active.size === 0);
    assert.equal(runtime.stats.failedRefreshes, failed + 1, 'each recovery round admits one probe');
  }
  assert.equal(messages.warn.length, 1, 'debug must not multiply outage warnings');
  assert.match(messages.warn[0], /waiting for usable responses/);
  assert.equal(messages.warn.join('').includes(server.url), false);

  unavailable = false;
  t.mock.timers.tick(31000);
  runtime.tick();
  await until(() => runtime.snapshot().recovering.length === 0 && runtime.coordinator.queue.length === 0 && runtime.coordinator.active.size === 0);
  assert.equal(messages.info.length, 1);
  assert.match(messages.info[0], /responses recovered/);
  assert.ok(entries.every(entry => entry.failures === 0));
  assert.ok(server.maxActive <= 2);
});

test('old gateways with a successful HTTP timeout page use the same quiet recovery and do not invent state', async t => {
  const server = await fakeServer(t, (_req, res) => res.end('Controller response timeout'));
  const {runtime, register, messages} = harness(t);
  const entry = register(server.url, 'Old gateway', {mappers: [{type: 'jpath', parameters: {jpath: '$.u'}}]});
  await runtime.refresh(entry);
  assert.equal(entry.lastError, 'inconclusive');
  assert.equal(entry.known, false);
  assert.throws(() => runtime.read(entry), {category: 'inconclusive'});
  assert.equal(runtime.snapshot().recovering.length, 1);
  assert.equal(messages.warn.length, 0);
});

test('mapper errors remain actionable without pausing the origin or repeating warnings under debug', async t => {
  const server = await fakeServer(t);
  const {runtime, register, messages} = harness(t);
  const entry = register(server.url, 'Bad mapper', {mappers: [{type: 'eval', parameters: {expression: 'missingFunction()'}}]});
  await runtime.refresh(entry);
  await runtime.refresh(entry);
  assert.equal(entry.lastError, 'mapper');
  assert.equal(messages.warn.length, 1);
  assert.equal(runtime.snapshot().recovering.length, 0);
});

test('explicit fallback values preserve retry guidance and outage reminders are rate limited', async t => {
  t.mock.timers.enable({apis: ['Date'], now: Date.now()});
  const server = await fakeServer(t, (_req, res) => {res.writeHead(503, {'Retry-After': '120'}); res.end('busy');});
  const {runtime, register, messages} = harness(t);
  const entry = register(server.url, 'Fallback', {resultOnError: false});
  await runtime.refresh(entry);
  assert.equal(entry.value, 'false');
  assert.equal(entry.lastSuccess, 0);
  assert.equal(runtime.snapshot().recovering[0].nextProbe, 120000);
  t.mock.timers.tick(91000); runtime.tick();
  assert.equal(messages.warn.length, 1);
  for (let i = 0; i < 10; i++) runtime.tick();
  assert.equal(messages.warn.length, 1);
  t.mock.timers.tick(300000); runtime.tick();
  assert.equal(messages.warn.length, 2);
  runtime.shutdown();
  await until(() => runtime.coordinator.active.size === 0);
});

for (const failure of ['text', 'html', 'missingField', 'brokenXML', 'disconnect', 'slowBody']) {
  test(`unchanged legacy server: 44 POST getters survive a long ${failure} outage without retry headers`, async t => {
    t.mock.timers.enable({apis: ['Date'], now: Date.now()});
    let unavailable = false;
    const server = await fakeServer(t, (_req, res) => {
      if (!unavailable) { res.end(failure === 'brokenXML' ? '<state>1</state>' : '{"state":1}'); return; }
      if (failure === 'disconnect') { res.destroy(); return; }
      if (failure === 'slowBody') { res.writeHead(200); res.write('{"state":'); return; }
      if (failure === 'html') { res.statusCode = 502; res.end('<html>Backend busy</html>'); return; }
      res.end(failure === 'missingField' ? '{}' : failure === 'brokenXML' ? '<state' : 'Controller response timeout');
    });
    const {runtime, messages, register} = harness(t);
    const entries = Array.from({length:44}, (_, i) => register(server.url, `Legacy ${i}`, {
      httpMethod:'POST', body:`read=${i}`, timeout:failure === 'slowBody' ? 40 : 10000,
      requireResponseMatch:failure === 'missingField',
      mappers:[failure === 'brokenXML' ? {type:'xpath',parameters:{xpath:'//state/text()'}} : {type:'jpath',parameters:{jpath:'$.state'}}],
    }));
    await Promise.all(entries.map(entry => runtime.refresh(entry)));
    unavailable = true;
    for (const entry of entries) entry.nextEligible = 0;
    runtime.tick();
    await until(() => runtime.stats.failedRefreshes >= 2 && runtime.coordinator.active.size === 0);
    const initialFailures = runtime.stats.failedRefreshes;
    assert.ok(initialFailures <= 4);
    for (let round = 0; round < 4; round++) {
      const failed = runtime.stats.failedRefreshes;
      t.mock.timers.tick(31000); runtime.tick();
      await until(() => runtime.stats.failedRefreshes > failed && runtime.coordinator.active.size === 0);
      assert.equal(runtime.stats.failedRefreshes, failed + 1);
      for (const entry of entries) assert.equal(runtime.read(entry), '1');
    }
    assert.equal(messages.warn.length, 1);
    assert.equal(runtime.stats.mapperFailures, 0);
    unavailable = false;
    t.mock.timers.tick(31000); runtime.tick();
    await until(() => runtime.snapshot().recovering.length === 0 && runtime.coordinator.queue.length === 0 && runtime.coordinator.active.size === 0);
    assert.equal(messages.info.length, 1);
    assert.ok(entries.every(entry => entry.value === '1'));
    assert.ok(server.requests.every(request => request.method === 'POST' && /^read=\d+$/.test(request.body)));
  });
}

test('fixed plain-text replies tolerate line endings and reject HTTP 200 error pages without turning off', async t => {
  let reply = 'ON\r\n';
  const server = await fakeServer(t, (_req, res) => res.end(reply));
  const api = await makeAPI(t);
  const {runtime, messages} = harness(t);
  const adapter = new DeviceAdapter(api, runtime, {name:'Fixed protocol',service:'Switch',urls:{
    getOn:{url:server.url,responsePattern:'^(?:ON|OFF)\\s*$',mappers:[
      {type:'regex',parameters:{regexp:'^(ON|OFF)\\s*$'}},
      {type:'static',parameters:{mapping:{ON:'1',OFF:'0'}}},
    ]},
  }}, 'fixed');
  const entry = adapter.entries.get('getOn');
  await runtime.refresh(entry);
  assert.equal(runtime.read(entry), true);
  reply = 'OFF\r\n';
  await runtime.refresh(entry);
  assert.equal(runtime.read(entry), false);
  reply = 'ON';
  await runtime.refresh(entry);
  reply = 'Backend temporarily unavailable';
  await runtime.refresh(entry);
  assert.equal(runtime.read(entry), true);
  assert.equal(entry.lastError, 'inconclusive');
  assert.equal(messages.warn.length, 0);
});

test('a temporarily nonnumeric response retains sensor state with quiet recovery', async t => {
  let reply = '21.5';
  const server = await fakeServer(t, (_req, res) => res.end(reply));
  const api = await makeAPI(t);
  const {runtime, messages} = harness(t);
  const adapter = new DeviceAdapter(api, runtime, {name:'Old sensor',service:'TemperatureSensor',urls:{getCurrentTemperature:{url:server.url}}}, 'sensor');
  const entry = adapter.entries.get('getCurrentTemperature');
  await runtime.refresh(entry);
  reply = 'Please wait';
  await runtime.refresh(entry);
  assert.equal(runtime.read(entry), 21.5);
  assert.equal(entry.lastError, 'inconclusive');
  assert.equal(messages.warn.length, 0);
});

test('an explicit inconclusive fallback still handles a missing field successfully', async t => {
  const server = await fakeServer(t, (req, res) => res.end(req.url === '/fallback' ? '0' : '{}'));
  const {runtime, register} = harness(t);
  const entry = register(server.url, 'Fallback endpoint', {
    requireResponseMatch:true,mappers:[{type:'jpath',parameters:{jpath:'$.state'}}],inconclusive:{url:server.url+'/fallback'},
  });
  await runtime.refresh(entry);
  assert.equal(runtime.read(entry), '0');
  assert.equal(runtime.snapshot().recovering.length, 0);
});

test('a recovering fleet releases queue capacity without inventing fallback values or replaying writes', async t => {
  t.mock.timers.enable({apis:['Date'], now:Date.now()});
  let offline=false; let value='old';
  const server=await fakeServer(t,(req,res)=>{
    if(req.method==='POST'){res.end('OK');return;}
    if(offline){res.writeHead(503,{'Retry-After':'120'});res.end('busy');return;}
    res.end(value);
  });
  const healthy=await fakeServer(t);
  const {runtime,register,messages}=harness(t);
  runtime.coordinator.configure({concurrency:2,perOrigin:2,maxQueue:4});
  const entries=Array.from({length:40},(_,i)=>register(server.url,`Fleet ${i}`,i===4?{resultOnError:'fabricated'}:{}));
  await Promise.all(entries.slice(0,2).map(entry=>runtime.refresh(entry)));
  offline=true;
  for(const entry of entries)entry.nextEligible=0;
  runtime.tick();
  await until(()=>runtime.stats.failedRefreshes===2&&runtime.coordinator.active.size===0);
  await until(()=>runtime.coordinator.queue.length===0);
  assert.equal(entries[0].value,'old');
  assert.equal(entries[4].known,false,'a parked read must not apply resultOnError');
  assert.throws(()=>runtime.read(entries[4]),{category:'inconclusive'});
  assert.equal(messages.warn.length,0);
  for(let i=0;i<10;i++)runtime.tick();
  assert.equal(runtime.coordinator.queue.length,0);
  const other=register(healthy.url,'Healthy');await runtime.refresh(other);assert.equal(other.value,'1');
  await runtime.set({urls:{setOn:{url:server.url,httpMethod:'POST'}}},{},'setOn',true);
  assert.equal(runtime.snapshot().recovering.length,1,'a write acknowledgement does not prove reads recovered');
  assert.equal(server.requests.filter(req=>req.method==='POST').length,1);
  offline=false;value='new';t.mock.timers.tick(120001);
  await until(()=>{t.mock.timers.tick(100);runtime.tick();return entries.every(entry=>entry.value==='new')&&runtime.coordinator.queue.length===0&&runtime.coordinator.active.size===0;});
  assert.equal(runtime.snapshot().recovering.length,0);
  assert.equal(server.requests.filter(req=>req.method==='POST').length,1);
  assert.ok(server.maxActive<=2);
  assert.ok(runtime.coordinator.stats.highWater<=4);
});

test('malformed getter URL is contained while another origin recovers', async t => {
  const server=await fakeServer(t,(_req,res)=>{res.writeHead(503,{'Retry-After':'30'});res.end('busy');});
  const {runtime,register}=harness(t);
  await runtime.refresh(register(server.url,'Offline'));
  const bad=register('http://','Malformed');bad.nextEligible=0;
  assert.doesNotThrow(()=>runtime.tick());
  await until(()=>bad.lastError==='config');
  assert.equal(runtime.snapshot().recovering.length,1);
});

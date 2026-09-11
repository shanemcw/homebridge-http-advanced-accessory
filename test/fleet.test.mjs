import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {LegacyAccessory} from '../dist/accessory.js';
import {sharedRuntime} from '../dist/runtime.js';
import {loadLegacy} from './legacy-loader.mjs';
import {fakeServer,makeAPI,silentLog,sleep,bridgeFixture,identifierCache,until} from './helpers.mjs';

import {fleetMeasurement} from './fleet-measurement.mjs';

test('44-device HAP bulk serialization returns memory state without getter fan-out under slow backend',async t=>{
  const {report}=await fleetMeasurement(t);
  assert.equal(report.alphaGetterRequestsFromBulk,0);assert.equal(report.baselineGetterRequests,41);
  assert.ok(report.alphaBulkMS<report.baselineBulkMS/4);
  assert.ok(report.maxConcurrency<=2);
});
test('identifier cache survives a full legacy instance replacement with unchanged AIDs/IIDs',async t=>{
  const api=await makeAPI(t),Old=loadLegacy(api.hap),cache=identifierCache();
  const configs=[{name:'One',service:'Switch'},{name:'Two',service:'Lightbulb',optionCharacteristic:['Brightness']}];
  const old=bridgeFixture(api,configs.map(c=>new Old(silentLog,c)),cache);
  const modern=bridgeFixture(api,configs.map(c=>new LegacyAccessory(silentLog,c,api)),cache);
  const structure=b=>b.internalHAPRepresentation(false).map(a=>({aid:a.aid,services:a.services.map(s=>({iid:s.iid,type:s.type,chars:s.characteristics.map(c=>({iid:c.iid,type:c.type}))}))}));
  assert.deepEqual(structure(modern),structure(old));
});
test('scheduler keeps bounded work under fleet load without overlapping any action',async t=>{
  const backend=await fakeServer(t,async(_req,res)=>{await sleep(35);res.end('1');});
  const api=await makeAPI(t),runtime=sharedRuntime(api,silentLog);runtime.coordinator.configure({concurrency:3,perOrigin:2,maxQueue:5});
  for(let i=0;i<20;i++)new LegacyAccessory(silentLog,{name:`Load ${i}`,service:'Switch',refresh:{activeInterval:.05},urls:{getOn:{url:backend.url}}},api);
  for(const e of runtime.entries.values())e.nextEligible=0;
  runtime.start();await until(()=>[...runtime.entries.values()].every(e=>e.known),5000);
  assert.ok(runtime.coordinator.stats.highWater<=5);assert.ok(backend.maxActive<=2);
  assert.ok([...runtime.entries.values()].every(e=>e.failures===0));
});

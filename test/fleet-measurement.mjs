import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {createRequire} from 'node:module';
import {LegacyAccessory} from '../dist/accessory.js';
import {sharedRuntime} from '../dist/runtime.js';
import {loadLegacy} from './legacy-loader.mjs';
import {fakeServer,makeAPI,silentLog,sleep,bridgeFixture,identifierCache,until} from './helpers.mjs';

export async function fleetMeasurement(t, delay=20) {
  let sequence=Promise.resolve();
  const backend=await fakeServer(t,(_req,res)=>{
    sequence=sequence.then(async()=>{await sleep(delay);res.end('{"u":"1"}');});return sequence;
  });
  const api=await makeAPI(t);
  const configs=JSON.parse(readFileSync(new URL('./fixtures/fleet.json',import.meta.url)));
  for(const config of configs)for(const action of Object.values(config.urls))action.url=backend.url+'/control.php';
  const require=createRequire(import.meta.url);
  const Legacy=loadLegacy(api.hap,createRequire(require.resolve('legacy-plugin'))('request'));
  // baseline on-demand entries are sufficient for direct comparison; polling has a separate regression
  const baselineConfigs=configs.filter(c=>!c.forceRefreshDelay);
  const baseline=bridgeFixture(api,baselineConfigs.map(c=>new Legacy(silentLog,c)));
  const baselineStart=performance.now();
  const baselineBody={accessories:await baseline.toHAP(undefined,true)};
  const baselineMS=performance.now()-baselineStart,baselineRequests=backend.requests.length;
  const cache=identifierCache();
  const instances=configs.map(c=>new LegacyAccessory(silentLog,c,api));
  const alpha=bridgeFixture(api,instances,cache);
  const runtime=sharedRuntime(api,silentLog);
  const sweepStart=performance.now();
  await Promise.all([...runtime.entries.values()].map(e=>runtime.refresh(e)));
  const sweepMS=performance.now()-sweepStart;
  const before=backend.requests.length,started=runtime.coordinator.stats.started;
  const alphaStart=performance.now();const alphaBody={accessories:await alpha.toHAP(undefined,true)};const alphaMS=performance.now()-alphaStart;
  assert.equal(backend.requests.length,before);assert.equal(runtime.coordinator.stats.started,started);
  assert.equal(alphaBody.accessories.length,45);assert.equal(baselineBody.accessories.length,42);
  // exact service/characteristic short types consumed by readhb12.pl
  for(const accessory of alphaBody.accessories.slice(1)){
    assert.ok(accessory.aid>1);
    const info=accessory.services.find(s=>s.type==='3E'),service=accessory.services.find(s=>s.type==='49');
    assert.equal(typeof info.characteristics.find(c=>c.type==='23').value,'string');
    assert.equal(service.characteristics.find(c=>c.type==='25').value,1);
    assert.ok(service.characteristics.every(c=>Number.isInteger(c.iid)));
  }
  const ages=[...runtime.entries.values()].map(e=>Date.now()-e.lastSuccess);
  const summary=values=>{const v=[...values].sort((a,b)=>a-b);return {median:v[Math.floor(v.length/2)]??0,p95:v[Math.min(v.length-1,Math.ceil(v.length*.95)-1)]??0,max:v.at(-1)??0};};
  const report={node:process.version,homebridge:process.env.HB_TEST_VERSION||'2',syntheticBackendDelayMS:delay,devices:44,baselineOnDemandDevices:41,
    baselineBulkMS:baselineMS,baselineGetterRequests:baselineRequests,alphaBulkMS:alphaMS,alphaGetterRequestsFromBulk:backend.requests.length-before,
    refreshSweepMS:sweepMS,cacheAgeMS:summary(ages),requestDurationMS:summary(runtime.coordinator.stats.durations),queueHighWater:runtime.coordinator.stats.highWater,
    maxConcurrency:runtime.coordinator.stats.maxInFlight,completed:runtime.coordinator.stats.completed,failures:runtime.coordinator.stats.failed};
  return {report,runtime,api,alpha,backend,configs,cache};
}

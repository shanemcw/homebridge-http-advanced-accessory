import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const silentLog = Object.assign(() => {}, {info() {}, warn() {}, error() {}, debug() {}});
export async function until(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out waiting for condition'); await sleep(5); }
}
export async function fakeServer(t, handler = (_req, res) => res.end('1')) {
  const requests = [];
  let active = 0, maxActive = 0;
  const server = http.createServer(async (req, res) => {
    active++; maxActive = Math.max(maxActive, active);
    res.on('close', () => active--);
    let body = ''; for await (const chunk of req) body += chunk;
    const item = {url: req.url, method: req.method, headers: req.headers, body, time: Date.now(), port: req.socket.remotePort};
    requests.push(item);
    try { await handler(item, res); } catch { res.destroy(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  t?.after(close);
  return {url: `http://127.0.0.1:${server.address().port}`, requests, close, get maxActive() {return maxActive;}};
}
export async function makeAPI(t, version = process.env.HB_TEST_VERSION || '2') {
  const name = version === '1' ? 'homebridge-v1' : 'homebridge';
  const root = dirname(require.resolve(name));
  const {HomebridgeAPI} = await import(pathToFileURL(join(root, 'api.js')).href);
  const api = new HomebridgeAPI();
  const storage = mkdtempSync(join(tmpdir(), 'http-advanced-test-'));
  api.user = {persistPath: () => storage};
  api.registrations = []; api.updates = []; api.removals = [];
  api.registerPlatformAccessories = (_plugin, _platform, accessories) => api.registrations.push(...accessories);
  api.updatePlatformAccessories = accessories => api.updates.push(...accessories);
  api.unregisterPlatformAccessories = (_plugin, _platform, accessories) => api.removals.push(...accessories);
  t?.after(() => {api.emit('shutdown'); rmSync(storage, {recursive: true, force: true});});
  return api;
}

export function identifierCache(version = process.env.HB_TEST_VERSION || '2') {
  const localRequire=createRequire(require.resolve(version==='1'?'homebridge-v1':'homebridge'));
  const hapName=version==='1'?'hap-nodejs':'@homebridge/hap-nodejs';
  const root=dirname(localRequire.resolve(hapName));
  const {IdentifierCache}=require(join(root,'lib/model/IdentifierCache.js'));
  return new IdentifierCache('00:00:00:00:00:01');
}

export function bridgeFixture(api, instances, cache=identifierCache()) {
  const bridge=new api.hap.Bridge('Fixture Bridge',api.hap.uuid.generate('Fixture Bridge'));
  for(const [index,instance] of instances.entries()){
    const name=instance.name??`Fixture ${index}`;
    const accessory=new api.hap.Accessory(name,api.hap.uuid.generate('HttpAdvancedAccessory:'+name));
    for(const service of instance.getServices()){
      if(service.UUID===api.hap.Service.AccessoryInformation.UUID){
        service.setCharacteristic(api.hap.Characteristic.Name,name);
        accessory.getService(api.hap.Service.AccessoryInformation).replaceCharacteristicsFromService(service);
      }else accessory.addService(service);
    }
    bridge.addBridgedAccessory(accessory);
  }
  // private HAP APIs are used only by the regression harness, never by the plugin
  bridge._assignIDs(cache);
  return bridge;
}

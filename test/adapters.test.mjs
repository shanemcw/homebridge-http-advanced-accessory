import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import initialize from '../dist/index.js';
import {LegacyAccessory,DeviceAdapter,serviceConstructor,convertValue} from '../dist/accessory.js';
import {HTTPPlatform} from '../dist/platform.js';
import {Runtime,sharedRuntime} from '../dist/runtime.js';
import {loadLegacy} from './legacy-loader.mjs';
import {fakeServer,makeAPI,silentLog} from './helpers.mjs';
const require=createRequire(import.meta.url);
const shape=services=>JSON.parse(JSON.stringify(services.map(s=>({UUID:s.UUID,name:s.displayName,chars:s.characteristics.map(c=>({UUID:c.UUID,props:c.props}))}))));

test('registers unchanged legacy alias alongside dynamic platform',async t=>{
  const api=await makeAPI(t);const registrations=[];
  api.registerAccessory=(...args)=>registrations.push(args.slice(0,2));api.registerPlatform=(...args)=>registrations.push(args.slice(0,2));initialize(api);
  assert.deepEqual(registrations,[['homebridge-http-advanced-accessory','HttpAdvancedAccessory'],['homebridge-http-advanced-accessory','HttpAdvanced']]);
});
test('legacy service shape matches published plugin across service types, optional characteristics and props',async t=>{
  const api=await makeAPI(t);const Old=loadLegacy(api.hap);
  for(const config of [
    {name:'Switch',service:'Switch'},
    {name:'Lamp',service:'Lightbulb',optionCharacteristic:['Hue','Brightness','Saturation'],props:{Brightness:{minValue:5,maxValue:90}}},
    {name:'Thermostat',service:'Thermostat'},
    {name:'Security',service:'SecuritySystem'},
    {name:'Contact',service:'ContactSensor'},
    {name:'Window',service:'WindowCovering'},
  ]){
    const old=new Old(silentLog,config);const modern=new LegacyAccessory(silentLog,config,api);
    assert.deepEqual(shape(modern.getServices()),shape(old.getServices()));
  }
});
test('inventory every historically documented service against actual HAP; BatteryService alias works',async t=>{
  const api=await makeAPI(t);
  const doc=readFileSync(new URL('../docs/legacy-reference.md',import.meta.url),'utf8');
  const names=doc.split('## Supported services')[1].split('## Configuration Examples')[0].trim().split(/\s+/);
  for(const name of names){
    if(name==='BatteryService'||typeof api.hap.Service[name]==='function')assert.equal(typeof serviceConstructor(api,name),'function');
    else assert.throws(()=>serviceConstructor(api,name),new RegExp('unsupported HomeKit service: '+name));
  }
  assert.equal(serviceConstructor(api,'BatteryService').UUID,api.hap.Service.Battery.UUID);
});
test('numeric, boolean, string characteristic conversions preserve false/zero',async t=>{
  const api=await makeAPI(t);
  assert.equal(convertValue(new api.hap.Characteristic.On(),'0'),false);
  assert.equal(convertValue(new api.hap.Characteristic.Brightness(),'0'),0);
  assert.equal(convertValue(new api.hap.Characteristic.CurrentTemperature(),'21.5'),21.5);
  assert.equal(convertValue(new api.hap.Characteristic.Name(),''),'');
  assert.equal(convertValue(new api.hap.Characteristic.Brightness(),'120'),100);
  assert.equal(convertValue(new api.hap.Characteristic.On(),'off'),false);
  assert.equal(convertValue(new api.hap.Characteristic.Name(),42),'42');
});
test('dynamic platform restores cached objects, retains IDs on rename with id, removes only obsolete devices',async t=>{
  const api=await makeAPI(t);
  const config={platform:'HttpAdvanced',name:'Test Platform',devices:[{id:'one',name:'One',service:'Switch'}]};
  const first=new HTTPPlatform(silentLog,config,api);first.discover();
  assert.equal(api.registrations.length,1);const original=api.registrations[0];
  const second=new HTTPPlatform(silentLog,{...config,devices:[{...config.devices[0],name:'Renamed'}]},api);second.configureAccessory(original);second.discover();
  assert.equal(api.registrations.length,1);assert.equal(api.updates[0],original);
  assert.equal(original.getService(api.hap.Service.Switch).getCharacteristic(api.hap.Characteristic.Name).value,'Renamed');
  const invalid=new HTTPPlatform(silentLog,{...config,devices:[{name:'bad',service:'Missing'}]},api);invalid.configureAccessory(original);invalid.discover();assert.equal(api.removals.length,0);
  const empty=new HTTPPlatform(silentLog,{...config,devices:[]},api);empty.configureAccessory(original);empty.discover();assert.equal(api.removals.length,1);
});
test('legacy and platform configurations expose equivalent services, getters and setters',async t=>{
  const api=await makeAPI(t);const server=await fakeServer(t);
  const config={name:'Equivalent',service:'Switch',urls:{getOn:{url:server.url},setOn:{url:server.url+'/set/{value}'}}};
  const legacy=new LegacyAccessory(silentLog,config,api);
  const platform=new HTTPPlatform(silentLog,{platform:'HttpAdvanced',name:'Test',devices:[config]},api);platform.discover();
  const runtime=sharedRuntime(api,silentLog);await Promise.all([...runtime.entries.values()].map(e=>runtime.refresh(e)));
  const a=legacy.getServices()[1], b=api.registrations[0].getService(api.hap.Service.Switch);
  assert.deepEqual(shape([a]),shape([b]));
  for(const s of [a,b]){const c=s.getCharacteristic(api.hap.Characteristic.On);assert.equal(await c.handleGetRequest(),true);await c.handleSetRequest(false);}
  assert.equal(server.requests.filter(r=>r.url==='/set/false').length,2);
});
test('ordinary legacy upgrade preserves Homebridge UUID input and serialized AID/IID assignment',async t=>{
  const api=await makeAPI(t);
  const modulePath=require.resolve(process.env.HB_TEST_VERSION==='1'?'homebridge-v1':'homebridge').replace(/index\.js$/,'bridgeService.js');
  const {BridgeService}=await import(pathToFileURL(modulePath).href);
  const Old=loadLegacy(api.hap), config={name:'Identity',service:'Lightbulb',optionCharacteristic:['Brightness']};
  const old=new Old(silentLog,config), modern=new LegacyAccessory(silentLog,config,api);
  const identity=api.hap.uuid.generate('HttpAdvancedAccessory:Identity');
  const build=instance=>BridgeService.prototype.createHAPAccessory.call({}, {getPluginIdentifier:()=> 'homebridge-http-advanced-accessory'}, instance, config.name, 'HttpAdvancedAccessory');
  const before=build(old),after=build(modern);
  assert.equal(before.UUID,after.UUID);
  assert.equal(after.UUID,identity);
  // persisted identifier lookup keys are the accessory UUID, service UUID/subtype and characteristic UUID
  const keys=a=>a.services.flatMap(s=>s.characteristics.map(c=>[a.UUID,s.UUID,s.subtype,c.UUID]));
  assert.deepEqual(keys(before),keys(after));
});
test('sanitized 44-device fixture preserves all delay and mapper variants without config rewriting',async t=>{
  const api=await makeAPI(t);const runtime=new Runtime(silentLog);t.after(()=>runtime.shutdown());
  const devices=JSON.parse(readFileSync(new URL('./fixtures/fleet.json',import.meta.url)));
  const original=JSON.stringify(devices);
  for(const config of devices)new DeviceAdapter(api,runtime,config,config.name);
  assert.equal(runtime.entries.size,44);assert.equal([...runtime.entries.values()].filter(e=>e.config.forceRefreshDelay===500).length,3);
  assert.equal(JSON.stringify(devices),original);
});

test('serialized platform lifecycle preserves identity through disable and re-enable, then removes explicitly',async t=>{
  const server=await fakeServer(t,(req,res)=>res.end(req.url.startsWith('/set')?'OK':'1'));
  const config={platform:'HttpAdvanced',name:'Lifecycle',enabled:true,devices:[{id:'stable-id',name:'Original',service:'Switch',urls:{getOn:{url:server.url},setOn:{url:server.url+'/set/{value}'}}}]};
  const firstAPI=await makeAPI(t);
  new HTTPPlatform(silentLog,config,firstAPI).discover();
  const original=firstAPI.registrations[0];
  const firstRuntime=sharedRuntime(firstAPI,silentLog);
  await firstRuntime.refresh([...firstRuntime.entries.values()][0]);
  // use Homebridge's real persistence format, not an in-memory object with old handlers
  original._associatedPlugin='homebridge-http-advanced-accessory';original._associatedPlatform='HttpAdvanced';
  const saved=JSON.parse(JSON.stringify(firstAPI.platformAccessory.serialize(original)));
  firstAPI.emit('shutdown');
  const restore=api=>api.platformAccessory.deserialize(structuredClone(saved));
  const disabledAPI=await makeAPI(t);const disabledAccessory=restore(disabledAPI);
  const disabled=new HTTPPlatform(silentLog,{...config,enabled:false},disabledAPI);disabled.configureAccessory(disabledAccessory);disabled.discover();
  const off=disabledAccessory.getService(disabledAPI.hap.Service.Switch).getCharacteristic(disabledAPI.hap.Characteristic.On);
  const before=server.requests.length;
  await assert.rejects(off.handleGetRequest());await assert.rejects(off.handleSetRequest(false));
  assert.equal(server.requests.length,before);assert.equal(disabledAPI.removals.length,0);
  assert.equal(disabledAccessory.UUID,original.UUID);
  const enabledAPI=await makeAPI(t);const restored=restore(enabledAPI);
  const renamed={...config,devices:[{...config.devices[0],name:'Renamed'}]};
  const enabled=new HTTPPlatform(silentLog,renamed,enabledAPI);enabled.configureAccessory(restored);enabled.discover();
  assert.equal(enabledAPI.registrations.length,0);assert.equal(enabledAPI.updates[0].UUID,original.UUID);
  const runtime=sharedRuntime(enabledAPI,silentLog);await runtime.refresh([...runtime.entries.values()][0]);
  const on=restored.getService(enabledAPI.hap.Service.Switch).getCharacteristic(enabledAPI.hap.Characteristic.On);
  assert.equal(await on.handleGetRequest(),true);await on.handleSetRequest(false);
  assert.equal(server.requests.filter(req=>req.url==='/set/false').length,1);
  enabledAPI.emit('shutdown');
  for(const overrides of [{enabled:'false',devices:[]},{devices:[{name:'Invalid',service:'Missing'}]},{coordinator:{concurrency:0},devices:[]}]){
    const api=await makeAPI(t);const accessory=restore(api);const platform=new HTTPPlatform(silentLog,{...config,...overrides},api);
    platform.configureAccessory(accessory);platform.discover();assert.equal(api.removals.length,0);
    await assert.rejects(accessory.getService(api.hap.Service.Switch).getCharacteristic(api.hap.Characteristic.On).handleSetRequest(false));
  }
  const emptyAPI=await makeAPI(t);const empty=new HTTPPlatform(silentLog,{...config,devices:[]},emptyAPI);
  empty.configureAccessory(restore(emptyAPI));empty.discover();assert.equal(emptyAPI.removals.length,1);
  assert.equal(emptyAPI.removals[0].UUID,original.UUID);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {makeAPI} from './helpers.mjs';
import {validateDevice} from '../dist/config.js';
const require=createRequire(import.meta.url);

test('actual Homebridge plugin loader loads the ESM entry and registers both adapters',async t=>{
  const api=await makeAPI(t),calls=[];
  api.registerAccessory=(...args)=>calls.push(args[1]);api.registerPlatform=(...args)=>calls.push(args[1]);
  const packageName=process.env.HB_TEST_VERSION==='1'?'homebridge-v1':'homebridge';
  const modulePath=require.resolve(packageName).replace(/index\.js$/,'plugin.js');
  const {Plugin}=await import(pathToFileURL(modulePath).href);
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const plugin=new Plugin(pkg.name,fileURLToPath(new URL('..',import.meta.url)),pkg);
  await plugin.load();await plugin.initialize(api);
  assert.deepEqual(calls,['HttpAdvancedAccessory','HttpAdvanced']);
});
test('platform JSON schema accepts every sanitized legacy device and recursive actions',()=>{
  const Ajv=require('ajv');
  const schema=JSON.parse(readFileSync(new URL('../config.schema.json',import.meta.url),'utf8'));
  const devices=JSON.parse(readFileSync(new URL('./fixtures/fleet.json',import.meta.url),'utf8'));
  assert.equal(schema.pluginAlias, 'HttpAdvancedAccessory');
  assert.equal(schema.pluginType, 'accessory');
  assert.equal(schema.customUi, true);
  const ajv=new Ajv({formats:{password:()=>true}});
  const legacyValidator=ajv.compile(schema.schema);
  for (const device of devices) assert.equal(legacyValidator(device),true,JSON.stringify(legacyValidator.errors));
  const validator=ajv.compile({definitions:schema.schema.definitions,$ref:'#/definitions/platform'});
  assert.equal(validator({name:'Fixture',platform:'HttpAdvanced',devices}),true,JSON.stringify(validator.errors));
  devices[0].urls.getOn.inconclusive={url:'http://example.invalid',mappers:[{type:'eval',parameters:{expression:'value'}}]};
  devices[0].urls.getOn.responsePattern='^(?:ON|OFF)$';
  devices[0].urls.getOn.requireResponseMatch=true;
  assert.equal(validator({name:'Fixture',platform:'HttpAdvanced',devices}),true,JSON.stringify(validator.errors));
});

test('response patterns validate before startup, including fallback actions', () => {
  const device = {name:'Fixed protocol',service:'Switch',urls:{getOn:{url:'http://example.invalid',responsePattern:'^(?:ON|OFF)$'}}};
  validateDevice(device);
  for (const responsePattern of ['[', 7, null]) {
    device.urls.getOn.inconclusive = {url:'http://example.invalid/fallback',responsePattern};
    assert.throws(() => validateDevice(device), {category:'config'});
  }
  device.urls.getOn.inconclusive = {url:'http://example.invalid/fallback',requireResponseMatch:'yes'};
  assert.throws(() => validateDevice(device), {category:'config'});
});

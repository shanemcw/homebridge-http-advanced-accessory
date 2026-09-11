import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {makeAPI} from './helpers.mjs';
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
  const validator=new Ajv({formats:{password:()=>true}}).compile(schema.schema);
  assert.equal(validator({name:'Fixture',platform:'HttpAdvanced',devices}),true,JSON.stringify(validator.errors));
  devices[0].urls.getOn.inconclusive={url:'http://example.invalid',mappers:[{type:'eval',parameters:{expression:'value'}}]};
  assert.equal(validator({name:'Fixture',platform:'HttpAdvanced',devices}),true,JSON.stringify(validator.errors));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { ConfigEditor, mergeSettings, selectSettings } from '../dist/ui-config.js';
const fleet = JSON.parse(readFileSync(new URL('./fixtures/fleet.json', import.meta.url), 'utf8'));
const platform = { platform:'HttpAdvanced',name:'Optional',devices:[],enabled:false };
const setup = t => {
  const root=mkdtempSync(join(tmpdir(),'http-advanced-ui-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const path=join(root,'config.json');
  const config={bridge:{name:'Fixture',username:'00:00:00:00:00:01',pin:'000-00-000'},accessories:[{accessory:'Other',name:'before'},...structuredClone(fleet),{accessory:'Other',name:'after'}],platforms:[{platform:'Other',name:'Keep'},platform],unrelated:{keep:true}};
  config.accessories[1].urls.getOn.url='http://example.invalid/?command=%24home%7B%22Lamp%22%7D%3D1%3B&literal=%2520';
  config.accessories[1].urls.setOn={url:'http://example.invalid',httpMethod:'PUSH',body:'${value}%2B{value}',mappers:[{type:'eval',parameters:{expression:'value ? "x%20y" : "x+y"'}}]};
  config.accessories[1].custom={nested:['unknown',1,false]};
  config.accessories[1]._bridge={username:'00:00:00:00:00:02',port:43210};
  config.accessories[2].accessory='homebridge-http-advanced-accessory.HttpAdvancedAccessory';
  writeFileSync(path,JSON.stringify(config,null,4)+'\n',{mode:0o600});
  return {root,path,config,editor:new ConfigEditor(path)};
};

test('44 legacy devices, encoded strings, arbitrary fields and bridge identity round-trip alongside a platform',t=>{
  const {editor,path,config,root}=setup(t);const loaded=editor.load();
  assert.equal(loaded.draft.accessories.length,44);
  const before=readFileSync(path,'utf8');
  assert.equal(editor.save(loaded).changed,false);assert.equal(readFileSync(path,'utf8'),before);
  loaded.draft.settings={requestTimeout:45000,recovery:{quietPeriod:120}};
  loaded.draft.platforms[0].enabled=true;
  const result=editor.save(loaded);assert.equal(result.changed,true);
  const after=JSON.parse(readFileSync(path,'utf8'));
  assert.deepEqual(after.accessories,config.accessories);assert.deepEqual(after.bridge,config.bridge);
  assert.deepEqual(after.platforms[0],config.platforms[0]);assert.deepEqual(after.unrelated,config.unrelated);
  assert.equal(after.platforms[1].enabled,true);
  const backup=readdirSync(root).find(n=>n.includes('backup-'));
  assert.equal(readFileSync(join(root,backup),'utf8'),before);assert.equal(statSync(join(root,backup)).mode&0o777,0o600);
  assert.equal(statSync(path).mode&0o777,0o600);
});

test('stale plugin edits are refused; unrelated edits since opening are preserved',t=>{
  const {editor,path,config}=setup(t);const loaded=editor.load();
  config.unrelated.changed='new value';writeFileSync(path,JSON.stringify(config));
  loaded.draft.settings={requestTimeout:35000};editor.save(loaded);
  assert.equal(JSON.parse(readFileSync(path,'utf8')).unrelated.changed,'new value');
  const before=readFileSync(path,'utf8');assert.throws(()=>editor.save(loaded),/another editor/);assert.equal(readFileSync(path,'utf8'),before);
});

test('save rejects malformed arrays, wrong aliases, duplicates and invalid settings without touching disk',t=>{
  const {editor,path}=setup(t);const loaded=editor.load();const before=readFileSync(path,'utf8');
  for(const modify of [
    d=>{d.accessories={};},d=>{d.accessories[0].accessory='AnotherPlugin';},d=>{d.platforms[0].platform='AnotherPlugin';},
    d=>{d.accessories.push(d.accessories[0]);},d=>{d.platforms.push(d.platforms[0]);},
    d=>{d.settings={requestTimeout:-1};},d=>{d.settings={recovery:{retryInterval:60,maxRetryInterval:5}};},
    d=>{d.platforms[0].devices=[fleet[0],fleet[0]];},d=>{d.platforms[0].enabled='false';},
  ]){
    const input=structuredClone(loaded);modify(input.draft);assert.throws(()=>editor.save(input));assert.equal(readFileSync(path,'utf8'),before);
  }
  assert.throws(()=>editor.save({draft:loaded.draft}));
});

test('bounded merge supports adding and removing legacy entries without altering unrelated ordering or aliases',()=>{
  const config={accessories:[{accessory:'Other',name:'first'},fleet[0],{accessory:'Other',name:'middle'},fleet[1],{accessory:'Other',name:'last'}]};
  const draft=selectSettings(config);draft.accessories=[fleet[2]];
  const merged=mergeSettings(config,draft);
  assert.deepEqual(merged.accessories,[config.accessories[0],fleet[2],config.accessories[2],config.accessories[4]]);
  assert.equal(merged.platforms,undefined);assert.equal(merged.httpAdvanced,undefined);
});

test('validation identifies the field or indexed platform without echoing configuration values', t => {
  const {editor, path} = setup(t);
  const loaded = editor.load(); const before = readFileSync(path, 'utf8');
  const input = structuredClone(loaded);
  input.draft.settings = {requestTimeout: 'private-value'};
  assert.throws(() => editor.save(input), error => /requestTimeout/.test(error.message) && !error.message.includes('private-value'));
  input.draft.settings = {coordinator: {concurrency: 1.5}};
  assert.throws(() => editor.save(input), /coordinator.concurrency.*whole/);
  input.draft.settings = {recovery: {retryInterval: 60}};
  assert.throws(() => editor.save(input), /recovery.maxRetryInterval.*recovery.retryInterval/);
  input.draft.settings = {};
  input.draft.platforms[0].devices = [{name: 'private-name', service: 'Switch', urls: {getOn: {url: 'private-url'}}}];
  assert.throws(() => editor.save(input), error => /Platform 1, device 1/.test(error.message) && !/private-/.test(error.message));
  assert.equal(readFileSync(path, 'utf8'), before);
  const config = JSON.parse(before); config.httpAdvanced = {recovery: {retryInterval: 60}};
  writeFileSync(path, JSON.stringify(config));
  assert.throws(() => editor.load(), /recovery.maxRetryInterval.*full configuration editor/);
});

test('missing/corrupt config fails closed and a symlink keeps its target',t=>{
  const {editor,path,root}=setup(t);const alias=join(root,'config-link.json');symlinkSync(path,alias);
  const linked=new ConfigEditor(alias);const loaded=linked.load();loaded.draft.settings={requestTimeout:30000};linked.save(loaded);
  assert.deepEqual(editor.load().draft.settings,{requestTimeout:30000});
  writeFileSync(path,'not JSON');assert.throws(()=>editor.load(),/Could not read/);assert.throws(()=>editor.save(loaded));assert.equal(readFileSync(path,'utf8'),'not JSON');
  assert.throws(()=>new ConfigEditor(join(root,'missing')).load());
});

test('an active editor lock prevents writes and a dead editor lock is reclaimed',t=>{
  const {editor,path}=setup(t);const loaded=editor.load();loaded.draft.settings={requestTimeout:35000};
  const before=readFileSync(path,'utf8');
  writeFileSync(path+'.http-advanced.lock',JSON.stringify({pid:process.pid}));
  assert.throws(()=>editor.save(loaded),/lock could not be acquired/);assert.equal(readFileSync(path,'utf8'),before);
  writeFileSync(path+'.http-advanced.lock',JSON.stringify({pid:2147483647}));
  assert.equal(editor.save(loaded).changed,true);
});

test('official Homebridge custom UI IPC server loads and saves both config types',async t=>{
  const {path}=setup(t);
  const child=fork(new URL('../homebridge-ui/server.js',import.meta.url),[],{env:{...process.env,HOMEBRIDGE_CONFIG_PATH:path},stdio:['ignore','pipe','pipe','ipc']});
  t.after(()=>child.kill());
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const [ready]=await once(child,'message');assert.equal(ready.action,'ready');
  const request=async (route,body)=>{child.send({action:'request',path:route,requestId:'test',body});const [response]=await once(child,'message');assert.equal(response.payload.success,true);return response.payload.data;};
  const loaded=await request('/settings/load');assert.equal(loaded.draft.accessories.length,44);
  loaded.draft.settings={requestTimeout:31000};loaded.draft.platforms[0].enabled=true;
  const saved=await request('/settings/save',loaded);assert.equal(saved.changed,true);
  assert.equal(saved.draft.platforms[0].enabled,true);assert.equal(saved.draft.accessories.length,44);
  assert.ok(!output.includes('%24home'));assert.ok(!output.includes('000-00-000'));
});

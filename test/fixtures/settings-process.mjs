// exercise the same Homebridge User storage path used by child bridges in separate OS processes
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sharedRuntime} from '../../dist/runtime.js';
import {LegacyAccessory} from '../../dist/accessory.js';
import {HTTPPlatform} from '../../dist/platform.js';
import {silentLog} from '../helpers.mjs';
const require=createRequire(import.meta.url);
const root=dirname(require.resolve(process.env.HB_TEST_VERSION==='1'?'homebridge-v1':'homebridge'));
const {User}=await import(pathToFileURL(join(root,'user.js')).href);
const {HomebridgeAPI}=await import(pathToFileURL(join(root,'api.js')).href);
User.setStoragePath(process.argv[2]);
const api=new HomebridgeAPI();
new LegacyAccessory(silentLog,{accessory:'HttpAdvancedAccessory',name:'Isolated legacy',service:'Switch',urls:{}},api);
if(process.argv[3]==='override')new HTTPPlatform(silentLog,{platform:'HttpAdvanced',name:'Isolated platform',devices:[],coordinator:{concurrency:1}},api).discover();
const runtime=sharedRuntime(api,silentLog);
process.send({settings:runtime.settings,limits:runtime.coordinator.limits,configPath:api.user.configPath(),pid:process.pid});
api.emit('shutdown');process.disconnect();

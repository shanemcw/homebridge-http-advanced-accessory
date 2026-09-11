import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const mappers=require('legacy-plugin/mappers.js');
export function loadLegacy(hap, request = (_options, callback) => callback(null, {statusCode: 200}, '1')) {
  let Accessory;
  const context = { module: {exports: {}}, require: name => name === 'request' ? request : name === './mappers.js' ? mappers : require('legacy-plugin/node_modules/' + name), setTimeout, clearTimeout, Buffer, console };
  // polling-to-event may be hoisted by npm
  context.require = name => name === 'request' ? request : name === './mappers.js' ? mappers : createRequire(require.resolve('legacy-plugin'))(name);
  vm.runInNewContext(readFileSync(require.resolve('legacy-plugin'), 'utf8'), context);
  context.module.exports({hap, registerAccessory: (_package, _alias, cls) => { Accessory = cls; }});
  return Accessory;
}

import {loadLegacy} from './legacy-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const mappers = require('legacy-plugin/mappers.js');

test('published 1.3.0 establishes legacy mapper truthiness and expression contract', () => {
  const mapping = new mappers.StaticMapper({mapping: {zero: 0, false: false, empty: '', off: '0'}});
  assert.equal(mapping.map('zero'), 'zero');
  assert.equal(mapping.map('false'), 'false');
  assert.equal(mapping.map('empty'), 'empty');
  assert.equal(mapping.map('off'), '0');
  assert.equal(new mappers.RegexMapper({regexp: '(armed)', capture: 1}).map('armed'), 'armed');
  assert.equal(new mappers.XPathMapper({xpath: '//a/text()', index: 1}).map('<r><a>1</a><a>2</a></r>'), '2');
  assert.equal(new mappers.JPathMapper({jpath: '$.a'}).map('{"a":{"x":1}}'), '{"x":1}');
  assert.equal(new mappers.JPathMapper({jpath: '$.a'}).map('broken'), 'inconclusive');
  const evaluator = new mappers.EvalMapper({expression: 'value + self.state.getOn'});
  evaluator.state = {getOn: 2};
  assert.equal(evaluator.map(1), 3);
});

test('published 1.3.0 sends auth immediately and maps non-2xx response bodies', async () => {
  const {hap} = new (require('homebridge-v1/lib/api.js').HomebridgeAPI)();
  const requests = [];
  const Legacy = loadLegacy(hap, (options, callback) => {requests.push(options); callback(null, {statusCode: 503}, '1');});
  const accessory = new Legacy(() => {}, {name: 'Baseline', service:'Switch', manufacturer:'Ignored', immediately:false, username:'fixture', password:'fixture', urls: {getOn:{url:'http://example.invalid'}}});
  const services = accessory.getServices();
  const c = services[1].getCharacteristic(hap.Characteristic.On);
  const value = await new Promise((resolve,reject) => c.emit('get',(e,v) => e ? reject(e) : resolve(v)));
  assert.equal(value, '1');
  assert.equal(requests[0].method, 'GET');
  assert.match(requests[0].headers.Authorization, /^Basic /);
  assert.equal(services[0].getCharacteristic(hap.Characteristic.Manufacturer).value, 'Custom Manufacturer');
});

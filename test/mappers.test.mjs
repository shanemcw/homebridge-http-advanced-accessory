import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mapResponse, mapValue} from '../dist/mappers.js';
import {interpolateLegacy} from '../dist/compatibility.js';
const require = createRequire(import.meta.url);
const legacy = require('legacy-plugin/mappers.js');
const cases = [
  ['static', 'StaticMapper', {mapping: {on: '1', off: '0', zero: 0, no: false, empty: ''}}, ['on', 'off', 'zero', 'no', 'empty', 'missing']],
  ['regex', 'RegexMapper', {regexp: 'state=(\\w+)', capture: '1'}, ['state=armed', 'nothing']],
  ['xpath', 'XPathMapper', {xpath: '//a/text()', index: 1}, ['<r><a>armed</a><a>off</a></r>']],
  ['xpath', 'XPathMapper', {xpath: 'string(//a/@state)'}, ['<r><a state="on"/></r>']],
  ['jpath', 'JPathMapper', {jpath: '$.values[*]', index: 1}, ['{"values":[1,0,3]}', 'bad', '1', '"string"']],
  ['jpath', 'JPathMapper', {jpath: '$.x'}, ['{"x":{"v":1}}', '{"x":[0,false]}', '{}', 'null']],
  ['jpath', 'JPathMapper', {jpath: '$.x[?(@.v>1)].v'}, ['{"x":[{"v":1},{"v":3}]}']],
  ['eval', 'EvalMapper', {expression: 'value < 30 ? 0 : Math.round((value - 30) * 100 / 69)'}, [10,50,99]],
  ['eval', 'EvalMapper', {expression: 'value + self.state.getOn'}, [1,2]],
];
for (const [type, className, parameters, inputs] of cases) test(`legacy equivalence ${type} ${JSON.stringify(parameters)}`, () => {
  const old = new legacy[className](parameters); old.state = {getOn: 3};
  for (const value of inputs) {
    assert.deepEqual(mapValue([{type,parameters}], value, old.state), old.map(value));
    assert.deepEqual(mapResponse([{type,parameters}], value, old.state), old.map(value));
  }
});
test('ordered mapper pipeline and valid falsey values', () => {
  assert.equal(mapValue([{type:'jpath',parameters:{jpath:'$.u'}},{type:'static',parameters:{mapping:{false:'0'}}}], '{"u":false}'), '0');
  assert.equal(mapValue([{type:'eval',parameters:{expression:'false'}}], 'anything'), false);
});
test('legacy URL and body expressions distinguish raw value from mapped value', () => {
  assert.equal(interpolateLegacy('http://example/${value}?t=${state.getTargetTemperature*9/5+32}&v={value}', 1, 'on', {getTargetTemperature:20}), 'http://example/1?t=68&v=on');
  assert.equal(interpolateLegacy('{"v":"{VALUE}","temp":${state.getTargetTemperature}}', 1, 'on', {getTargetTemperature:20}), '{"v":"on","temp":20}');
});
test('malformed expressions, regex, XML and paths are contained without raw content', () => {
  for (const m of [
    {type:'regex',parameters:{regexp:'['}},
    {type:'xpath',parameters:{xpath:'//a/text()'}},
    {type:'eval',parameters:{expression:'throw new Error("secret")'}},
  ]) assert.throws(() => mapValue([m], '<a>secret'), {message:'HTTP Advanced mapper failure'});
});

test('opt-in response extraction checks are inconclusive while default and outbound pass-through are unchanged', () => {
  const cases = [
    [{type:'regex',parameters:{regexp:'state=(on|off)'}}, '<html>Temporarily unavailable</html>'],
    [{type:'jpath',parameters:{jpath:'$.state'}}, '{}'],
    [{type:'jpath',parameters:{jpath:'$.state'}}, 'null'],
    [{type:'jpath',parameters:{jpath:'$.values[*]',index:5}}, '{"values":[1]}'],
    [{type:'xpath',parameters:{xpath:'//state/text()'}}, '<html>Unavailable</html>'],
    [{type:'xpath',parameters:{xpath:'//state/text()'}}, 'Controller response timeout'],
  ];
  for (const [mapper, body] of cases) assert.equal(mapResponse([mapper], body, {}, true), 'inconclusive');
  assert.equal(mapValue([cases[0][0]], cases[0][1]), cases[0][1]);
  assert.equal(mapValue([cases[1][0]], '{}'), '[]');
  assert.equal(mapResponse([cases[0][0]], cases[0][1]), cases[0][1]);
  assert.equal(mapResponse([cases[1][0]], '{}'), '[]');
});

test('later explicit mappings may handle failed extraction and valid falsey selections remain usable', () => {
  const jpath = {type:'jpath',parameters:{jpath:'$.state'}};
  assert.equal(mapResponse([jpath, {type:'static',parameters:{mapping:{'[]':'0'}}}], '{}', {}, true), '0');
  assert.equal(mapResponse([jpath, {type:'static',parameters:{mapping:{inconclusive:'0'}}}], 'old error page'), '0');
  assert.equal(mapResponse([{type:'regex',parameters:{regexp:'state=(on|off)'}}, {type:'static',parameters:{mapping:{offline:'0'}}}], 'offline', {}, true), '0');
  assert.equal(mapResponse([jpath, {type:'eval',parameters:{expression:'value === "[]" ? false : value'}}], '{}', {}, true), false);
  for (const value of [false, 0, '']) assert.equal(mapResponse([jpath], JSON.stringify({state:value})), value);
  assert.equal(mapResponse([{type:'static',parameters:{mapping:{offline:'0'}}}], '42'), '42', 'intentional static pass-through remains available');
  assert.throws(() => mapResponse([{type:'xpath',parameters:{xpath:'['}}], '<state>1</state>'), {category:'mapper'});
});

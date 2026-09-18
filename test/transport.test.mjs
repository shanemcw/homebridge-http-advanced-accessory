import test from 'node:test';
import assert from 'node:assert/strict';
import {Coordinator} from '../dist/coordinator.js';
import {Transport} from '../dist/transport.js';
import {Actions} from '../dist/actions.js';
import {fakeServer, sleep} from './helpers.mjs';

function harness(t, options) {
  const coordinator = new Coordinator(options); const transport = new Transport(coordinator);
  t.after(() => transport.shutdown()); return {coordinator, transport, actions: new Actions(transport)};
}
test('GET defaults, POST and GET bodies, preemptive Basic Auth, no empty auth, connection reuse', async t => {
  const server = await fakeServer(t); const {transport} = harness(t);
  await transport.request({url:server.url}, {}, 'a');
  await transport.request({url:server.url,httpMethod:'POST',body:'a=on'}, {username:'test',password:'test',immediately:false}, 'a');
  await transport.request({url:server.url,body:'get-body'}, {}, 'a');
  assert.equal(server.requests[0].headers.authorization, undefined);
  assert.equal(server.requests[1].body,'a=on'); assert.equal(server.requests[1].headers.authorization,'Basic dGVzdDp0ZXN0');
  assert.equal(server.requests[2].body,'get-body'); assert.equal(server.requests[2].method,'GET');
  assert.equal(new Set(server.requests.map(r=>r.port)).size,1);
});
test('non-2xx bodies keep legacy mapping; strictHTTP and resultOnError are explicit', async t => {
  const server = await fakeServer(t, (_req,res)=>{res.statusCode=503;res.end('offline');});
  const {actions} = harness(t);
  const action = {url:server.url,mappers:[{type:'static',parameters:{mapping:{offline:'0'}}}]};
  assert.equal(await actions.get(action, {}, 'a', {}),'0');
  await assert.rejects(actions.get({...action,strictHTTP:true}, {},'a',{}), {category:'unavailable'});
  assert.equal(await actions.get({...action,strictHTTP:true,resultOnError:false}, {},'a',{}), false);
});
test('total timeout and shutdown abort body reads; connection refusal is categorized', async t => {
  const server = await fakeServer(t, (_req,res)=>{res.writeHead(200);res.write('part');});
  const {transport} = harness(t);
  await assert.rejects(transport.request({url:server.url,timeout:30},{},'a'),{category:'timeout'});
  const work = transport.request({url:server.url},{},'a'); await sleep(10); transport.shutdown();
  await assert.rejects(work,{category:'aborted'});
  const other = harness(t);
  // reserve then close a port so no household endpoint is contacted
  const closed = await fakeServer(); await closed.close();
  await assert.rejects(other.transport.request({url:closed.url},{},'a'),{category:'network'});
});
test('nested inconclusive actions and resultOnError bypass mappers as in stable', async t => {
  const server = await fakeServer(t,(req,res)=>res.end(req.url==='/last'?'7':'bad JSON'));
  const {actions} = harness(t);
  const action = {url:server.url,mappers:[{type:'jpath',parameters:{jpath:'$.u'}}],inconclusive:{url:server.url+'/last'}};
  assert.equal(await actions.get(action,{},'a',{}),'7');
  action.inconclusive=action;
  await assert.rejects(actions.get(action,{},'a',{}),{category:'inconclusive'});
});
test('SET maps outgoing values and expands state templates', async t => {
  const server = await fakeServer(t); const {actions} = harness(t);
  await actions.set({url:server.url+'/${value}/{value}',httpMethod:'POST',body:'t=${state.getTargetTemperature}&v={value}',mappers:[{type:'static',parameters:{mapping:{true:'on'}}}]},{},'a',{getTargetTemperature:20},true);
  assert.equal(server.requests[0].url,'/true/on'); assert.equal(server.requests[0].body,'t=20&v=on');
});
test('queue bounds, per-origin concurrency and fairness', async t => {
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const server = await fakeServer(t, async (_req,res)=>{await gate;res.end('1');});
  const fast = await fakeServer(t);
  const {coordinator,transport} = harness(t,{concurrency:3,perOrigin:1,maxQueue:3});
  const jobs = [0,1,2].map(i=>transport.request({url:server.url+'/same'},{uriCallsDelay:50},'same'));
  const quick = transport.request({url:fast.url},{},'other');
  await quick; assert.equal(server.requests.length,1);
  const queued = transport.request({url:server.url},{},'last');
  const excess = transport.request({url:server.url},{},'overflow');
  await assert.rejects(excess,{category:'queue'});
  release();
  await Promise.all([...jobs,queued]);
  assert.equal(server.maxActive,1);
  assert.ok(coordinator.stats.highWater<=3);
});

test('uriCallsDelay spaces actual request starts independently of response arrival timing',async t=>{
  const coordinator=new Coordinator({concurrency:4,perOrigin:4});t.after(()=>coordinator.shutdown());
  const starts=[];const guard=setTimeout(()=>{},2000);
  try {
    await Promise.all([0,1,2].map(()=>coordinator.submit('http://example.invalid','device',50,false,async()=>{starts.push(Date.now());})));
    assert.ok(starts[1]-starts[0]>=50);assert.ok(starts[2]-starts[1]>=50);
  }finally{clearTimeout(guard);}
});

test('cross-origin GET redirects release queue slots and strip credentials',async t=>{
  const target=await fakeServer(t);
  const source=await fakeServer(t,(_req,res)=>{res.statusCode=302;res.setHeader('Location',target.url);res.end();});
  const {transport}=harness(t,{concurrency:1,perOrigin:1});
  assert.equal((await transport.request({url:source.url},{username:'fixture',password:'fixture'},'a')).body,'1');
  assert.equal(target.requests[0].headers.authorization,undefined);
});

test('background timeout starts at admission, while writes retain their total queue deadline', async t => {
  const {coordinator, transport} = harness(t, {concurrency: 1});
  const server = await fakeServer(t);
  let release;
  const blocker = coordinator.submit(new URL(server.url).origin, 'blocker', 0, false, () => new Promise(resolve => {release = resolve;}));
  await sleep(5);
  const read = transport.request({url: server.url, timeout: 30}, {}, 'reader');
  const write = transport.request({url: server.url, timeout: 30}, {}, 'writer', true);
  let settled = false;
  const writeFailure = assert.rejects(write, {category: 'timeout'}).then(() => {settled = true;});
  await sleep(70);
  const settledWhileBlocked = settled;
  release(); await blocker;
  await writeFailure;
  assert.equal((await read).body, '1');
  assert.equal(server.requests.length, 1);
  assert.equal(settledWhileBlocked, true, 'a queued write must time out before the occupied slot is released');
  assert.equal(transport.stats.timeouts, 1);
});

test('Retry-After accepts seconds and dates, bounds delays, and never maps an unavailable response as state', async t => {
  let retryAfter = '45';
  const server = await fakeServer(t, (_req, res) => {res.writeHead(503, {'Retry-After': retryAfter}); res.end('busy');});
  const {transport} = harness(t);
  await assert.rejects(transport.request({url: server.url}, {}, 'a'), {category: 'unavailable', retryAfter: 45000});
  retryAfter = new Date(Date.now() + 60000).toUTCString();
  await assert.rejects(transport.request({url: server.url}, {}, 'a'), error => error.category === 'unavailable' && error.retryAfter > 58000 && error.retryAfter <= 60000);
  retryAfter = '999999';
  await assert.rejects(transport.request({url: server.url}, {}, 'a'), {category: 'unavailable', retryAfter: 300000});
});

test('strict HTTP recovery works without retry headers while intentional legacy error-body mappings remain usable', async t => {
  let status = 500;
  const server = await fakeServer(t, (_req, res) => {res.statusCode=status;res.end('offline');});
  const {actions} = harness(t);
  for (status of [408, 429, 500, 502, 503, 504]) {
    const action = {url:server.url,mappers:[{type:'static',parameters:{mapping:{offline:'0'}}}]};
    assert.equal(await actions.get(action, {}, 'read', {}), '0');
    await assert.rejects(actions.get({...action,strictHTTP:true}, {}, 'read', {}), {category:'unavailable'});
  }
  for (status of [401, 403, 404]) await assert.rejects(actions.get({url:server.url,strictHTTP:true}, {}, 'read', {}), {category:'http'});
});

test('optional response patterns reject HTTP 200 error text on writes without replaying the command', async t => {
  let reply = 'OK\r\n';
  const server = await fakeServer(t, (_req, res) => res.end(reply));
  const {actions} = harness(t);
  const action = {url:server.url, httpMethod:'POST', body:'set={value}', responsePattern:'^OK\\s*$'};
  await actions.set(action, {}, 'writer', {}, true);
  reply = 'Device is busy';
  await assert.rejects(actions.set(action, {}, 'writer', {}, false), {category:'inconclusive'});
  assert.equal(server.requests.length, 2);
  assert.equal(server.requests[1].body, 'set=false');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateRelease} from '../scripts/release-guard.mjs';
import {pluginVersion} from '../dist/metadata.js';
import {Runtime} from '../dist/runtime.js';
import {silentLog} from './helpers.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
test('prerelease guard matches alpha and beta versions to their tag, never latest', () => {
  for (const channel of ['alpha', 'beta']) {
    const candidate = {...pkg, version: `2.0.0-${channel}.1`};
    assert.doesNotThrow(() => validateRelease(candidate, channel));
    for (const tag of [undefined, 'latest', channel === 'alpha' ? 'beta' : 'alpha']) assert.throws(() => validateRelease(candidate, tag));
  }
  for (const version of ['2.0.0', '2.0.0-rc.1', '2.0.0-beta.1extra']) assert.throws(() => validateRelease({...pkg, version}, 'beta'));
  assert.throws(() => validateRelease({...pkg, name: 'another-plugin'}, 'alpha'));
  const run = tag => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/release-guard.mjs', import.meta.url))], {env: {...process.env, npm_config_tag: tag}, encoding: 'utf8'});
  assert.equal(run('alpha').status, 0);
  assert.notEqual(run('latest').status, 0);
});

test('runtime startup identifies the actual package version', t => {
  const messages = [];
  const runtime = new Runtime({...silentLog, info: message => messages.push(message)});
  t.after(() => runtime.shutdown());
  runtime.start();
  assert.equal(pluginVersion, pkg.version);
  assert.ok(messages[0].startsWith(`HTTP Advanced ${pkg.version}:`));
});

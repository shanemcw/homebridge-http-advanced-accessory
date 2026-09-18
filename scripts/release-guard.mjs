import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const pkg = JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
export function validateRelease(pkg, tag) {
  const channel = /^2\.0\.0-(alpha|beta)\.\d+$/.exec(pkg.version)?.[1];
  if (pkg.name !== 'homebridge-http-advanced-accessory' || !channel || tag !== channel) {
    throw new Error('Prerelease publishing requires the verified package name and an explicit --tag matching its alpha or beta version');
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) validateRelease(pkg, process.env.npm_config_tag);

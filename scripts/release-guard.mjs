import {readFileSync} from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const alphaVersion = /^\d+\.\d+\.\d+-alpha(?:\.\d+)?$/.test(pkg.version);
if (pkg.name !== 'homebridge-http-advanced-accessory' || !alphaVersion || process.env.npm_config_tag !== 'alpha') {
  throw new Error('Alpha publishing requires the verified package name, alpha prerelease version and explicit --tag alpha');
}

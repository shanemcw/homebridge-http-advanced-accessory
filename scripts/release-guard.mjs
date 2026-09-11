import {readFileSync} from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
if (pkg.name !== 'homebridge-http-advanced-accessory' || !/^2\.0\.0-alpha\.\d+$/.test(pkg.version) || process.env.npm_config_tag !== 'alpha') {
  throw new Error('Alpha publishing requires the verified package name, alpha version and explicit --tag alpha');
}

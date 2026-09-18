import { createRequire } from 'node:module';

export const pluginVersion: string = createRequire(import.meta.url)('../package.json').version;

export const pluginName = 'homebridge-http-advanced-accessory';
export const accessoryName = 'HttpAdvancedAccessory';
export const platformName = 'HttpAdvanced';

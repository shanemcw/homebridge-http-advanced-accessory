import type { API } from 'homebridge';
import { LegacyAccessory } from './accessory.js';
import { HTTPPlatform } from './platform.js';
import { accessoryName, platformName, pluginName } from './metadata.js';

export default function initialize(api: API): void {
  api.registerAccessory(pluginName, accessoryName, LegacyAccessory);
  api.registerPlatform(pluginName, platformName, HTTPPlatform);
}

import type { API } from 'homebridge';
import { LegacyAccessory } from './accessory.js';
import { HTTPPlatform, platformName, pluginName } from './platform.js';

export default function initialize(api: API): void {
  api.registerAccessory(pluginName, 'HttpAdvancedAccessory', LegacyAccessory);
  api.registerPlatform(pluginName, platformName, HTTPPlatform);
}

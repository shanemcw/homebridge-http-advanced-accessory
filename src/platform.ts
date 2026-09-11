import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import { DeviceAdapter, serviceConstructor } from './accessory.js';
import { validateDevice } from './config.js';
import { sharedRuntime } from './runtime.js';
import type { CoordinatorConfig, DeviceConfig } from './types.js';

export const pluginName = 'homebridge-http-advanced-accessory';
export const platformName = 'HttpAdvanced';
export interface HTTPPlatformConfig extends PlatformConfig { devices?: DeviceConfig[]; coordinator?: CoordinatorConfig }

export class HTTPPlatform implements DynamicPlatformPlugin {
  private readonly cached = new Map<string, PlatformAccessory>();
  constructor(readonly log: Logging, readonly config: HTTPPlatformConfig, readonly api: API) {
    api.on('didFinishLaunching', () => this.discover());
  }

  configureAccessory(accessory: PlatformAccessory): void { this.cached.set(accessory.UUID, accessory); }

  discover(): void {
    // validate the whole inventory before reconciling so malformed configuration cannot remove devices
    const devices = this.config.devices;
    if (!Array.isArray(devices)) { this.log.error('HTTP Advanced platform requires a devices array'); return; }
    const desired = new Map<string, DeviceConfig>();
    try {
      for (const device of devices) {
        validateDevice(device); serviceConstructor(this.api, device.service);
        const id = device.id ?? device.name;
        if (typeof id !== 'string' || !id.trim()) throw new Error();
        const UUID = this.api.hap.uuid.generate(`${pluginName}:${this.config.name ?? platformName}:${id}`);
        if (desired.has(UUID)) throw new Error();
        desired.set(UUID, device);
      }
    } catch (error) {
      const unsupported = error instanceof Error && error.message.startsWith('HTTP Advanced unsupported HomeKit service:');
      this.log.error(unsupported ? `${error.message}; cached accessories retained` : 'HTTP Advanced platform inventory invalid or contains duplicate IDs; cached accessories retained');
      return;
    }
    const runtime = sharedRuntime(this.api, this.log);
    try { runtime.coordinator.configure(this.config.coordinator ?? {}); }
    catch { this.log.error('HTTP Advanced invalid coordinator limits; cached accessories retained'); return; }
    let failed = false;
    for (const [UUID, device] of desired) {
      try {
        const cached = this.cached.get(UUID);
        const accessory = cached ?? new this.api.platformAccessory(device.name, UUID);
        const Constructor = serviceConstructor(this.api, device.service);
        const existing = accessory.services.find(service => service.UUID === Constructor.UUID);
        const adapter = new DeviceAdapter(this.api, runtime, device, `platform:${UUID}`, existing);
        if (!existing) accessory.addService(adapter.service);
        // remove obsolete primary services only after the new definition was successfully attached
        for (const service of accessory.services.slice()) {
          if (service.UUID !== this.api.hap.Service.AccessoryInformation.UUID && service !== adapter.service) accessory.removeService(service);
        }
        accessory.displayName = device.name;
        accessory.getService(this.api.hap.Service.AccessoryInformation)!
          .setCharacteristic(this.api.hap.Characteristic.Name, device.name)
          .setCharacteristic(this.api.hap.Characteristic.Manufacturer, device.manufacturer ?? 'Custom Manufacturer')
          .setCharacteristic(this.api.hap.Characteristic.Model, device.model ?? 'HTTP Accessory Model')
          .setCharacteristic(this.api.hap.Characteristic.SerialNumber, device.id ?? 'HTTP Accessory Serial Number');
        // context stores no configuration, URLs, bodies, usernames or passwords
        accessory.context = { schemaVersion: 1 };
        if (cached) this.api.updatePlatformAccessories([accessory]);
        else this.api.registerPlatformAccessories(pluginName, platformName, [accessory]);
        this.cached.set(UUID, accessory);
      } catch { failed = true; this.log.error('HTTP Advanced device initialization failed; cached accessories retained'); }
    }
    if (!failed) {
      const removed = [...this.cached.values()].filter(a => !desired.has(a.UUID));
      if (removed.length) this.api.unregisterPlatformAccessories(pluginName, platformName, removed);
      for (const accessory of removed) this.cached.delete(accessory.UUID);
    }
    runtime.start();
  }
}

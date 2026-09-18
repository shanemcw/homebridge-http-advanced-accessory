import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import { DeviceAdapter, serviceConstructor } from './accessory.js';
import { validateDevice } from './config.js';
import { sharedRuntime } from './runtime.js';
import { validateSettings } from './settings.js';
import type { CoordinatorConfig, DeviceConfig } from './types.js';

import { pluginName, platformName } from './metadata.js';
export { pluginName, platformName } from './metadata.js';
export interface HTTPPlatformConfig extends PlatformConfig { enabled?: boolean; devices?: DeviceConfig[]; coordinator?: CoordinatorConfig }

export class HTTPPlatform implements DynamicPlatformPlugin {
  private readonly cached = new Map<string, PlatformAccessory>();
  constructor(readonly log: Logging, readonly config: HTTPPlatformConfig, readonly api: API) {
    api.on('didFinishLaunching', () => this.discover());
  }

  configureAccessory(accessory: PlatformAccessory): void { this.cached.set(accessory.UUID, accessory); }

  private unavailable(): void {
    const fail = () => { throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE); };
    for (const accessory of this.cached.values()) {
      for (const service of accessory.services) {
        if (service.UUID === this.api.hap.Service.AccessoryInformation.UUID) continue;
        for (const characteristic of service.characteristics) {
          if (characteristic.UUID === this.api.hap.Characteristic.Name.UUID) continue;
          if (characteristic.props.perms.includes(this.api.hap.Perms.PAIRED_READ)) characteristic.onGet(fail);
          if (characteristic.props.perms.includes(this.api.hap.Perms.PAIRED_WRITE)) characteristic.onSet(fail);
        }
      }
    }
  }

  discover(): void {
    // disabling a platform retains its configuration and cached HomeKit identities
    if (this.config.enabled === false) { this.unavailable(); return; }
    if (this.config.enabled !== undefined && typeof this.config.enabled !== 'boolean') {
      this.unavailable(); this.log.error('HTTP Advanced platform enabled must be true or false; cached accessories retained'); return;
    }
    // validate the whole inventory before reconciling so malformed configuration cannot remove devices
    const devices = this.config.devices;
    if (!Array.isArray(devices)) { this.unavailable(); this.log.error('HTTP Advanced platform requires a devices array'); return; }
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
      this.unavailable();
      const unsupported = error instanceof Error && error.message.startsWith('HTTP Advanced unsupported HomeKit service:');
      this.log.error(unsupported ? `${error.message}; cached accessories retained` : 'HTTP Advanced platform inventory invalid or contains duplicate IDs; cached accessories retained');
      return;
    }
    const runtime = sharedRuntime(this.api, this.log);
    try {
      if (this.config.coordinator !== undefined) validateSettings({ coordinator: this.config.coordinator });
      runtime.coordinator.configure(this.config.coordinator ?? {});
    }
    catch { this.unavailable(); this.log.error('HTTP Advanced invalid coordinator limits; cached accessories retained'); return; }
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

import type { API, AccessoryConfig, Characteristic, CharacteristicValue, Logging, Service } from 'homebridge';
import { validateDevice } from './config.js';
import { ActionError, type CacheEntry, type DeviceConfig, type State } from './types.js';
import { fingerprint, Runtime, sharedRuntime } from './runtime.js';

type ServiceConstructor = { new(name?: string): Service; UUID: string };
type CharacteristicConstructor = { new(): Characteristic; UUID: string };

export function serviceConstructor(api: API, name: string): ServiceConstructor {
  const alias = name === 'BatteryService' ? 'Battery' : name;
  const constructor = (api.hap.Service as unknown as Record<string, ServiceConstructor>)[alias];
  if (typeof constructor !== 'function' || !constructor.UUID) throw new Error(`HTTP Advanced unsupported HomeKit service: ${name}`);
  return constructor;
}

export function convertValue(characteristic: Characteristic, value: unknown): CharacteristicValue {
  const format = characteristic.props.format;
  let converted: CharacteristicValue;
  if (format === 'bool') {
    if (value === 'inconclusive' || !['boolean', 'number', 'string'].includes(typeof value)) throw new ActionError('mapper');
    converted = value === true || value === 1 || value === '1' || value === 'true';
  } else if (['int', 'uint8', 'uint16', 'uint32', 'uint64', 'float'].includes(format)) {
    if (value === null || value === undefined || typeof value === 'object') throw new ActionError('mapper');
    converted = typeof value === 'boolean' ? Number(value) : typeof value === 'number' ? value : format === 'float' ? parseFloat(String(value)) : parseInt(String(value), 10);
    if (!Number.isFinite(converted)) throw new ActionError('mapper');
  } else if (format === 'string' && (typeof value === 'string' || typeof value === 'number')) {
    converted = String(value);
  } else if (['data', 'tlv8'].includes(format) && typeof value === 'string') {
    converted = value;
  } else {
    throw new ActionError('mapper');
  }
  // let the supplied HAP implementation normalize bounds, minStep and valid values
  // on an unbound characteristic, so normalization cannot emit premature device events
  const Constructor = characteristic.constructor as new() => Characteristic;
  const normalizer = new Constructor();
  normalizer.setProps(characteristic.props);
  if (characteristic.value !== null) normalizer.updateValue(characteristic.value);
  normalizer.updateValue(converted);
  if (normalizer.value === null) throw new ActionError('mapper');
  return normalizer.value;
}

export class DeviceAdapter {
  readonly state: State = {};
  readonly entries = new Map<string, CacheEntry>();
  readonly service: Service;
  constructor(readonly api: API, readonly runtime: Runtime, readonly config: DeviceConfig, readonly identity: string, existing?: Service) {
    validateDevice(config);
    const Constructor = serviceConstructor(api, config.service);
    this.service = existing ?? new Constructor(config.name);
    this.service.displayName = config.name;
    const registry = api.hap.Characteristic as unknown as Record<string, CharacteristicConstructor>;
    const names = new Map<string, string>();
    for (const [name, value] of Object.entries(registry)) if (typeof value === 'function' && value.UUID) names.set(value.UUID, name);
    if (existing) {
      const required = new Constructor(config.name).characteristics.map(c => c.UUID);
      for (const characteristic of existing.characteristics.slice()) {
        const compact = characteristic.displayName.replace(/\s/g, '');
        const canonical = names.get(characteristic.UUID) ?? compact;
        if (!required.includes(characteristic.UUID) && !config.optionCharacteristic?.includes(compact) && !config.optionCharacteristic?.includes(canonical)) {
          existing.removeCharacteristic(characteristic);
        }
      }
    }
    // preserve the optional service ordering used by the legacy adapter, not config order
    for (const characteristic of this.service.optionalCharacteristics.slice()) {
      const compact = characteristic.displayName.replace(/\s/g, '');
      const canonical = names.get(characteristic.UUID) ?? compact;
      if (config.optionCharacteristic?.includes(compact) || config.optionCharacteristic?.includes(canonical)) {
        if (!this.service.characteristics.some(c => c.UUID === characteristic.UUID)) this.service.addCharacteristic(characteristic);
      }
    }
    for (const characteristic of this.service.characteristics) {
      const compact = characteristic.displayName.replace(/\s/g, '');
      const canonical = names.get(characteristic.UUID) ?? compact;
      const props = config.props?.[compact] ?? config.props?.[canonical];
      if (props) characteristic.setProps(props);
      const resolve = (prefix: string): string => config.urls?.[prefix + compact] ? prefix + compact : prefix + canonical;
      const getName = resolve('get');
      const setName = resolve('set');
      if (characteristic.UUID === api.hap.Characteristic.Name.UUID) {
        characteristic.updateValue(config.name).onGet(() => config.name);
        continue;
      }
      let entry: CacheEntry | undefined;
      if (config.urls?.[getName]) {
        entry = runtime.register(identity, getName, config, this.state, value => convertValue(characteristic, value), value => characteristic.updateValue(value));
        this.entries.set(getName, entry);
        const cached = entry;
        characteristic.onGet(() => {
          try { return runtime.read(cached); }
          catch { throw new api.hap.HapStatusError(api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE); }
        });
      }
      if (config.urls?.[setName]) {
        characteristic.onSet(async value => {
          const restore = () => { if (entry?.known && entry.value !== undefined) characteristic.updateValue(entry.value); };
          const work = async () => {
            try { await runtime.set(config, this.state, setName, value, entry); }
            catch { restore(); throw new api.hap.HapStatusError(api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE); }
          };
          if (config.setterDelay) runtime.debounce(fingerprint([identity, setName]), config.setterDelay, work, restore);
          else await work();
        });
      }
    }
  }
}

export class LegacyAccessory {
  readonly name: string;
  private readonly services: Service[];
  constructor(log: Logging, rawConfig: AccessoryConfig, api: API) {
    const config = rawConfig as unknown as DeviceConfig;
    this.name = config.name;
    const information = new api.hap.Service.AccessoryInformation()
      .setCharacteristic(api.hap.Characteristic.Manufacturer, 'Custom Manufacturer')
      .setCharacteristic(api.hap.Characteristic.Model, 'HTTP Accessory Model')
      .setCharacteristic(api.hap.Characteristic.SerialNumber, 'HTTP Accessory Serial Number');
    this.services = [information];
    try {
      const adapter = new DeviceAdapter(api, sharedRuntime(api, log), config, `legacy:${config.name}`);
      this.services.push(adapter.service);
    } catch (error) {
      const unsupported = error instanceof Error && error.message.startsWith('HTTP Advanced unsupported HomeKit service:');
      log.error(unsupported ? error.message : 'HTTP Advanced accessory configuration failed; check action and characteristic definitions');
    }
  }
  getServices(): Service[] { return this.services; }
  identify(callback?: (error?: Error | null) => void): void { callback?.(null); }
}

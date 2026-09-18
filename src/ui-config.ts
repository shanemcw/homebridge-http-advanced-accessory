import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fchmodSync, fchownSync, fstatSync, fsyncSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { validateDevice } from './config.js';
import { validateSettings, SettingsValidationError, type GlobalSettings } from './settings.js';
import type { DeviceConfig } from './types.js';

type Block = Record<string, unknown>;
export interface PluginSettings { accessories: Block[]; platforms: Block[]; settings: GlobalSettings }
import { pluginName, accessoryName, platformName } from './metadata.js';
const isObject = (value: unknown): value is Block => !!value && typeof value === 'object' && !Array.isArray(value);
const owns = (block: unknown, type: 'accessory' | 'platform'): boolean => {
  const alias = type === 'accessory' ? accessoryName : platformName;
  return isObject(block) && (block[type] === alias || block[type] === `${pluginName}.${alias}`);
};
export class SettingsError extends Error {}

function configObject(value: unknown): asserts value is Block {
  if (!isObject(value) || ['accessories', 'platforms'].some(key => value[key] !== undefined && !Array.isArray(value[key]))) {
    throw new SettingsError('Homebridge configuration is invalid; no changes saved');
  }
}

export function selectSettings(config: unknown): PluginSettings {
  configObject(config);
  const settings = config.httpAdvanced ?? {};
  validateSettings(settings);
  return { accessories: ((config.accessories ?? []) as Block[]).filter(b => owns(b, 'accessory')),
    platforms: ((config.platforms ?? []) as Block[]).filter(b => owns(b, 'platform')), settings };
}

export function validatePluginSettings(value: unknown): asserts value is PluginSettings {
  if (!isObject(value) || !Array.isArray(value.accessories) || !Array.isArray(value.platforms)) throw new SettingsError('Accessory and platform configuration must be arrays');
  let location = 'Shared settings';
  try {
    validateSettings(value.settings);
    const legacyNames = new Set<string>();
    for (const [index, block] of value.accessories.entries()) {
      location = `Legacy accessory ${index + 1} in JSON Config`;
      if (!owns(block, 'accessory')) throw new Error();
      validateDevice(block as DeviceConfig);
      if (legacyNames.has(block.name)) throw new Error();
      legacyNames.add(block.name);
    }
    const platformNames = new Set<string>();
    for (const [index, block] of value.platforms.entries()) {
      location = `Platform ${index + 1}`;
      if (!owns(block, 'platform') || typeof block.name !== 'string' || !block.name.trim() || !Array.isArray(block.devices)
        || (block.enabled !== undefined && typeof block.enabled !== 'boolean')) throw new Error();
      if (platformNames.has(block.name)) throw new Error();
      platformNames.add(block.name);
      if (block.coordinator !== undefined) validateSettings({ coordinator: block.coordinator });
      const ids = new Set<string>();
      for (const [deviceIndex, device] of block.devices.entries()) {
        location = `Platform ${index + 1}, device ${deviceIndex + 1}`;
        validateDevice(device);
        const id = device.id ?? device.name;
        if (typeof id !== 'string' || !id.trim() || ids.has(id)) throw new Error();
        ids.add(id);
      }
    }
  } catch (error) {
    const detail = error instanceof SettingsValidationError ? error.message.replace(/^Shared settings: /, '') : 'check names, aliases, device actions and timing values';
    throw new SettingsError(`${location}: ${detail}; no changes saved`);
  }
}

function replaceBlocks(current: unknown[], type: 'accessory' | 'platform', replacements: Block[]): unknown[] {
  let index = 0;
  const result = current.flatMap(block => !owns(block, type) ? [block] : index < replacements.length ? [replacements[index++]] : []);
  return result.concat(replacements.slice(index));
}

export function mergeSettings(config: unknown, draft: PluginSettings): Block {
  configObject(config); validatePluginSettings(draft);
  const result = { ...config };
  if (config.accessories !== undefined || draft.accessories.length) result.accessories = replaceBlocks((config.accessories ?? []) as unknown[], 'accessory', draft.accessories);
  if (config.platforms !== undefined || draft.platforms.length) result.platforms = replaceBlocks((config.platforms ?? []) as unknown[], 'platform', draft.platforms);
  if (config.httpAdvanced !== undefined || Object.keys(draft.settings).length) result.httpAdvanced = draft.settings;
  return result;
}

const revision = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function acquireLock(path: string): number {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const descriptor = openSync(path, 'wx', 0o600);
      try { writeFileSync(descriptor, JSON.stringify({ pid: process.pid })); }
      catch (error) { closeSync(descriptor); unlinkSync(path); throw error; }
      return descriptor;
    } catch {
      // reclaim only a lock whose recorded process no longer exists
      try {
        const before = statSync(path);
        const { pid } = JSON.parse(readFileSync(path, 'utf8')) as { pid: number };
        if (!Number.isSafeInteger(pid) || pid <= 0) break;
        try { process.kill(pid, 0); break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') break; }
        if (statSync(path).ino !== before.ino) break;
        unlinkSync(path);
      } catch { break; }
    }
  }
  throw new SettingsError('Another settings save is in progress or its lock could not be acquired; try again after it completes');
}

export class ConfigEditor {
  constructor(private readonly configPath: string) {}

  private read(): { path: string; raw: string; config: Block; draft: PluginSettings } {
    try {
      const path = realpathSync(this.configPath);
      const raw = readFileSync(path, 'utf8');
      const config: unknown = JSON.parse(raw);
      configObject(config);
      return { path, raw, config, draft: selectSettings(config) };
    } catch (error) {
      if (error instanceof SettingsValidationError) throw new SettingsError(`${error.message}; correct httpAdvanced in Homebridge's full configuration editor, then reopen Plugin Config`);
      throw new SettingsError('Could not read Homebridge configuration; no changes saved');
    }
  }

  load(): { draft: PluginSettings; revision: string } {
    const { draft } = this.read();
    return { draft, revision: revision(draft) };
  }

  save(input: unknown): { draft: PluginSettings; revision: string; changed: boolean } {
    if (!isObject(input) || typeof input.revision !== 'string') throw new SettingsError('Reload settings before saving');
    validatePluginSettings(input.draft);
    const initial = this.read();
    const lockPath = initial.path + '.http-advanced.lock';
    const lock = acquireLock(lockPath);
    const temporary = initial.path + `.http-advanced-${randomUUID()}.tmp`;
    try {
      const current = this.read();
      if (current.path !== initial.path || revision(current.draft) !== input.revision) throw new SettingsError('HTTP Advanced settings changed in another editor; reload before saving');
      const merged = mergeSettings(current.config, input.draft);
      if (isDeepStrictEqual(merged, current.config)) return { ...this.load(), changed: false };
      const descriptor = openSync(temporary, 'wx', 0o600);
      try {
        writeFileSync(descriptor, JSON.stringify(merged, null, 4) + '\n');
        // preserve ownership as well as mode, including when the UI runs as root
        const original = statSync(current.path), replacement = fstatSync(descriptor);
        if (replacement.uid !== original.uid || replacement.gid !== original.gid) fchownSync(descriptor, original.uid, original.gid);
        fchmodSync(descriptor, original.mode & 0o777);
        fsyncSync(descriptor);
      } finally { closeSync(descriptor); }
      // preserve an exact private backup; recheck for writes from other Homebridge editors
      const backup = current.path + `.http-advanced-backup-${Date.now()}-${randomUUID()}`;
      const backupDescriptor = openSync(backup, 'wx', 0o600);
      try { writeFileSync(backupDescriptor, current.raw); fsyncSync(backupDescriptor); }
      finally { closeSync(backupDescriptor); }
      if (readFileSync(current.path, 'utf8') !== current.raw) throw new SettingsError('Homebridge configuration changed during save; reload before saving');
      renameSync(temporary, current.path);
      return { ...this.load(), changed: true };
    } catch (error) {
      if (error instanceof SettingsError) throw error;
      throw new SettingsError('Could not save Homebridge configuration; check file permissions');
    } finally {
      try { unlinkSync(temporary); } catch { /* no temporary file after a successful rename */ }
      closeSync(lock); unlinkSync(lockPath);
    }
  }
}

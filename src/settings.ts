import { readFileSync } from 'node:fs';
import type { API, Logging } from 'homebridge';
import { ActionError, type CoordinatorConfig, type RefreshConfig } from './types.js';

export interface GlobalSettings {
  requestTimeout?: number;
  uriCallsDelay?: number;
  setterDelay?: number;
  writeConfirmationTimeout?: number;
  refresh?: RefreshConfig;
  coordinator?: CoordinatorConfig;
  recovery?: { retryInterval?: number; maxRetryInterval?: number; quietPeriod?: number; reminderInterval?: number };
}

export class SettingsValidationError extends ActionError {
  constructor(field: string, requirement: string) {
    super('config');
    this.message = `Shared settings: ${field} ${requirement}`;
  }
}

export function validateSettings(value: unknown): asserts value is GlobalSettings {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!object(value)) throw new SettingsValidationError('httpAdvanced', 'must be an object');
  const number = (field: string, v: unknown, zero = false, integer = false): void => {
    if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || (zero ? v < 0 : v <= 0) || (integer && !Number.isInteger(v)))) {
      throw new SettingsValidationError(field, `must be a ${integer ? 'whole ' : ''}number ${zero ? 'of zero or greater' : 'greater than zero'}`);
    }
  };
  number('requestTimeout', value.requestTimeout);
  for (const key of ['uriCallsDelay', 'setterDelay', 'writeConfirmationTimeout']) number(key, value[key], true);
  for (const section of ['refresh', 'coordinator', 'recovery']) {
    if (value[section] !== undefined && !object(value[section])) throw new SettingsValidationError(section, 'must be an object');
  }
  const settings = value as GlobalSettings;
  for (const key of ['activeInterval', 'idleInterval', 'idleAfter'] as const) number(`refresh.${key}`, settings.refresh?.[key]);
  for (const key of ['concurrency', 'perOrigin', 'maxQueue'] as const) number(`coordinator.${key}`, settings.coordinator?.[key], false, true);
  if (Object.keys(settings.coordinator ?? {}).some(key => !['concurrency', 'perOrigin', 'maxQueue'].includes(key))) throw new SettingsValidationError('coordinator', 'supports only concurrency, perOrigin and maxQueue');
  for (const key of ['retryInterval', 'maxRetryInterval', 'reminderInterval'] as const) number(`recovery.${key}`, settings.recovery?.[key]);
  number('recovery.quietPeriod', settings.recovery?.quietPeriod, true);
  if ((settings.recovery?.maxRetryInterval ?? 30) < (settings.recovery?.retryInterval ?? 5)) throw new SettingsValidationError('recovery.maxRetryInterval', 'must be at least recovery.retryInterval (defaults: 30 and 5 seconds)');
}

export function readGlobalSettings(api: API, log: Logging): GlobalSettings {
  try {
    // child bridges use the same config path; defaults do not require a platform instance
    const settings: unknown = JSON.parse(readFileSync(api.user.configPath(), 'utf8')).httpAdvanced ?? {};
    validateSettings(settings);
    return settings;
  } catch (error) {
    if (error instanceof ActionError) log.warn('HTTP Advanced shared settings invalid; using built-in defaults');
    return {};
  }
}

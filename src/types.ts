import type { CharacteristicProps, CharacteristicValue } from 'homebridge';

export type Value = string | number | boolean;
export type State = Record<string, unknown>;
export type MapperConfig =
  | { type: 'static'; parameters: { mapping: Record<string, unknown> } }
  | { type: 'regex'; parameters: { regexp: string; capture?: number | string } }
  | { type: 'xpath'; parameters: { xpath: string; index?: number } }
  | { type: 'jpath'; parameters: { jpath: string; index?: number } }
  | { type: 'eval'; parameters: { expression: string } };
export interface ActionConfig {
  url: string;
  httpMethod?: string;
  body?: string;
  headers?: Record<string, string>;
  mappers?: MapperConfig[];
  resultOnError?: Value;
  inconclusive?: ActionConfig;
  timeout?: number;
  strictHTTP?: boolean;
  responsePattern?: string;
  requireResponseMatch?: boolean;
}
export interface RefreshConfig {
  activeInterval?: number;
  idleInterval?: number;
  idleAfter?: number;
}
export interface DeviceConfig {
  accessory?: string;
  id?: string;
  name: string;
  service: string;
  manufacturer?: string;
  model?: string;
  username?: string;
  password?: string;
  immediately?: boolean;
  debug?: boolean;
  optionCharacteristic?: string[];
  props?: Record<string, Partial<CharacteristicProps>>;
  forceRefreshDelay?: number;
  setterDelay?: number;
  writeConfirmationTimeout?: number;
  uriCallsDelay?: number;
  refresh?: RefreshConfig;
  urls?: Record<string, ActionConfig>;
}
export interface CoordinatorConfig {
  concurrency?: number;
  perOrigin?: number;
  maxQueue?: number;
}
export type ErrorCategory = 'config' | 'network' | 'timeout' | 'aborted' | 'deferred' | 'http' | 'unavailable' | 'mapper' | 'inconclusive' | 'queue';
export class ActionError extends Error {
  constructor(public readonly category: ErrorCategory, public readonly retryAfter?: number) {
    super(`HTTP Advanced ${category} failure`);
  }
}
export interface CacheEntry {
  key: string;
  actionName: string;
  config: DeviceConfig;
  state: State;
  value?: CharacteristicValue;
  stateValue?: unknown;
  known: boolean;
  lastSuccess: number;
  lastAttempt: number;
  lastChange: number;
  lastDemand: number;
  inFlight: boolean;
  failures: number;
  lastError?: ErrorCategory;
  nextEligible: number;
  generation: number;
  pendingWrite?: PendingWrite;
  convert: (value: unknown) => CharacteristicValue;
  update: (value: CharacteristicValue | Error) => void;
}
export interface PendingWrite {
  value: CharacteristicValue;
  // no deadline until the debounced HTTP operation has completed
  expires?: number;
}

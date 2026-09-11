import { mapValue } from './mappers.js';
import { interpolateLegacy } from './compatibility.js';
import { ActionError, type ActionConfig, type DeviceConfig, type ErrorCategory, type State } from './types.js';
import { Transport } from './transport.js';

export class Actions {
  constructor(readonly transport: Transport) {}
  async get(action: ActionConfig, config: DeviceConfig, owner: string, state: State, seen = new Set<ActionConfig>(), onFailure?: (category: ErrorCategory) => void): Promise<unknown> {
    if (seen.has(action) || seen.size >= 32) throw new ActionError('inconclusive');
    seen.add(action);
    let body: string;
    try { body = (await this.transport.request(action, config, owner)).body; }
    catch (error) {
      if (error instanceof ActionError && error.category !== 'aborted' && action.resultOnError != null) {
        onFailure?.(error.category);
        return action.resultOnError;
      }
      throw error;
    }
    const value = mapValue(action.mappers, body, state);
    if (value === 'inconclusive') {
      if (action.inconclusive) return this.get(action.inconclusive, config, owner, state, seen, onFailure);
      // published 1.3.0 returned this sentinel; callers validate it for the HAP format
      return value;
    }
    return value;
  }

  async set(action: ActionConfig, config: DeviceConfig, owner: string, state: State, value: unknown): Promise<void> {
    const mapped = mapValue(action.mappers, value, state);
    let url: string; let body: string;
    try {
      url = interpolateLegacy(action.url, value, mapped, state);
      body = action.body ? interpolateLegacy(action.body, value, mapped, state) : '';
    } catch { throw new ActionError('mapper'); }
    await this.transport.request({ ...action, url, body }, config, owner, true);
  }
}

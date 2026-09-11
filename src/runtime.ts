import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { API, CharacteristicValue, Logging } from 'homebridge';
import { Coordinator } from './coordinator.js';
import { Transport } from './transport.js';
import { Actions } from './actions.js';
import { ActionError, type CacheEntry, type CoordinatorConfig, type DeviceConfig, type ErrorCategory, type State } from './types.js';

type Persisted = { value: CharacteristicValue; stateValue?: unknown; lastSuccess: number; lastChange: number };
export const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class Runtime {
  readonly coordinator: Coordinator;
  readonly transport: Transport;
  readonly actions: Actions;
  readonly entries = new Map<string, CacheEntry>();
  readonly setters = new Map<string, NodeJS.Timeout>();
  private readonly persisted: Record<string, Persisted> = {};
  private readonly owners = new Set<string>();
  private timer?: NodeJS.Timeout;
  private persistenceTimer?: NodeJS.Timeout;
  private stopped = false;
  private started = false;
  private savePath?: string;
  private dirty = false;
  readonly stats = { changes: 0, mapperFailures: 0, restored: 0, reads: 0, failedRefreshes: 0 };

  constructor(readonly log: Logging, options: CoordinatorConfig = {}, persistPath?: string) {
    this.coordinator = new Coordinator(options);
    this.transport = new Transport(this.coordinator);
    this.actions = new Actions(this.transport);
    if (persistPath) {
      this.savePath = join(persistPath, 'http-advanced-state-v1');
    }
  }

  register(owner: string, actionName: string, config: DeviceConfig, state: State, convert: CacheEntry['convert'], update: CacheEntry['update']): CacheEntry {
    const key = fingerprint([owner, config, actionName]);
    if (this.entries.has(key)) throw new ActionError('config');
    this.owners.add(owner);
    const now = Date.now();
    const entry: CacheEntry = { key, actionName, config, state, known: false, lastSuccess: 0, lastAttempt: 0, lastChange: 0, lastDemand: now, inFlight: false, failures: 0, nextEligible: now + Math.random() * 1000, generation: 0, convert, update };
    if (this.savePath) {
      try {
        const saved = JSON.parse(readFileSync(join(this.savePath, key + '.json'), 'utf8')) as Persisted;
        if (saved && typeof saved === 'object') this.persisted[key] = saved;
      } catch { /* missing or corrupt optional state cannot block startup */ }
    }
    const saved = this.persisted[key];
    if (saved && Number.isFinite(saved.lastSuccess) && saved.lastSuccess > 0 && saved.lastSuccess <= now) {
      try {
        entry.value = convert(saved.value); entry.known = true;
        entry.lastSuccess = saved.lastSuccess; entry.lastChange = saved.lastChange;
        entry.stateValue = ['string', 'boolean', 'number'].includes(typeof saved.stateValue) ? saved.stateValue : entry.value;
        state[actionName] = entry.stateValue; update(entry.value); this.stats.restored++;
      } catch { /* invalid values are ignored; the getter reports not-ready until refreshed */ }
    }
    this.entries.set(key, entry);
    return entry;
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.log.info(`HTTP Advanced 2.0.0-alpha.1: ${this.owners.size} devices, ${this.entries.size} cached getters, ${this.stats.restored} restored; concurrency ${this.coordinator.limits.concurrency}/${this.coordinator.limits.perOrigin}`);
    this.timer = setInterval(() => this.tick(), 100);
    this.timer.unref();
    this.persistenceTimer = setInterval(() => { this.persist(); this.debugSnapshot(); }, 30000);
    this.persistenceTimer.unref();
    this.tick();
  }

  interval(entry: CacheEntry, now = Date.now()): number {
    if (entry.config.forceRefreshDelay) return entry.config.forceRefreshDelay * 1000;
    const options = entry.config.refresh ?? {};
    return now - entry.lastDemand > (options.idleAfter ?? 60) * 1000
      ? (options.idleInterval ?? 60) * 1000 : (options.activeInterval ?? 5) * 1000;
  }

  read(entry: CacheEntry): CharacteristicValue {
    this.stats.reads++;
    entry.lastDemand = Date.now();
    // demand only marks work eligible; the scheduler starts it on a separate turn
    if (!entry.config.forceRefreshDelay && entry.failures === 0 && entry.lastDemand - entry.lastSuccess >= this.interval(entry)) {
      entry.nextEligible = Math.min(entry.nextEligible, entry.lastDemand);
    }
    if (!entry.known || entry.value === undefined) throw new ActionError('inconclusive');
    return entry.value;
  }

  tick(now = Date.now()): void {
    if (this.stopped) return;
    for (const entry of [...this.entries.values()].sort((a, b) => a.nextEligible - b.nextEligible)) {
      if (!this.coordinator.available) break;
      if (!entry.inFlight && entry.nextEligible <= now) void this.refresh(entry);
    }
  }

  async refresh(entry: CacheEntry): Promise<void> {
    if (this.stopped || entry.inFlight) return;
    entry.inFlight = true;
    entry.lastAttempt = Date.now();
    const generation = entry.generation;
    try {
      let fallbackError: ErrorCategory | undefined;
      const raw = await this.actions.get(entry.config.urls![entry.actionName], entry.config, this.ownerFor(entry), entry.state, new Set(), category => { fallbackError = category; });
      if (this.stopped || generation !== entry.generation) return;
      const value = entry.convert(raw);
      const changed = !entry.known || value !== entry.value;
      entry.value = value; entry.known = true;
      if (!fallbackError) entry.lastSuccess = Date.now();
      // legacy on-demand state holds mapper output; polling converts only numeric HAP formats
      entry.stateValue = entry.config.forceRefreshDelay && typeof value === 'number' ? value : raw;
      entry.state[entry.actionName] = entry.stateValue;
      if (changed) { entry.lastChange = Date.now(); this.stats.changes++; }
      // also clear a prior HAP error without calling any setter
      entry.update(value);
      this.dirty = true;
      if (fallbackError) throw new ActionError(fallbackError);
      this.persisted[entry.key] = { value, stateValue: entry.stateValue, lastSuccess: entry.lastSuccess, lastChange: entry.lastChange };
      entry.failures = 0; entry.lastError = undefined;
      entry.nextEligible = Date.now() + this.interval(entry) * (1 + Math.random() * 0.1);
    } catch (error) {
      if (this.stopped) return;
      entry.failures++; this.stats.failedRefreshes++;
      entry.lastError = error instanceof ActionError ? error.category : 'mapper';
      if (entry.lastError === 'mapper') this.stats.mapperFailures++;
      entry.nextEligible = Date.now() + Math.min(300000, Math.max(this.interval(entry), 1000) * 2 ** Math.min(entry.failures - 1, 8)) * (1 + Math.random() * 0.1);
      if (entry.config.debug || entry.failures === 1) this.log.warn(`HTTP Advanced ${entry.actionName}: ${entry.lastError}; retaining last known state; retry in ${Math.round((entry.nextEligible - Date.now()) / 1000)}s`);
    } finally {
      entry.inFlight = false;
      // a SET that raced an old GET must be verified again after that GET leaves
      if (generation !== entry.generation && !this.stopped) entry.nextEligible = Date.now();
    }
  }

  private ownerFor(entry: CacheEntry): string { return fingerprint(entry.config); }

  async set(config: DeviceConfig, state: State, actionName: string, value: CharacteristicValue, entry?: CacheEntry): Promise<void> {
    if (this.stopped) throw new ActionError('aborted');
    const action = config.urls?.[actionName];
    if (!action) return;
    // invalidate older GETs before issuing a write so their responses cannot overwrite it
    if (entry) entry.generation++;
    try {
      await this.actions.set(action, config, fingerprint(config), state, value);
    } finally {
      if (entry) {
        // also invalidate reads started while the write was in progress
        entry.generation++;
        entry.nextEligible = Date.now();
      }
    }
  }

  debounce(key: string, delay: number, work: () => Promise<void>, onFailure?: () => void): void {
    clearTimeout(this.setters.get(key));
    const timer = setTimeout(() => {
      this.setters.delete(key);
      void work().catch(() => { this.log.warn('HTTP Advanced delayed SET failed'); onFailure?.(); });
    }, delay);
    this.setters.set(key, timer);
  }

  snapshot(): object {
    const now = Date.now();
    return { ...this.stats, queue: this.coordinator.queue.length, inFlight: this.coordinator.active.size, limits: this.coordinator.limits,
      requests: { ...this.coordinator.stats, durations: [...this.coordinator.stats.durations] }, transport: { ...this.transport.stats },
      cache: [...this.entries.values()].map(e => ({ id: e.key.slice(0, 12), known: e.known, age: e.known ? now - e.lastSuccess : null, failures: e.failures, lastError: e.lastError, nextRefresh: Math.max(0, e.nextEligible - now), inFlight: e.inFlight })),
      origins: [...this.coordinator.originStats].map(([origin, stats]) => ({id: fingerprint(origin).slice(0, 12), ...stats, inFlight: this.coordinator.origins.get(origin) ?? 0})) };
  }

  private debugSnapshot(): void {
    if ([...this.entries.values()].some(e => e.config.debug)) this.log.info(`HTTP Advanced diagnostics ${JSON.stringify(this.snapshot())}`);
  }

  persist(): void {
    if (!this.savePath || !this.dirty) return;
    try {
      mkdirSync(this.savePath, { recursive: true });
      // separate hashed entries prevent one child bridge overwriting another's cache
      for (const e of this.entries.values()) if (this.persisted[e.key]) {
        const path = join(this.savePath, e.key + '.json');
        const temporary = path + `.${process.pid}.tmp`;
        writeFileSync(temporary, JSON.stringify(this.persisted[e.key]), {mode: 0o600});
        renameSync(temporary, path);
      }
      this.dirty = false;
    } catch { this.log.warn('HTTP Advanced could not persist state cache'); }
  }

  shutdown(): void {
    this.stopped = true;
    clearInterval(this.timer); clearInterval(this.persistenceTimer);
    for (const timer of this.setters.values()) clearTimeout(timer);
    this.setters.clear(); this.transport.shutdown(); this.persist();
  }
}

const runtimes = new WeakMap<API, Runtime>();
export function sharedRuntime(api: API, log: Logging): Runtime {
  let runtime = runtimes.get(api);
  if (!runtime) {
    runtime = new Runtime(log, {}, api.user.persistPath());
    runtimes.set(api, runtime);
    const instance = runtime;
    api.on('didFinishLaunching', () => { setImmediate(() => instance.start()); });
    api.on('shutdown', () => instance.shutdown());
  }
  return runtime;
}

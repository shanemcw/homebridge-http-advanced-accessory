import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { API, CharacteristicValue, Logging } from 'homebridge';
import { Coordinator } from './coordinator.js';
import { Transport } from './transport.js';
import { Actions } from './actions.js';
import { readGlobalSettings, type GlobalSettings } from './settings.js';
import { pluginVersion } from './metadata.js';
import { ActionError, type CacheEntry, type CoordinatorConfig, type DeviceConfig, type ErrorCategory, type PendingWrite, type State } from './types.js';

type Persisted = { value: CharacteristicValue; stateValue?: unknown; lastSuccess: number; lastChange: number };
type Recovery = { since: number; nextProbe: number; attempts: number; lastWarning: number; category: ErrorCategory };
const temporaryFailure = (category?: ErrorCategory): boolean => category !== undefined && ['network', 'timeout', 'inconclusive', 'unavailable'].includes(category);
export const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class Runtime {
  readonly coordinator: Coordinator;
  readonly transport: Transport;
  readonly actions: Actions;
  readonly entries = new Map<string, CacheEntry>();
  readonly setters = new Map<string, NodeJS.Timeout>();
  private readonly persisted: Record<string, Persisted> = {};
  private readonly owners = new Set<string>();
  private readonly recovering = new Map<string, Recovery>();
  private timer?: NodeJS.Timeout;
  private persistenceTimer?: NodeJS.Timeout;
  private stopped = false;
  private started = false;
  private savePath?: string;
  private dirty = false;
  readonly stats = { changes: 0, mapperFailures: 0, restored: 0, reads: 0, failedRefreshes: 0 };

  constructor(readonly log: Logging, options: CoordinatorConfig = {}, persistPath?: string, readonly settings: GlobalSettings = {}) {
    this.coordinator = new Coordinator({ ...settings.coordinator, ...options });
    this.transport = new Transport(this.coordinator, settings);
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
    this.log.info(`HTTP Advanced ${pluginVersion}: ${this.owners.size} devices, ${this.entries.size} cached getters, ${this.stats.restored} restored; concurrency ${this.coordinator.limits.concurrency}/${this.coordinator.limits.perOrigin}`);
    this.timer = setInterval(() => this.tick(), 100);
    this.timer.unref();
    this.persistenceTimer = setInterval(() => { this.persist(); this.debugSnapshot(); }, 30000);
    this.persistenceTimer.unref();
    this.tick();
  }

  interval(entry: CacheEntry, now = Date.now()): number {
    if (entry.config.forceRefreshDelay) return entry.config.forceRefreshDelay * 1000;
    const options = { ...this.settings.refresh, ...entry.config.refresh };
    return now - entry.lastDemand > (options.idleAfter ?? 60) * 1000
      ? (options.idleInterval ?? 60) * 1000 : (options.activeInterval ?? 5) * 1000;
  }

  read(entry: CacheEntry): CharacteristicValue {
    this.stats.reads++;
    entry.lastDemand = Date.now();
    this.expireWrite(entry, entry.lastDemand);
    if (entry.pendingWrite) return entry.pendingWrite.value;
    // demand only marks work eligible; the scheduler starts it on a separate turn
    if (!entry.config.forceRefreshDelay && entry.failures === 0 && entry.lastDemand - entry.lastSuccess >= this.interval(entry)) {
      entry.nextEligible = Math.min(entry.nextEligible, entry.lastDemand);
    }
    if (!entry.known || entry.value === undefined) throw new ActionError('inconclusive');
    return entry.value;
  }

  tick(now = Date.now()): void {
    if (this.stopped) return;
    this.reportRecovery(now);
    // expiry must still reach HomeKit when the endpoint or request queue is blocked
    for (const entry of this.entries.values()) this.expireWrite(entry, now);
    for (const entry of [...this.entries.values()].sort((a, b) => a.nextEligible - b.nextEligible)) {
      if (!this.coordinator.available) break;
      if (entry.pendingWrite && entry.pendingWrite.expires === undefined) continue;
      const origin = this.originFor(entry);
      if (origin && !this.coordinator.backgroundReady(origin, now)) continue;
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
      let fallbackRetryAfter: number | undefined;
      const raw = await this.actions.get(entry.config.urls![entry.actionName], entry.config, this.ownerFor(entry), entry.state, new Set(), (category, retryAfter) => { fallbackError = category; fallbackRetryAfter = retryAfter; });
      if (this.stopped || generation !== entry.generation || (entry.pendingWrite && entry.pendingWrite.expires === undefined)) return;
      // an unusable response (including a gateway timeout page) is not a broken mapper
      if (raw === 'inconclusive') throw new ActionError('inconclusive');
      let value: CharacteristicValue;
      try { value = entry.convert(raw); }
      catch (error) {
        // valid mapping code can still receive a temporary non-value from an older server
        if (error instanceof ActionError && error.category === 'mapper') throw new ActionError('inconclusive');
        throw error;
      }
      // an error fallback is not confirmation of a command, even if its value matches
      if (entry.pendingWrite && fallbackError) throw new ActionError(fallbackError, fallbackRetryAfter);
      if (entry.pendingWrite && (value === entry.pendingWrite.value || Date.now() >= entry.pendingWrite.expires!)) delete entry.pendingWrite;
      const changed = !entry.known || value !== entry.value;
      entry.value = value; entry.known = true;
      if (!fallbackError) entry.lastSuccess = Date.now();
      // legacy on-demand state holds mapper output; polling converts only numeric HAP formats
      entry.stateValue = entry.config.forceRefreshDelay && typeof value === 'number' ? value : raw;
      entry.state[entry.actionName] = entry.stateValue;
      if (changed) { entry.lastChange = Date.now(); this.stats.changes++; }
      // also clear a prior HAP error without calling any setter
      entry.update(entry.pendingWrite?.value ?? value);
      this.dirty = true;
      if (fallbackError) throw new ActionError(fallbackError, fallbackRetryAfter);
      this.persisted[entry.key] = { value, stateValue: entry.stateValue, lastSuccess: entry.lastSuccess, lastChange: entry.lastChange };
      this.finishRecovery(entry);
      entry.failures = 0; entry.lastError = undefined;
      entry.nextEligible = Date.now() + this.interval(entry) * (1 + Math.random() * 0.1);
      if (entry.pendingWrite) entry.nextEligible = Math.min(entry.nextEligible, Date.now() + 1000, entry.pendingWrite.expires!);
    } catch (error) {
      if (this.stopped || generation !== entry.generation) return;
      if (error instanceof ActionError && error.category === 'deferred') {
        entry.nextEligible = Date.now() + Math.max(100, error.retryAfter ?? 0);
        return;
      }
      this.expireWrite(entry, Date.now());
      entry.failures++; this.stats.failedRefreshes++;
      entry.lastError = error instanceof ActionError ? error.category : 'mapper';
      if (entry.lastError === 'mapper') this.stats.mapperFailures++;
      entry.nextEligible = Date.now() + Math.min(300000, Math.max(this.interval(entry), 1000) * 2 ** Math.min(entry.failures - 1, 8)) * (1 + Math.random() * 0.1);
      if (temporaryFailure(entry.lastError)) {
        this.pauseOrigin(entry, error instanceof ActionError ? error.retryAfter : undefined);
      } else if (entry.failures === 1) {
        this.log.warn(`HTTP Advanced action ${entry.key.slice(0, 12)} ${entry.actionName}: ${entry.lastError}; keeping cached state where available; retrying in background`);
      }
    } finally {
      entry.inFlight = false;
      // a SET that raced an old GET must be verified again after that GET leaves
      if (generation !== entry.generation && !this.stopped) entry.nextEligible = Date.now();
    }
  }

  private ownerFor(entry: CacheEntry): string { return fingerprint(entry.config); }

  private originFor(entry: CacheEntry): string | undefined {
    try { return new URL(entry.config.urls![entry.actionName].url).origin; }
    catch { return undefined; }
  }

  private pauseOrigin(entry: CacheEntry, retryAfter = 0): void {
    const origin = this.originFor(entry);
    if (!origin) return;
    const now = Date.now();
    const recovery = this.recovering.get(origin) ?? { since: now, nextProbe: 0, attempts: 0, lastWarning: 0, category: entry.lastError! };
    // failures from requests already in flight belong to the same attempt
    if (now >= recovery.nextProbe) {
      recovery.attempts++;
      recovery.nextProbe = now + Math.min((this.settings.recovery?.maxRetryInterval ?? 30) * 1000, (this.settings.recovery?.retryInterval ?? 5) * 1000 * 2 ** Math.min(recovery.attempts - 1, 20));
    }
    recovery.nextProbe = Math.max(recovery.nextProbe, now + retryAfter);
    recovery.category = entry.lastError!;
    this.recovering.set(origin, recovery);
    this.coordinator.pauseOrigin(origin, recovery.nextProbe);
    entry.nextEligible = recovery.nextProbe;
    this.reportRecovery(now);
  }

  private reportRecovery(now: number): void {
    for (const [origin, recovery] of this.recovering) {
      if (now - recovery.since < (this.settings.recovery?.quietPeriod ?? 90) * 1000 || (recovery.lastWarning && now - recovery.lastWarning < (this.settings.recovery?.reminderInterval ?? 300) * 1000)) continue;
      recovery.lastWarning = now;
      this.log.warn(`HTTP Advanced endpoint ${fingerprint(origin).slice(0, 12)}: waiting for usable responses for ${Math.round((now - recovery.since) / 1000)}s (${recovery.category}); keeping cached state where available; retrying one background request at a time`);
    }
  }

  private finishRecovery(entry: CacheEntry): void {
    const origin = this.originFor(entry);
    if (!origin) return;
    const recovery = this.recovering.get(origin);
    if (!recovery) return;
    this.recovering.delete(origin);
    this.coordinator.resumeOrigin(origin);
    const message = `HTTP Advanced endpoint ${fingerprint(origin).slice(0, 12)}: responses recovered after ${Math.round((Date.now() - recovery.since) / 1000)}s; refreshing cached state`;
    if (recovery.lastWarning) this.log.info(message); else this.log.debug(message);
    // a successful probe releases siblings from outage backoff, retaining normal queue limits
    for (const sibling of this.entries.values()) {
      if (temporaryFailure(sibling.lastError) && this.originFor(sibling) === origin) {
        sibling.failures = 0; sibling.lastError = undefined;
        sibling.nextEligible = Date.now() + Math.random() * 1000;
      }
    }
  }

  beginWrite(entry: CacheEntry, value: CharacteristicValue): PendingWrite {
    const intent = { value: entry.convert(value) };
    entry.generation++;
    entry.pendingWrite = intent;
    entry.lastDemand = Date.now();
    return intent;
  }

  private expireWrite(entry: CacheEntry, now: number): void {
    if (entry.pendingWrite?.expires === undefined || now < entry.pendingWrite.expires) return;
    delete entry.pendingWrite;
    this.publish(entry);
  }

  publish(entry: CacheEntry): void {
    if (this.stopped) return;
    if (entry.pendingWrite?.expires !== undefined && Date.now() >= entry.pendingWrite.expires) delete entry.pendingWrite;
    entry.update(entry.pendingWrite?.value ?? (entry.known ? entry.value : undefined) ?? new ActionError('inconclusive'));
  }

  async set(config: DeviceConfig, state: State, actionName: string, value: CharacteristicValue, entry?: CacheEntry, intent?: PendingWrite): Promise<void> {
    if (this.stopped) throw new ActionError('aborted');
    const action = config.urls?.[actionName];
    if (!action) return;
    intent ??= entry ? this.beginWrite(entry, value) : undefined;
    try {
      await this.actions.set(action, config, fingerprint(config), state, value);
      if (entry && entry.pendingWrite === intent) intent!.expires = Date.now() + (config.writeConfirmationTimeout ?? this.settings.writeConfirmationTimeout ?? 10000);
    } catch (error) {
      if (entry && entry.pendingWrite === intent) {
        delete entry.pendingWrite;
        this.publish(entry);
      }
      throw error;
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
      recovering: [...this.recovering].map(([origin, recovery]) => ({ id: fingerprint(origin).slice(0, 12), age: now - recovery.since, nextProbe: Math.max(0, recovery.nextProbe - now), attempts: recovery.attempts, category: recovery.category })),
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
    // Homebridge's Logging methods use their receiver's public prefix and log method
    // copy them onto a separate callable so accessory-specific logging stays untouched
    const sharedLog: Logging = Object.assign((message: string, ...parameters: unknown[]) => sharedLog.info(message, ...parameters), log, { prefix: 'HTTP Advanced' });
    runtime = new Runtime(sharedLog, {}, api.user.persistPath(), readGlobalSettings(api, sharedLog));
    runtimes.set(api, runtime);
    const instance = runtime;
    api.on('didFinishLaunching', () => { setImmediate(() => instance.start()); });
    api.on('shutdown', () => instance.shutdown());
  }
  return runtime;
}

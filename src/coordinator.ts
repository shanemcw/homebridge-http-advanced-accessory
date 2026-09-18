import { ActionError, type CoordinatorConfig } from './types.js';

interface Job {
  origin: string;
  owner: string;
  spacing: number;
  priority: boolean;
  run: (signal: AbortSignal) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  deadline?: number;
  timer?: NodeJS.Timeout;
}

export class Coordinator {
  limits = { concurrency: 4, perOrigin: 2, maxQueue: 256 };
  readonly queue: Job[] = [];
  readonly active = new Set<AbortController>();
  readonly origins = new Map<string, number>();
  readonly originStats = new Map<string, { started: number; completed: number; failed: number; maxInFlight: number }>();
  private readonly nextStart = new Map<string, number>();
  private readonly recovering = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private lastOrigin = '';
  private stopped = false;
  readonly stats = { completed: 0, failed: 0, highWater: 0, maxInFlight: 0, durations: [] as number[], started: 0 };

  constructor(config: CoordinatorConfig = {}) { this.configure(config); }

  configure(config: CoordinatorConfig): void {
    for (const [key, value] of Object.entries(config)) {
      if (!Object.hasOwn(this.limits, key) || !Number.isInteger(value) || value < 1) throw new ActionError('config');
    }
    Object.assign(this.limits, config);
  }

  get available(): boolean { return !this.stopped && this.queue.length < this.limits.maxQueue; }

  pauseOrigin(origin: string, until: number): void {
    this.recovering.set(origin, until);
    // parked reads belong in the cache scheduler, not in slots needed by healthy endpoints
    for (const job of this.queue.slice()) {
      if (job.origin !== origin || job.priority) continue;
      this.queue.splice(this.queue.indexOf(job), 1);
      clearTimeout(job.timer);
      job.reject(new ActionError('deferred', Math.max(0, until - Date.now())));
    }
  }

  backgroundReady(origin: string, now = Date.now()): boolean {
    const probeAt = this.recovering.get(origin);
    return probeAt === undefined || (now >= probeAt && (this.origins.get(origin) ?? 0) === 0);
  }

  resumeOrigin(origin: string): void {
    this.recovering.delete(origin);
  }

  submit<T>(origin: string, owner: string, spacing: number, priority: boolean, run: (signal: AbortSignal) => Promise<T>, deadline?: number): Promise<T> {
    if (this.stopped) return Promise.reject(new ActionError('aborted'));
    if (!priority && !this.backgroundReady(origin)) return Promise.reject(new ActionError('deferred', Math.max(0, (this.recovering.get(origin) ?? 0) - Date.now())));
    if (!this.available) return Promise.reject(new ActionError('queue'));
    return new Promise<T>((resolve, reject) => {
      const job: Job = { origin, owner, spacing, priority, run, resolve: value => resolve(value as T), reject, deadline };
      this.queue.push(job);
      if (deadline !== undefined) {
        const expire = () => {
          if (!this.queue.includes(job)) return;
          const remaining = deadline - Date.now();
          if (remaining > 0) { job.timer = setTimeout(expire, Math.min(remaining, 2147483647)); return; }
          this.queue.splice(this.queue.indexOf(job), 1);
          job.reject(new ActionError('timeout'));
          this.pump();
        };
        job.timer = setTimeout(expire, Math.max(0, Math.min(deadline - Date.now(), 2147483647)));
      }
      this.stats.highWater = Math.max(this.stats.highWater, this.queue.length);
      this.pump();
    });
  }

  private pump(): void {
    if (this.stopped) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    while (this.active.size < this.limits.concurrency) {
      const now = Date.now();
      // expired commands must never run later, even if admission beats their timer callback
      for (const job of this.queue.slice()) {
        if (job.deadline !== undefined && now >= job.deadline) {
          this.queue.splice(this.queue.indexOf(job), 1);
          clearTimeout(job.timer);
          job.reject(new ActionError('timeout'));
        }
      }
      const eligible = this.queue.filter(job => {
        const active = this.origins.get(job.origin) ?? 0;
        // writes retain priority; a recovering origin gets only one background probe at a time
        return active < this.limits.perOrigin && (this.nextStart.get(job.owner) ?? 0) <= now
          && (job.priority || this.backgroundReady(job.origin, now));
      });
      // prefer control writes, then rotate eligible origins to prevent a slow fleet starving others
      const candidates = eligible.some(job => job.priority) ? eligible.filter(job => job.priority) : eligible;
      const job = candidates.find(job => job.origin !== this.lastOrigin) ?? candidates[0];
      if (!job) break;
      this.queue.splice(this.queue.indexOf(job), 1);
      clearTimeout(job.timer);
      this.lastOrigin = job.origin;
      this.nextStart.set(job.owner, now + job.spacing);
      this.origins.set(job.origin, (this.origins.get(job.origin) ?? 0) + 1);
      const originStats = this.originStats.get(job.origin) ?? { started: 0, completed: 0, failed: 0, maxInFlight: 0 };
      this.originStats.set(job.origin, originStats);
      originStats.started++;
      originStats.maxInFlight = Math.max(originStats.maxInFlight, this.origins.get(job.origin)!);
      const controller = new AbortController();
      this.active.add(controller);
      this.stats.started++;
      this.stats.maxInFlight = Math.max(this.stats.maxInFlight, this.active.size);
      Promise.resolve().then(() => {
        // admission can precede execution during event-loop load; pace from actual execution
        this.nextStart.set(job.owner, Date.now() + job.spacing);
        return job.run(controller.signal);
      }).then(value => {
        this.stats.completed++; originStats.completed++; job.resolve(value);
      }, error => { this.stats.failed++; originStats.failed++; job.reject(error); }).finally(() => {
        this.active.delete(controller);
        this.origins.set(job.origin, (this.origins.get(job.origin) ?? 1) - 1);
        this.stats.durations.push(Date.now() - now);
        if (this.stats.durations.length > 2048) this.stats.durations.shift();
        // allow response mapping and recovery feedback to settle before admitting the next job
        setImmediate(() => this.pump());
      });
    }
    if (this.queue.length && this.active.size < this.limits.concurrency) {
      this.timer = setTimeout(() => this.pump(), 20);
      this.timer.unref();
    }
  }

  shutdown(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const job of this.queue.splice(0)) { clearTimeout(job.timer); job.reject(new ActionError('aborted')); }
    for (const controller of this.active) controller.abort();
  }
}

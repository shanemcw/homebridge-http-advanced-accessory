import http from 'node:http';
import https from 'node:https';
import { ActionError, type ActionConfig, type DeviceConfig } from './types.js';
import { Coordinator } from './coordinator.js';
import type { GlobalSettings } from './settings.js';

export interface HTTPResult { body: string; status: number; location?: string; retryAfter?: string }
export class Transport {
  private readonly httpAgent = new http.Agent({ keepAlive: true, maxSockets: 4, maxFreeSockets: 2 });
  private readonly httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 4, maxFreeSockets: 2 });
  readonly stats = { timeouts: 0, httpErrors: 0, aborted: 0, bytes: 0 };
  constructor(readonly coordinator: Coordinator, readonly defaults: GlobalSettings = {}) {}

  async request(action: ActionConfig, config: DeviceConfig, owner: string, priority = false, depth = 0, deadline: number | undefined = priority ? Date.now() + (action.timeout ?? this.defaults.requestTimeout ?? 10000) : undefined): Promise<HTTPResult> {
    if (depth > 10) throw new ActionError('http');
    let url: URL;
    try { url = new URL(action.url); } catch { return Promise.reject(new ActionError('config')); }
    if (!['http:', 'https:'].includes(url.protocol)) return Promise.reject(new ActionError('config'));
    const result = await this.coordinator.submit(url.origin, owner, config.uriCallsDelay ?? this.defaults.uriCallsDelay ?? 0, priority, async signal => {
      // background work gets its request budget when admitted, including subsequent redirects
      deadline ??= Date.now() + (action.timeout ?? this.defaults.requestTimeout ?? 10000);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new ActionError('timeout');
      const controller = new AbortController();
      const abort = () => controller.abort(new ActionError('aborted'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      const timer = setTimeout(() => controller.abort(new ActionError('timeout')), remaining);
      const headers = { ...action.headers };
      // 1.3.0 always sent supplied credentials immediately, even with immediately:false
      if ((config.username || config.password) && !Object.keys(headers).some(k => k.toLowerCase() === 'authorization')) {
        headers.Authorization = `Basic ${Buffer.from(`${config.username || ''}:${config.password || ''}`).toString('base64')}`;
      }
      try {
        const result = await this.follow(url, action.httpMethod || 'GET', action.body || '', headers, controller.signal);
        return result;
      } catch (error) {
        if (controller.signal.aborted) {
          const reason = controller.signal.reason as ActionError;
          if (reason.category !== 'timeout') this.stats.aborted++;
          throw reason;
        }
        throw error instanceof ActionError ? error : new ActionError('network');
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    }, deadline).catch(error => {
      if (error instanceof ActionError && error.category === 'timeout') this.stats.timeouts++;
      throw error;
    });
    const method = (action.httpMethod || 'GET').toUpperCase();
    if ([301, 302, 303, 307, 308].includes(result.status) && result.location && ['GET', 'HEAD'].includes(method)) {
      let next: URL;
      try { next = new URL(result.location, url); } catch { throw new ActionError('http'); }
      const sameOrigin = next.origin === url.origin;
      // custom headers can carry credentials too; never forward them to another origin
      const headers = sameOrigin ? { ...action.headers } : {};
      const nextConfig = sameOrigin ? config : { ...config, username: '', password: '' };
      return this.request({ ...action, url: next.href, headers }, nextConfig, owner, priority, depth + 1, deadline);
    }
    if (result.status < 200 || result.status >= 300) {
      this.stats.httpErrors++;
      // an explicit retry signal is an outage, never a device value or a successful write
      if ([429, 503].includes(result.status) && result.retryAfter !== undefined) {
        const seconds = Number(result.retryAfter);
        const delay = result.retryAfter.trim() && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(result.retryAfter) - Date.now();
        throw new ActionError('unavailable', Number.isFinite(delay) ? Math.max(0, Math.min(300000, delay)) : undefined);
      }
      if (action.strictHTTP) throw new ActionError([408, 429, 500, 502, 503, 504].includes(result.status) ? 'unavailable' : 'http');
    }
    if (action.responsePattern !== undefined) {
      let pattern: RegExp;
      try { pattern = new RegExp(action.responsePattern); } catch { throw new ActionError('config'); }
      // fixed legacy protocols can identify valid replies without changing their server
      if (!pattern.test(result.body)) throw new ActionError('inconclusive');
    }
    return result;
  }

  private async follow(url: URL, method: string, body: string, headers: Record<string, string>, signal: AbortSignal): Promise<HTTPResult> {
    const result = await new Promise<HTTPResult & { location?: string }>((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;
      const requestHeaders = { ...headers };
      if (body && !Object.keys(headers).some(k => k.toLowerCase() === 'content-length')) requestHeaders['Content-Length'] = String(Buffer.byteLength(body));
      const request = client.request(url, { method, headers: requestHeaders, signal, agent: url.protocol === 'https:' ? this.httpsAgent : this.httpAgent }, response => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) { request.destroy(new ActionError('http')); return; }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          this.stats.bytes += size;
          resolve({ body: Buffer.concat(chunks).toString('utf8'), status: response.statusCode ?? 0, location: response.headers.location, retryAfter: response.headers['retry-after'] });
        });
      });
      request.on('error', reject);
      request.end(body);
    });
    return result;
  }

  shutdown(): void { this.coordinator.shutdown(); this.httpAgent.destroy(); this.httpsAgent.destroy(); }
}

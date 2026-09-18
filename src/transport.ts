import http from 'node:http';
import https from 'node:https';
import { ActionError, type ActionConfig, type DeviceConfig } from './types.js';
import { Coordinator } from './coordinator.js';

export interface HTTPResult { body: string; status: number; location?: string }
export class Transport {
  private readonly httpAgent = new http.Agent({ keepAlive: true, maxSockets: 4, maxFreeSockets: 2 });
  private readonly httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 4, maxFreeSockets: 2 });
  readonly stats = { timeouts: 0, httpErrors: 0, aborted: 0, bytes: 0 };
  constructor(readonly coordinator: Coordinator) {}

  async request(action: ActionConfig, config: DeviceConfig, owner: string, priority = false, depth = 0, deadline = Date.now() + (action.timeout ?? 10000)): Promise<HTTPResult> {
    if (depth > 10) throw new ActionError('http');
    let url: URL;
    try { url = new URL(action.url); } catch { return Promise.reject(new ActionError('config')); }
    if (!['http:', 'https:'].includes(url.protocol)) return Promise.reject(new ActionError('config'));
    const result = await this.coordinator.submit(url.origin, owner, config.uriCallsDelay || 0, priority, async signal => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) { this.stats.timeouts++; throw new ActionError('timeout'); }
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
          if (reason.category === 'timeout') this.stats.timeouts++; else this.stats.aborted++;
          throw reason;
        }
        throw error instanceof ActionError ? error : new ActionError('network');
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    });
    const method = (action.httpMethod || 'GET').toUpperCase();
    if ([301, 302, 303, 307, 308].includes(result.status) && result.location && ['GET', 'HEAD'].includes(method)) {
      let next: URL;
      try { next = new URL(result.location, url); } catch { throw new ActionError('http'); }
      const crossOrigin = next.origin !== url.origin;
      const headers = crossOrigin ? {} : { ...action.headers };
      const nextConfig = crossOrigin ? { ...config, username: '', password: '' } : config;
      return this.request({ ...action, url: next.href, headers }, nextConfig, owner, priority, depth + 1, deadline);
    }
    if (result.status < 200 || result.status >= 300) {
      this.stats.httpErrors++;
      if (action.strictHTTP) throw new ActionError('http');
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
          resolve({ body: Buffer.concat(chunks).toString('utf8'), status: response.statusCode ?? 0, location: response.headers.location });
        });
      });
      request.on('error', reject);
      request.end(body);
    });
    return result;
  }

  shutdown(): void { this.coordinator.shutdown(); this.httpAgent.destroy(); this.httpsAgent.destroy(); }
}

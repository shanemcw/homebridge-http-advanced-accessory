import { createRequire } from 'node:module';
import type { State } from './types.js';

// trusted legacy configuration is executable JavaScript, not a security sandbox
const require = createRequire(new URL('../package.json', import.meta.url));
export function evaluateLegacy(expression: string, value: unknown, state: State): unknown {
  const self = { exp: expression, state };
  // direct eval deliberately retains value, self.state, this.state and CommonJS require
  return function (this: typeof self) {
    void value; void state; void require;
    return eval(self.exp);
  }.call(self);
}

export function interpolateLegacy(template: string, value: unknown, mappedValue: unknown, state: State): string {
  // ordinary placeholders do not need JavaScript evaluation
  let result = template;
  if (template.includes('${') || template.includes('`') || template.includes('\\')) {
    void state; void value; void require;
    result = eval('`' + template + '`') as string;
  }
  // string replacement preserves legacy replacement-token semantics as well
  return result.replace(/{value}/gi, String(mappedValue));
}

import { DOMParser } from '@xmldom/xmldom';
import xpath from 'xpath';
import { JSONPath } from 'jsonpath-plus';
import { evaluateLegacy } from './compatibility.js';
import { ActionError, type MapperConfig, type State } from './types.js';

export function mapValue(mappers: MapperConfig[] = [], input: unknown, state: State = {}): unknown {
  try {
    return mappers.reduce((value: unknown, mapper) => {
      const p = mapper.parameters;
      switch (mapper.type) {
        case 'static': {
          const mapping = mapper.parameters.mapping;
          // preserve 1.3.0 falsey mapping pass-through; changing it requires an opt-in
          return Object.hasOwn(mapping, String(value)) ? mapping[String(value)] || value : value;
        }
        case 'regex': {
          const { regexp, capture } = mapper.parameters;
          const matches = new RegExp(regexp).exec(String(value));
          const index = String(capture || '1');
          return matches && index in matches ? matches[Number(index)] : value;
        }
        case 'xpath': {
          const { xpath: expression, index = 0 } = mapper.parameters;
          const document = new DOMParser({ onError: () => { throw new ActionError('mapper'); } })
            .parseFromString(String(value), 'text/xml');
          const result = xpath.select(expression, document as unknown as Node);
          if (typeof result === 'string') return result;
          if (Array.isArray(result) && result.length > index) return (result[index] as { data?: string }).data;
          return value;
        }
        case 'jpath': {
          let json: unknown;
          try { json = JSON.parse(String(value)); } catch { return 'inconclusive'; }
          if (typeof json !== 'object') return 'inconclusive';
          const { jpath, index = 0 } = mapper.parameters;
          // safe filter evaluation retains JSONPath filters without native eval
          let result: unknown = JSONPath({ path: jpath, json: json as object, eval: 'safe' });
          if (Array.isArray(result) && result.length > index) result = result[index];
          return result instanceof Object ? JSON.stringify(result) : result;
        }
        case 'eval': return evaluateLegacy(mapper.parameters.expression, value, state);
        default: void p; throw new ActionError('config');
      }
    }, input);
  } catch (error) {
    if (error instanceof ActionError) throw error;
    // remote content or expressions may contain credentials; never expose the original error
    throw new ActionError('mapper');
  }
}

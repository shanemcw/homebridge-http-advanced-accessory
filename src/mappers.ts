import { DOMParser } from '@xmldom/xmldom';
import xpath from 'xpath';
import { JSONPath } from 'jsonpath-plus';
import { evaluateLegacy } from './compatibility.js';
import { ActionError, type MapperConfig, type State } from './types.js';

export function mapValue(mappers: MapperConfig[] = [], input: unknown, state: State = {}): unknown {
  return mapPipeline(mappers, input, state, false);
}

export function mapResponse(mappers: MapperConfig[] = [], input: unknown, state: State = {}, requireMatch = false): unknown {
  return mapPipeline(mappers, input, state, true, requireMatch);
}

function mapPipeline(mappers: MapperConfig[], input: unknown, state: State, response: boolean, requireMatch = false): unknown {
  let unmatched = false;
  let invalidDocument = false;
  try {
    const result = mappers.reduce((value: unknown, mapper) => {
      const p = mapper.parameters;
      switch (mapper.type) {
        case 'static': {
          const mapping = mapper.parameters.mapping;
          // preserve 1.3.0 falsey mapping pass-through; changing it requires an opt-in
          if (Object.hasOwn(mapping, String(value))) {
            unmatched = false; invalidDocument = false;
            return mapping[String(value)] || value;
          }
          return value;
        }
        case 'regex': {
          const { regexp, capture } = mapper.parameters;
          const matches = new RegExp(regexp).exec(String(value));
          const index = String(capture || '1');
          if (matches && index in matches) { unmatched = false; invalidDocument = false; return matches[Number(index)]; }
          unmatched = true;
          return value;
        }
        case 'xpath': {
          const { xpath: expression, index = 0 } = mapper.parameters;
          let document;
          try {
            document = new DOMParser({ onError: () => { throw new ActionError('mapper'); } })
              .parseFromString(String(value), 'text/xml');
          } catch (error) {
            if (!response) throw error;
            invalidDocument = true;
            unmatched = true;
            return value;
          }
          const result = xpath.select(expression, document as unknown as Node);
          if (typeof result === 'string') { unmatched = false; invalidDocument = false; return result; }
          if (Array.isArray(result) && result.length > index) { unmatched = false; invalidDocument = false; return (result[index] as { data?: string }).data; }
          unmatched = true;
          return value;
        }
        case 'jpath': {
          let json: unknown;
          try { json = JSON.parse(String(value)); } catch { unmatched = true; return 'inconclusive'; }
          if (typeof json !== 'object') { unmatched = true; return 'inconclusive'; }
          const { jpath, index = 0 } = mapper.parameters;
          // safe filter evaluation retains JSONPath filters without native eval
          let result: unknown = JSONPath({ path: jpath, json: json as object, eval: 'safe' });
          if (Array.isArray(result) && result.length > index) { unmatched = false; invalidDocument = false; result = result[index]; }
          else unmatched = true;
          return result instanceof Object ? JSON.stringify(result) : result;
        }
        case 'eval': {
          const result = evaluateLegacy(mapper.parameters.expression, value, state);
          // explicit user code may deliberately handle an earlier extraction miss
          unmatched = false; invalidDocument = false;
          return result;
        }
        default: void p; throw new ActionError('config');
      }
    }, input);
    // preserve intermediate legacy values so a later mapper can explicitly handle a miss
    return response && unmatched && (requireMatch || invalidDocument) ? 'inconclusive' : result;
  } catch (error) {
    if (error instanceof ActionError) throw error;
    // remote content or expressions may contain credentials; never expose the original error
    throw new ActionError('mapper');
  }
}

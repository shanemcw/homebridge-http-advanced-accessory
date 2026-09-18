# HTTP Advanced Accessory

Bridge HTTP-controlled devices into HomeKit using Homebridge. Configure a service, its getter/setter URLs, and optional response transformations. The Alpha adds a shared background state cache, bounded HTTP scheduling, and an optional dynamic platform.

**2.0.0-alpha.1 is a development prerelease candidate. Public release is gated by the validation checklist in [the implementation report](docs/implementation-report.md).** Stable users remain on 1.3.0 until they explicitly opt in. Existing `HttpAdvancedAccessory` configurations remain supported without rewriting them on the supported runtime matrix.

## Runtime requirements

- Node.js 22.13 or later in the 22.x line, or Node.js 24.x.
- Homebridge 1.11.4 or later in the 1.x line, or Homebridge 2.4 or later in the 2.x line.
- Older Node/Homebridge versions continue to use plugin 1.3.0. Upgrade Homebridge's runtime before testing this Alpha.

The package uses TypeScript compiled to ESM and the HAP API supplied by Homebridge. It does not load or bundle a second HAP runtime. The tested versions and remaining validation are recorded in [the report](docs/implementation-report.md).

## Existing accessory configuration

Keep existing entries in `accessories[]`, including their names and service definitions:

```json
{
  "accessory": "HttpAdvancedAccessory",
  "name": "Example Switch",
  "service": "Switch",
  "urls": {
    "getOn": { "url": "http://device.example/state" },
    "setOn": { "url": "http://device.example/set/{value}" }
  }
}
```

Keep your Homebridge storage, bridge identity and accessory names when upgrading. The legacy registration name, service ordering and characteristic identities are preserved; tests reuse HAP's identifier cache across replacement instances. This ordinary upgrade is separate from moving a device to platform configuration.

## Optional platform configuration

New installations can use one `HttpAdvanced` entry in `platforms[]`:

```json
{
  "platform": "HttpAdvanced",
  "name": "HTTP Advanced",
  "coordinator": { "concurrency": 4, "perOrigin": 2, "maxQueue": 256 },
  "devices": [
    {
      "id": "example-switch",
      "name": "Example Switch",
      "service": "Switch",
      "refresh": { "activeInterval": 5, "idleInterval": 60, "idleAfter": 60 },
      "urls": {
        "getOn": { "url": "http://device.example/state" },
        "setOn": { "url": "http://device.example/set/{value}" }
      }
    }
  ]
}
```

The platform restores cached accessories and removes obsolete ones only after successful inventory validation. Set a permanent `id` before pairing if you want to rename the device later. Otherwise its initial name is its identity. Keep the platform name stable. Invalid or duplicate inventories preserve cached accessories and report an error.

Legacy and platform definitions can coexist for **different devices**. Do not define the same device in both places: voluntary conversion uses different accessory UUIDs and may require rebuilding HomeKit assignments. There is no automatic migration tool. See [migration and rollback](docs/migration.md).

The schema provides platform settings. Arbitrary action-name maps, mapper parameters, property overrides and recursive fallback definitions remain available in Homebridge's JSON editor. Do not use the platform form to replace existing legacy blocks. The plugin never writes `config.json`.

## How reads and freshness work

HomeKit GETs read memory immediately. They do not wait for HTTP, retries, a queue, or another device. Unknown state returns HomeKit's communication error until the first usable refresh; an existing last-known value is returned while refreshing or recovering from failure.

A single scheduler serves both adapters. Default bounds are four total requests, two per origin, and 256 waiting requests. GETs for the same action never overlap. Overdue actions are serviced before recently refreshed ones, and eligible origins rotate. SETs have queue priority. Connections are reused.

| Setting | Unit | Behavior |
|---|---|---|
| `forceRefreshDelay` | seconds | Positive values retain explicit polling intervals; default 0 selects adaptive refresh. |
| `refresh.activeInterval` | seconds | Default 5 after startup and while reads are active. |
| `refresh.idleAfter` | seconds | Default 60 without a HomeKit read before switching to idle cadence. |
| `refresh.idleInterval` | seconds | Default 60 for idle devices. |
| `setterDelay` | milliseconds | Default 0. Positive values acknowledge immediately and debounce each characteristic; last write wins. |
| `uriCallsDelay` | milliseconds | Default 0. Minimum spacing between this device's request starts, including GETs, SETs and fallbacks. |

Intervals run after request completion, with up to 10% positive jitter. Startup acquisition is spread across the first second. Explicit polling is not shortened by HomeKit reads. With adaptive refresh, a stale read makes work eligible for a later scheduler tick (100 ms resolution); it still returns memory state. Errors back off exponentially up to five minutes plus jitter. Error fallback values also back off, so a working `resultOnError` cannot create a retry storm.

This changes the acquisition timing of `forceRefreshDelay: 0`: old versions fetched on demand, while Alpha learns state ahead of reads. It introduces bounded background traffic and finite staleness. Measure both freshness and load for your devices; very slow fleets can exceed the nominal interval. A 500-second configured interval still allows approximately 500 seconds of staleness. No cache promises mathematically instantaneous remote state.

Successful reads update HAP using `updateValue`, never a setter. Last successful values and timestamps are stored under Homebridge's persistence directory and restored only for an identical configuration fingerprint. Cache files contain values and hashes, not action URLs or credentials. A missing/corrupt cache is ignored. Persistence is periodic and at graceful shutdown; a crash can lose recent cache updates.

## Actions and HTTP

Action keys combine `get` or `set` with a characteristic name, such as `getOn`, `setBrightness`, or `getSecuritySystemTargetState`. Canonical HAP names are resolved by UUID; historical compact display names remain accepted.

Each action supports:

- `url`: HTTP or HTTPS endpoint.
- `httpMethod`: defaults to `GET`; legacy POST bodies and GET bodies are supported.
- `body`: string, sent without implicit JSON/form serialization.
- `headers`: optional explicit headers, including Content-Type if your endpoint requires one.
- `mappers`: ordered transformation chain.
- `resultOnError`: getter value returned on transport failure, bypassing mappers. Zero, false and empty string are valid fallbacks.
- `inconclusive`: another getter action when the mapped result is the string `"inconclusive"`. Up to 32 actions are allowed; cycles are rejected.
- `timeout`: total milliseconds including queueing, response body and redirects; default 10000.
- `strictHTTP`: default false. True treats non-2xx responses as errors.

For compatibility, non-2xx response bodies are mapped by default, as in 1.3.0. Status errors are counted separately in diagnostics. Enable `strictHTTP` to make these responses fail and use `resultOnError`. GET/HEAD redirects are followed (up to ten); each hop goes through the coordinator. Credentials and cookies are removed on cross-origin redirects. POST redirects are not automatically followed, matching legacy defaults. Responses are limited to 8 MiB to bound memory use.

Set `username` and `password` on a device for Basic Auth. Supplied credentials are sent immediately, including when legacy `immediately: false` is present: 1.3.0's explicit Authorization header already overrode that setting. Alpha preserves that behavior. Without credentials, Alpha omits the old empty `Basic Og==` header. Credentials embedded in a URL are also handled by Node's HTTP client. Use HTTPS for sensitive endpoints.

## SETs and templates

SETs apply mappers to the outgoing HomeKit value, expand templates, and send the request. A normal SET resolves after the HTTP operation; failures surface as a HomeKit error. `setterDelay` retains legacy immediate acknowledgement, so a later failure can only be logged and the cached value restored. Successful writes make an authoritative getter verification eligible immediately. Older in-flight GETs cannot overwrite the result of a newer SET.

`{value}` (case-insensitive) substitutes the **mapped** value. Legacy JavaScript template expressions see the original `value` and characteristic `state`:

```json
{
  "url": "http://device.example/set/${value}?mapped={value}",
  "httpMethod": "POST",
  "body": "temperature=${state.getTargetTemperature * 9/5 + 32}"
}
```

Expressions are available in setter URLs and bodies. Getter URLs/bodies remain literal, matching 1.3.0. `state.getOn`, `state.getTargetTemperature`, etc. retain the legacy mapper-output types; polling converts numeric characteristics as before.

## Mappers

A chain feeds each mapper's output into the next. Getter mappers consume response text; setter mappers consume the outgoing HomeKit value.

| Type | Parameters | Semantics |
|---|---|---|
| `static` | `mapping` object | Lookup by input value; unmatched values pass through. Legacy falsey mapped values (`0`, `false`, `""`) also pass through. Use strings `"0"`/`"1"` for numeric state or an eval expression for an intentional falsey result. |
| `regex` | `regexp`, `capture` (default `"1"`) | Return the selected capture, or original input when unmatched. |
| `xpath` | `xpath`, `index` (default 0) | XPath text-node selection or string expression. Select `/text()` or `string(...)`, not entire elements. |
| `jpath` | `jpath`, `index` (default 0) | JSONPath selection, indexed result, objects/arrays serialized as JSON. Malformed or non-object JSON returns `"inconclusive"`. |
| `eval` | `expression` | Execute the legacy JavaScript expression with `value`, `self.state`, and `this.state`. |

```json
[
  { "type": "jpath", "parameters": { "jpath": "$.u", "index": 0 } },
  { "type": "static", "parameters": { "mapping": { "0": "0", "1": "1", "unset": "0" } } }
]
```

**Eval and `${...}` templates execute trusted configuration as JavaScript with the privileges of Homebridge. They are not sandboxed.** Do not paste untrusted expressions. Evaluation is isolated in the compatibility module and exceptions are contained; a deliberately nonterminating expression can still block Node. JSONPath uses the maintained library's safe filter evaluator; exotic executable legacy JSONPath scripts need individual compatibility verification.

Malformed XML, invalid values, expression failures and exhausted numeric/boolean `inconclusive` results produce contained action failures. They cannot leave a getter callback waiting indefinitely. Numeric HAP formats are converted deliberately; unsupported values are rejected rather than cached as valid state.

## Services, optional characteristics and props

`service` uses the Homebridge HAP service name. `BatteryService` aliases `Battery`. Removed historical HAP services produce an explicit unsupported-service error; consult [the service inventory](docs/service-support.md). The old `HomeKitExtensionTypes.js` was never loaded by the plugin entry point and did not provide a working configuration feature.

`optionCharacteristic` selects optional characteristics in HAP's original service order. `props` overrides properties by canonical or legacy compact name:

```json
{
  "service": "Lightbulb",
  "optionCharacteristic": ["Brightness", "Hue", "Saturation"],
  "props": { "Brightness": { "minValue": 0, "maxValue": 100, "minStep": 1 } }
}
```

The legacy adapter retains the fixed Manufacturer, Model and SerialNumber values exposed by 1.3.0; its previously ignored `manufacturer`/`model` keys remain accepted. The platform honors these metadata settings. All historical extended examples (security system, contact sensor, Daikin, Yamaha and lightbulb) remain in [the legacy reference](docs/legacy-reference.md).

## Alpha installation and rollback

Once the Alpha tag has been published, explicitly select it in Homebridge UI or run in your Homebridge installation environment:

```sh
npm install -g homebridge-http-advanced-accessory@alpha
```

Back up Homebridge before testing. Restart Homebridge after installing. Leave existing legacy configuration and Homebridge storage unchanged. For an unpublished local candidate, install the reviewed tarball on a separate test instance first.

To roll back to the verified stable baseline:

```sh
npm install -g homebridge-http-advanced-accessory@1.3.0
```

Restart Homebridge. Platform definitions are Alpha-only: remove them and restore the backed-up legacy configuration if you had explicitly migrated. Do not delete Homebridge pairing or identifier storage during an ordinary plugin rollback.

## Troubleshooting and diagnostics

Set `debug: true` on one device to log a shared diagnostic snapshot every 30 seconds. It reports queue depth/high-water mark, concurrency, sampled request durations, cache ages, failure categories, next eligible refresh times and state-change counts. URLs, credentials, bodies, values and raw exception messages are omitted. Diagnostics are local; nothing is sent externally.

- Unknown startup state: wait for initial acquisition; check endpoint reachability and mapper output.
- Old values: inspect cache age, explicit refresh interval, queue depth and backoff before increasing concurrency.
- Slow writes: inspect backend latency and `setterDelay`/`uriCallsDelay`.
- Configuration error: inspect service names, action shapes and mapper syntax. Failed devices are isolated; invalid platform inventory is not reconciled destructively.
- Unexpected mapper result: remember legacy static falsey behavior and JSONPath object serialization.

Use [the measurement guide](docs/performance.md) to compare bulk-read latency and freshness. Include plugin/Homebridge/Node versions and sanitized diagnostics in reports, never your unredacted configuration.

## Development and release policy

```sh
npm ci
npm run check
HB_TEST_VERSION=1 npm test
npm run benchmark -- --save
npm pack --dry-run
```

CI exercises Node 22/24 and real Homebridge v1/v2 HAP implementations. Unit/integration tests use only loopback fake servers. `legacy-plugin` is a test-only alias of published 1.3.0; its obsolete dependencies are excluded from production installation and the tarball. `npm audit --omit=dev` audits the maintained runtime separately.

The first release must use `npm publish --tag alpha` and a GitHub prerelease. `publishConfig.tag` and the publish guard prevent accidental use of `latest`. No automatic publishing workflow is enabled. Stable requires broader device, restart and field evidence, not merely synthetic fixtures.

The existing Apache-2.0 LICENSE remains unchanged. Package metadata is reconciled to that file, which has existed since the initial commit; historical authorship is retained and the current maintainer is credited.

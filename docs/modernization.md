# Modernization details and developer reference

This reference describes the behavior of **2.0.0-alpha.5**. Start with the [README](../README.md) for the compatibility summary, installation and everyday configuration.

## What non-breaking means here

The existing `accessories[]` configuration model remains supported: the `HttpAdvancedAccessory` alias, device names, service definitions, getter/setter actions, encoded URLs, bodies, mapper chains, optional characteristics and property overrides can stay in place. Plugin Config summarizes these accessories; the plugin menu's JSON Config supports maintaining each definition separately. Runtime startup does not rewrite configuration. The shared cache, recovery and write-confirmation improvements apply without enabling a platform or modifying the web server.

Compatibility does not mean every runtime behavior is identical to 1.3.0. In particular:

| Area | Compatibility and limits |
|---|---|
| HomeKit identity | The legacy adapter retains its registration, service ordering and characteristic identities. Preserve accessory names and Homebridge pairing/identifier storage. Regression tests check identity continuity; physical-device and automation verification remains part of Alpha testing. |
| Optional platform | Legacy and platform devices can coexist. Moving an existing device to the platform creates a different identity; plan room, scene and automation assignments. There is no automatic identity-preserving migration tool. |
| Runtime support | Node 22.13+ in the 22.x line or Node 24.x; Homebridge 1.11.4+ in the 1.x line or 2.4+ in the 2.x line. Historical HAP services removed by a newer Homebridge version cannot be restored by this plugin. |
| Read timing | Default on-demand acquisition becomes background refresh. HomeKit reads return memory state promptly, with finite staleness and bounded background traffic. Positive polling intervals remain, with a brief confirmation phase after writes. |
| Writes | HTTP acknowledgement is followed by a bounded requested-state window while the getter catches up. Failed writes are not replayed. A matching response, expiry or command failure ends that command's pending state. |
| Responses and errors | Existing non-2xx body mapping remains the default, except 429/503 with `Retry-After`. Timeouts, size limits and invalid values produce contained failures. Stricter HTTP/extraction checks are optional. |
| Mapper compatibility | Legacy pass-through and raw-state semantics remain. Maintained JSONPath dependencies use a safe evaluator; unusual executable legacy JSONPath expressions require individual verification. |

See [upgrade and migration](migration.md), [supported services](service-support.md) and the behavior below before opting into Alpha on an existing installation.

## Shared settings and precedence

Shared settings live at top-level `httpAdvanced`, apply to both adapters, and are read by legacy child bridges as well. Per-action `timeout`, per-device `uriCallsDelay`, `setterDelay` and `writeConfirmationTimeout`, and individual device `refresh` values override their shared defaults. Positive `forceRefreshDelay` overrides the normal adaptive cadence. Request timeout, debounce, request spacing and write confirmation are milliseconds; refresh and recovery intervals are seconds.

Concurrency and recovery are coordinated per Homebridge process; child bridges share settings, not a cross-process queue. The earlier Alpha platform-level `coordinator` setting remains supported and overrides shared coordinator values within that platform's process. Within one process, each enabled platform applies its supplied coordinator keys in discovery order; the last supplied value for a key wins. Disabled platforms apply no overrides. For uniform limits, keep coordinator settings only in `httpAdvanced`. Plugin Config identifies platform-level overrides when present.

| Setting | Resolution, highest priority first | Unit / default |
|---|---|---|
| HTTP timeout | action `timeout`, global `requestTimeout`, built-in | ms / 10000 |
| Request spacing | device `uriCallsDelay`, global `uriCallsDelay`, built-in | ms / 0 |
| Setter debounce | device `setterDelay`, global `setterDelay`, built-in | ms / 0 |
| Write confirmation | device `writeConfirmationTimeout`, global value, built-in | ms / 10000 |
| Normal refresh | positive device `forceRefreshDelay`; otherwise each device `refresh` field, corresponding global field, built-in | seconds / active 5, idle 60, idle-after 60 |
| Recovery | global `recovery` fields, built-in | seconds / retry 5, max retry 30, quiet 90, reminder 300 |
| Request limits | enabled platform `coordinator` keys in discovery order, global `coordinator`, built-in | counts / total 4, per-origin 2, queue 256 |

Explicit zero overrides are supported for spacing, debounce and write confirmation; zero does not mean inherit. Timeout, refresh intervals, recovery retry/reminder intervals and request limits must be positive. A zero recovery quiet period enables immediate outage warnings. Platform-level timing settings other than the historical `coordinator` block are not a separate defaults layer: use global fields or device/action overrides.

Separate-process tests use Homebridge's real `User` storage path and API to verify shared defaults and isolated coordinator overrides. They do not advertise test bridges or replace a live child-bridge lifecycle check.

Increasing the HTTP timeout does not extend HomeKit's own request budget. It is mainly useful for background acquisition from slow servers; control writes still surface failures and are never automatically replayed.

## Configuration editor and platform lifecycle

The custom editor saves optional `platforms[]` entries and shared settings while preserving the loaded legacy `accessories[]` definitions, other plugins, bridge configuration and unknown fields. Each changed save retains an exact private backup beside `config.json`, checks for conflicting plugin edits (including legacy definitions edited elsewhere), and replaces the file atomically. Avoid simultaneous saves from multiple editors. The default plugin JSON/schema view identifies the legacy accessory alias and provides individual accessory editing; the custom UI summarizes legacy accessories and maintains platforms and shared settings. Runtime startup never rewrites configuration.

Plugin Config disables its controls while a save is pending so later input cannot be overwritten by the save response. Validation identifies shared fields or indexed platform/device blocks without echoing private values. Invalid shared settings on load direct the user to the full configuration editor for correction.

The platform restores cached accessories and removes obsolete ones only after successful inventory validation. Invalid or duplicate inventories preserve cached accessories and report an error. Set a permanent device `id` before pairing if the display name may change later; without one, its initial name is its identity. Keep the platform name stable. An omitted `enabled` means enabled. After restart, disabling retains definitions and cached identities while reporting device reads and commands unavailable; see [platform lifecycle](#platform-lifecycle).

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
| `writeConfirmationTimeout` | milliseconds | Default 10000 after HTTP success. Hold the requested value until a getter confirms it or this window expires; 0 disables the window. |
| `uriCallsDelay` | milliseconds | Default 0. Minimum spacing between this device's request starts, including GETs, SETs and fallbacks. |

Intervals run after request completion, with up to 10% positive jitter. Startup acquisition is spread across the first second. Explicit polling is not shortened by HomeKit reads. With adaptive refresh, a stale read makes work eligible for a later scheduler tick (100 ms resolution); it still returns memory state. Errors back off exponentially up to five minutes plus jitter. Error fallback values also back off, so a working `resultOnError` cannot create a retry storm.

Temporary network failures, timeouts, inconclusive responses, HTTP 429/503 responses with `Retry-After`, and transient HTTP errors rejected by `strictHTTP` share recovery by configured URL origin within a runtime. Background requests pause together, then probe one at a time after 5, 10, 20, and at most 30 seconds between failed probes. Server retry guidance can extend the pause up to five minutes. Queued background reads for a recovering origin are returned to the cache scheduler, freeing queue capacity for healthy origins and writes. This internal deferral is not a failed request and does not apply `resultOnError`. A usable response releases the origin and makes affected cached getters eligible again under the normal concurrency and spacing limits. Other origins and control writes retain normal scheduling. Writes are never automatically replayed; a failed write still reports failure.

Short interruptions stay quiet in normal logs. After 90 seconds without a usable response, one endpoint warning appears, with reminders at most every five minutes and one recovery notice. Short recoveries use debug logging. Enabling device diagnostics does not multiply warnings. Unknown state remains unknown until acquired; known state remains available unless an explicit `resultOnError` supplies a fallback. Actual mapper/configuration failures remain action-specific warnings. An endpoint that stays unavailable continues probing; there is no 30-second outage cutoff.

This changes the acquisition timing of `forceRefreshDelay: 0`: old versions fetched on demand, while Alpha learns state ahead of reads. It introduces bounded background traffic and finite staleness. Measure both freshness and load for your devices; very slow fleets can exceed the nominal interval. A 500-second configured interval still allows approximately 500 seconds of staleness. No cache promises mathematically instantaneous remote state.

Successful reads update HAP using `updateValue`, never a setter. Last successful values and timestamps are stored under Homebridge's persistence directory and restored only for an identical configuration fingerprint. Cache files contain values and hashes, not action URLs or credentials. A missing/corrupt cache is ignored. Persistence is periodic and at graceful shutdown; a crash can lose recent cache updates.

## Actions and HTTP

Action keys combine `get` or `set` with a characteristic name, such as `getOn`, `setBrightness`, or `getSecuritySystemTargetState`. Canonical HAP names are resolved by UUID; historical compact display names remain accepted.

Each action supports:

- `url`: HTTP or HTTPS endpoint.
- `httpMethod`: defaults to `GET`; legacy POST bodies and GET bodies are supported.
- `body`: string, sent without implicit JSON/form serialization.
- `headers`: optional explicit headers, including Content-Type if your endpoint requires one.
- `responsePattern`: optional JavaScript regular expression, without enclosing `/` delimiters, that the raw response body must match. A mismatch fails acquisition before mapping, retaining cached state unless an explicit `resultOnError` supplies a fallback. It also fails writes without replaying them. Omit it to retain unrestricted response formats.
- `requireResponseMatch`: default false. Opt-in getter protection against missing regex/JSONPath/XPath extractions that no later mapper explicitly handles. The default preserves legacy missing-match pass-through. It does not change outgoing setter mapping.
- `mappers`: ordered transformation chain.
- `resultOnError`: getter value returned on transport failure, bypassing mappers. Zero, false and empty string are valid fallbacks.
- `inconclusive`: another getter action when the mapped result is the string `"inconclusive"`. Up to 32 actions are allowed; cycles are rejected.
- `timeout`: milliseconds for the response body and redirects; default 10000 unless shared `requestTimeout` overrides it. Background acquisition starts its budget when first admitted to the network, so waiting behind an unavailable endpoint does not consume it. Control writes retain a total budget including initial queueing. A queued write rejects when that budget expires even if no slot has opened; it is removed from the queue and cannot execute later.
- `strictHTTP`: default false. True treats non-2xx responses as errors. Statuses 408, 429, 500, 502, 503, and 504 use shared recovery even without retry headers; other statuses remain action-specific failures.

For compatibility, non-2xx response bodies are mapped by default, as in 1.3.0, except HTTP 429/503 responses carrying `Retry-After`: those explicitly signal temporary unavailability and are never mapped as successful state or accepted as successful writes. Retry guidance accepts seconds or an HTTP date, bounded to five minutes; invalid guidance uses normal backoff. Status errors are counted separately in diagnostics. Enable `strictHTTP` to make other non-2xx responses fail and use `resultOnError`. GET/HEAD redirects are followed (up to ten); each hop goes through the coordinator. All configured request headers (including custom API keys, cookies and Authorization) and device Basic Auth credentials are removed on cross-origin redirects. Same-origin redirects retain them. This security change can affect configurations that previously forwarded custom headers to a different origin: configure the final trusted endpoint directly when it needs those headers. POST redirects are not automatically followed, matching legacy defaults. Responses are limited to 8 MiB to bound memory use.

Set `username` and `password` on a device for Basic Auth. Supplied credentials are sent immediately, including when legacy `immediately: false` is present: 1.3.0's explicit Authorization header already overrode that setting. Alpha preserves that behavior. Without credentials, Alpha omits the old empty `Basic Og==` header. Credentials embedded in a URL are also handled by Node's HTTP client. Use HTTPS for sensitive endpoints.

### Servers you cannot change

Recovery does not require a gateway upgrade, JSON error messages, accurate HTTP status codes, or `Retry-After`. Timeouts and disconnections already trigger shared backoff. Malformed JSON/XML that the mapper chain cannot handle and numeric responses that cannot be converted to their characteristics also retain cached state and retry quietly.

For stricter extraction, set `"requireResponseMatch": true` on a getter. Missing JSONPath selections and missing regex/XPath node matches then become inconclusive when no later mapper explicitly handles the miss. This prevents leftover HTML, timeout text, or a missing field from becoming an accidental false/off value. It is opt-in because existing installations can deliberately rely on missing-match pass-through.

Request URLs, HTTP methods (including POST-based reads), bodies, authentication, and outgoing mapper behavior are unchanged. Intermediate mapper values retain legacy behavior so a later explicit mapping or `eval` can handle them. For example, a JSONPath miss followed by a static mapping from `"[]"` to `"0"` deliberately reports zero. An `inconclusive` fallback action still works. Successful false, zero, and empty-string selections remain valid.

With stricter extraction enabled, if an absent field deliberately means off for your protocol, express that in a mapper instead of relying on the final boolean conversion. Static mapper pass-through, scalar XPath results, and explicit `eval` results remain authoritative; the plugin cannot infer that every unfamiliar string or empty value is an error. Use an existing mapper to return `"inconclusive"` for recognized busy responses, or add an optional raw-response guard for a fixed vocabulary:

```json
{
  "url": "http://device.example.invalid/state",
  "httpMethod": "POST",
  "body": "command=read",
  "responsePattern": "^(?:ON|OFF)\\s*$",
  "mappers": [
    { "type": "regex", "parameters": { "regexp": "^(ON|OFF)\\s*$" } },
    { "type": "static", "parameters": { "mapping": { "ON": "1", "OFF": "0" } } }
  ]
}
```

The guard accepts the two state words with trailing whitespace; the regex mapper captures the word so a server's line ending cannot change the static lookup. On a setter that acknowledges commands with `OK`, `"responsePattern": "^OK\\s*$"` accepts the acknowledgement with optional whitespace and rejects an HTTP 200 busy/error reply. The write is sent once and its failure is reported. A guard mismatch is a response failure, so an explicit getter `resultOnError` may supply a fallback; the `inconclusive` action applies to mapped inconclusive results. Anchor patterns when the entire reply must match. Use `strictHTTP` only when the server's status codes can be trusted; otherwise retain intentional error-body mappings.

## SETs and templates

SETs apply mappers to the outgoing HomeKit value, expand templates, and send the request. A normal SET resolves after the HTTP operation; failures surface as a HomeKit error. `setterDelay` retains legacy immediate acknowledgement, so a later failure can only be logged and the cached value restored. The requested characteristic value stays visible during debounce and the HTTP operation, then for up to `writeConfirmationTimeout` (default 10 seconds) after HTTP success. This prevents an older server state from flipping the HomeKit control back while the command takes effect. The matching getter becomes eligible immediately and, while awaiting confirmation, at intervals of at most one second after each successful response, subject to normal queue limits, request spacing and outage backoff. This brief confirmation phase also applies to devices with longer explicit polling intervals; their normal cadence resumes afterward.

A matching usable getter response ends the window early. At expiry, HomeKit returns to the latest observed state, or a communication error if none is known. An HTTP failure clears that command's pending value immediately. GETs that overlap a write cannot confirm it, and error fallback values cannot confirm it either. Pending values are never persisted or substituted into legacy mapper/template state. Rapid toggles keep the newest intent; commands are never automatically replayed. No gateway upgrade is required. Shared diagnostics use the `HTTP Advanced` log prefix; accessory-specific messages keep the accessory name.

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

A chain feeds each mapper's output into the next. Getter mappers consume response text; setter mappers consume the outgoing HomeKit value. The table describes intermediate and default pass-through behavior. With `requireResponseMatch`, an unresolved extraction miss at the end of a getter chain becomes `"inconclusive"`.

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

`service` uses the Homebridge HAP service name. `BatteryService` aliases `Battery`. Removed historical HAP services produce an explicit unsupported-service error; consult [the service inventory](service-support.md). The old `HomeKitExtensionTypes.js` was never loaded by the plugin entry point and did not provide a working configuration feature.

`optionCharacteristic` selects optional characteristics in HAP's original service order. `props` overrides properties by canonical or legacy compact name:

```json
{
  "service": "Lightbulb",
  "optionCharacteristic": ["Brightness", "Hue", "Saturation"],
  "props": { "Brightness": { "minValue": 0, "maxValue": 100, "minStep": 1 } }
}
```

The legacy adapter retains the fixed Manufacturer, Model and SerialNumber values exposed by 1.3.0; its previously ignored `manufacturer`/`model` keys remain accepted. The platform honors these metadata settings. All historical extended examples (security system, contact sensor, Daikin, Yamaha and lightbulb) remain in [the legacy reference](legacy-reference.md).

## Platform lifecycle

After saving and restarting, a disabled platform retains cached identities but reports its device reads and commands unavailable. Re-enabling with the same platform name and device IDs restores those identities. Invalid enable flags or inventories retain cached accessories and report them unavailable instead of accepting commands without a working device handler. A valid empty inventory explicitly unregisters its devices.

Local integration tests serialize and deserialize Homebridge platform accessories between fresh API instances, covering disable, rename/re-enable, real getter/setter handlers, invalid inventory retention and explicit removal. This verifies the persistence boundary without pairing a field HomeKit controller.

## Measurements and validation

The recorded synthetic fixture compares about 2.15 seconds for a blocking 41-getter read with about 3 ms for a warmed 44-device cached snapshot, issuing no new HTTP getter requests for that snapshot. Refreshing all 44 devices separately took about 2.25 seconds. These measure different stages: the cache speeds up HomeKit reads; it does not make the web server or physical device instantaneous. They are fixture measurements, not a promised speedup on every installation.

Use the [measurement guide](performance.md) to compare read latency, cache freshness and sustained backend load together. The [implementation report](implementation-report.md) records tested versions, package checks and remaining release gates; [Alpha release notes](alpha-release-notes.md) summarize the candidate.

## Development and release policy

The core is TypeScript compiled to ESM. Homebridge supplies HAP at runtime; the plugin does not bundle a second HAP implementation. Legacy and platform adapters share the HTTP coordinator, cache and mapping core.

```sh
npm ci
npm run check
HB_TEST_VERSION=1 npm test
npm run benchmark -- --save
npm pack --dry-run
```

CI exercises Node 22/24 and real Homebridge v1/v2 HAP implementations. Unit/integration tests use only loopback fake servers. `legacy-plugin` is a test-only alias of published 1.3.0; its obsolete dependencies are excluded from production installation and the tarball. `npm audit --omit=dev` audits the maintained runtime separately.

Any future public prerelease must use an explicit tag matching its version channel (`alpha` or `beta`) and be marked as a GitHub prerelease. The guard rejects stable versions, channel mismatches and `latest`. `publishConfig.tag` remains `alpha` for this Alpha candidate; update it deliberately when preparing Beta. No automatic publishing workflow is enabled. Stable requires broader device, restart and real-installation evidence, not merely synthetic fixtures.

The existing Apache-2.0 LICENSE remains unchanged. Package metadata is reconciled to that file, which has existed since the initial commit; historical authorship is retained and the current maintainer is credited.

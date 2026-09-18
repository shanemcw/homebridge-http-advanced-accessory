# Alpha implementation and release checkpoint

Status as of 2026-09-13: Alpha.5 is a local, uncommitted candidate. The four-combination test matrix passes; the current review and remaining field gates are tracked in [Beta readiness](beta-readiness.md). Alpha.4 is the last verified field deployment. No publication or upstream announcement is part of this checkpoint.

## Baseline and architecture

The work began from repository commit `2933f9a` and the separately installed published npm package 1.3.0. Their mapper code matches, but their handling of `inconclusive` without a fallback differs: the GitHub revision can fail to call back, while npm 1.3.0 returns the sentinel. Tests use the published package as their baseline.

A TypeScript/ESM core now handles configuration, mapping, native HTTP(S), bounded scheduling, state cache and persistence. Both the unchanged `HttpAdvancedAccessory` adapter and new `HttpAdvanced` dynamic platform use it. Homebridge supplies HAP at runtime. The obsolete request and polling libraries are absent from runtime dependencies; a test-only 1.3.0 alias retains them solely for differential regression tests.

Normal GET handlers read memory. Acquisition runs independently, with global/per-origin bounds, overdue-action ordering, action deduplication, write priority, pacing, backoff and shutdown cancellation. HAP updates use `updateValue`. Writes invalidate older reads, including reads started during a write. Cached platform accessories are restored/reconciled; state persistence uses per-action hashed files under Homebridge storage so separate child bridges cannot overwrite one shared snapshot file.

## Compatibility decisions

- Preserve the legacy alias, HAP identity seed, service ordering, characteristic UUIDs and optional characteristic order. Tests use Homebridge's real accessory factory and HAP identifier cache.
- Preserve static mapper falsey pass-through, immediate credential sending even with `immediately:false`, and non-2xx body mapping. These surprising behaviors are observable in npm 1.3.0. Strict HTTP status rejection is opt-in.
- Preserve raw mapper-output types in legacy template state. Numeric polling state remains numeric. HAP itself normalizes bounds/steps on an unbound characteristic using supported APIs, avoiding a second implementation of HAP coercion.
- Preserve immediate acknowledgement and last-write debounce when `setterDelay` is configured. Delayed errors remain log-only, with cache restoration.
- Preserve explicit polling intervals, including all three 500-second entries in the 44-device fixture. Default on-demand acquisition becomes adaptive background refresh: five seconds during active use, sixty seconds when idle. This deliberately changes acquisition timing and needs field validation for freshness/load.
- Omit the old empty Basic Authorization header when no credentials are configured, as allowed by the brief.
- Bound HTTP total duration (default ten seconds), response size (8 MiB), redirects (ten), fallback depth (32), pending queue and retries. Malformed remote values no longer leave getter callbacks hanging.
- Retain trusted eval/template execution in a dedicated compatibility module. JSONPath uses the maintained implementation's safe evaluator. Exotic executable JSONPath scripts and expressions depending on undocumented closure internals still need individual assessment.
- Alias BatteryService to Battery. List services removed by HAP v2 explicitly; do not invent substitutes.
- Preserve fixed legacy Manufacturer/Model/SerialNumber values; honor configuration metadata in the new platform path.
- Voluntary legacy-to-platform migration has a different UUID namespace. There is no automatic migration tool or identity-preservation claim for that conversion.

## Tooling, metadata and licensing

The candidate version is 2.0.0-alpha.5. Declared runtime support is Node ^22.13.0 or ^24.0.0, Homebridge ^1.11.4 or ^2.4.0. This conservative matrix uses current available Homebridge versions rather than claiming untested support for every historical v1/v2 minor release.

Official references checked during the initial implementation:

- [Homebridge v2 migration guidance](https://github.com/homebridge/homebridge/wiki/Updating-To-Homebridge-v2.0)
- [Node update guidance](https://github.com/homebridge/homebridge/wiki/How-To-Update-Node.js)
- [Official TypeScript/ESM plugin template](https://github.com/homebridge/homebridge-plugin-template)
- [Verified plugin requirements](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

Repository, homepage and issue metadata point to the maintained repository. Original author metadata remains; the maintainer is credited as a contributor. The LICENSE has been Apache-2.0 since initial commit `b7f0d4c`; only the contradictory package metadata was reconciled. The LICENSE and historical notices are unchanged. This does not relicense the project.

The package allowlist includes built runtime, schema, custom settings UI, documentation and sample configuration. Tests, development preview scripts, old runtime sources, the planning brief, local configuration, logs, credentials and node_modules are excluded. The custom UI summarizes legacy accessories and directs individual editing to the plugin menu's JSON Config. It maintains platform JSON and global settings stored at top-level `httpAdvanced`, preserving loaded legacy definitions on save.

The standard Homebridge plugin config API selects one alias/type. The custom UI therefore uses an editor restricted to this plugin's two aliases and shared settings. It merges into the latest configuration, refuses conflicting plugin edits, preserves unrelated entries and unknown fields, makes a private exact backup, and atomically replaces the file. A per-file lock serializes custom editor saves; other Homebridge editors do not participate in that lock, so avoid simultaneous saves from different tools. A lock left by a terminated process is reclaimed; an unreadable lock requires stopping the UI and removing `config.json.http-advanced.lock` before retrying. File ownership, group and mode are preserved, or the save fails.

Local verification covers the real custom-UI IPC helper and browser editing/save/reload against an isolated sanitized 44-device configuration. Earlier Alpha.3 device control passed field testing, and the Alpha.4 deployment restored all 44 legacy accessories while preserving configuration and pairing identifiers. Alpha.5 has not been deployed; its changes still need field acceptance.

## Measurements

The reproducible synthetic benchmark uses a serialized 50 ms loopback backend and real HAP serialization. The 41 legacy on-demand entries took about 2146 ms and caused 41 HTTP reads. The warmed Alpha serialized all 44 entries in about 3.1 ms with zero new getter requests. The independent 44-device sweep took about 2249 ms; median cache age at the end was 1121 ms, p95 2090 ms and max 2189 ms. Maximum concurrency was two, queue high-water 42, and there were no request failures. See `benchmark-results.json` for the exact recorded run.

Field performance remains to be measured on comparable stable and Alpha installations. The synthetic benchmark establishes repeatable scheduler and serialization behavior but is not evidence of field latency or freshness improvement.

## Validation checkpoint

The automated suite covers published behavior, all five mapper types, templates, GET/POST/GET-body transport, auth, status handling, fallback recursion, timeout/abort, queue bounds, pacing/fairness, persistence, debouncing, stale-read races, HAP identity, real plugin loading, schema, platform restoration/removal and the 44-device workload.

Dated local checkpoints are recorded below; historical results are not evidence for the final candidate. Development dependencies include intentionally vulnerable historical packages from the 1.3.0 regression baseline; none are runtime dependencies.

## Remaining Beta gates

- Exercise Alpha.5 in the actual Homebridge UI and managed child bridges, including restart, disabled/re-enabled platform devices and retained legacy identities.
- Verify Apple Home pairing, rooms/scenes/automations, command confirmation and manual device updates after the candidate is installed.
- Test a backend outage longer than 30 seconds and recovery under representative field traffic, with commands during the outage and polite logs.
- Measure sustained cache age, backend request rate and field `/accessories` latency; compare equivalent workloads rather than warmed snapshot speed alone.
- Verify backup/rollback and inspect the final candidate diff and tarball. Run remote CI on the final review commit when committing/pushing is authorized.

The maintainer announcement is planned for Beta.1 after these gates. Committing, deployment, npm publication and upstream contact require the owner's next instruction. If publication is later authorized, use a matching prerelease version and channel (`alpha` or `beta`); stable/latest remain forbidden by the guard.

### Initial implementation matrix

Node 22.23.2 and Node 24.21.0 each run the suite against Homebridge 1.11.4 and 2.4.0. The four combinations pass 44 tests each (176 executions), including the actual ESM plugin loader. Typecheck, lint and whitespace checks pass. The 45-file package was inspected and installed under an isolated temporary directory with production dependencies only. Its entry point loads and registers both adapters without request, polling-to-event, legacy-plugin or Homebridge in its dependency tree. Remote CI is recorded with the review branch.

### Alpha.3 write-confirmation checkpoint

On Node 24.19.0, all 88 tests pass against both Homebridge 1.11.4 and 2.4.0 (176 executions); typecheck and lint pass. Added coverage includes a plain HTTP server acknowledging commands before its mapped state changes, reads completing during writes, debounced and overlapping writes, failed commands, confirmation expiry during endpoint recovery, unknown-state errors, observed-only persistence, and real Homebridge logger prefixes. The ten-second default confirmation window is configurable globally and per device. Field reports indicate that Apple Home toggling and manual operation at the device pass on the deployed alpha.3. Alpha.4 adds the legacy accessory summary, navigation back to the plugin menu, and theme-aware settings fields; browser checks with sanitized fixtures preserve all 44 accessory definitions exactly when saving shared settings.

### Alpha.5 local code review

The review found that a control write queued behind an occupied slot could exceed its deadline without rejecting until admission. Queue deadlines now reject on time and remove the command, while background reads retain their admission-based budget. The regression holds the slot past the write deadline and verifies both prompt rejection and no later HTTP command. Timeout diagnostics count the rejection once.

Plugin Config now prevents editing during an in-flight save, uses field-specific numeric validation, generates unused default platform names, and reports indexed platform/device errors without revealing configuration values. Invalid shared settings on load identify the field and the full configuration editor needed to repair it. Platform coordinator overrides keep their existing process-wide precedence; UI guidance and a regression make that boundary explicit.

Startup version reporting uses package metadata. The publication guard accepts only matching Alpha/Beta versions and tags and still rejects stable/latest. The working version remains alpha.5; no publication is enabled or performed.

Validation: Node 24.19.0 passes typecheck, lint and all 92 tests against both Homebridge 1.11.4 and 2.4.0 (184 executions). The focused eight-test configuration suite also passes after the final wording adjustment. Browser checks with sanitized fixtures cover delayed-save locking, integer/positive limits, unique platform names, indexed validation errors, draft retention, error focus, and save/reload with 44 legacy accessories plus a disabled platform. Package dry-run includes package-derived version metadata and excludes tests and preview scripts. This was the first local pass; the deeper review checkpoint below supersedes its test count. These changes are local, uncommitted and undeployed.

### Alpha.5 deeper review checkpoint — 2026-09-13

Paused-origin background reads now leave the pending queue and return to the scheduler, freeing capacity for healthy origins and writes. Internal deferral does not count as another endpoint failure or invoke `resultOnError`. Tests exercise a 40-device recovery workload with a four-slot queue, preserved known state, unknown state without a fabricated fallback, a command during recovery, and bounded refresh after the pause. A malformed getter URL no longer interrupts scheduling for other origins.

Disabled platform devices retain their cached identities but fail reads and commands with HomeKit communication errors after restart. Malformed enable flags, inventories and coordinator settings also retain devices as unavailable. Tests serialize and restore real Homebridge accessories between API instances, then verify re-enable preserves UUIDs and explicit empty inventory removes devices. This does not substitute for a live managed-child-bridge restart.

Settings tests cover per-action timeout, zero-valued device overrides, shared defaults and platform coordinator precedence. Separate OS processes use Homebridge's actual storage-path API to verify that shared defaults load in each process while coordinator overrides stay process-local. The [settings reference](modernization.md#shared-settings-and-precedence) records the existing discovery-order rule for multiple platform coordinator overrides. Registration aliases and package-derived version reporting now share one metadata module.

Node 22.23.2 and Node 24.19.0 each pass all 97 tests against Homebridge 1.11.4 and 2.4.0: 388 test executions, no failures or skips. Typecheck and lint pass on both Node versions. Alpha.5 remains local, uncommitted and undeployed. The Beta readiness checklist distinguishes these local checks from outstanding field validation.

The reviewed 59-file tarball installs with production dependencies only and loads both registration aliases without a bundled Homebridge or the historical request/polling libraries. Package metadata and UI assets are present; tests, preview scripts and local configuration are excluded. The isolated production dependency audit reports zero known vulnerabilities on 2026-09-13. These package checks are local and do not deploy or publish the candidate.

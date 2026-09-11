# Alpha implementation and release checkpoint

Status: implemented; local matrix, package smoke test and runtime audit pass. Remote CI and field validation remain release gates. This is not a declaration that the public Alpha release is complete.

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

The candidate version is 2.0.0-alpha.1. Declared runtime support is Node ^22.13.0 or ^24.0.0, Homebridge ^1.11.4 or ^2.4.0. This conservative matrix uses current available Homebridge versions rather than claiming untested support for every historical v1/v2 minor release.

Current official references checked during implementation:

- [Homebridge v2 migration guidance](https://github.com/homebridge/homebridge/wiki/Updating-To-Homebridge-v2.0)
- [Node update guidance](https://github.com/homebridge/homebridge/wiki/How-To-Update-Node.js)
- [Official TypeScript/ESM plugin template](https://github.com/homebridge/homebridge-plugin-template)
- [Verified plugin requirements](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

Repository, homepage and issue metadata point to the maintained repository. Original author metadata remains; the maintainer is credited as a contributor. The LICENSE has been Apache-2.0 since initial commit `b7f0d4c`; only the contradictory package metadata was reconciled. The LICENSE and historical notices are unchanged. This does not relicense the project.

The package allowlist includes built runtime, schema, documentation and sample configuration. Tests, old runtime sources, the planning brief, household configuration, logs, credentials and node_modules are excluded. The UI schema preserves advanced JSON configuration; visual Homebridge UI verification remains outstanding.

## Measurements

The reproducible synthetic benchmark uses a serialized 50 ms loopback backend and real HAP serialization. The 41 legacy on-demand entries took about 2146 ms and caused 41 HTTP reads. The warmed Alpha serialized all 44 entries in about 3.1 ms with zero new getter requests. The independent 44-device sweep took about 2249 ms; median cache age at the end was 1121 ms, p95 2090 ms and max 2189 ms. Maximum concurrency was two, queue high-water 42, and there were no request failures. See `benchmark-results.json` for the exact recorded run.

The owner supplied eight newly instrumented live baseline HTTP-request timings: median 4.5 seconds, seven samples between 4.3 and 5.2 seconds, and one 0.03-second result. These are a different environment and workload from the synthetic benchmark. No live Alpha improvement has yet been measured. See `performance.md` for the instrumentation boundary and recent-snapshot caveat.

## Validation checkpoint

The automated suite covers published behavior, all five mapper types, templates, GET/POST/GET-body transport, auth, status handling, fallback recursion, timeout/abort, queue bounds, pacing/fairness, persistence, debouncing, stale-read races, HAP identity, real plugin loading, schema, platform restoration/removal and the 44-device workload.

The final local matrix and remote CI results are recorded below when complete. Runtime dependency audit currently reports zero known vulnerabilities. Development audit includes intentionally vulnerable historical packages from the 1.3.0 regression baseline; none are runtime dependencies.

## Remaining release gates

- Confirm all four Node 22/24 × Homebridge v1/v2 jobs pass on the final commit.
- Review the final npm tarball, package version and alpha-only publication guard.
- Exercise Homebridge UI configuration visually and test a real restart/restore cycle on the Alpha installation.
- Verify existing Apple Home pairing, rooms/scenes/automations and accessory identity on that installation.
- Measure the unchanged Home Control reader against the Alpha; compare its new `took` metric with the supplied baseline and separately measure end-to-end orchestration.
- Measure sustained cache age and backend request rate; approve cadence based on freshness, not snapshot speed alone.
- Confirm the planned npm/GitHub prerelease publication after these checks; publish only with `--tag alpha`, mark GitHub prerelease and verify `latest` remains 1.3.0.

Do not publish stable 2.0.0 or move `latest`. The first Alpha is not complete until applicable field and publication gates are satisfied.

### Local final matrix

Node 22.23.2 and Node 24.21.0 each run the suite against Homebridge 1.11.4 and 2.4.0. The four combinations pass 44 tests each (176 executions), including the actual ESM plugin loader. Typecheck, lint and whitespace checks pass. The 45-file package was inspected and installed under an isolated temporary directory with production dependencies only. Its entry point loads and registers both adapters without request, polling-to-event, legacy-plugin or Homebridge in its dependency tree. Remote CI is recorded with the review branch.

# Proposal: preserve individual HTTP commands

**Planned for review, 2026-09-19; not implemented.** Add an optional per-action distinction between individual commands and target-value writes. Existing configuration and defaults remain unchanged.

## Why this helps

“Set brightness to 40%” and “volume up” behave differently. Combining rapid target changes can be useful; combining three deliberate presses loses commands. HTTP devices also vary in whether they report their actual state. This proposal supports those differences without requiring server changes. Working dedicated integrations stay outside its scope.

## Connection to #55

@seidnerj’s [#55](https://github.com/staromeste/homebridge-http-advanced-accessory/pull/55) shares this contribution’s TypeScript and dependency-modernization goals. It also ports and registers the custom FanIR/TVIR definitions dormant in the original extension file. That work highlights command-oriented controls, and suggests a useful general HTTP improvement beyond those service names.

Our implementation is independent; it does not incorporate #55’s commits or cover every feature/runtime choice. Custom-service compatibility, older runtime support and full TV integration remain separate decisions. The maintainer and contributor can review the action behavior together before expanding that scope.

## What works today

Setters can operate without getters. Device-level `setterDelay: 0` overrides a positive shared debounce default, but applies to every setter on that device. Request spacing and concurrency are separate controls.

A loopback fixture on Homebridge 1 and 2 submitted up, up, down through a standard VolumeSelector setter, with no getter and concurrency limited to one. Zero debounce sent all three commands; 50 ms debounce sent only the last. This confirms the mixed-action use case, not physical-device or Apple Home UI support.

## Proposed contract

- **Explicit opt-in:** choose individual-command behavior per action; settle the field name in review. Omission retains existing timing precedence. Do not infer behavior from the HTTP method or device name.
- **Preserve presses:** bypass last-write debounce and submit admitted commands for the same configured device in order, with appropriate spacing. Specify ordering with target-value writes on that device; leave unrelated devices unchanged.
- **Bound delivery:** retain queue limits, deadlines and shutdown cancellation. Report rejected/expired work; never execute expired commands later or automatically replay failed/uncertain commands. A timeout can follow delivery, so this cannot promise exactly-once physical execution.
- **Use real feedback:** keep acknowledgements, requested targets and observations distinct. Do not treat an increment/toggle code as resulting state or use it for target-value confirmation. Command-only endpoints need no fabricated getter.
- **Preserve compatibility:** keep aliases, encoded commands, mappings, defaults and HomeKit identities. Both adapters and config editors must preserve and validate the opt-in field.

Prefer standard HAP controls where appropriate; the [official TV example](https://github.com/homebridge/HAP-NodeJS/blob/latest/src/accessories/TV_accessory.ts) illustrates command controls. Adding custom-service aliases later must preserve their established UUIDs. Complete TV service relationships need separate implementation and validation.

## Delivery and acceptance

1. Agree the action contract, including mixed-action ordering and validation.
2. Implement it in a separate focused change. Test repeated identical/alternating commands, global debounce overrides, target/command mixtures, pacing, queue pressure, failures, expiry, shutdown and feedback handling.
3. Verify both adapters, config round-trips, unchanged legacy identities, the four-way runtime matrix and package contents. Validate representative HTTP devices and HomeKit presentation before claiming device support.

Existing [Beta release gates](beta-readiness.md#field-exit-criteria) still apply. Use a new prerelease version before distributing a changed build. The current modernization can receive feedback while this follow-up is developed.

**Review question:** does this contract capture the HTTP command use cases the maintainer and #55 contributor want supported? Concrete commands, available feedback and expected ordering would help refine it.

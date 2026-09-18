# 2.0.0-alpha.1 — draft prerelease notes

**Prerelease software. Not yet published. Normal users remain on stable 1.3.0 unless they explicitly opt in.**

This modernization keeps `HttpAdvancedAccessory` configuration and adds an optional `HttpAdvanced` dynamic platform. Both use a shared state cache and bounded background HTTP coordinator. HomeKit reads return known memory state immediately; refresh, retry and mapping happen independently. No migration is required to obtain the performance improvements.

Runtime requirements: Node ^22.13.0 or ^24.0.0; Homebridge ^1.11.4 or ^2.4.0. Older runtime environments should stay on stable until upgraded.

After publication, install with `npm install -g homebridge-http-advanced-accessory@alpha` and restart Homebridge. Back up Homebridge first and preserve legacy names, definitions and pairing storage. Roll back with `npm install -g homebridge-http-advanced-accessory@1.3.0` and restart. Restore the backed-up legacy configuration if you voluntarily introduced Alpha-only platform definitions.

The real-HAP synthetic fixture changes a 41-getter blocking snapshot from about 2.15 seconds to a warmed 44-device snapshot of about 3 ms and zero getter requests. The independent 44-device refresh sweep takes about 2.25 seconds. These measurements are not field measurements; compare both cache freshness and backend traffic before adopting the Alpha.

Known limitations and changes:

- Default zero-delay acquisition becomes adaptive background refresh; tune based on actual cache age and backend load.
- Explicit positive polling intervals remain authoritative.
- Legacy truthy static mapping and preemptive authentication behavior remain compatible.
- Invalid responses are contained, with bounded timeout, response size and fallback depth.
- Eval and legacy templates remain executable trusted configuration, not a sandbox.
- Platform conversion uses new identities; do not duplicate existing devices across configuration styles.
- HAP v2 removed several old service classes; consult the service inventory.
- Field validation of cache freshness and backend load, HomeKit pairing/automation behavior, physical device control, restart/restore behavior and Homebridge UI configuration remains a prerequisite for publishing this candidate.

For reports include Node/Homebridge/plugin versions, sanitized diagnostics, request duration, queue depth, cache age and sustained request rate. Never include credentials, PINs or an unredacted configuration.

Publication must use npm dist-tag `alpha` and a GitHub prerelease. Verify npm `latest` remains on stable; stable 2.0.0 requires broader validation.

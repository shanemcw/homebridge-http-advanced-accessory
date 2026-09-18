# Alpha.5 baseline and contribution-preparation notes

New in alpha.5: Plugin Config uses consistent typography, section spacing, aligned fields and grouped legacy navigation controls in both themes. The code review also fixes queued-write deadlines, protects pending UI saves, identifies validation errors, avoids generated platform-name collisions, and displays process-wide coordinator overrides. Startup reads its version from package metadata; the prerelease guard recognizes matching Alpha/Beta tags. The deeper review frees queue capacity during endpoint recovery and makes disabled platform devices report unavailable rather than apparently accepting commands. The preserved Alpha.5 baseline has been deployed successfully in a field installation. The subsequent preparation changes below remain undeployed and unpublished to npm.

Introduced in alpha.4: Plugin Config now summarizes legacy accessories and directs users to the plugin menu's per-accessory **JSON Config** editor. Shared settings and platforms remain editable here, with an unsaved-change guard on the return button and fields that follow the page theme.

**Contribution branch, not a new release.** It retains version `2.0.0-alpha.5` for review; a changed package requires a new prerelease version before distribution.

Preparation changes: public documentation and package links are generalized for upstream, CI retains the full runtime matrix with updated actions, a timing-sensitive settings test is stabilized, and npm includes the runtime/UI and user references while keeping draft evidence in the repository. Cross-origin redirects now discard all configured headers, including custom API keys, as well as device Basic Auth. Same-origin redirects retain them. Configurations that relied on forwarding custom headers to another origin should use the final trusted endpoint directly.

This modernization keeps `HttpAdvancedAccessory` configuration and adds an optional `HttpAdvanced` dynamic platform. Both use a shared state cache and bounded background HTTP coordinator. HomeKit reads return known memory state immediately; refresh, retry and mapping happen independently. No migration is required to obtain the performance improvements.

Legacy accessory JSON remains maintainable through the per-accessory JSON Config editor alongside optional platform definitions in Plugin Config. Shared timing and recovery defaults work with either mode, including legacy child bridges. Existing encoded commands and hand-written mappings remain intact; enabling a platform does not migrate existing accessories.

This candidate prevents stale reads from briefly reversing a HomeKit toggle while the web server applies a command. A configurable confirmation window works with existing servers and mappings, while failures and unconfirmed commands still return to observed state. Shared diagnostics now use the plugin name, and the settings status message follows the UI theme.

Runtime requirements: Node ^22.13.0 or ^24.0.0; Homebridge ^1.11.4 or ^2.4.0. Older runtime environments should stay on stable until upgraded.

For baseline testing, install the reviewed `.tgz` using the instructions in the README and restart Homebridge. Back up Homebridge first and preserve legacy names, definitions and pairing storage. Roll back to 1.3.0 using the same plugin location and package-management path, then restart. Restore the backed-up legacy configuration if you voluntarily introduced Alpha-only platform definitions.

The real-HAP synthetic fixture changes a 41-getter blocking snapshot from about 2.15 seconds to a warmed 44-device snapshot of about 3 ms and zero getter requests. The independent 44-device refresh sweep takes about 2.25 seconds. These measurements are not claims about the live installation; compare both cache freshness and backend traffic before adopting the Alpha.

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

Any future publication must use a new prerelease version and its matching npm dist-tag (`alpha` or `beta`), plus a GitHub prerelease. Verify npm `latest` remains on stable; stable 2.0.0 requires broader validation.

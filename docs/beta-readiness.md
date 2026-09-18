# Beta.1 readiness

Checkpoint: 2026-09-18. The preserved `2.0.0-alpha.5` baseline was deployed on 2026-09-13 and verified again on 2026-09-18. Homebridge was active with 44 legacy accessories and restored getters; deployment checks found configuration and HomeKit identity files unchanged, with no recorded plugin startup/recovery warnings or errors. Subsequent usage is reported successful. This is evidence for that baseline, not for the preparation changes on this branch, which remain undeployed and unpublished to npm.

| Area | Local evidence | Remaining acceptance |
|---|---|---|
| Configuration UX | Browser save/reload preserves 44 legacy definitions; validation retains drafts and focuses errors; controls lock during saves. Real HAP cache restoration covers disabled reads/writes, re-enable with unchanged UUIDs, invalid inventory retention and explicit removal. | Repeat in the installed Homebridge UI, including its native JSON editor, restart and a managed child bridge. |
| Recovery | Queued writes expire without later transmission. Paused background reads release queue capacity without fabricating fallback state. A 40-device outage test checks healthy-origin progress, one command during recovery and bounded resumption. | Field outage longer than 30 seconds, command/confirmation behavior, log volume and a sustained recovery/soak run. |
| Settings | Action/device/global precedence and explicit zero overrides are tested. Separate processes load shared defaults through Homebridge's storage API and isolate platform coordinator overrides. The existing multiple-platform discovery-order rule is documented. | Confirm the actual managed child bridge loads the intended settings after restart. |
| Release plumbing | Alpha/Beta version/tag guard tests pass; startup version comes from package metadata; both registration aliases share that module. | Final candidate diff, package and authorized CI before Beta.1. No stable/latest publication. |
| Maintainer readiness | User guide, migration boundaries and detailed timing/lifecycle references reconciled; registration duplication removed. Legacy mapper behavior remains deliberately isolated for compatibility. | Review field evidence and prepare the maintainer announcement at Beta.1. |

## Local verification

The preserved baseline passed the full Node 22/24 × Homebridge 1/2 CI matrix. A local parallel run exposed a timing-sensitive settings assertion; this preparation branch verifies the configured delay at the coordinator boundary and retains the separate actual-start-spacing regression. Typecheck and lint pass on both Node versions. Browser checks use a sanitized fixture and an isolated configuration server. Process-isolation and real HAP restoration tests do not prove live pairing, managed-child-bridge startup or field behavior.

The reviewed baseline tarball installs into a fresh temporary directory with production dependencies only. Its entry point registers both adapters, its startup metadata matches Alpha.5, and it includes the custom UI without tests, preview scripts or local configuration. Homebridge, the historical regression baseline, `request` and `polling-to-event` are absent from that installed dependency tree. The production dependency audit reports zero known vulnerabilities at the baseline checkpoint; this is an advisory check, not a security audit.

The preparation candidate passes the full local Node 22/24 × Homebridge 1/2 matrix, typecheck and lint. Its production-only install smoke test, package-content/link inspection and production dependency audit also pass. CI results belong to the exact reviewed branch revision; these checks do not imply deployment or completion of the field exit criteria.

## Field exit criteria

1. Preserve all existing legacy definitions and HomeKit identities through installation and restart; verify rooms, scenes and automations still refer to the same devices.
2. Exercise platform validation, disable/re-enable and saving in the real UI, using a separate test device. Re-enabling the same platform ID must retain identity; explicit removal must remove only that device.
3. Verify Apple Home toggles and manual device changes, including a blocked backend longer than 30 seconds, a command during recovery and a command that cannot complete. Failed/unknown states must not appear as confirmed success, and expired queued writes must not execute later.
4. Record sustained cache age, request rate, recovery log volume and field `/accessories` timing. The synthetic warmed-read benchmark alone is insufficient.
5. Verify the backup and rollback path. Review the final package and run CI on the authorized review commit before promoting to Beta.1.

The successful baseline deployment and usage provide continuity evidence. Managed-child-bridge lifecycle coverage, controlled outage/soak measurements and a restore rehearsal remain distinct acceptance items. The preparation branch also needs review of its redirect behavior change and the final candidate diff. Choose a new prerelease version before deployment or publication; retain the Alpha.5 tag unchanged.

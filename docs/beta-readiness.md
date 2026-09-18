# Beta.1 readiness

Local checkpoint: 2026-09-13, `2.0.0-alpha.5`. Alpha.4 is the last verified field deployment. These changes are uncommitted and have not been deployed or published.

| Area | Local evidence | Remaining acceptance |
|---|---|---|
| Configuration UX | Browser save/reload preserves 44 legacy definitions; validation retains drafts and focuses errors; controls lock during saves. Real HAP cache restoration covers disabled reads/writes, re-enable with unchanged UUIDs, invalid inventory retention and explicit removal. | Repeat in the installed Homebridge UI, including its native JSON editor, restart and a managed child bridge. |
| Recovery | Queued writes expire without later transmission. Paused background reads release queue capacity without fabricating fallback state. A 40-device outage test checks healthy-origin progress, one command during recovery and bounded resumption. | Field outage longer than 30 seconds, command/confirmation behavior, log volume and a sustained recovery/soak run. |
| Settings | Action/device/global precedence and explicit zero overrides are tested. Separate processes load shared defaults through Homebridge's storage API and isolate platform coordinator overrides. The existing multiple-platform discovery-order rule is documented. | Confirm the actual managed child bridge loads the intended settings after restart. |
| Release plumbing | Alpha/Beta version/tag guard tests pass; startup version comes from package metadata; both registration aliases share that module. | Final candidate diff, package and authorized CI before Beta.1. No stable/latest publication. |
| Maintainer readiness | User guide, migration boundaries and detailed timing/lifecycle references reconciled; registration duplication removed. Legacy mapper behavior remains deliberately isolated for compatibility. | Review field evidence and prepare the maintainer announcement at Beta.1. |

## Local verification

All 97 tests pass on each combination of Node 22.23.2/24.19.0 and Homebridge 1.11.4/2.4.0: 388 executions, no failures or skips. Typecheck and lint pass on both Node versions. Browser checks use a sanitized fixture and an isolated configuration server. Process-isolation and real HAP restoration tests do not prove live pairing, managed-child-bridge startup or field behavior.

The reviewed 59-file tarball installs into a fresh temporary directory with production dependencies only. Its entry point registers both adapters, its startup metadata matches Alpha.5, and it includes the custom UI without tests, preview scripts or local configuration. Homebridge, the historical regression baseline, `request` and `polling-to-event` are absent from that installed dependency tree. The production dependency audit reports zero known vulnerabilities at this checkpoint; this is an advisory check, not a security audit.

## Field exit criteria

1. Preserve all existing legacy definitions and HomeKit identities through installation and restart; verify rooms, scenes and automations still refer to the same devices.
2. Exercise platform validation, disable/re-enable and saving in the real UI, using a separate test device. Re-enabling the same platform ID must retain identity; explicit removal must remove only that device.
3. Verify Apple Home toggles and manual device changes, including a blocked backend longer than 30 seconds, a command during recovery and a command that cannot complete. Failed/unknown states must not appear as confirmed success, and expired queued writes must not execute later.
4. Record sustained cache age, request rate, recovery log volume and field `/accessories` timing. The synthetic warmed-read benchmark alone is insufficient.
5. Verify the backup and rollback path. Review the final package and run CI on the authorized review commit before promoting to Beta.1.

Alpha.3 toggling/manual operation passed owner testing; Alpha.4 restored 44 legacy devices. Those results provide continuity evidence, but do not replace acceptance of the Alpha.5 recovery and lifecycle changes. Deployment, commits, publication and upstream contact remain separate next steps requiring the owner's instruction.

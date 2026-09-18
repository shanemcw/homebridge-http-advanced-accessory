# Upgrade and migration

## Ordinary legacy upgrade

1. Back up Homebridge configuration, cached accessories, pairing data and identifier cache using Homebridge's backup facility.
2. Verify the Node/Homebridge requirements in the README.
3. Install the explicit Alpha version or reviewed local package in your Homebridge environment and restart.
4. Keep accessory names, `accessory: "HttpAdvancedAccessory"`, service definitions and storage unchanged.
5. Verify state freshness, control writes and existing automations before leaving Alpha unattended.

Runtime reads existing configuration without rewriting it. Plugin Config summarizes legacy accessories and maintains optional platforms and shared defaults; the plugin menu's **JSON Config** provides individual legacy accessory editors with add and delete controls. In Plugin Config, only an explicit **Save all settings** changes configuration, preserving the legacy definitions. The legacy registration and service identity remain unchanged. HAP identifier-cache regression tests cover replacing plugin instances without changing AIDs/IIDs. Live Apple Home pairing and automation verification remain a release gate.

The platform-only settings screen in the first Alpha hid legacy configuration. Hidden entries are not evidence of deleted configuration: inspect `accessories[]` in the current `config.json` before attempting any restoration. Recover missing definitions from a known backup, preserving names, aliases and `_bridge` settings; do not reconstruct command URLs or mappings from cached HAP values. Merge only the missing definitions into the current file rather than rolling unrelated plugins back to an old complete configuration.

## Optional platform migration

Platform mode is for new devices or an explicitly planned conversion. It is not required to obtain the cache/performance improvements.

Use **Also use as a platform** in the plugin settings screen to create a platform while leaving legacy entries in place. Its enable checkbox controls `enabled`; after restart, disabling it retains definitions and cached identities while reporting device reads and commands unavailable. Re-enable with the same name and device IDs, then restart to restore operation. Shared timings can be maintained in the same screen and apply to legacy-only configurations too. The full JSON editor uses top-level `httpAdvanced` for these defaults.

The legacy UUID seed is controlled by Homebridge (`HttpAdvancedAccessory:<name>`). Platform UUIDs use the plugin, platform name and device ID. These namespaces differ intentionally. Merely moving a JSON block is therefore not a seamless identity-preserving migration.

Do not copy the same device into both arrays. A future migration tool must prove identity preservation, back up state and handle partial failure before it is offered. No such tool is included in this Alpha. For a manual conversion, expect new HomeKit identities and plan room, scene and automation reassignment. Keep a full backup and test rollback first.

Within platform mode, a fixed device `id` preserves its UUID across display-name changes. Changing the platform name or device ID changes identity. Removing an entry from a valid platform inventory unregisters that accessory.

## Rollback

Pin plugin 1.3.0 and restart Homebridge. Legacy-only users keep their configuration and storage. If you introduced platform entries, restore the backed-up legacy configuration and appropriate Homebridge backup rather than attempting to run platform definitions with 1.3.0. The optional Alpha state file can remain; stable does not read it.

# HTTP Advanced Accessory

Connect HTTP-controlled devices and web services to Apple Home through Homebridge.

**A non-breaking modernization of the existing accessory configuration model, with an optional platform when you choose to migrate.** Keep your `HttpAdvancedAccessory` entries, encoded command URLs, request bodies, hand-written mappings and other settings. The improvements apply to existing accessories without converting them to a platform or upgrading their web server.

- **Faster HomeKit reads:** shared cached state lets Apple Home read device status promptly while HTTP refreshes run in the background.
- **More resilient HTTP handling:** bounded requests, background recovery and quieter logs accommodate slow or temporarily unavailable servers, including older systems you cannot change.
- **Migration at your pace:** maintain existing accessories through JSON Config, and add platform devices alongside them when useful. The plugin also keeps a requested switch state visible while the server catches up, avoiding a brief reversal caused by stale reads.

**Release status: `2.0.0-alpha.5` is a prerelease candidate.** Compatibility applies on the supported runtimes below. Refresh timing changes, and voluntarily converting a device to the platform creates a new HomeKit identity. [Compatibility details](docs/modernization.md#what-non-breaking-means-here) explain those boundaries.

[User guide](#user-guide) · [Modernization details](#modernization-details) · [Developer reference](docs/modernization.md#development-and-release-policy) · [Beta readiness](docs/beta-readiness.md)

## User guide

### Requirements

| Component | Supported versions |
|---|---|
| Node.js | 22.13 or later in the 22.x line, or 24.x |
| Homebridge | 1.11.4 or later in the 1.x line, or 2.4 or later in the 2.x line |

Older environments need a runtime upgrade before testing this Alpha. Plugin 1.3.0 is the stable compatibility baseline. If you also upgrade Homebridge itself, check the [service compatibility list](docs/service-support.md) for historical services removed by newer HAP versions.

### Install or upgrade

Back up Homebridge first, including configuration, cached accessories and pairing data. Install the reviewed Alpha package into the **same plugin location your Homebridge installation already uses**, then restart Homebridge. Keep your existing accessory definitions and Homebridge storage in place.

For this unpublished testing candidate, use the supplied `.tgz` archive. npm remains on stable 1.3.0. For example, on a server that keeps plugins in `/var/lib/homebridge`, run as the account that owns that installation:

```sh
npm install --prefix /var/lib/homebridge --omit=dev --ignore-scripts /path/to/homebridge-http-advanced-accessory-2.0.0-alpha.5.tgz
```

Use your installation's actual path; installations with globally managed plugins should use their normal plugin-management workflow. If an Alpha is later published to npm, explicitly select that version through Homebridge UI or your usual package manager. Test device control, state updates and existing automations after restarting.

After a manual package installation, if the plugin's JSON menu still identifies it only as a platform, restart the complete Homebridge service/UI so its cached plugin metadata reloads.

### Keep using existing accessories

Existing devices stay in `accessories[]`. No configuration rewrite is required to obtain the cache and recovery improvements. A basic definition looks like this:

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

Keep each existing accessory's name, alias and service definition unchanged when upgrading to preserve its identity. Your existing GET/POST methods, bodies, encoded strings, mapper chains, optional characteristics and property settings remain supported. See the [action and HTTP reference](docs/modernization.md#actions-and-http), [mapper reference](docs/modernization.md#mappers) and [legacy examples](docs/legacy-reference.md) for more elaborate configurations.

### Maintain configuration in the UI or JSON

The plugin settings screen brings three areas together:

| Area | What you maintain |
|---|---|
| **Legacy accessories** | An accessory count and expandable name list, with directions to **JSON Config** for individual editing. |
| **Shared settings** | Timing, request limits and recovery defaults for both accessories and platforms. |
| **Optional platforms** | Separate platform definitions, with an enable checkbox for each. |

To edit, add or delete a legacy accessory, choose **JSON Config** from the plugin menu. Each accessory has its own bounded JSON editor, including custom fields, encoded commands and mappings. **Back to plugin menu** closes Plugin Config after you save any pending changes.

Choose **Save all settings** inside Plugin Config to save shared settings and optional platforms, then restart Homebridge to apply changes. Legacy accessory definitions stay unchanged. A changed save keeps a private configuration backup and preserves unrelated plugins and bridge settings. Avoid editing the same configuration from multiple windows at once.

You can also maintain `config.json` directly through Homebridge's JSON editor. Existing entries remain in `accessories[]`; platform entries use `platforms[]`; shared defaults use the top-level `httpAdvanced` object. Simply opening the UI or starting the plugin does not migrate or rewrite your configuration.

### Add a platform when you choose

Use **Also use as a platform** in the settings screen, or add an `HttpAdvanced` entry to `platforms[]`. You can start with a new device while keeping all existing accessories as they are:

```json
{
  "platform": "HttpAdvanced",
  "name": "HTTP Advanced",
  "enabled": true,
  "devices": [
    {
      "id": "new-platform-light",
      "name": "New Platform Light",
      "service": "Switch",
      "urls": {
        "getOn": { "url": "http://another-device.example/state" },
        "setOn": { "url": "http://another-device.example/set/{value}" }
      }
    }
  ]
}
```

Choose a permanent device `id` before pairing, and keep the platform name stable. The device's display name can then change without changing its platform identity. Disabling a platform keeps its definitions and cached identities but stops device updates.

**Accessories and platforms can coexist for different devices.** Do not define the same physical device in both places. Moving an existing accessory into a platform is an optional, deliberate conversion: it creates a different HomeKit identity and may require reassigning rooms, scenes and automations. There is no automatic identity-preserving migration tool in this Alpha. Follow the [migration guide](docs/migration.md) if you choose to convert devices.

### Tune shared settings

The built-in defaults work with either configuration style; no platform is required. Leave UI fields blank to use them, or add the following top-level object to your existing `config.json`:

```json
{
  "httpAdvanced": {
    "requestTimeout": 10000,
    "uriCallsDelay": 0,
    "setterDelay": 0,
    "writeConfirmationTimeout": 10000,
    "refresh": { "activeInterval": 5, "idleInterval": 60, "idleAfter": 60 },
    "coordinator": { "concurrency": 4, "perOrigin": 2, "maxQueue": 256 },
    "recovery": { "retryInterval": 5, "maxRetryInterval": 30, "quietPeriod": 90, "reminderInterval": 300 }
  }
}
```

Request timeout, request spacing, debounce and write confirmation are **milliseconds**. Refresh and recovery intervals are **seconds**. Existing device/action overrides take precedence over their shared defaults; positive legacy `forceRefreshDelay` still controls the normal polling interval.

| If you need to… | Setting to consider |
|---|---|
| Allow a slow background HTTP response more time | Increase `requestTimeout`; an individual action's `timeout` overrides it. This does not extend HomeKit's own request budget. |
| Space requests to an older server | Increase `uriCallsDelay`, or reduce the shared `coordinator.perOrigin` limit. |
| Allow the server more time to reflect a successful command | Adjust `writeConfirmationTimeout`; the default is 10000 ms after HTTP success. |
| Combine a burst of changes into the last command | Set `setterDelay` to a positive debounce delay. |
| Balance freshness with background traffic | Adjust `refresh.activeInterval` and `refresh.idleInterval`, or retain a device's explicit `forceRefreshDelay`. |

Shared defaults also apply to legacy child bridges. [The technical reference](docs/modernization.md#shared-settings-and-precedence) covers precedence, units and scheduling boundaries.

### What to expect in Apple Home

Device reads return the latest known state promptly. Background HTTP requests refresh it independently, so a fast HomeKit response can still contain an older observation. On startup, a device without saved or newly acquired state reports a communication error until its first usable response.

When you change a value, the plugin keeps the requested value visible during debounce and the HTTP request, then for up to ten seconds by default while waiting for confirmation. A matching getter response ends that window early. If the command fails or the window expires, HomeKit returns to the latest observed state, or an error if none is known. This handles servers that acknowledge a command before reporting its new state. Failed commands are never automatically replayed.

During a temporary outage, the plugin retries background reads with backoff and keeps known state available, unless your configuration explicitly supplies an error fallback. Short interruptions stay quiet in normal logs. Default outage warnings start after 90 seconds, with reminders at most every five minutes. Recovery can continue beyond 30 seconds; the plugin does not require a gateway upgrade or special retry headers.

### Troubleshooting and rollback

| Symptom | Check first |
|---|---|
| Unknown state after startup | Endpoint reachability and getter mapper output. |
| State is older than expected | Refresh interval, cache age, queue depth and outage backoff. |
| A toggle returns to its old state | Whether the write failed, the server applied it, or the confirmation window expired. |
| Busy/error text becomes an unexpected value | The mapper chain and optional `responsePattern`, `requireResponseMatch` or `strictHTTP` settings. See [servers you cannot change](docs/modernization.md#servers-you-cannot-change). |
| Configuration does not load | Service support, action names, mapper syntax and duplicate platform IDs. |

Set `debug: true` on one device to enable a shared diagnostic snapshot every 30 seconds. It includes request timing, queue usage, cache ages and recovery status. Shared messages use **HTTP Advanced** as their log prefix; device-specific messages retain their accessory name. Diagnostics omit URLs, credentials, request bodies and device values, and are not sent externally.

For a report, include plugin, Homebridge and Node versions plus sanitized diagnostics. The [measurement guide](docs/performance.md) explains how to compare responsiveness and freshness together.

To roll back, reinstall the 1.3.0 baseline through the same plugin-management path and restart Homebridge. Legacy-only users retain their definitions and storage. If you introduced platform devices, follow the [rollback instructions](docs/migration.md#rollback) and use the relevant backup. Preserve pairing and identifier storage during an ordinary plugin rollback.

## Modernization details

The [modernization and developer reference](docs/modernization.md) contains the fine print:

- What compatibility preserves, and which runtime behaviors change.
- Shared caching, persistence, polling, request scheduling and outage recovery.
- HTTP actions, older-server response handling, writes, templates and all five mapper types.
- Service support, optional characteristics, configuration editing and platform lifecycle.
- Benchmark interpretation, development commands, test coverage and release policy.

The [Alpha release notes](docs/alpha-release-notes.md) summarize this candidate; the [implementation report](docs/implementation-report.md) records validation and remaining release gates. The project retains its existing [Apache-2.0 license](LICENSE) and historical authorship.

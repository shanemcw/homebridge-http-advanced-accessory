# Measuring latency, freshness and backend load

## Reproducible fixture

Run `npm run benchmark -- --save` from the source checkout. It uses real HAP serialization and a loopback backend that serializes 50 ms responses, modeling a single-command backend. It never contacts household devices.

The baseline uses the 41 on-demand entries from the 44-device fixture; the three 500-second pollers are separately covered by interval tests. The Alpha warms all 44 entries, then serializes their HAP state. Acquisition is separated from measurement so every network request caused by the bulk read can be attributed exactly. Timings are diagnostic rather than portable absolute performance guarantees.

`benchmark-results.json` records baseline bulk time, Alpha bulk time, getter request counts, full refresh sweep time, median/p95/max cache age and request latency, queue high-water mark, concurrency and failures. Cache age is measured at the end of a sweep and is not a long-running household freshness result.

## Actual Homebridge / Home Control measurements still required

On a backed-up Alpha test installation, use the existing Homebridge UI/API session to time repeated `/accessories` requests. Keep authorization in the existing client; never paste headers into commands or logs. Capture baseline and Alpha on the same host with comparable load.

Record:

- `/accessories` median/p95/max wall time, including warm and restart cases;
- existing reader end-to-end time and successful parsing, without editing Home Control;
- backend request counts and maximum concurrency during bulk reads;
- cache-age median/p95/max from periodic plugin debug snapshots;
- getter request-duration median/p95/max and error/timeout counts;
- sustained request rate from the difference in cumulative `requests.started` divided by elapsed seconds;
- elapsed time until every getter has completed one successful refresh after startup;
- whether devices with explicit polling intervals retain the expected freshness;
- normal writes, delayed writes and recovery after a backend outage.

Debug snapshots expose per-action hashes for correlation without exposing endpoint names or payloads. `age` is time since last successful HTTP acquisition. Fallback values do not reset that timestamp. An unknown entry has `age: null`. The bounded duration sample holds the most recent 2048 requests.

The old reader also has an asynchronous orchestration/polling delay outside the plugin. Faster HAP serialization does not remove that delay. Do not attribute an end-to-end improvement to the plugin without measuring both components.

Approve default cadence based on actual freshness and sustained load. If a full sweep is slower than the desired interval, reduce workload or deliberately tune the shared concurrency for the backend; do not simply remove the bounds. Avoid changing the three existing 500-second intervals unintentionally.

## Owner-supplied live baseline (September 10, 2026)

The updated reader records `took` immediately around its LWP HTTP request, and the controller logs that field after reading the result file. This excludes JSON parsing, state-file writing and the parent's later polling delay. It measures the complete HTTP exchange, including all Homebridge plugins involved; it does not isolate this plugin's contribution.

Eight supplied samples were 4.6, 0.03, 5.2, 4.4, 5.0, 4.3, 4.4 and 4.9 seconds. Their median is 4.5 seconds. Seven were in the 4.3–5.2-second range; one was 0.03 seconds. Values are rounded by the existing log formatter, and this is a small sample rather than a sustained latency distribution.

The short result is consistent with Homebridge's recent-snapshot reuse, but its cause is not established by the log. The tested HAP implementations invoke getters for `/accessories` only when the previous such request was more than five seconds earlier. Space before/after measurement requests beyond that window to avoid mistaking this built-in reuse for a plugin improvement. Include the production Homebridge/HAP versions in the eventual comparison.

The supplied private log and Home Control source are not included in this repository. Alpha has not yet been measured on the live installation.

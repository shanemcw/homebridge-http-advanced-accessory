# Measuring latency, freshness and backend load

## Reproducible fixture

Run `npm run benchmark -- --save` from the source checkout. It uses real HAP serialization and a loopback backend that serializes 50 ms responses, modeling a single-command backend. It never contacts external devices.

The baseline uses the 41 on-demand entries from the 44-device fixture; the three 500-second pollers are separately covered by interval tests. The Alpha warms all 44 entries, then serializes their HAP state. Acquisition is separated from measurement so every network request caused by the bulk read can be attributed exactly. Timings are diagnostic rather than portable absolute performance guarantees.

`benchmark-results.json` records baseline bulk time, Alpha bulk time, getter request counts, full refresh sweep time, median/p95/max cache age and request latency, queue high-water mark, concurrency and failures. Cache age is measured at the end of a sweep and is not a long-running field freshness result.

## Field Homebridge measurements still required

On a backed-up Alpha test installation, use the existing Homebridge UI/API session to time repeated `/accessories` requests. Keep authorization in the existing client; never paste headers into commands or logs. Capture baseline and Alpha on the same host with comparable load.

Record:

- `/accessories` median/p95/max wall time, including warm and restart cases;
- backend request counts and maximum concurrency during bulk reads;
- cache-age median/p95/max from periodic plugin debug snapshots;
- getter request-duration median/p95/max and error/timeout counts;
- sustained request rate from the difference in cumulative `requests.started` divided by elapsed seconds;
- elapsed time until every getter has completed one successful refresh after startup;
- whether devices with explicit polling intervals retain the expected freshness;
- normal writes, delayed writes and recovery after a backend outage.

Debug snapshots expose per-action hashes for correlation without exposing endpoint names or payloads. `age` is time since last successful HTTP acquisition. Fallback values do not reset that timestamp. An unknown entry has `age: null`. The bounded duration sample holds the most recent 2048 requests.

If an external client or automation layer adds orchestration or polling delay, measure that separately. Do not attribute an end-to-end improvement to the plugin without isolating the plugin-facing request.

Approve default cadence based on actual freshness and sustained load. If a full sweep is slower than the desired interval, reduce workload or deliberately tune the shared concurrency for the backend; do not simply remove the bounds. Avoid changing the three existing 500-second intervals unintentionally.

## Measurement caveat

The tested HAP implementations can reuse a recent `/accessories` snapshot. Space repeated measurements beyond the implementation's reuse window and record the Homebridge/HAP versions so snapshot reuse is not mistaken for a plugin improvement.

Alpha has not yet been measured in a field installation.

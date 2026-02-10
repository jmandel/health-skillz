# Finalize Script Evolution and Findings

## Scope
This writeup documents how `skill/health-record-assistant/scripts/finalize-session.ts` evolved from the initial implementation to the current production-ready version, what was measured, and why defaults changed.

## Initial State
The initial finalize script:
- Polled readiness and downloaded/decrypted data.
- For v3 chunked payloads, built significant in-memory buffers during processing.
- Had limited resilience for transient server/network failures.
- Had no opt-in instrumentation for memory/timing.

## Problems Observed
- Memory varied widely based on chunk concurrency and buffering strategy.
- Transient poll/fetch failures could interrupt long runs.
- We needed reproducible measurements for throughput vs memory tradeoffs.
- We needed clean separation between script behavior and external network shaping.

## Iterations Performed
1. Added stronger poll/fetch retries for transient failures.
2. Evaluated multiple v3 strategies:
   - memory-pipeline
   - disk-queue
   - disk-two-phase
   - disk-gzip-spool
3. Added optional instrumentation for memory/timing.
4. Compared behavior under:
   - global external bandwidth caps
   - per-connection external bandwidth caps
   - no external caps
5. Simplified to one production v3 strategy with a narrow, practical option surface.

## Key Results
Representative matrix (active phase timing + peak RSS):
- `memory-pipeline`: good speed, higher memory at higher prefetch.
- `disk-queue`: near-best speed with substantially better memory behavior than two-phase variants.
- `disk-two-phase` / `disk-gzip-spool`: consistently high memory in this stack.

Per-connection capped test (`1.5 MB/s` per connection):
- `prefetch=2`: ~65.4s
- `prefetch=16`: ~21.4s
- ~3x speedup, showing concurrency helps strongly in per-connection-limited environments.

No-proxy direct test:
- `prefetch=2`: ~21.3s, lower memory
- `prefetch=16`: ~19.8s, much higher memory
- small speed gain for large memory increase.

## Production Decisions
Current production finalize design:
- Single v3 strategy: **disk-queue**.
- Default `prefetch` set to **8**.
- Optional instrumentation only when explicitly enabled:
  - `--instrument`
  - `FINALIZE_INSTRUMENT=1`

Rationale:
- `disk-queue` provided the best speed/memory balance in measurements.
- Default `8` is a practical middle ground:
  - materially faster than low concurrency in constrained environments
  - avoids always maxing concurrency to 16 and associated memory spikes.

## Current Script Behavior
`skill/health-record-assistant/scripts/finalize-session.ts` now provides:
- robust polling with transient retry handling
- bounded concurrent chunk download/decrypt/decompress flow for v3 payloads
- active-phase elapsed time reporting (`wrote_file.elapsedMs`, `done.elapsedMs`)
- opt-in instrumentation without polluting default logs

## Benchmark Interpretation Notes
- Active phase timings were used to avoid counting setup/wait overhead.
- Wall time can differ from active time due to startup and orchestration costs.

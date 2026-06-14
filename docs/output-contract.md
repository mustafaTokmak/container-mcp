# Tool output contract (and a known break to fix on macOS 26)

**Status:** ✅ Normalizer implemented **and verified against the real CLI** —
captured live `container ls` / `inspect` / `stats` JSON on macOS 26.5.1 /
container 1.0.0 (2026-06-14) and corrected the field paths to ground truth.
`src/tools/normalize.ts`, applied in `list_containers` / `inspect_container` /
`container_stats`, covered by `test/normalize.test.ts` (incl. tests built from the
captured real shapes).

**Confirmed real field paths (container 1.0.0):**

| Flat field | Real Apple path |
|---|---|
| `id` | top-level `id` |
| `image` | `configuration.image.reference` |
| `status` | `status.state` — the top-level `status` is an **object** `{state,startedDate,…}` |
| `created_at` | `configuration.creationDate` |
| `command` | `configuration.initProcess.{executable, arguments}` |
| `labels` | `configuration.labels` (a map) |
| `mounts` | `configuration.mounts[]` = `{source, destination, options[]}`; read-only is `"ro"` in `options` |
| stats mem | `memoryUsageBytes` / `memoryLimitBytes` (bytes → MB) |
| stats cpu | `cpuUsageUsec` (cumulative µs — **not** a %; passed through as `cpu_usage_usec`) |

The original break: these three tools emitted **raw Apple CLI JSON**
(`return ok(res.stdout.trim())`), which the GUI's flat decoders silently turned into
empty/default values. The normalizer now lifts the `configuration` wrapper to the
flat schema below.

**Two consumer-side follow-ups surfaced by the live run:**
1. A **stopped** container's `status.state` is the string `"stopped"` — the GUI's
   `ContainerStatusKind` only recognizes `"running"` / `"exited (N)"` / `"building"`,
   so `"stopped"` falls through to `.unknown`. The GUI must learn `"stopped"`.
2. Apple has no instantaneous CPU %. For a live CPU sparkline the GUI must compute a
   delta from consecutive `cpu_usage_usec` samples (it polls every 1.5s); memory works
   directly from `mem_used_mb` / `mem_limit_mb`.

## The problem

These tools do `return ok(res.stdout.trim())` — they pass the CLI's JSON straight
through. The Apple `container` CLI nests fields under a top-level `configuration`
object (the server itself reads `node.configuration.labels` in `ensureManaged`,
and the managed-inspect test fixture is `[{ configuration: { labels: {...} } }]`),
has no top-level `created_at`, and emits labels as a `key=value` array.

Consumers (the GUI, and AI agents) reasonably expect a **flat, stable,
snake_case** object. Because the GUI decodes with `decodeIfPresent ?? default`,
the mismatch does **not** throw — it silently yields empty/default values:

| Field | Consumer expects | Raw CLI reality | Silent result |
|---|---|---|---|
| `image` | top-level string | `configuration.image.reference` (verify) | `""` — blank image everywhere |
| `status` | top-level string | runtime state, different shape/location | `"unknown"` → all lifecycle logic dead |
| `mounts` | top-level `[{source,destination,read_only}]` | under `configuration` (verify) | `[]` — boundary shows nothing |
| `created_at` | top-level ISO8601 | absent / under `configuration` (verify) | `nil` |
| `labels` | flat map | `configuration.labels` key=value array | ✅ GUI anticipated this |
| stats `cpu_percent`/`mem_used_mb` | Docker-style keys | Apple CLI may not emit these (or no `stats`) | `nil` — no sparklines |

A server should present a clean contract, not a raw CLI dump — this is the right
fix for **every** consumer, agents included.

## Target normalized schema (the contract)

Normalize inside the server so every consumer gets this regardless of CLI drift:

```jsonc
// list_containers → array of:
{
  "id":         "string",
  "image":      "string",                 // e.g. "docker.io/library/nginx:latest"
  "status":     "string",                 // "running" | "exited (0)" | "building" | ...
  "created_at": "2026-06-14T10:14:22Z",   // ISO8601
  "labels":     { "dev.container-mcp.session": "…", "…": "…" },  // flattened to a map
  "mounts":     [ { "source": "~/proj", "destination": "/work", "read_only": false } ]
}

// inspect_container → the same object plus:
{ "command": ["/usr/bin/node", "server.js"] }

// container_stats →
{ "cpu_percent": 12.5, "mem_used_mb": 128.0, "mem_limit_mb": 512.0 }
```

`container_logs`, `stop_container`, `remove_container`, `system_status`, and
`run_container` already match their consumers — do not change them.

## Remaining work

The capture + correction is **done** (paths confirmed above; tests built from the
real shapes). What's left is small:

- ~~Mount element field-names~~ — **confirmed** on macOS 26: `configuration.mounts[]`
  = `{source, destination, options[]}`, read-only is `"ro"` in `options`.
- ~~GUI: handle `"stopped"`~~ — **done**: the GUI's `ContainerStatusKind` now maps
  `stopped`/`dead`/`removed` → exited.
- **GUI: CPU% from `cpu_usage_usec` deltas** (consumer follow-up #2 above) — still open.
- Re-run the GUI's real (`mcp`) engine end-to-end against a live container — still open.

Reference — the original capture/confirm procedure:

1. Run the real CLI and capture ground truth:
   - `container ls --all --format json`
   - `container inspect <id>` (note: returns a single-element **array**)
   - `container stats --no-stream --format json <id>` (confirm the subcommand exists and its keys)
   Save these as fixtures under `test/fixtures/`.
2. Write a `normalizeContainer(raw)` / `normalizeStats(raw)` mapper in
   `src/tools/util.ts` that maps the real shape → the contract above. Key
   mappings to confirm against the fixtures: `configuration.image.reference → image`,
   `configuration.labels` (key=value array) → flat `labels` map, mounts location +
   the read-only field name, and the `created_at` source/format.
3. Apply it in `list_containers`, `inspect_container`, `container_stats` instead
   of `ok(res.stdout.trim())`.
4. Add unit tests that decode the fixtures through the mapper and assert the
   contract shape — so this can never silently regress again.
5. Re-verify end-to-end against the GUI's real (`mcp`) engine on macOS 26.

## Why this matters

Until this is fixed, the GUI's **real mode** renders structurally empty data even
though it compiles, all unit tests pass, and Mock mode looks perfect. Mock/unit
tests cannot catch a wrong tool field — only this normalization + fixture tests
(or live hardware) can.

# Tool output contract (and a known break to fix on macOS 26)

**Status:** ⚠️ Known issue — `list_containers`, `inspect_container`, and
`container_stats` currently emit **raw Apple `container` CLI JSON**, which does
not match the flat schema consumers expect. Found 2026-06-14 by a cross-repo
contract verification against the `container-mission-control` GUI. Real mode has
never run on macOS 26, so this has not surfaced at runtime yet.

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

## Fix plan (do on macOS 26, where you can see real CLI output)

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

# container-mcp

[![CI](https://github.com/mustafaTokmak/container-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mustafaTokmak/container-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Run AI agents in real VM sandboxes on your Mac — fully local, safe by default.**

An MCP server for [Apple containers](https://github.com/apple/container) — every
container gets its own VM, which makes it the right isolation boundary for code
an AI agent wrote five seconds ago. No daemon, no account, no cloud.

> Part of a larger toolkit: a native macOS "mission control" GUI for agent
> sandboxes is in development.

> [!IMPORTANT]
> **Requirements — read before installing.** This server shells out to Apple's
> `container` CLI, which only runs on **Apple silicon Macs (M-series) on macOS 26
> or newer**. There is no Linux, Intel, or pre-26 fallback — the server will
> install but every tool call fails without a working `container` CLI.
>
> - Apple silicon Mac (arm64)
> - macOS 26 (Tahoe) or newer
> - [Apple `container` CLI](https://github.com/apple/container/releases) installed and on `PATH`
> - Node.js 20+
>
> Verify the CLI is present before going further: `container --version`

## Why

- **Real VM isolation, per container** — each sandbox gets its own kernel via
  Apple's container runtime: the right boundary for agent-written code, not a
  shared-kernel namespace
- **Local-first and private** — no daemon, no account, no cloud; network is
  denied by default, so nothing leaves your Mac unless you allow it
- **Safe by default, and visible** — explicit mount allowlist, default-deny
  network, and managed-label scoping; the boundary is meant to be seen, not
  buried in config
- **Self-healing errors** — every failure tells the agent how to fix it
- **Agent-aware** — every container is labeled with the session and client that
  created it

## Install

Meets the requirements above? Install with one command (no clone, no build):

```bash
claude mcp add container -- npx -y container-mcp
```

Or point any MCP client's config at the published binary:

```json
{
  "mcpServers": {
    "container": { "command": "npx", "args": ["-y", "container-mcp"] }
  }
}
```

<details>
<summary>Install from source (for development or pre-release builds)</summary>

```bash
git clone https://github.com/mustafaTokmak/container-mcp.git
cd container-mcp
npm install && npm run build
claude mcp add container -- node "$(pwd)/dist/index.js"
```

</details>

## Verify it works

After adding the server, confirm the toolchain end-to-end by asking your agent to
check (and start) the container system service:

```
Use the system_status tool with start: true.
```

A healthy setup returns `running` (or `container system service started` on first
start). An error here means the `container` CLI isn't installed or you're not on
macOS 26+ — fix that before trying other tools.

## Try it — the aha moment

Ask your agent to run untrusted code in a throwaway VM and hand back the output —
no daemon, no cloud, network denied by default:

```
Run python:3.12-alpine in a container with wait: true and
command ["python", "-c", "print(sum(range(1000)))"]. Show me the output.
```

The agent calls `run_container` with `wait: true`, the code executes inside its
own VM with no network access, and you get back a structured result:

```
499500
```

That container had its own kernel, couldn't reach the network, and is gone when
you remove it (`remove_container`) — the right blast radius for code an agent
wrote five seconds ago. Want it to reach the network? Add `network: true` to the
same request.

## Tools

| Tool | Description |
|---|---|
| `run_container` | Run an image in its own VM (labeled, resource-limited; `wait: true` runs to completion and returns structured output; `network` enables egress; `ports` publishes ports) |
| `exec_in_container` | Run a command in a running container (returns structured `{exitCode, stdout, stderr}`) |
| `list_containers` / `container_logs` | Inspect state and output |
| `container_stats` | Snapshot CPU, memory, and I/O usage for a running container as JSON |
| `inspect_container` | Full container detail (configuration, mounts, labels, network, status) as JSON |
| `stop_container` / `remove_container` | Lifecycle |
| `copy_files` | Copy between host and container |
| `list_images` / `pull_image` / `build_image` | Image management |
| `remove_image` / `prune_images` | Remove images to reclaim disk |
| `system_status` | Check/start the container system service |

## Safety model

| Env var | Default | Effect |
|---|---|---|
| `CONTAINER_MCP_ALLOWED_MOUNTS` | launch dir + private scratch dir | Colon-separated allowlist of host paths agents may mount, copy to/from, or build from. Setting it replaces the default. |
| `CONTAINER_MCP_READONLY` | off | `1`/`true`: only listing, logs, and status work |
| `CONTAINER_MCP_ALLOW_NETWORK` | off | `1`/`true`: allow containers outbound network access (default: denied) |
| `CONTAINER_MCP_DEFAULT_CPUS` | `2` | CPU limit applied when the agent does not specify one |
| `CONTAINER_MCP_DEFAULT_MEMORY` | `2g` | Memory limit applied when the agent does not specify one |
| `CONTAINER_MCP_AGENT_NAME` | `agent` | Value of the `dev.container-mcp.agent` label on created containers |
| `CONTAINER_MCP_TIMEOUT_MS` | `120000` | Base CLI timeout in ms. Image pulls/builds and wait-mode runs get 600000 automatically. |
| `CONTAINER_MCP_MAX_CONTAINERS` | `10` | Maximum concurrent containers run_container will create |
| `CONTAINER_MCP_ALLOW_UNMANAGED` | off | `1`/`true`: allow operating on containers not created by this server |

Mount sources, build contexts, and dockerfiles must exist and are fully
canonicalized (symlinks resolved) before allowlist checks — a path cannot be
swapped for a symlink after validation. A launch directory of `/` or your home
directory is never used as an implicit allowlist root. Lifecycle tools
(stop, remove, exec, logs, copy) only operate on containers this server
created (tagged `dev.container-mcp.managed=true`) unless
`CONTAINER_MCP_ALLOW_UNMANAGED` is set. Every agent-supplied value that
reaches the CLI is guarded against flag injection, and commands are executed
with `execFile` (no shell), so there is no shell injection surface.

Containers have no outbound network by default (run with `--network none`); set
`CONTAINER_MCP_ALLOW_NETWORK` or pass `network: true` per run to enable egress.
Every container is labeled with a per-session id and the connecting MCP client's
name (`dev.container-mcp.session`, `dev.container-mcp.client`) so a session view
can attribute containers truthfully across concurrent agents.

## Verified against the real CLI

These were doc-only assumptions; the live suite now runs against container 1.0.0 on
macOS 26 and confirms (or corrected) each:

- `container exec` takes **no** `--` terminator — Apple captures everything after the
  container id as the process argv verbatim (passing `--` makes `--` the target
  executable and fails). Corrected 2026-06-14; a leading-dash command token is treated
  as a literal executable and fails closed, so dropping `--` opens no flag-injection path.
- `container cp` round-trips a file host → container → host. ✅ confirmed.
- `container inspect` nests labels under `configuration.labels`; managed-label checks
  parse it tolerantly and fail closed (override: `CONTAINER_MCP_ALLOW_UNMANAGED`). ✅ confirmed.
- `container run --network none` disables egress (the `none` value is accepted). ✅ confirmed.

Each has a dedicated test in the live suite below.

## Development

```bash
npm install
npm test          # unit + integration suite; no container CLI required
npm run build
```

`CONTAINER_MCP_LIVE=1 npm test` additionally runs the live end-to-end suite
([test/live.test.ts](test/live.test.ts)), which requires the container CLI,
pulls `alpine:latest`, and creates real containers. It is the pre-release
gate that verifies the known assumptions above against real hardware. CI
runs the regular suite on macOS for every push.

## License

MIT

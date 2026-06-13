# container-mcp

[![CI](https://github.com/mustafaTokmak/container-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mustafaTokmak/container-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Run AI agents in VM-isolated sandboxes on your Mac.**

An MCP server for [Apple containers](https://github.com/apple/container) — every
container gets its own lightweight VM, which makes it the right isolation
boundary for code an AI agent wrote five seconds ago.

> Part of a larger toolkit: a native macOS "mission control" GUI for agent
> sandboxes is in development.

## Why

- **VM-per-container isolation** — stronger than Docker's shared-kernel model
- **Safe by default** — agents can only mount the project directory and temp;
  everything else requires an explicit allowlist
- **Self-healing errors** — every failure tells the agent how to fix it
- **Agent-labeled** — every container is tagged with which agent created it

## Install

Requires an Apple silicon Mac, macOS 26 or newer, and the
[container CLI](https://github.com/apple/container/releases).

Until the npm package is published, install from source:

```bash
git clone https://github.com/mustafaTokmak/container-mcp.git
cd container-mcp
npm install && npm run build
claude mcp add container -- node "$(pwd)/dist/index.js"
```

Or in any MCP client config (point `command`/`args` at the built entry point):

```json
{
  "mcpServers": {
    "container": { "command": "node", "args": ["/absolute/path/to/container-mcp/dist/index.js"] }
  }
}
```

Once published to npm, this becomes `claude mcp add container -- npx -y container-mcp`.

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

## Known assumptions

Built against apple/container docs without a live CLI on the dev machine:

- `container exec` is invoked with a `--` terminator before the agent's command
  (standard swift-argument-parser convention, not explicitly documented).
- `container cp` is used (documented alias of the canonical `container copy`).
- `container inspect` label layout is undocumented; managed-label checks parse it
  tolerantly and fail closed (override: `CONTAINER_MCP_ALLOW_UNMANAGED`).
- `container run --network none` is assumed valid for disabling egress
  (Docker-compatible convention; the `--network` flag is documented but the `none`
  value is not explicitly — confirmed by the live suite).

Each assumption has a dedicated test in the live suite below.

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

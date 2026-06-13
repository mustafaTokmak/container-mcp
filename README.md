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

```bash
claude mcp add container -- npx -y container-mcp
```

Or in any MCP client config:

```json
{
  "mcpServers": {
    "container": { "command": "npx", "args": ["-y", "container-mcp"] }
  }
}
```

## Tools

| Tool | Description |
|---|---|
| `run_container` | Run an image in its own VM (labeled, resource-limited; `wait: true` runs to completion and returns output) |
| `exec_in_container` | Run a command in a running container |
| `list_containers` / `container_logs` | Inspect state and output |
| `stop_container` / `remove_container` | Lifecycle |
| `copy_files` | Copy between host and container |
| `list_images` / `pull_image` / `build_image` | Image management |
| `system_status` | Check/start the container system service |

## Safety model

| Env var | Default | Effect |
|---|---|---|
| `CONTAINER_MCP_ALLOWED_MOUNTS` | launch dir + private scratch dir | Colon-separated allowlist of host paths agents may mount, copy to/from, or build from. Setting it replaces the default. |
| `CONTAINER_MCP_READONLY` | off | `1`/`true`: only listing, logs, and status work |
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

## Known assumptions

Built against apple/container docs without a live CLI on the dev machine:

- `container exec` is invoked with a `--` terminator before the agent's command
  (standard swift-argument-parser convention, not explicitly documented).
- `container cp` is used (documented alias of the canonical `container copy`).
- `container inspect` label layout is undocumented; managed-label checks parse it
  tolerantly and fail closed (override: `CONTAINER_MCP_ALLOW_UNMANAGED`).

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

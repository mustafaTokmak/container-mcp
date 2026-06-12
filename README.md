# container-mcp

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

Requires an Apple silicon Mac, macOS 26+, and the
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
| `run_container` | Run an image in its own VM (detached, labeled, resource-limited) |
| `exec_in_container` | Run a command in a running container |
| `list_containers` / `container_logs` | Inspect state and output |
| `stop_container` / `remove_container` | Lifecycle |
| `copy_files` | Copy between host and container |
| `list_images` / `pull_image` / `build_image` | Image management |
| `system_status` | Check/start the container system service |

## Safety model

| Env var | Default | Effect |
|---|---|---|
| `CONTAINER_MCP_ALLOWED_MOUNTS` | launch dir + temp | Colon-separated allowlist of host paths agents may mount, copy to/from, or build from. Setting it replaces the default. |
| `CONTAINER_MCP_READONLY` | off | `1`/`true`: only listing, logs, and status work |
| `CONTAINER_MCP_DEFAULT_CPUS` | `2` | CPU limit applied when the agent does not specify one |
| `CONTAINER_MCP_DEFAULT_MEMORY` | `2g` | Memory limit applied when the agent does not specify one |
| `CONTAINER_MCP_AGENT_NAME` | `agent` | Value of the `dev.container-mcp.agent` label on created containers |

Mount sources are canonicalized (symlinks resolved) before allowlist checks, and
every agent-supplied value that reaches the CLI is guarded against flag
injection. Commands are executed with `execFile` (no shell), so there is no
shell injection surface.

## Known assumptions

Built against apple/container docs without a live CLI on the dev machine:

- `container exec` is invoked with a `--` terminator before the agent's command
  (standard swift-argument-parser convention, not explicitly documented).
- `container cp` is used (documented alias of the canonical `container copy`).
- Log tailing slices in-process rather than using the CLI's `-n` flag.

## License

MIT

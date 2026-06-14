# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-06-14

First release published to npm. Install with `npx -y container-mcp` /
`claude mcp add container -- npx -y container-mcp`.

### Added

- Every created container is now stamped with a
  `dev.container-mcp.network=allowed|denied` label reflecting its egress posture,
  so a GUI (Mission Control's boundary bar) can show per-session network state
  truthfully.
- Published to the npm registry as `container-mcp` (first public release).
- GitHub Actions release workflow that publishes on `v*` tag push with npm
  provenance (`npm publish --access public --provenance`).
- `tsconfig.test.json` and a `typecheck` npm script that type-check both `src`
  and `test`; CI now runs `npm run typecheck` so test/source type drift fails
  the build.

### Changed

- README: hoisted the Apple-silicon + macOS-26 + `container` CLI requirements
  into a prominent callout at the top, switched the Install section to the
  published `npx -y container-mcp` one-liner (from-source demoted to a
  collapsible block), and added "Verify it works" (system_status smoke test)
  and "Try it" (a worked run_container example) sections.

### Fixed

- Test suite type-checks cleanly under `tsc` (test-only typing fix; no change
  to shipped behavior).

[0.2.0]: https://github.com/mustafaTokmak/container-mcp/compare/v0.1.2...v0.2.0

## [0.1.2] - 2026-06-13

Engine round: network egress control, attribution labels, structured results,
two new read tools, port publishing, and image lifecycle tools. 15 tools total.

### Security

- Containers now have NO outbound network by default (`--network none`). Opt in
  globally via `CONTAINER_MCP_ALLOW_NETWORK=1` or per run with `network: true`.

### Added

- Per-session and per-client attribution labels (`dev.container-mcp.session`,
  `dev.container-mcp.client`) stamped on every created container so concurrent
  agents can be tracked independently.
- Structured `{exitCode, stdout, stderr}` results for `run_container` wait-mode
  and `exec_in_container`.
- `container_stats` tool: snapshot CPU, memory, and I/O for a running container
  as JSON (`container stats --no-stream --format json`).
- `inspect_container` tool: full container detail (configuration, mounts, labels,
  network, status) as JSON.
- Port publishing on `run_container` via the `ports` input
  (`{host, container, protocol}`), mapped to `--publish`.
- `remove_image` tool: delete a local image by reference (supports `--force`).
- `prune_images` tool: remove dangling (or all unused) images to reclaim disk.

### Changed

- README install section updated to from-source instructions until npm publish.

## [0.1.1] - 2026-06-12

Security and robustness hardening following a multi-model code review. No
public release was made from 0.1.0, so 0.1.1 is the first intended release.

### Security

- Closed a time-of-check/time-of-use mount race: mount sources, build
  contexts, and dockerfiles must now exist and are fully canonicalized
  (symlinks resolved) before the allowlist check, so a path cannot be swapped
  for a symlink after validation.
- A launch directory of `/` or the user's home directory is no longer used as
  an implicit allowlist root.
- The default writable scratch area is now a private per-process directory
  (mode 0700) instead of the shared system temp directory.
- Lifecycle tools (`stop`, `remove`, `exec`, `logs`, `copy`) now refuse to
  operate on containers this server did not create, verified via the
  `dev.container-mcp.managed` label and failing closed on unrecognized
  inspect output. Override with `CONTAINER_MCP_ALLOW_UNMANAGED`.
- Required string inputs reject empty values; `copy_files` requires absolute
  host paths and uses a stricter container-path classification.

### Added

- `run_container` gains `wait: true` (run to completion and return output)
  and `workdir`.
- Concurrent-container cap via `CONTAINER_MCP_MAX_CONTAINERS` (default 10).
- Configurable CLI timeout via `CONTAINER_MCP_TIMEOUT_MS` (default 120000);
  image pulls/builds and wait-mode runs automatically use 600000.
- Non-zero CLI exits now surface the exit code and a tail of stdout; timeout
  and output-overflow errors name the relevant remedy.
- Gated live end-to-end suite (`CONTAINER_MCP_LIVE=1`) and macOS CI workflow.

### Changed

- `container_logs` now tails via the CLI's native `-n` flag instead of
  fetching the full log and slicing in process.
- `VERSION` is read from `package.json` to prevent drift.
- npm package metadata (repository, keywords, `os`, `prepublishOnly`).

## [0.1.0] - 2026-06-12

Initial implementation (tagged, not published).

### Added

- MCP server wrapping Apple's `container` CLI over stdio.
- Eleven tools: `run_container`, `exec_in_container`, `list_containers`,
  `container_logs`, `stop_container`, `remove_container`, `copy_files`,
  `list_images`, `pull_image`, `build_image`, `system_status`.
- Host-path mount allowlist, read-only mode, flag-injection guards, and
  `execFile`-only execution (no shell).
- Management labels (`dev.container-mcp.managed`, `dev.container-mcp.agent`)
  on every created container.

[0.1.2]: https://github.com/mustafaTokmak/container-mcp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/mustafaTokmak/container-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mustafaTokmak/container-mcp/releases/tag/v0.1.0

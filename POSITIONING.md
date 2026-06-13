# Positioning

## One line

The local-first, safety-first way to run AI agents in real VM sandboxes on your
Mac — no daemon, no account, no cloud.

## The wedge

Agent sandboxing on macOS is no longer empty space (see the competitive map
below). The defensible angle is **not** "VM isolation" on its own — competitors
now match that. It is the combination others chose not to take:

1. **Fully local and private** — runs entirely on your Mac on Apple's own
   container runtime. No login, no daemon to install, no traffic off the
   machine. Network is denied by default.
2. **Safety as a visible product, not a config flag** — the mount allowlist,
   default-deny network, and managed-label scoping are surfaced (in the planned
   GUI) as a boundary you can see, not env vars you hope are set.
3. **Open source (MIT)** and Apple-native.

We lead with those three. We do **not** claim to be "stronger than Docker" —
that comparison is now stale and invites a losing argument.

## What we claim / what we don't

- Claim: real per-container VM isolation; local-only; safe-by-default and
  visible; agent-aware (session + client labels); open source.
- Don't claim: broadest feature set, cross-platform, cloud scale, or that VM
  isolation is unique to us.

## Competitive map (mid-2026, honest)

- **Docker Sandboxes (sbx)** — per-agent microVMs on Apple's Virtualization
  framework, cross-platform, free tier, Claude Code support, network-egress
  proxy. Requires a Docker account and is cloud-tied. *We are: local-only,
  no-account, open-source, Apple-native.*
- **Docker Desktop (classic)** — shared-kernel containers. *We are: real VMs.*
- **Sculptor (Imbue), Conductor (Melty Labs)** — native Mac "mission control"
  apps for parallel coding agents. They do not surface the isolation boundary as
  the product. *We are: isolation/safety as the visible surface.*
- **coderunner (instavm)** — Apple-container + MCP + UI, but a single shared
  Python/Jupyter sandbox. *We are: multi-container lifecycle + strict per-mount
  allowlist + managed-label safety.*
- **Dagger container-use** — category leader (~3.9k★), git-branch-per-agent
  review; requires the Dagger engine; apple/container backend is experimental.
  *We are: a leaner, no-Dagger, Apple-native primitive.* (Gap: no branch/diff
  review story yet — decide whether to add or stay a lower-level primitive.)
- **ACMS (Apple Container MCP Server)** — same Apple-container-MCP wedge, but
  self-describes as insecure (no allowlist). *We are: the safe one.*

## Known TAM constraint

Apple silicon + macOS 26 only. Accepted as a deliberate early-niche bet. If TAM
pressure grows, the hedge is to abstract the runtime backend (apple/container
now, Docker/Lima later) behind the same MCP + GUI — not a rewrite.

## Open question to revisit

Whether to add a git-branch-per-agent review workflow (container-use / Conductor
have it) or stay positioned as a lower-level safe primitive that pairs with git.

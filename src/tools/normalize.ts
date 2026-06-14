// Normalize raw Apple `container` CLI JSON into a stable, flat, snake_case schema
// that consumers (AI agents, the Mission Control GUI) can rely on regardless of CLI
// drift. The Apple CLI nests image/mounts/labels under a `configuration` object —
// CONFIRMED by the server's own ensureManaged (`configuration.labels`) and the
// MANAGED_INSPECT test fixture `[{ configuration: { labels: {...} } }]`.
//
// The exact paths for image/mounts/status/created_at are undocumented upstream, so
// each extractor tries the known candidate locations (nested under `configuration`
// AND flat) and falls back to a safe default — never throwing on a missing field.
//
// VERIFY ON macOS 26: capture real `container ls --format json` and
// `container inspect <id>` output as fixtures, then confirm the candidate paths
// below cover the real shape (and tighten them). Until then this is best-effort but
// strictly better than passing raw CLI JSON straight through. See docs/output-contract.md.

export interface NormalizedMount {
  source: string;
  destination: string;
  read_only: boolean;
}

export interface NormalizedContainer {
  id: string;
  image: string;
  status: string;
  created_at: string | null;
  labels: Record<string, string>;
  mounts: NormalizedMount[];
  command?: string[];
}

export interface NormalizedStats {
  cpu_percent: number;
  cpu_usage_usec: number;
  mem_used_mb: number;
  mem_limit_mb: number;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** key=value string array OR object map OR undefined -> flat map (mirrors ensureManaged). */
export function normalizeLabels(raw: unknown): Record<string, string> {
  if (Array.isArray(raw)) {
    return Object.fromEntries(
      raw
        .filter((e): e is string => typeof e === "string")
        .map((e) => {
          const i = e.indexOf("=");
          return i === -1 ? [e, ""] : [e.slice(0, i), e.slice(i + 1)];
        })
    );
  }
  if (raw && typeof raw === "object") return raw as Record<string, string>;
  return {};
}

export function normalizeMount(m: any): NormalizedMount {
  return {
    source: str(m?.source ?? m?.Source ?? m?.host ?? m?.hostPath ?? m?.host_path),
    destination: str(
      m?.destination ?? m?.Destination ?? m?.target ?? m?.guest ?? m?.containerPath ?? m?.container_path
    ),
    read_only: Boolean(m?.read_only ?? m?.readOnly ?? m?.readonly ?? m?.ro ?? false),
  };
}

function extractImage(node: any): string {
  const img = node?.configuration?.image ?? node?.image;
  if (typeof img === "string") return img;
  return str(img?.reference ?? img?.name ?? img?.tag);
}

function extractStatus(node: any): string {
  // Apple container 1.0.0: runtime state is `status.state` (an object: {state,startedDate,...}).
  const s = node?.status ?? node?.state ?? node?.configuration?.status;
  if (typeof s === "string") return s;
  return str(s?.state ?? s?.status);
}

function extractCreatedAt(node: any): string | null {
  const c =
    node?.configuration?.creationDate ?? // confirmed real Apple field (container 1.0.0)
    node?.created_at ??
    node?.createdAt ??
    node?.configuration?.created_at ??
    node?.configuration?.createdAt ??
    node?.status?.startedDate;
  return typeof c === "string" ? c : null;
}

function extractCommand(node: any): string[] | undefined {
  // Apple container 1.0.0: configuration.initProcess.{executable, arguments}.
  const ip = node?.configuration?.initProcess;
  if (ip && typeof ip === "object") {
    const exe = typeof ip.executable === "string" && ip.executable.length > 0 ? [ip.executable] : [];
    const args = Array.isArray(ip.arguments) ? ip.arguments.map(str).filter((s: string) => s.length > 0) : [];
    const cmd = [...exe, ...args];
    if (cmd.length > 0) return cmd;
  }
  const fallback = node?.command ?? node?.configuration?.command ?? node?.configuration?.process?.args;
  if (Array.isArray(fallback)) {
    const m = fallback.map(str).filter((s: string) => s.length > 0);
    if (m.length > 0) return m;
  }
  return undefined;
}

function extractMounts(node: any): NormalizedMount[] {
  const raw = node?.configuration?.mounts ?? node?.mounts;
  return Array.isArray(raw) ? raw.map(normalizeMount) : [];
}

/** Map one raw container/inspect node onto the flat contract schema. */
export function normalizeContainer(node: any): NormalizedContainer {
  const out: NormalizedContainer = {
    id: str(node?.id ?? node?.ID ?? node?.name ?? node?.configuration?.id),
    image: extractImage(node),
    status: extractStatus(node),
    created_at: extractCreatedAt(node),
    labels: normalizeLabels(node?.configuration?.labels ?? node?.labels),
    mounts: extractMounts(node),
  };
  const command = extractCommand(node);
  if (command) out.command = command;
  return out;
}

/** Parse + normalize a `container list --format json` payload (array, or a lone object). */
export function normalizeContainerList(stdout: string): NormalizedContainer[] {
  const parsed = JSON.parse(stdout);
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr.map(normalizeContainer);
}

/** Parse + normalize a `container inspect` payload (single-element array, or an object). */
export function normalizeInspect(stdout: string): NormalizedContainer {
  const parsed = JSON.parse(stdout);
  const node = Array.isArray(parsed) ? parsed[0] : parsed;
  return normalizeContainer(node);
}

/** Parse + normalize `container stats --format json` into cpu/mem numbers (MB). */
export function normalizeStats(stdout: string): NormalizedStats {
  let raw: any = {};
  try {
    raw = JSON.parse(stdout);
  } catch {
    raw = {};
  }
  if (Array.isArray(raw)) raw = raw[0] ?? {};

  const bytesToMb = (v: unknown) => num(v) / (1024 * 1024);

  // Apple container 1.0.0 stats: memoryUsageBytes / memoryLimitBytes / cpuUsageUsec (confirmed).
  const usedBytes = raw.memoryUsageBytes ?? raw.mem_used_bytes;
  const limitBytes = raw.memoryLimitBytes ?? raw.mem_limit_bytes;
  const usedMb =
    usedBytes !== undefined
      ? bytesToMb(usedBytes)
      : raw.mem_used_mb ?? raw.memory_usage_mb ?? raw.MemUsage ?? raw.memory_usage;
  const limitMb =
    limitBytes !== undefined
      ? bytesToMb(limitBytes)
      : raw.mem_limit_mb ?? raw.memory_limit_mb ?? raw.MemLimit ?? raw.memory_limit;

  return {
    // Apple exposes cumulative CPU time (cpuUsageUsec), NOT an instantaneous percent.
    // A real % needs two samples over time; consumers can derive it from cpu_usage_usec
    // deltas. cpu_percent stays best-effort (0 unless a pre-computed % key is present).
    cpu_percent: num(raw.cpu_percent ?? raw.cpuPercent ?? raw.CPUPerc ?? raw.cpu),
    cpu_usage_usec: num(raw.cpuUsageUsec ?? raw.cpu_usage_usec),
    mem_used_mb: num(usedMb),
    mem_limit_mb: num(limitMb),
  };
}

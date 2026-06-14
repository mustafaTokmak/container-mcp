import { describe, test, expect } from "vitest";
import {
  normalizeLabels,
  normalizeContainer,
  normalizeContainerList,
  normalizeInspect,
  normalizeStats,
} from "../src/tools/normalize.js";

describe("normalizeLabels", () => {
  test("key=value string array -> map", () => {
    expect(normalizeLabels(["a=1", "b=2", "flag"])).toEqual({ a: "1", b: "2", flag: "" });
  });
  test("object map passes through", () => {
    expect(normalizeLabels({ x: "y" })).toEqual({ x: "y" });
  });
  test("missing -> empty map", () => {
    expect(normalizeLabels(undefined)).toEqual({});
    expect(normalizeLabels(null)).toEqual({});
  });
});

describe("normalizeContainer", () => {
  test("lifts the configuration wrapper to a flat schema", () => {
    const node = {
      id: "abc",
      status: "running",
      created_at: "2026-06-14T10:00:00Z",
      configuration: {
        image: { reference: "docker.io/library/nginx:latest" },
        labels: ["dev.container-mcp.session=s1", "dev.container-mcp.client=Claude"],
        mounts: [{ source: "~/proj", destination: "/work", read_only: true }],
      },
    };
    expect(normalizeContainer(node)).toEqual({
      id: "abc",
      image: "docker.io/library/nginx:latest",
      status: "running",
      created_at: "2026-06-14T10:00:00Z",
      labels: { "dev.container-mcp.session": "s1", "dev.container-mcp.client": "Claude" },
      mounts: [{ source: "~/proj", destination: "/work", read_only: true }],
    });
  });

  test("also accepts an already-flat shape (defensive both-ways)", () => {
    const n = normalizeContainer({
      id: "x",
      image: "redis:7",
      status: "exited (0)",
      labels: { k: "v" },
      mounts: [{ source: "/a", destination: "/b", read_only: false }],
    });
    expect(n.image).toBe("redis:7");
    expect(n.labels).toEqual({ k: "v" });
    expect(n.mounts).toEqual([{ source: "/a", destination: "/b", read_only: false }]);
  });

  test("missing fields default safely, never throw", () => {
    expect(normalizeContainer({})).toEqual({
      id: "",
      image: "",
      status: "",
      created_at: null,
      labels: {},
      mounts: [],
    });
  });

  test("maps mount field-name variants", () => {
    const n = normalizeContainer({
      configuration: { mounts: [{ Source: "/h", Destination: "/g", readOnly: true }] },
    });
    expect(n.mounts).toEqual([{ source: "/h", destination: "/g", read_only: true }]);
  });

  test("real Apple mount shape — options[] carries read-only (macOS 26)", () => {
    // Captured from `container inspect` for `-v /tmp:/data` and `-v /tmp:/data:ro`.
    const rw = normalizeContainer({
      configuration: { mounts: [{ destination: "/data", options: [], source: "/tmp", type: { virtiofs: {} } }] },
    });
    expect(rw.mounts).toEqual([{ source: "/tmp", destination: "/data", read_only: false }]);
    const ro = normalizeContainer({
      configuration: { mounts: [{ destination: "/data", options: ["ro"], source: "/tmp", type: { virtiofs: {} } }] },
    });
    expect(ro.mounts).toEqual([{ source: "/tmp", destination: "/data", read_only: true }]);
  });

  test("image as a plain string", () => {
    expect(normalizeContainer({ configuration: { image: "alpine:3.20" } }).image).toBe("alpine:3.20");
  });

  test("includes command when present (for inspect)", () => {
    const n = normalizeContainer({ configuration: { command: ["node", "x.js"] } });
    expect(n.command).toEqual(["node", "x.js"]);
  });

  test("real Apple container shape (macOS 26 / container 1.0.0)", () => {
    // Captured from a live `container ls --format json` on macOS 26.5.1.
    const real = {
      configuration: {
        creationDate: "2026-06-14T04:05:40Z",
        id: "quayprobe",
        image: {
          descriptor: { digest: "sha256:a2d4", mediaType: "application/vnd.oci.image.index.v1+json", size: 9218 },
          reference: "docker.io/library/alpine:latest",
        },
        initProcess: { arguments: ["300"], executable: "sleep", environment: ["PATH=/bin"] },
        labels: {
          "dev.container-mcp.session": "probe-1",
          "dev.container-mcp.client": "Probe",
          "dev.container-mcp.managed": "true",
        },
        mounts: [],
        resources: { cpus: 4, memoryInBytes: 1073741824 },
      },
      id: "quayprobe",
      status: { state: "running", startedDate: "2026-06-14T04:05:42Z", networks: [] },
    };
    const n = normalizeContainer(real);
    expect(n.id).toBe("quayprobe");
    expect(n.image).toBe("docker.io/library/alpine:latest"); // configuration.image.reference
    expect(n.status).toBe("running"); // status.state
    expect(n.created_at).toBe("2026-06-14T04:05:40Z"); // configuration.creationDate
    expect(n.command).toEqual(["sleep", "300"]); // configuration.initProcess.{executable,arguments}
    expect(n.labels).toEqual({
      "dev.container-mcp.session": "probe-1",
      "dev.container-mcp.client": "Probe",
      "dev.container-mcp.managed": "true",
    });
    expect(n.mounts).toEqual([]);
  });
});

describe("normalizeContainerList / normalizeInspect", () => {
  test("list maps every element", () => {
    const out = normalizeContainerList(JSON.stringify([{ id: "a" }, { id: "b" }]));
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
  });
  test("inspect unwraps a single-element array", () => {
    const out = normalizeInspect(JSON.stringify([{ configuration: { labels: { k: "v" } } }]));
    expect(out.labels).toEqual({ k: "v" });
  });
  test("inspect accepts a bare object", () => {
    expect(normalizeInspect(JSON.stringify({ id: "z" })).id).toBe("z");
  });
});

describe("normalizeStats", () => {
  test("real Apple container stats shape (bytes + cumulative usec)", () => {
    // Captured from `container stats --no-stream --format json` on macOS 26.5.1.
    const real = JSON.stringify([
      {
        blockReadBytes: 1744896,
        blockWriteBytes: 0,
        cpuUsageUsec: 3259,
        id: "quayprobe",
        memoryLimitBytes: 1073741824,
        memoryUsageBytes: 2007040,
        networkRxBytes: 41256,
        networkTxBytes: 602,
        numProcesses: 1,
      },
    ]);
    expect(normalizeStats(real)).toEqual({
      cpu_percent: 0, // Apple emits cumulative usec, not an instantaneous percent
      cpu_usage_usec: 3259,
      mem_used_mb: 2007040 / (1024 * 1024),
      mem_limit_mb: 1024, // 1073741824 bytes
    });
  });
  test("percent string + MB keys (Docker-ish fallback)", () => {
    expect(
      normalizeStats(JSON.stringify({ cpu: "5%", mem_used_mb: 128, mem_limit_mb: 512 }))
    ).toEqual({ cpu_percent: 5, cpu_usage_usec: 0, mem_used_mb: 128, mem_limit_mb: 512 });
  });
  test("unrecognized / empty / malformed -> zeros, never throws", () => {
    expect(normalizeStats("{}")).toEqual({ cpu_percent: 0, cpu_usage_usec: 0, mem_used_mb: 0, mem_limit_mb: 0 });
    expect(normalizeStats("not json")).toEqual({ cpu_percent: 0, cpu_usage_usec: 0, mem_used_mb: 0, mem_limit_mb: 0 });
  });
});

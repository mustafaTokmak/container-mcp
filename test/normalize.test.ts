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

  test("image as a plain string", () => {
    expect(normalizeContainer({ configuration: { image: "alpine:3.20" } }).image).toBe("alpine:3.20");
  });

  test("includes command when present (for inspect)", () => {
    const n = normalizeContainer({ configuration: { command: ["node", "x.js"] } });
    expect(n.command).toEqual(["node", "x.js"]);
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
  test("percent string + MB keys", () => {
    expect(
      normalizeStats(JSON.stringify({ cpu: "5%", mem_used_mb: 128, mem_limit_mb: 512 }))
    ).toEqual({ cpu_percent: 5, mem_used_mb: 128, mem_limit_mb: 512 });
  });
  test("bytes fields convert to MB", () => {
    expect(
      normalizeStats(JSON.stringify({ cpu_percent: 12.5, mem_used_bytes: 1048576, mem_limit_bytes: 2097152 }))
    ).toEqual({ cpu_percent: 12.5, mem_used_mb: 1, mem_limit_mb: 2 });
  });
  test("unrecognized / empty / malformed -> zeros, never throws", () => {
    expect(normalizeStats("{}")).toEqual({ cpu_percent: 0, mem_used_mb: 0, mem_limit_mb: 0 });
    expect(normalizeStats("not json")).toEqual({ cpu_percent: 0, mem_used_mb: 0, mem_limit_mb: 0 });
  });
});

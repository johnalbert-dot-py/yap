import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveHealthPath,
  resolveHttpLogPath,
  resolveOutputPath,
  sourcePath,
  workflowArtifactRel,
  writeHealth,
  writeSources,
  writeWorkflowOutput,
} from "../src/cli/save.js";
import type { Health } from "../src/scrape/health.js";
import type { WorkflowResult } from "../src/workflow/types.js";

const result: WorkflowResult = {
  list_of_cars: { cars: [{ title: "Laptop" }] },
};

const now = new Date(2026, 7, 29, 3, 7, 21);

describe("workflow artifact paths", () => {
  it("mirrors a workflow path below workflows", () => {
    const cwd = "/tmp/yap";
    const workflowFile = join(cwd, "workflows/test-site.com/one.yaml");
    expect(workflowArtifactRel(workflowFile, cwd)).toBe(join("test-site.com", "one"));
    expect(resolveOutputPath({ workflowFile, useTimestamps: false, now, cwd })).toBe(
      join(cwd, "output/test-site.com/one.json"),
    );
    expect(resolveHealthPath({ workflowFile, useTimestamps: false, now, cwd })).toBe(
      join(cwd, "output/test-site.com/one.health.json"),
    );
    expect(sourcePath({ workflowFile, useTimestamps: false, now, cwd })).toBe(
      join(cwd, "output/test-site.com/one.source.json"),
    );
  });

  it("preserves the examples path", () => {
    const cwd = "/tmp/yap";
    const workflowFile = join(cwd, "workflows/examples/web-scraping.dev/products.yaml");
    expect(resolveOutputPath({ workflowFile, useTimestamps: false, now, cwd })).toBe(
      join(cwd, "output/examples/web-scraping.dev/products.json"),
    );
  });

  it("uses the basename for a workflow outside workflows", () => {
    const cwd = "/tmp/foo";
    const workflowFile = join(cwd, "log-demo.yaml");
    expect(workflowArtifactRel(workflowFile, cwd)).toBe("log-demo");
    expect(resolveOutputPath({ workflowFile, useTimestamps: false, now, cwd })).toBe(
      join(cwd, "output/log-demo.json"),
    );
  });

  it("uses the same timestamped stem for JSON and HTTP logs", () => {
    const cwd = "/tmp/yap";
    const workflowFile = join(cwd, "workflows/test-site.com/one.yml");
    const outputPath = resolveOutputPath({ workflowFile, useTimestamps: true, now, cwd });
    const logPath = resolveHttpLogPath({
      workflowFile,
      logging: { level: "INFO" },
      useTimestamps: true,
      now,
      cwd,
    });
    expect(outputPath).toBe(join(cwd, "output/test-site.com/one-2026-08-29-03-07-21.json"));
    expect(logPath).toBe(join(cwd, "logs/test-site.com/one-2026-08-29-03-07-21.log"));
  });

  it("does not resolve an HTTP log without logging", () => {
    expect(
      resolveHttpLogPath({
        workflowFile: "/tmp/foo/log-demo.yaml",
        logging: undefined,
        useTimestamps: false,
        now,
        cwd: "/tmp/foo",
      }),
    ).toBeUndefined();
  });
});

describe("writeWorkflowOutput", () => {
  it("creates mirrored directories and writes JSON", () => {
    const cwd = mkdtempSync(join(tmpdir(), "yap-output-"));
    const workflowFile = join(cwd, "workflows/examples/site.test/demo.yaml");
    try {
      const path = writeWorkflowOutput({
        workflowFile,
        result,
        useTimestamps: false,
        now,
        cwd,
      });
      expect(path).toBe(join(cwd, "output/examples/site.test/demo.json"));
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(result);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("writeHealth", () => {
  it("writes a sidecar next to the JSON result", () => {
    const cwd = mkdtempSync(join(tmpdir(), "yap-health-"));
    const workflowFile = join(cwd, "workflows/examples/site.test/demo.yaml");
    const health: Health = {
      status: "degraded",
      fields: [
        {
          scraperId: "card",
          field: "year",
          attempted: 2,
          matched: 1,
          missing: 1,
          required: true,
        },
      ],
    };
    try {
      const path = writeHealth({
        workflowFile,
        health,
        useTimestamps: false,
        now,
        cwd,
      });
      expect(path).toBe(join(cwd, "output/examples/site.test/demo.health.json"));
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(health);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("keeps the previous health file when overwriting", () => {
    const cwd = mkdtempSync(join(tmpdir(), "yap-health-prev-"));
    const workflowFile = join(cwd, "workflows/examples/site.test/demo.yaml");
    const previous: Health = {
      status: "healthy",
      fields: [
        {
          scraperId: "card",
          field: "year",
          attempted: 10,
          matched: 9,
          missing: 1,
          required: true,
        },
      ],
    };
    const current: Health = {
      status: "failed",
      fields: [
        {
          scraperId: "card",
          field: "year",
          attempted: 10,
          matched: 1,
          missing: 9,
          required: true,
        },
      ],
    };
    try {
      writeHealth({
        workflowFile,
        health: previous,
        useTimestamps: false,
        now,
        cwd,
      });
      writeHealth({
        workflowFile,
        health: current,
        useTimestamps: false,
        now,
        cwd,
      });
      expect(
        JSON.parse(
          readFileSync(join(cwd, "output/examples/site.test/demo.prev.health.json"), "utf8"),
        ),
      ).toEqual(previous);
      expect(
        JSON.parse(readFileSync(join(cwd, "output/examples/site.test/demo.health.json"), "utf8")),
      ).toEqual(current);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("writeSources", () => {
  it("writes a sidecar next to the JSON result", () => {
    const cwd = mkdtempSync(join(tmpdir(), "yap-prov-"));
    const workflowFile = join(cwd, "workflows/examples/site.test/demo.yaml");
    const sources = {
      cells: {
        "list.cards[0].title": {
          path: "list.cards[0].title",
          value: "Laptop",
          stepId: "page",
          scraperId: "card",
          scrapeId: "cards",
          selector: "h3",
          request: { method: "GET", url: "https://example.test" },
          response: { status: 200, url: "https://example.test" },
        },
      },
    };
    try {
      const path = writeSources({
        workflowFile,
        sources,
        useTimestamps: false,
        now,
        cwd,
      });
      expect(path).toBe(join(cwd, "output/examples/site.test/demo.source.json"));
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(sources);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

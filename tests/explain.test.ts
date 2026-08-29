import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ExplainError,
  explainCell,
  findNewestProvenanceFile,
  YAP_EXPLAIN_NO_RUN,
  YAP_EXPLAIN_NOT_FOUND,
} from "../src/cli/explain.js";
import type { ProvenanceIndex } from "../src/scrape/provenance.js";

const cell = {
  path: "list_of_cars.cars[17].year",
  value: "2021",
  rawValue: "2021",
  stepId: "remaining-pages",
  scraperId: "car-detail",
  scrapeId: "cars",
  selector: "p.card-text -> 1",
  request: { method: "GET", url: "https://example.com/cars?page=4" },
  response: { status: 200, url: "https://example.com/cars?page=4" },
};

const indexWithYear = (): ProvenanceIndex => ({
  cells: { [cell.path]: cell },
});

describe("findNewestProvenanceFile", () => {
  it("picks the newest mtime under output", () => {
    const cwd = mkdtempSync(join(tmpdir(), "yap-explain-"));
    try {
      mkdirSync(join(cwd, "output/examples"), { recursive: true });
      const older = join(cwd, "output/examples/older.provenance.json");
      const newer = join(cwd, "output/newer.provenance.json");
      writeFileSync(older, JSON.stringify(indexWithYear()));
      writeFileSync(newer, JSON.stringify({ cells: {} }));
      utimesSync(older, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
      utimesSync(newer, new Date("2026-01-02T00:00:00Z"), new Date("2026-01-02T00:00:00Z"));
      expect(findNewestProvenanceFile(cwd)).toBe(newer);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("returns undefined when no provenance file exists", () => {
    const cwd = mkdtempSync(join(tmpdir(), "yap-explain-"));
    try {
      expect(findNewestProvenanceFile(cwd)).toBeUndefined();
      mkdirSync(join(cwd, "output"), { recursive: true });
      writeFileSync(join(cwd, "output/demo.json"), "{}");
      expect(findNewestProvenanceFile(cwd)).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("explainCell", () => {
  it("prints the cell from the newest file", () => {
    const cwd = mkdtempSync(join(tmpdir(), "yap-explain-"));
    try {
      mkdirSync(join(cwd, "output"), { recursive: true });
      writeFileSync(join(cwd, "output/demo.provenance.json"), JSON.stringify(indexWithYear()));
      expect(explainCell("list_of_cars.cars[17].year", cwd)).toContain("remaining-pages");
      expect(explainCell("list_of_cars.cars[17].year", cwd)).toContain("2021");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("throws YAP_EXPLAIN_NO_RUN when no file exists", () => {
    const cwd = mkdtempSync(join(tmpdir(), "yap-explain-"));
    try {
      expect(() => explainCell("list_of_cars.cars[17].year", cwd)).toThrow(ExplainError);
      try {
        explainCell("list_of_cars.cars[17].year", cwd);
      } catch (error) {
        expect(error).toMatchObject({ code: YAP_EXPLAIN_NO_RUN });
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("scopes to a workflow file when one is passed", () => {
    const cwd = mkdtempSync(join(tmpdir(), "yap-explain-scope-"));
    try {
      mkdirSync(join(cwd, "output/examples/site.test"), { recursive: true });
      mkdirSync(join(cwd, "output/other"), { recursive: true });
      writeFileSync(
        join(cwd, "output/examples/site.test/demo.provenance.json"),
        JSON.stringify(indexWithYear()),
      );
      writeFileSync(join(cwd, "output/other/newer.provenance.json"), JSON.stringify({ cells: {} }));
      utimesSync(
        join(cwd, "output/examples/site.test/demo.provenance.json"),
        new Date("2026-01-01T00:00:00Z"),
        new Date("2026-01-01T00:00:00Z"),
      );
      utimesSync(
        join(cwd, "output/other/newer.provenance.json"),
        new Date("2026-01-02T00:00:00Z"),
        new Date("2026-01-02T00:00:00Z"),
      );
      const workflowFile = join(cwd, "workflows/examples/site.test/demo.yaml");
      expect(() => explainCell("list_of_cars.cars[17].year", cwd)).toThrow(ExplainError);
      expect(explainCell("list_of_cars.cars[17].year", cwd, workflowFile)).toContain("2021");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("throws YAP_EXPLAIN_NOT_FOUND when the path is missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "yap-explain-"));
    try {
      mkdirSync(join(cwd, "output"), { recursive: true });
      writeFileSync(join(cwd, "output/demo.provenance.json"), JSON.stringify(indexWithYear()));
      try {
        explainCell("list_of_cars.cars[0].year", cwd);
        throw new Error("expected missing path");
      } catch (error) {
        expect(error).toMatchObject({ code: YAP_EXPLAIN_NOT_FOUND });
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

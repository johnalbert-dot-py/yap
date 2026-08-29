import { describe, expect, it } from "vitest";
import {
  compareExtractionHealth,
  createExtractionStats,
  evaluateContracts,
  isMissingExtractedValue,
  processExitCode,
  recordScraperRows,
  type ExtractionHealth,
} from "../src/scrape/health.js";
import { formatDriftReport, formatHealthReport, healthStderrLines } from "../src/cli/health.js";

describe("extraction health", () => {
  it("treats null and empty string as missing", () => {
    expect(isMissingExtractedValue(null)).toBe(true);
    expect(isMissingExtractedValue(undefined)).toBe(true);
    expect(isMissingExtractedValue("")).toBe(true);
    expect(isMissingExtractedValue(" ")).toBe(false);
    expect(isMissingExtractedValue(0)).toBe(false);
    expect(isMissingExtractedValue(false)).toBe(false);
  });

  it("fails when a required field matches zero times", () => {
    const stats = createExtractionStats();
    recordScraperRows(stats, "card", { title: { required: true } }, [
      { title: null },
      { title: "" },
    ]);
    expect(evaluateContracts(stats)).toEqual({
      status: "failed",
      fields: [
        {
          scraperId: "card",
          field: "title",
          attempted: 2,
          matched: 0,
          missing: 2,
          required: true,
        },
      ],
    });
    expect(processExitCode("failed")).toBe(1);
  });

  it("degrades when a required field misses some rows", () => {
    const stats = createExtractionStats();
    recordScraperRows(stats, "card", { title: { required: true } }, [
      { title: "Laptop" },
      { title: null },
    ]);
    expect(evaluateContracts(stats).status).toBe("degraded");
    expect(processExitCode("degraded")).toBe(0);
  });

  it("stays healthy when required fields are omitted or unused", () => {
    const stats = createExtractionStats();
    recordScraperRows(stats, "card", { title: {} }, [{ title: null }]);
    expect(evaluateContracts(stats).status).toBe("healthy");
    expect(evaluateContracts(createExtractionStats()).status).toBe("healthy");
    expect(processExitCode("healthy")).toBe(0);
  });
});

describe("health stderr", () => {
  const failed = evaluateContracts(
    (() => {
      const stats = createExtractionStats();
      recordScraperRows(stats, "card", { title: { required: true } }, [{ title: null }]);
      return stats;
    })(),
  );

  it("prints a table on a TTY even when healthy", () => {
    expect(healthStderrLines({ status: "healthy", fields: [] }, true)).toEqual([
      "extraction  healthy",
    ]);
  });

  it("stays quiet when healthy and stderr is not a TTY", () => {
    expect(healthStderrLines({ status: "healthy", fields: [] }, false)).toEqual([]);
  });

  it("always prints failed and degraded reports", () => {
    expect(healthStderrLines(failed, false)[0]).toBe("YAP_EXTRACTION_FAILED");
    expect(formatHealthReport(failed)).toContain("card.title  0/1 matched  required");
  });
});

describe("compareExtractionHealth", () => {
  const previous: ExtractionHealth = {
    status: "healthy",
    fields: [
      {
        scraperId: "car-detail",
        field: "year",
        attempted: 342,
        matched: 334,
        missing: 8,
        required: true,
      },
    ],
  };
  const current: ExtractionHealth = {
    status: "degraded",
    fields: [
      {
        scraperId: "car-detail",
        field: "year",
        attempted: 342,
        matched: 11,
        missing: 331,
        required: true,
      },
    ],
  };

  it("marks severe drift when match rate falls from >= 80% to <= 20%", () => {
    const drift = compareExtractionHealth(previous, current);
    expect(drift.status).toBe("severe");
    expect(drift.fields[0]).toMatchObject({
      scraperId: "car-detail",
      field: "year",
      previousRate: 334 / 342,
      currentRate: 11 / 342,
      severity: "severe",
    });
    expect(formatDriftReport(drift)).toContain("Possible extraction drift");
    expect(formatDriftReport(drift)).toContain("car-detail.year");
  });

  it("stays none when rates do not cross the heuristic", () => {
    expect(compareExtractionHealth(previous, previous).status).toBe("none");
    expect(formatDriftReport(compareExtractionHealth(previous, previous))).toBe(
      "extraction drift  none",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  compareHealth,
  emptyStats,
  toHealth,
  isMissingExtractedValue,
  processExitCode,
  recordScraperRows,
  type Health,
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
    const stats = emptyStats();
    recordScraperRows(stats, "card", { title: { required: true } }, [
      { title: null },
      { title: "" },
    ]);
    expect(toHealth(stats)).toEqual({
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
    const stats = emptyStats();
    recordScraperRows(stats, "card", { title: { required: true } }, [
      { title: "Laptop" },
      { title: null },
    ]);
    expect(toHealth(stats).status).toBe("degraded");
    expect(processExitCode("degraded")).toBe(0);
  });

  it("stays healthy when required fields are omitted or unused", () => {
    const stats = emptyStats();
    recordScraperRows(stats, "card", { title: {} }, [{ title: null }]);
    expect(toHealth(stats).status).toBe("healthy");
    expect(toHealth(emptyStats()).status).toBe("healthy");
    expect(processExitCode("healthy")).toBe(0);
  });

  it("fails a required field when the scraper ran and returned no rows", () => {
    const stats = emptyStats();
    recordScraperRows(stats, "card", { title: { required: true } }, []);
    expect(toHealth(stats)).toEqual({
      status: "failed",
      fields: [
        {
          scraperId: "card",
          field: "title",
          attempted: 0,
          matched: 0,
          missing: 0,
          required: true,
        },
      ],
    });
  });

  it("keeps earlier page stats when a later page returns no rows", () => {
    const stats = emptyStats();
    recordScraperRows(stats, "card", { title: { required: true } }, [{ title: "Laptop" }]);
    recordScraperRows(stats, "card", { title: { required: true } }, []);
    expect(toHealth(stats).status).toBe("healthy");
    expect(toHealth(stats).fields[0]?.attempted).toBe(1);
  });
});

describe("health stderr", () => {
  const failed = toHealth(
    (() => {
      const stats = emptyStats();
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

describe("compareHealth", () => {
  const previous: Health = {
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
  const current: Health = {
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
    const drift = compareHealth(previous, current);
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
    expect(compareHealth(previous, previous).status).toBe("none");
    expect(formatDriftReport(compareHealth(previous, previous))).toBe("extraction drift  none");
  });

  it("marks severe drift when a required field drops to a zero-row scrape", () => {
    const current: Health = {
      status: "failed",
      fields: [
        {
          scraperId: "car-detail",
          field: "year",
          attempted: 0,
          matched: 0,
          missing: 0,
          required: true,
        },
      ],
    };
    const drift = compareHealth(previous, current);
    expect(drift.status).toBe("severe");
    expect(drift.fields[0]?.currentRate).toBe(0);
  });
});

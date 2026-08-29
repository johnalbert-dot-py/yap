import { readFileSync } from "node:fs";
import {
  compareHealth,
  type DriftReport,
  type Health,
  type ExtractionStatus,
  type FieldStats,
} from "../scrape/health.js";
import { healthSnapshotPair, newestSidecar } from "./artifacts.js";

export const YAP_HEALTH_NO_RUN = "YAP_HEALTH_NO_RUN";
export const YAP_DRIFT_NO_PREVIOUS = "YAP_DRIFT_NO_PREVIOUS";

export class HealthError extends Error {
  readonly code: typeof YAP_HEALTH_NO_RUN | typeof YAP_DRIFT_NO_PREVIOUS;

  constructor(code: typeof YAP_HEALTH_NO_RUN | typeof YAP_DRIFT_NO_PREVIOUS) {
    super(code);
    this.name = "HealthError";
    this.code = code;
  }
}

export const formatHealthReport = (health: Health): string => {
  const header = `extraction  ${health.status}`;
  if (health.fields.length === 0) {
    return header;
  }
  const rows = health.fields.map((field) => {
    const required = field.required ? "  required" : "";
    return `  ${field.scraperId}.${field.field}  ${field.matched}/${field.attempted} matched${required}`;
  });
  return [header, ...rows].join("\n");
};

const percent = (rate: number): string => `${(rate * 100).toFixed(1)}%`;

export const formatDriftReport = (drift: DriftReport): string => {
  if (drift.status === "none") {
    return "extraction drift  none";
  }
  const rows = drift.fields.flatMap((field) => [
    `  ${field.scraperId}.${field.field}`,
    `  previous  ${percent(field.previousRate)}  (${field.previousMatched}/${field.previousAttempted})`,
    `  current   ${percent(field.currentRate)}  (${field.currentMatched}/${field.currentAttempted})`,
  ]);
  return ["Possible extraction drift", ...rows].join("\n");
};

export const healthStderrLines = (health: Health, isTTY: boolean): string[] => {
  const lines: string[] = [];
  if (health.status === "failed") {
    lines.push("YAP_EXTRACTION_FAILED");
  } else if (health.status === "degraded") {
    lines.push("YAP_EXTRACTION_DEGRADED");
  }
  if (isTTY || health.status !== "healthy") {
    lines.push(formatHealthReport(health));
  }
  return lines;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStatus = (value: unknown): value is ExtractionStatus =>
  value === "healthy" || value === "degraded" || value === "failed";

const isFieldStats = (value: unknown): value is FieldStats => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.scraperId === "string" &&
    typeof value.field === "string" &&
    typeof value.attempted === "number" &&
    typeof value.matched === "number" &&
    typeof value.missing === "number" &&
    typeof value.required === "boolean"
  );
};

export const readHealthFile = (file: string): Health => {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(parsed) || !isStatus(parsed.status)) {
    return { status: "healthy", fields: [] };
  }
  const fields = Array.isArray(parsed.fields) ? parsed.fields.filter(isFieldStats) : [];
  return { status: parsed.status, fields };
};

export const readCurrentHealth = (cwd = process.cwd(), workflowFile?: string): Health => {
  const file = newestSidecar(cwd, "health", workflowFile);
  if (!file) {
    throw new HealthError(YAP_HEALTH_NO_RUN);
  }
  return readHealthFile(file);
};

export const readDrift = (cwd = process.cwd(), workflowFile?: string): DriftReport => {
  const pair = healthSnapshotPair(cwd, workflowFile);
  if (!pair) {
    throw new HealthError(YAP_HEALTH_NO_RUN);
  }
  if (!pair.previous) {
    throw new HealthError(YAP_DRIFT_NO_PREVIOUS);
  }
  return compareHealth(readHealthFile(pair.previous), readHealthFile(pair.current));
};

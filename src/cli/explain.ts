import { readFileSync } from "node:fs";
import { formatCell, type CellProvenance, type ProvenanceIndex } from "../scrape/provenance.js";
import { newestSidecar } from "./artifacts.js";

export const YAP_EXPLAIN_NO_RUN = "YAP_EXPLAIN_NO_RUN";
export const YAP_EXPLAIN_NOT_FOUND = "YAP_EXPLAIN_NOT_FOUND";

export class ExplainError extends Error {
  readonly code: typeof YAP_EXPLAIN_NO_RUN | typeof YAP_EXPLAIN_NOT_FOUND;

  constructor(code: typeof YAP_EXPLAIN_NO_RUN | typeof YAP_EXPLAIN_NOT_FOUND) {
    super(code);
    this.name = "ExplainError";
    this.code = code;
  }
}

export const findNewestProvenanceFile = (cwd: string, workflowFile?: string): string | undefined =>
  newestSidecar(cwd, "provenance", workflowFile);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isHopPart = (value: unknown): value is { method: string; url: string } => {
  if (!isRecord(value) || typeof value.method !== "string" || typeof value.url !== "string") {
    return false;
  }
  return true;
};

const isResponsePart = (value: unknown): value is { status: number; url: string } => {
  if (!isRecord(value) || typeof value.status !== "number" || typeof value.url !== "string") {
    return false;
  }
  return true;
};

const isCellProvenance = (value: unknown): value is CellProvenance => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.path === "string" &&
    typeof value.stepId === "string" &&
    typeof value.scraperId === "string" &&
    typeof value.scrapeId === "string" &&
    typeof value.selector === "string" &&
    isHopPart(value.request) &&
    isResponsePart(value.response)
  );
};

const readProvenanceIndex = (file: string): ProvenanceIndex => {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed.cells)) {
    return { cells: {} };
  }
  const cells: Record<string, CellProvenance> = {};
  for (const [key, cell] of Object.entries(parsed.cells)) {
    if (isCellProvenance(cell)) {
      cells[key] = cell;
    }
  }
  return { cells };
};

export const explainCell = (path: string, cwd = process.cwd(), workflowFile?: string): string => {
  const file = findNewestProvenanceFile(cwd, workflowFile);
  if (!file) {
    throw new ExplainError(YAP_EXPLAIN_NO_RUN);
  }
  const cell = readProvenanceIndex(file).cells[path];
  if (!cell) {
    throw new ExplainError(YAP_EXPLAIN_NOT_FOUND);
  }
  return formatCell(cell);
};

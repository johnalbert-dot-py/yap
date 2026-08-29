export const isMissingExtractedValue = (value: unknown): boolean =>
  value === null || value === undefined || value === "";

export type ExtractionStatus = "healthy" | "degraded" | "failed";

export type FieldExtractionStats = {
  scraperId: string;
  field: string;
  attempted: number;
  matched: number;
  missing: number;
  required: boolean;
};

export type ExtractionHealth = {
  status: ExtractionStatus;
  fields: FieldExtractionStats[];
};

export type ExtractionStats = Map<string, FieldExtractionStats>;

const fieldKey = (scraperId: string, field: string): string => `${scraperId}\0${field}`;

export const createExtractionStats = (): ExtractionStats => new Map();

export const recordScraperRows = (
  stats: ExtractionStats,
  scraperId: string,
  fields: Record<string, { required?: boolean }>,
  rows: Record<string, unknown>[],
): void => {
  for (const row of rows) {
    for (const [field, spec] of Object.entries(fields)) {
      const key = fieldKey(scraperId, field);
      let entry = stats.get(key);
      if (!entry) {
        entry = {
          scraperId,
          field,
          attempted: 0,
          matched: 0,
          missing: 0,
          required: spec.required === true,
        };
        stats.set(key, entry);
      }
      entry.attempted += 1;
      if (isMissingExtractedValue(row[field])) {
        entry.missing += 1;
      } else {
        entry.matched += 1;
      }
    }
  }
};

const compareFields = (left: FieldExtractionStats, right: FieldExtractionStats): number => {
  const byScraper = left.scraperId.localeCompare(right.scraperId);
  if (byScraper !== 0) {
    return byScraper;
  }
  return left.field.localeCompare(right.field);
};

export const evaluateContracts = (stats: ExtractionStats): ExtractionHealth => {
  const fields = [...stats.values()].sort(compareFields);
  let failed = false;
  let degraded = false;
  for (const field of fields) {
    if (!field.required || field.attempted === 0) {
      continue;
    }
    if (field.matched === 0) {
      failed = true;
    } else if (field.missing > 0) {
      degraded = true;
    }
  }
  const status: ExtractionStatus = failed ? "failed" : degraded ? "degraded" : "healthy";
  return { status, fields };
};

export const processExitCode = (status: ExtractionStatus): number => (status === "failed" ? 1 : 0);

export const matchRate = (field: FieldExtractionStats): number | undefined => {
  if (field.attempted === 0) {
    return undefined;
  }
  return field.matched / field.attempted;
};

export type FieldDrift = {
  scraperId: string;
  field: string;
  previousMatched: number;
  previousAttempted: number;
  currentMatched: number;
  currentAttempted: number;
  previousRate: number;
  currentRate: number;
  severity: "severe";
};

export type DriftReport = {
  status: "none" | "severe";
  fields: FieldDrift[];
};

const SEVERE_PREVIOUS = 0.8;
const SEVERE_CURRENT = 0.2;

export const compareExtractionHealth = (
  previous: ExtractionHealth,
  current: ExtractionHealth,
): DriftReport => {
  const previousByKey = new Map(
    previous.fields.map((field) => [fieldKey(field.scraperId, field.field), field]),
  );
  const fields: FieldDrift[] = [];
  for (const field of current.fields) {
    const prior = previousByKey.get(fieldKey(field.scraperId, field.field));
    if (!prior) {
      continue;
    }
    const previousRate = matchRate(prior);
    const currentRate = matchRate(field);
    if (previousRate === undefined || currentRate === undefined) {
      continue;
    }
    if (previousRate >= SEVERE_PREVIOUS && currentRate <= SEVERE_CURRENT) {
      fields.push({
        scraperId: field.scraperId,
        field: field.field,
        previousMatched: prior.matched,
        previousAttempted: prior.attempted,
        currentMatched: field.matched,
        currentAttempted: field.attempted,
        previousRate,
        currentRate,
        severity: "severe",
      });
    }
  }
  fields.sort((left, right) => {
    const byScraper = left.scraperId.localeCompare(right.scraperId);
    if (byScraper !== 0) {
      return byScraper;
    }
    return left.field.localeCompare(right.field);
  });
  return { status: fields.length > 0 ? "severe" : "none", fields };
};

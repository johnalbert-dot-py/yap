import { lookup } from "../interpolate.js";
import type { JsonScraper, Scrape, Scraper } from "../workflow/types.js";
import { recordScraperRows, type Stats } from "./health.js";

type JsonField = JsonScraper["fields"][string];

export const isJsonScraper = (scraper: Scraper): scraper is JsonScraper =>
  scraper.format === "json";

export const parseJson = (text: string): unknown => JSON.parse(text);

const normalizePath = (path: string): string => {
  if (path === "$") {
    return "";
  }
  return path.startsWith("$.") ? path.slice(2) : path;
};

export const atPath = (root: unknown, path: string): unknown => {
  const normalized = normalizePath(path);
  if (normalized === "") {
    return root;
  }
  if (typeof root !== "object" || root === null) {
    return undefined;
  }
  return lookup(root as Record<string, unknown>, normalized);
};

const pickIndex = (value: unknown, index: number | undefined): unknown => {
  if (index === undefined) {
    return value;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value[index - 1];
};

const readJsonField = (item: unknown, field: JsonField): unknown => {
  const value = field.path === undefined ? item : atPath(item, field.path);
  const picked = pickIndex(value, field.index);
  return picked === undefined ? null : picked;
};

export const applyJsonScraper = (item: unknown, scraper: JsonScraper): Record<string, unknown> => {
  const record: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(scraper.fields)) {
    record[name] = readJsonField(item, field);
  }
  return record;
};

const asItems = (value: unknown, many: boolean): unknown[] => {
  if (value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return many ? value : value.slice(0, 1);
  }
  return [value];
};

export const scrapeJsonOp = (
  doc: unknown,
  op: Scrape,
  scraper: JsonScraper,
  stats?: Stats,
): Record<string, unknown>[] => {
  const roots = asItems(atPath(doc, op.selector), op.many);
  const rows = roots.map((item) => applyJsonScraper(item, scraper));
  if (stats) {
    recordScraperRows(stats, op.using, scraper.fields, rows);
  }
  return rows;
};

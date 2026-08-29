import type { HtmlScraper, Scrape } from "../workflow/types.js";
import type { HtmlDocument, HtmlNode } from "./html.js";
import { recordScraperRows, type Stats } from "./health.js";

type Field = HtmlScraper["fields"][string];
type HtmlFields = { fields: HtmlScraper["fields"] };

const readField = (node: HtmlNode, field: Field): string | null => {
  const getter = field.getter;
  if (!getter || getter.type === "text") {
    return node.text();
  }
  if (getter.type === "attribute") {
    return node.attr(getter.value);
  }
  const _exhaustive: never = getter;
  return _exhaustive;
};

export const applyScraper = (root: HtmlNode, scraper: HtmlFields): Record<string, unknown> => {
  const record: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(scraper.fields)) {
    if (!field.selector) {
      record[name] = readField(root, field);
      continue;
    }
    const matches = root.selectAll(field.selector);
    const index = (field.index ?? 1) - 1;
    const node = matches[index];
    record[name] = node ? readField(node, field) : null;
  }
  return record;
};

export const scrapeOp = (
  doc: HtmlDocument,
  op: Scrape,
  scraper: HtmlFields,
  stats?: Stats,
): Record<string, unknown>[] => {
  const roots = doc.selectAll(op.selector);
  const selected = op.many ? roots : roots.slice(0, 1);
  const rows = selected.map((root) => applyScraper(root, scraper));
  if (stats) {
    recordScraperRows(stats, op.using, scraper.fields, rows);
  }
  return rows;
};

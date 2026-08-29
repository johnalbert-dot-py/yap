export type CellSource = {
  path: string;
  value: unknown;
  rawValue: unknown;
  stepId: string;
  scraperId: string;
  scrapeId: string;
  selector: string;
  request: { method: string; url: string };
  response: { status: number; url: string };
  paginationNext?: unknown;
};

export type Sources = {
  cells: Record<string, CellSource>;
};

export type CellPathParts = {
  datasetId: string;
  scrapeId: string;
  row: number;
  field: string;
};

type FieldLocator = {
  selector?: string;
  path?: string;
  index?: number;
};

const CELL_PATH = /^([^.]+)\.([^[\]]+)\[(\d+)\]\.(.+)$/;

export const emptySources = (): Sources => ({ cells: {} });

export const cellPath = (datasetId: string, scrapeId: string, row: number, field: string): string =>
  `${datasetId}.${scrapeId}[${row}].${field}`;

export const parseCellPath = (path: string): CellPathParts | undefined => {
  const match = CELL_PATH.exec(path);
  if (!match) {
    return undefined;
  }
  const datasetId = match[1];
  const scrapeId = match[2];
  const row = match[3];
  const field = match[4];
  if (
    datasetId === undefined ||
    scrapeId === undefined ||
    row === undefined ||
    field === undefined
  ) {
    return undefined;
  }
  return {
    datasetId,
    scrapeId,
    row: Number(row),
    field,
  };
};

export const cellSelector = (field: FieldLocator, opSelector: string): string => {
  const base = field.selector ?? field.path ?? opSelector;
  if (field.index === undefined) {
    return base;
  }
  return `${base} -> ${field.index}`;
};

export const recordScrapeRows = (args: {
  index: Sources;
  datasetId: string;
  scrapeId: string;
  scraperId: string;
  stepId: string;
  opSelector: string;
  fields: Record<string, FieldLocator>;
  rows: Record<string, unknown>[];
  rowStart: number;
  request: { method: string; url: string };
  response: { status: number; url: string };
  paginationNext?: unknown;
  includePagination: boolean;
}): void => {
  const {
    index,
    datasetId,
    scrapeId,
    scraperId,
    stepId,
    opSelector,
    fields,
    rows,
    rowStart,
    request,
    response,
  } = args;
  for (const [offset, row] of rows.entries()) {
    const rowIndex = rowStart + offset;
    for (const [field, spec] of Object.entries(fields)) {
      const path = cellPath(datasetId, scrapeId, rowIndex, field);
      const cell: CellSource = {
        path,
        value: row[field],
        rawValue: row[field],
        stepId,
        scraperId,
        scrapeId,
        selector: cellSelector(spec, opSelector),
        request,
        response,
      };
      if (args.includePagination) {
        cell.paginationNext = args.paginationNext;
      }
      index.cells[path] = cell;
    }
  }
};

export const lookupCell = (index: Sources, path: string): CellSource | undefined =>
  index.cells[path];

const displayValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "undefined" : encoded;
};

export const formatCell = (cell: CellSource): string =>
  [
    cell.path,
    "",
    "Value:",
    displayValue(cell.value),
    "",
    "Source:",
    `${cell.request.method} ${cell.request.url}`,
    "",
    "Step:",
    cell.stepId,
    "",
    "Scraper:",
    cell.scraperId,
    "",
    "Selector:",
    cell.selector,
    "",
    "Raw value:",
    JSON.stringify(cell.rawValue),
  ].join("\n");

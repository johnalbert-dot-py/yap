import type { Pagination } from "../workflow/types.js";

type ScrapeItems = Record<string, Record<string, unknown>[]>;

export const advanceNext = (current: number): number => current + 1;

export const initialNext = (pagination: Pagination): unknown => {
  const paginationNext = pagination.next;
  if (paginationNext === "page") {
    return pagination.start;
  }
  if (paginationNext === "cursor") {
    return pagination.start;
  }
  const _exhaustive: never = paginationNext;
  return _exhaustive;
};

export const advancePagination = (args: {
  pagination: Pagination;
  current: unknown;
  items: ScrapeItems;
}): { next: unknown; stop: boolean } => {
  const paginationNext = args.pagination.next;
  if (paginationNext === "page") {
    if (typeof args.current !== "number") {
      throw new TypeError("Page pagination cursor must be a number");
    }
    return { next: advanceNext(args.current), stop: false };
  }
  if (paginationNext === "cursor") {
    const separator = args.pagination.from.indexOf(".");
    const scrapeId = args.pagination.from.slice(0, separator);
    const field = args.pagination.from.slice(separator + 1);
    const next = args.items[scrapeId]?.[0]?.[field];
    const stop =
      next === null || next === undefined || next === "" || Object.is(next, args.current);
    return { next, stop };
  }
  const _exhaustive: never = paginationNext;
  return _exhaustive;
};

export const shouldStop = (args: {
  iteration: number;
  max: number;
  emptyItems: boolean;
  stopWhen: Pagination["stop_when"];
}): boolean => {
  if (args.iteration >= args.max) {
    return true;
  }
  return args.stopWhen.includes("empty_items") && args.emptyItems;
};

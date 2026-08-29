import { describe, expect, it } from "vitest";
import { advancePagination, initialNext, shouldStop } from "../src/runtime/pagination.js";

const pagination = {
  next: "page" as const,
  start: 2,
  max: 50,
  stop_when: ["empty_items" as const],
};

const cursorPagination = {
  next: "cursor" as const,
  from: "page.endCursor",
  start: null,
  max: 5,
  stop_when: ["empty_items" as const],
};

describe("pagination", () => {
  it("starts at start", () => {
    expect(initialNext(pagination)).toBe(2);
  });

  it("advances page pagination by one", () => {
    expect(
      advancePagination({
        pagination,
        current: 2,
        items: {},
      }),
    ).toEqual({ next: 3, stop: false });
  });

  it("starts cursor pagination at null", () => {
    expect(initialNext(cursorPagination)).toBeNull();
  });

  it("advances a cursor from the first row of this iteration", () => {
    expect(
      advancePagination({
        pagination: cursorPagination,
        current: null,
        items: { page: [{ endCursor: "cursor-20" }] },
      }),
    ).toEqual({ next: "cursor-20", stop: false });
  });

  it("stops cursor pagination when the cursor is missing", () => {
    expect(
      advancePagination({
        pagination: cursorPagination,
        current: "cursor-20",
        items: { page: [] },
      }),
    ).toEqual({ next: undefined, stop: true });
  });

  it("stops cursor pagination when the cursor does not change", () => {
    expect(
      advancePagination({
        pagination: cursorPagination,
        current: "cursor-20",
        items: { page: [{ endCursor: "cursor-20" }] },
      }),
    ).toEqual({ next: "cursor-20", stop: true });
  });

  it("stops on empty items", () => {
    expect(
      shouldStop({
        iteration: 1,
        max: 50,
        emptyItems: true,
        stopWhen: ["empty_items"],
      }),
    ).toBe(true);
  });

  it("stops at max even when items exist", () => {
    expect(
      shouldStop({
        iteration: 50,
        max: 50,
        emptyItems: false,
        stopWhen: ["empty_items"],
      }),
    ).toBe(true);
  });
});

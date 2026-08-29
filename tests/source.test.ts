import { describe, expect, it } from "vitest";
import {
  cellPath,
  cellSelector,
  emptySources,
  formatCell,
  lookupCell,
  parseCellPath,
  recordScrapeRows,
  type CellSource,
} from "../src/scrape/source.js";

describe("cell path", () => {
  it("builds and parses the canonical path", () => {
    const path = cellPath("list_of_cars", "cars", 17, "year");
    expect(path).toBe("list_of_cars.cars[17].year");
    expect(parseCellPath(path)).toEqual({
      datasetId: "list_of_cars",
      scrapeId: "cars",
      row: 17,
      field: "year",
    });
  });

  it("rejects a shorthand without a scrape id", () => {
    expect(parseCellPath("list_of_cars[17].year")).toBeUndefined();
  });
});

describe("cellSelector", () => {
  it("uses the field locator and appends a 1-based index", () => {
    expect(cellSelector({ selector: "p.card-text", index: 1 }, ".card")).toBe("p.card-text -> 1");
    expect(cellSelector({ path: "node.text" }, "data.reviews.edges")).toBe("node.text");
    expect(cellSelector({}, ".card-body")).toBe(".card-body");
    expect(cellSelector({ path: "items", index: 2 }, "$")).toBe("items -> 2");
  });
});

describe("recordScrapeRows", () => {
  it("records one cell per field using concatenated row indexes", () => {
    const index = emptySources();
    recordScrapeRows({
      index,
      datasetId: "list_of_cars",
      scrapeId: "cars",
      scraperId: "car-detail",
      stepId: "remaining-pages",
      opSelector: ".card-body",
      fields: {
        title: { selector: "h3.card-title a" },
        year: { selector: "p.card-text", index: 1 },
      },
      rows: [
        { title: "Tablet", year: "2019" },
        { title: "Watch", year: "2018" },
      ],
      rowStart: 2,
      request: { method: "GET", url: "https://example.com/cars?page=4" },
      response: { status: 200, url: "https://example.com/cars?page=4" },
      paginationNext: 4,
      includePagination: true,
    });
    expect(Object.keys(index.cells).sort()).toEqual([
      "list_of_cars.cars[2].title",
      "list_of_cars.cars[2].year",
      "list_of_cars.cars[3].title",
      "list_of_cars.cars[3].year",
    ]);
    expect(index.cells["list_of_cars.cars[2].year"]).toMatchObject({
      value: "2019",
      stepId: "remaining-pages",
      scraperId: "car-detail",
      scrapeId: "cars",
      selector: "p.card-text -> 1",
      paginationNext: 4,
    });
  });

  it("records nothing for an empty scrape list", () => {
    const index = emptySources();
    recordScrapeRows({
      index,
      datasetId: "site",
      scrapeId: "page",
      scraperId: "body-text",
      stepId: "warm",
      opSelector: "body",
      fields: { text: {} },
      rows: [],
      rowStart: 0,
      request: { method: "GET", url: "https://example.test/login" },
      response: { status: 200, url: "https://example.test/account" },
      includePagination: false,
    });
    expect(index.cells).toEqual({});
  });

  it("omits paginationNext when the step has no pagination", () => {
    const index = emptySources();
    recordScrapeRows({
      index,
      datasetId: "list",
      scrapeId: "cards",
      scraperId: "card",
      stepId: "page",
      opSelector: ".card",
      fields: { title: { selector: "h3" } },
      rows: [{ title: "Laptop" }],
      rowStart: 0,
      request: { method: "GET", url: "https://example.test" },
      response: { status: 200, url: "https://example.test" },
      includePagination: false,
    });
    expect(index.cells["list.cards[0].title"]?.paginationNext).toBeUndefined();
  });
});

describe("lookup and format", () => {
  const cell: CellSource = {
    path: "list_of_cars.cars[17].year",
    value: "2021",
    stepId: "remaining-pages",
    scraperId: "car-detail",
    scrapeId: "cars",
    selector: "p.card-text -> 1",
    request: { method: "GET", url: "https://example.com/cars?page=4" },
    response: { status: 200, url: "https://example.com/cars?page=4" },
    paginationNext: 4,
  };

  it("looks up a cell by canonical path", () => {
    const index = emptySources();
    index.cells[cell.path] = cell;
    expect(lookupCell(index, cell.path)).toEqual(cell);
    expect(lookupCell(index, "list_of_cars.cars[0].year")).toBeUndefined();
  });

  it("formats the locked explain text", () => {
    expect(formatCell(cell)).toBe(`list_of_cars.cars[17].year

Value:
2021

Source:
GET https://example.com/cars?page=4

Step:
remaining-pages

Scraper:
car-detail

Selector:
p.card-text -> 1`);
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyScraper, scrapeOp } from "../src/scrape/apply.js";
import { parseHtml } from "../src/scrape/html.js";

const dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(dir, "fixtures/page-1.html"), "utf8");

const scraper = {
  fields: {
    title: { selector: "h3.card-title a" },
    description: { selector: "p.description" },
    year: { selector: "p.card-text", index: 1 },
    country: { selector: "p.card-text", index: 2 },
    mileage: { selector: "p.card-text", index: 3 },
  },
};

describe("scrape", () => {
  it("extracts fields with 1-based index", () => {
    const doc = parseHtml(html);
    const cards = doc.selectAll(".test-sites-card .card-body");
    expect(applyScraper(cards[0]!, scraper)).toEqual({
      title: "Laptop",
      description: "A portable computer",
      year: "2020",
      country: "USA",
      mileage: "1000",
    });
  });

  it("returns all cards for many", () => {
    const doc = parseHtml(html);
    const rows = scrapeOp(
      doc,
      {
        id: "cars",
        selector: ".test-sites-card .card-body",
        many: true,
        using: "car-detail",
      },
      scraper,
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ title: "Phone" });
  });

  it("returns the first match when many is false", () => {
    const doc = parseHtml(html);
    const rows = scrapeOp(
      doc,
      {
        id: "cars",
        selector: ".test-sites-card .card-body",
        many: false,
        using: "car-detail",
      },
      scraper,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Laptop" });
  });

  it("uses null for a missing field", () => {
    const doc = parseHtml("<div class='card-body'></div>");
    const [root] = doc.selectAll(".card-body");
    expect(applyScraper(root!, scraper).title).toBeNull();
  });

  it("reads an attribute getter instead of text", () => {
    const doc = parseHtml('<body><span data-href="/page-2">click</span></body>');
    const [root] = doc.selectAll("body");
    const hrefScraper = {
      fields: {
        next_page: {
          selector: "span[data-href]",
          getter: { type: "attribute" as const, value: "data-href" },
        },
      },
    };
    expect(applyScraper(root!, hrefScraper)).toEqual({ next_page: "/page-2" });
  });

  it("uses null when the attribute is missing", () => {
    const doc = parseHtml("<body><span>click</span></body>");
    const [root] = doc.selectAll("body");
    const hrefScraper = {
      fields: {
        next_page: {
          selector: "span",
          getter: { type: "attribute" as const, value: "data-href" },
        },
      },
    };
    expect(applyScraper(root!, hrefScraper).next_page).toBeNull();
  });

  it("reads the scrape root when selector is omitted", () => {
    const doc = parseHtml("<body>hello<span>x</span></body>");
    const [root] = doc.selectAll("body");
    const selfScraper = {
      fields: {
        target: {},
      },
    };
    const text = applyScraper(root!, selfScraper).target;
    expect(typeof text).toBe("string");
    expect(text).toContain("hello");
    expect(text).toContain("x");
  });

  it("treats an empty selector as the scrape root and ignores index", () => {
    const doc = parseHtml("<body>hello<span>x</span></body>");
    const [root] = doc.selectAll("body");
    const selfScraper = {
      fields: {
        target: { selector: "", index: 2 },
      },
    };
    const text = applyScraper(root!, selfScraper).target;
    expect(text).toContain("hello");
    expect(text).toContain("x");
  });
});

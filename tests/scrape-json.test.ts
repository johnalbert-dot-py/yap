import { describe, expect, it } from "vitest";
import { applyJsonScraper, atPath, scrapeJsonOp } from "../src/scrape/json.js";
import type { JsonScraper } from "../src/workflow/types.js";

const scraper: JsonScraper = {
  format: "json",
  fields: {
    rid: { path: "node.rid" },
    text: { path: "node.text" },
    rating: { path: "node.rating" },
  },
};

const doc = {
  data: {
    reviews: {
      edges: [
        { node: { rid: "a", text: "good", rating: 5 } },
        { node: { rid: "b", text: "ok", rating: 4 } },
      ],
    },
  },
};

describe("json scrape", () => {
  it("walks dotted paths", () => {
    expect(atPath(doc, "data.reviews.edges.0.node.rid")).toBe("a");
    expect(atPath(doc, "$.data.reviews.edges.0.node.rid")).toBe("a");
    expect(atPath(doc, "$")).toEqual(doc);
  });

  it("extracts fields from each array item when many", () => {
    const rows = scrapeJsonOp(
      doc,
      {
        id: "reviews",
        selector: "data.reviews.edges",
        many: true,
        using: "review",
      },
      scraper,
    );
    expect(rows).toEqual([
      { rid: "a", text: "good", rating: 5 },
      { rid: "b", text: "ok", rating: 4 },
    ]);
  });

  it("keeps the first array item when many is false", () => {
    const rows = scrapeJsonOp(
      doc,
      {
        id: "reviews",
        selector: "data.reviews.edges",
        many: false,
        using: "review",
      },
      scraper,
    );
    expect(rows).toEqual([{ rid: "a", text: "good", rating: 5 }]);
  });

  it("uses null for a missing path", () => {
    expect(applyJsonScraper({ node: {} }, scraper).text).toBeNull();
  });

  it("reads the item itself when path is omitted", () => {
    const rootScraper: JsonScraper = {
      format: "json",
      fields: {
        ok: {},
      },
    };
    expect(applyJsonScraper(true, rootScraper)).toEqual({ ok: true });
  });

  it("picks a 1-based index from an array field", () => {
    const indexed: JsonScraper = {
      format: "json",
      fields: {
        second: { path: "items", index: 2 },
      },
    };
    expect(applyJsonScraper({ items: ["a", "b", "c"] }, indexed)).toEqual({ second: "b" });
  });

  it("returns no rows when the selector path is missing", () => {
    const rows = scrapeJsonOp(
      doc,
      {
        id: "reviews",
        selector: "data.missing",
        many: true,
        using: "review",
      },
      scraper,
    );
    expect(rows).toEqual([]);
  });
});

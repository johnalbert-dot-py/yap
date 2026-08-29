import { describe, expect, it } from "vitest";
import { interpolate, renderStepOutput } from "../src/interpolate.js";

describe("interpolate", () => {
  it("keeps the number when the whole string is pagination.next", () => {
    expect(interpolate("{{ pagination.next }}", { pagination: { next: 2 } })).toBe(2);
  });

  it("stringifies inside mixed text", () => {
    expect(
      interpolate("https://example.com?page={{ pagination.next }}", {
        pagination: { next: 3 },
      }),
    ).toBe("https://example.com?page=3");
  });

  it("interpolates nested request body keys named id", () => {
    expect(
      interpolate(
        { body: { id: "{{ input.id }}", selector: "{{ input.sel }}" } },
        { input: { id: "42", sel: ".card" } },
      ),
    ).toEqual({ body: { id: "42", selector: ".card" } });
  });

  it("fills scrape fields in mixed text", () => {
    expect(
      interpolate("Found from {{ pagination.next }} -> {{ cars.title }}", {
        pagination: { next: 2 },
        cars: { title: "Audi" },
      }),
    ).toBe("Found from 2 -> Audi");
  });

  it("keeps null when the whole string is a null field", () => {
    expect(
      interpolate("{{ cars.title }}", {
        cars: { title: null },
      }),
    ).toBe(null);
  });

  it("treats missing and null fields as empty inside mixed text", () => {
    expect(
      interpolate("x{{ cars.title }}y", {
        cars: { title: null },
      }),
    ).toBe("xy");
  });

  it("resolves hyphenated step ids in a path", () => {
    expect(
      interpolate("https://example.test{{ initial-page.href.next_page }}", {
        "initial-page": { href: { next_page: "/page-2" } },
      }),
    ).toBe("https://example.test/page-2");
  });

  it("throws on a missing path when missing is throw", () => {
    expect(() => interpolate("{{ input.tokne }}", { input: {} }, { missing: "throw" })).toThrow(
      'Unresolved interpolation "{{ input.tokne }}"',
    );
  });
});

describe("renderStepOutput", () => {
  it("joins scrape fields on one line", () => {
    expect(
      renderStepOutput(
        "Found from initial -> {{ cars.title }}",
        {
          cars: [{ title: "Laptop" }, { title: "Phone" }],
        },
        { pagination: { next: undefined } },
      ),
    ).toEqual(["Found from initial -> Laptop, Phone"]);
  });

  it("skips null and empty field values when joining", () => {
    expect(
      renderStepOutput(
        "Found from initial -> {{ cars.title }}",
        {
          cars: [{ title: "Laptop" }, { title: null }, { title: "" }, { title: "Phone" }],
        },
        {},
      ),
    ).toEqual(["Found from initial -> Laptop, Phone"]);
  });

  it("keeps pagination.next on the joined line", () => {
    expect(
      renderStepOutput(
        "Found from {{ pagination.next }} -> {{ cars.title }}",
        { cars: [{ title: "Tablet" }] },
        { pagination: { next: 2 } },
      ),
    ).toEqual(["Found from 2 -> Tablet"]);
  });

  it("prints once when the template has no scrape fields", () => {
    expect(
      renderStepOutput(
        "done page {{ pagination.next }}",
        { cars: [{ title: "X" }] },
        {
          pagination: { next: 3 },
        },
      ),
    ).toEqual(["done page 3"]);
  });

  it("prints nothing when the scrape bucket is empty", () => {
    expect(
      renderStepOutput(
        "Found from {{ pagination.next }} -> {{ cars.title }}",
        { cars: [] },
        {
          pagination: { next: 4 },
        },
      ),
    ).toEqual([]);
  });

  it("prints once when a token is not a scrape id", () => {
    expect(renderStepOutput("hello {{ missing.x }}", { cars: [{ title: "Laptop" }] }, {})).toEqual([
      "hello ",
    ]);
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WorkflowValidationError } from "../src/error.js";
import { loadWorkflow } from "../src/workflow/load.js";
import { timeoutToMs } from "../src/workflow/schema.js";

const dir = dirname(fileURLToPath(import.meta.url));

const captureValidationError = (yaml: string): WorkflowValidationError => {
  try {
    loadWorkflow(yaml);
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected workflow validation to fail");
};

describe("loadWorkflow", () => {
  it("rejects a file path passed as YAML contents", () => {
    const result = captureValidationError("./samples/paginated-cars.yaml");
    expect(result.message).toMatch(/file contents, not a path/);
  });

  it("loads the sample including timestamped output", () => {
    const yaml = readFileSync(
      join(dir, "../workflows/examples/webscraper.io/paginated-cars.yaml"),
      "utf8",
    );
    const workflow = loadWorkflow(yaml);
    expect(workflow.output?.["use-timestamps"]).toBe(true);
    expect(workflow.data.list_of_cars.steps[0]?.output).toContain("{{ cars.title }}");
  });

  it("loads data-binding attribute getters", () => {
    const yaml = readFileSync(
      join(dir, "../workflows/examples/web-scraping.dev/data-binding.yaml"),
      "utf8",
    );
    const workflow = loadWorkflow(yaml);
    expect(workflow.scrapers["href-scraper"]?.fields.next_page).toEqual({
      selector: "span[data-href]",
      getter: { type: "attribute", value: "data-href" },
    });
    expect(workflow.scrapers["target-href-scraper"]?.fields.target?.selector).toBeUndefined();
    expect(workflow.logging).toEqual({ level: "INFO" });
  });

  it("loads a json scraper and defaults omitted format to html", () => {
    const workflow = loadWorkflow(`
version: 1
name: json-demo
scrapers:
  card:
    fields:
      title:
        selector: h1
  review:
    format: json
    fields:
      text:
        path: node.text
data:
  one:
    name: One
    steps:
      - id: gql
        request:
          method: POST
          url: https://example.test/api/graphql
        scrape:
          - id: reviews
            selector: data.reviews.edges
            using: review
`);
    expect(workflow.scrapers.card?.format).toBe("html");
    expect(workflow.scrapers.review).toEqual({
      format: "json",
      fields: { text: { path: "node.text" } },
    });
  });

  it("loads required field flags", () => {
    const workflow = loadWorkflow(`
version: 1
name: required-demo
scrapers:
  card:
    fields:
      title:
        selector: h1
        required: true
      year:
        selector: span
data:
  one:
    name: One
    steps:
      - id: open
        request:
          method: GET
          url: https://example.test
        scrape:
          - id: cards
            selector: .card
            using: card
`);
    expect(workflow.scrapers.card?.fields.title).toEqual({
      selector: "h1",
      required: true,
    });
    expect(workflow.scrapers.card?.fields.year).toEqual({
      selector: "span",
    });
  });

  it("loads cursor pagination with a null default start", () => {
    const workflow = loadWorkflow(`
version: 1
name: cursor-demo
scrapers:
  page-info:
    format: json
    fields:
      endCursor:
        path: endCursor
data:
  one:
    name: One
    steps:
      - id: gql
        pagination:
          next: cursor
          from: page.endCursor
          max: 5
          stop_when: [empty_items]
        request:
          method: POST
          url: https://example.test/api/graphql
        scrape:
          - id: page
            selector: data.reviews.pageInfo
            many: false
            using: page-info
`);

    expect(workflow.data.one.steps[0]?.pagination).toEqual({
      next: "cursor",
      from: "page.endCursor",
      start: null,
      max: 5,
      stop_when: ["empty_items"],
    });
  });

  it("rejects cursor pagination without from", () => {
    const error = captureValidationError(`
version: 1
name: cursor-demo
scrapers:
  page-info:
    format: json
    fields:
      endCursor:
        path: endCursor
data:
  one:
    name: One
    steps:
      - id: gql
        pagination:
          next: cursor
          max: 5
          stop_when: [empty_items]
        request:
          method: POST
          url: https://example.test/api/graphql
        scrape:
          - id: page
            selector: data.reviews.pageInfo
            many: false
            using: page-info
`);

    expect(error.message).toContain("pagination.from");
  });

  it("rejects a cursor source scrape id that is not on the step", () => {
    const error = captureValidationError(`
version: 1
name: cursor-demo
scrapers:
  page-info:
    format: json
    fields:
      endCursor:
        path: endCursor
data:
  one:
    name: One
    steps:
      - id: gql
        pagination:
          next: cursor
          from: missing.endCursor
          max: 5
          stop_when: [empty_items]
        request:
          method: POST
          url: https://example.test/api/graphql
        scrape:
          - id: page
            selector: data.reviews.pageInfo
            many: false
            using: page-info
`);

    expect(error.message).toContain('unknown scrape id "missing"');
  });

  it("loads primitive shorthand and file record inputs", () => {
    const workflow = loadWorkflow(`
version: 1
name: inputs
input:
  ids: number[]
  pokemon:
    file: inputs/pokemon.yaml
    key: my-pokemon
    fields:
      id: number
      name: string
scrapers: {}
data: {}
`);

    expect(workflow.input.ids).toEqual({ type: "number[]" });
    expect(workflow.input.pokemon).toEqual({
      file: "inputs/pokemon.yaml",
      key: "my-pokemon",
      fields: { id: "number", name: "string" },
    });
  });

  it("rejects a bare field map as an input declaration", () => {
    const error = captureValidationError(`
version: 1
name: invalid-input
input:
  pokemon:
    id: string
scrapers: {}
data: {}
`);

    expect(error.message).toContain("input.pokemon");
  });

  it("rejects each when the input is missing", () => {
    const error = captureValidationError(`
version: 1
name: missing-each
scrapers:
  item:
    format: json
    fields:
      id:
        path: id
data:
  items:
    name: Items
    steps:
      - id: fetch
        each: input.missing
        request:
          method: GET
          url: https://example.test
        scrape:
          - id: items
            selector: "$"
            using: item
`);

    expect(error.message).toContain('each references unknown input "missing"');
  });

  it("rejects each over a scalar primitive input", () => {
    const error = captureValidationError(`
version: 1
name: scalar-each
input:
  id: number
scrapers:
  item:
    format: json
    fields:
      id:
        path: id
data:
  items:
    name: Items
    steps:
      - id: fetch
        each: input.id
        request:
          method: GET
          url: https://example.test
        scrape:
          - id: items
            selector: "$"
            using: item
`);

    expect(error.message).toContain('each input "id" must be a list');
  });

  it("rejects duplicate scrape ids on one step", () => {
    const error = captureValidationError(`
version: 1
name: dup-scrape
scrapers:
  card:
    fields:
      title:
        selector: h1
data:
  one:
    name: One
    steps:
      - id: open
        request:
          method: GET
          url: https://example.test
        scrape:
          - id: cars
            selector: .a
            using: card
          - id: cars
            selector: .b
            using: card
`);
    expect(error.message).toContain('duplicate scrape id "cars"');
  });

  it("rejects a non-integer pagination max", () => {
    const error = captureValidationError(`
version: 1
name: frac-max
scrapers:
  card:
    fields:
      title:
        selector: h1
data:
  one:
    name: One
    steps:
      - id: open
        pagination:
          next: page
          max: 1.5
          stop_when: [empty_items]
        request:
          method: GET
          url: https://example.test
        scrape:
          - id: cars
            selector: .card
            using: card
`);
    expect(error.message).toContain("pagination.max");
  });

  it("loads a step whose scrape list is empty", () => {
    const workflow = loadWorkflow(`
version: 1
name: session-warm
scrapers: {}
data:
  site:
    name: Site
    steps:
      - id: warm
        request:
          method: GET
          url: https://shop.example.test/login
        scrape: []
`);
    expect(workflow.data.site.steps[0]?.scrape).toEqual([]);
  });

  it("defaults an omitted scrape list to empty", () => {
    const workflow = loadWorkflow(`
version: 1
name: session-warm
scrapers: {}
data:
  site:
    name: Site
    steps:
      - id: warm
        request:
          method: GET
          url: https://shop.example.test/login
`);
    expect(workflow.data.site.steps[0]?.scrape).toEqual([]);
  });

  it("rejects pagination when scrape is empty", () => {
    const error = captureValidationError(`
version: 1
name: paged-warm
scrapers: {}
data:
  site:
    name: Site
    steps:
      - id: warm
        pagination:
          next: page
          max: 3
          stop_when: [empty_items]
        request:
          method: GET
          url: https://shop.example.test/login
        scrape: []
`);
    expect(error.message).toContain("pagination requires at least one scrape operation");
  });

  it("rejects a reserved scrape id", () => {
    const error = captureValidationError(`
version: 1
name: reserved-scrape
scrapers:
  card:
    fields:
      title:
        selector: h1
data:
  one:
    name: One
    steps:
      - id: open
        request:
          method: GET
          url: https://example.test
        scrape:
          - id: response
            selector: body
            using: card
`);
    expect(error.message).toContain('reserved scrape id "response"');
  });

  it("rejects a reserved step id", () => {
    const error = captureValidationError(`
version: 1
name: reserved-step
scrapers: {}
data:
  one:
    name: One
    steps:
      - id: request
        request:
          method: GET
          url: https://example.test
`);
    expect(error.message).toContain('reserved step id "request"');
  });

  it("rejects unknown keys on the workflow root", () => {
    const error = captureValidationError(`
version: 1
name: typo
loging:
  level: INFO
scrapers: {}
data: {}
`);
    expect(error.message).toMatch(/loging|unrecognized/i);
  });

  it("rejects selecter on a field", () => {
    const error = captureValidationError(`
version: 1
name: typo
scrapers:
  card:
    fields:
      title:
        selecter: h1
data:
  one:
    name: One
    steps:
      - id: open
        request:
          method: GET
          url: https://example.test
        scrape:
          - id: cards
            selector: .card
            using: card
`);
    expect(error.message).toMatch(/selecter|unrecognized/i);
  });

  it("rejects timout on a request", () => {
    const error = captureValidationError(`
version: 1
name: typo
scrapers: {}
data:
  one:
    name: One
    steps:
      - id: hit
        request:
          method: GET
          url: https://example.test
          timout: 5s
`);
    expect(error.message).toMatch(/timout|unrecognized/i);
  });

  it("accepts a request timeout duration", () => {
    const workflow = loadWorkflow(`
version: 1
name: timeout-demo
scrapers: {}
data:
  one:
    name: One
    steps:
      - id: hit
        request:
          method: GET
          url: https://example.test
          timeout: 45s
`);
    expect(workflow.data.one?.steps[0]?.request.timeout).toBe("45s");
  });

  it("treats a bare number timeout as seconds", () => {
    const workflow = loadWorkflow(`
version: 1
name: timeout-demo
scrapers: {}
data:
  one:
    name: One
    steps:
      - id: hit
        request:
          method: GET
          url: https://example.test
          timeout: 45
`);
    expect(workflow.data.one?.steps[0]?.request.timeout).toBe(45);
  });

  it("rejects 0s and unknown units", () => {
    const zero = captureValidationError(`
version: 1
name: timeout-demo
scrapers: {}
data:
  one:
    name: One
    steps:
      - id: hit
        request:
          method: GET
          url: https://example.test
          timeout: 0s
`);
    expect(zero.message).toMatch(/timeout|5s/i);
    const junk = captureValidationError(`
version: 1
name: timeout-demo
scrapers: {}
data:
  one:
    name: One
    steps:
      - id: hit
        request:
          method: GET
          url: https://example.test
          timeout: 5hours
`);
    expect(junk.message).toMatch(/timeout/i);
  });

  it("rejects timeout on the workflow root", () => {
    const error = captureValidationError(`
version: 1
name: timeout-demo
timeout: 45
scrapers: {}
data: {}
`);
    expect(error.message).toMatch(/timeout|unrecognized/i);
  });
});

describe("timeoutToMs", () => {
  it("converts ms, s, m, and bare seconds", () => {
    expect(timeoutToMs("500ms")).toBe(500);
    expect(timeoutToMs("5s")).toBe(5_000);
    expect(timeoutToMs("2m")).toBe(120_000);
    expect(timeoutToMs("45")).toBe(45_000);
    expect(timeoutToMs(45)).toBe(45_000);
  });

  it("rejects values the schema also rejects", () => {
    expect(() => timeoutToMs("0s")).toThrow(/Invalid timeout/);
    expect(() => timeoutToMs("5hours")).toThrow(/Invalid timeout/);
  });
});

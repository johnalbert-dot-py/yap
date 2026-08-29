import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HttpTransportError, WorkFlowValidationError } from "../src/error.js";
import type { HttpClient, HttpRequest } from "../src/http/client.js";
import { executeWorkflow, type StepHttpLog, type StepProgress } from "../src/runtime/execute.js";
import { parseHtml } from "../src/scrape/html.js";
import { loadWorkflow } from "../src/workflow/load.js";

const dir = dirname(fileURLToPath(import.meta.url));
const page1 = readFileSync(join(dir, "fixtures/page-1.html"), "utf8");
const page2 = readFileSync(join(dir, "fixtures/page-2.html"), "utf8");
const empty = readFileSync(join(dir, "fixtures/page-empty.html"), "utf8");

const yaml = `
version: 1
name: local-cars
scrapers:
  car-detail:
    fields:
      title:
        selector: "h3.card-title a"
data:
  list_of_cars:
    name: Cars
    steps:
      - id: initial-page
        request:
          method: GET
          url: "https://example.test/page-1"
        scrape:
          - id: cars
            selector: ".test-sites-card .card-body"
            many: true
            using: car-detail
        output: "Found from initial -> {{ cars.title }}"
      - id: remaining-pages
        pagination:
          next: page
          start: 2
          max: 50
          stop_when: [empty_items]
        request:
          method: GET
          url: "https://example.test/page-{{ pagination.next }}"
        scrape:
          - id: cars
            selector: ".test-sites-card .card-body"
            many: true
            using: car-detail
        output: "Found from {{ pagination.next }} -> {{ cars.title }}"
`;

const mockHttp = (): HttpClient => ({
  async request(req: HttpRequest) {
    if (req.url.endsWith("/page-1")) {
      return { status: 200, url: req.url, bodyText: page1 };
    }
    if (req.url.endsWith("/page-2")) {
      return { status: 200, url: req.url, bodyText: page2 };
    }
    return { status: 200, url: req.url, bodyText: empty };
  },
});

describe("executeWorkflow", () => {
  it("concats seed page and paginated pages then stops on empty", async () => {
    const workflow = loadWorkflow(yaml);
    const result = await executeWorkflow(workflow, {
      http: mockHttp(),
      parseHtml,
    });
    const cars = result.data.list_of_cars.cars as Array<{ title: string }>;
    expect(cars.map((row) => row.title)).toEqual(["Laptop", "Phone", "Tablet"]);
  });

  it("passes request timeout to http as milliseconds", async () => {
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
          url: "https://example.test/"
          timeout: 45s
`);
    let timeoutMs: number | undefined;
    const http: HttpClient = {
      async request(req: HttpRequest) {
        timeoutMs = req.timeoutMs;
        return { status: 200, url: req.url, bodyText: "ok" };
      },
    };
    await executeWorkflow(workflow, { http });
    expect(timeoutMs).toBe(45_000);
  });

  it("treats a bare request timeout number as seconds", async () => {
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
          url: "https://example.test/"
          timeout: 45
`);
    let timeoutMs: number | undefined;
    const http: HttpClient = {
      async request(req: HttpRequest) {
        timeoutMs = req.timeoutMs;
        return { status: 200, url: req.url, bodyText: "ok" };
      },
    };
    await executeWorkflow(workflow, { http });
    expect(timeoutMs).toBe(45_000);
  });

  it("defaults HTTP timeout to 30 seconds", async () => {
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
          url: "https://example.test/"
`);
    let timeoutMs: number | undefined;
    const http: HttpClient = {
      async request(req: HttpRequest) {
        timeoutMs = req.timeoutMs;
        return { status: 200, url: req.url, bodyText: "ok" };
      },
    };
    await executeWorkflow(workflow, { http });
    expect(timeoutMs).toBe(30_000);
  });

  it("emits start, per-iteration ticks, and done without joining every page", async () => {
    const workflow = loadWorkflow(yaml);
    const events: StepProgress[] = [];
    await executeWorkflow(workflow, {
      http: mockHttp(),
      parseHtml,
      onProgress: (event) => events.push(event),
    });
    expect(events).toEqual([
      { stepId: "initial-page", status: "start", percent: 0, label: "initial-page" },
      {
        stepId: "initial-page",
        status: "tick",
        percent: 100,
        label: "Found from initial -> Laptop, Phone",
      },
      { stepId: "initial-page", status: "done", percent: 100, label: "initial-page" },
      { stepId: "remaining-pages", status: "start", percent: 0, label: "remaining-pages" },
      {
        stepId: "remaining-pages",
        status: "tick",
        percent: 2,
        label: "Found from 2 -> Tablet",
      },
      { stepId: "remaining-pages", status: "tick", percent: 4, label: "remaining-pages" },
      { stepId: "remaining-pages", status: "done", percent: 100, label: "remaining-pages" },
    ]);
    expect(
      events.some((event) => event.label.includes("Laptop") && event.label.includes("Tablet")),
    ).toBe(false);
  });

  it("binds a later step URL to the first row of an earlier hyphenated step", async () => {
    const workflow = loadWorkflow(`
version: 1
name: bind
scrapers:
  href-scraper:
    fields:
      next_page:
        selector: "span[data-href]"
        getter:
          type: attribute
          value: data-href
data:
  via-attribute:
    name: Bind
    steps:
      - id: first-page
        request:
          method: GET
          url: "https://example.test/start"
        scrape:
          - id: href
            selector: body
            using: href-scraper
      - id: second-page
        request:
          method: GET
          url: "https://example.test{{ first-page.href.next_page }}"
        scrape:
          - id: href
            selector: body
            using: href-scraper
`);
    const urls: string[] = [];
    const http: HttpClient = {
      async request(req: HttpRequest) {
        urls.push(req.url);
        return {
          status: 200,
          url: req.url,
          bodyText: '<body><span data-href="/page-2">click</span></body>',
        };
      },
    };
    await executeWorkflow(workflow, { http, parseHtml });
    expect(urls).toEqual(["https://example.test/start", "https://example.test/page-2"]);
  });

  it("scrapes a JSON GraphQL body without calling parseHtml", async () => {
    const workflow = loadWorkflow(`
version: 1
name: gql
scrapers:
  review:
    format: json
    fields:
      text:
        path: node.text
data:
  reviews:
    name: Reviews
    steps:
      - id: graphql
        request:
          method: POST
          url: https://example.test/api/graphql
          body:
            query: "{ reviews { edges { node { text } } } }"
        scrape:
          - id: reviews
            selector: data.reviews.edges
            using: review
`);
    let parsedHtml = false;
    const http: HttpClient = {
      async request(req: HttpRequest) {
        expect(req.method).toBe("POST");
        expect(req.body).toEqual({ query: "{ reviews { edges { node { text } } } }" });
        return {
          status: 200,
          url: req.url,
          bodyText: JSON.stringify({
            data: { reviews: { edges: [{ node: { text: "tasty" } }] } },
          }),
        };
      },
    };
    const result = await executeWorkflow(workflow, {
      http,
      parseHtml: (html) => {
        parsedHtml = true;
        return parseHtml(html);
      },
    });
    expect(parsedHtml).toBe(false);
    expect(result.data.reviews.reviews).toEqual([{ text: "tasty" }]);
  });

  it("paginates GraphQL with each response end cursor and stops on empty edges", async () => {
    const workflow = loadWorkflow(`
version: 1
name: gql-cursor
scrapers:
  review:
    format: json
    fields:
      text:
        path: node.text
  page-info:
    format: json
    fields:
      endCursor:
        path: endCursor
data:
  reviews:
    name: Reviews
    steps:
      - id: graphql
        pagination:
          next: cursor
          from: page.endCursor
          max: 5
          stop_when: [empty_items]
        request:
          method: POST
          url: https://example.test/api/graphql
          body:
            query: "query Reviews($first: Int, $after: String) { reviews { edges { node { text } } } }"
            variables:
              first: 20
              after: "{{ pagination.next }}"
        scrape:
          - id: reviews
            selector: data.reviews.edges
            using: review
          - id: page
            selector: data.reviews.pageInfo
            many: false
            using: page-info
`);
    const responses = [
      {
        data: {
          reviews: {
            edges: [{ node: { text: "first" } }],
            pageInfo: { endCursor: "cursor-20" },
          },
        },
      },
      {
        data: {
          reviews: {
            edges: [{ node: { text: "second" } }],
            pageInfo: { endCursor: "cursor-40" },
          },
        },
      },
      {
        data: {
          reviews: {
            edges: [],
            pageInfo: { endCursor: null },
          },
        },
      },
    ];
    const bodies: unknown[] = [];
    const http: HttpClient = {
      async request(req: HttpRequest) {
        bodies.push(req.body);
        const response = responses[bodies.length - 1];
        if (!response) {
          throw new Error("Unexpected fourth GraphQL request");
        }
        return {
          status: 200,
          url: req.url,
          bodyText: JSON.stringify(response),
        };
      },
    };

    const result = await executeWorkflow(workflow, {
      http,
      parseHtml: () => {
        throw new Error("parseHtml must not run for GraphQL JSON");
      },
    });

    expect(bodies).toHaveLength(3);
    expect(bodies).toMatchObject([
      { variables: { first: 20, after: null } },
      { variables: { first: 20, after: "cursor-20" } },
      { variables: { first: 20, after: "cursor-40" } },
    ]);
    expect(result.data.reviews.reviews).toEqual([{ text: "first" }, { text: "second" }]);
  });

  it("throws when a json scraper gets invalid JSON", async () => {
    const workflow = loadWorkflow(`
version: 1
name: gql
scrapers:
  review:
    format: json
    fields:
      text:
        path: node.text
data:
  reviews:
    name: Reviews
    steps:
      - id: graphql
        request:
          method: GET
          url: https://example.test/api/graphql
        scrape:
          - id: reviews
            selector: data.reviews.edges
            using: review
`);
    const http: HttpClient = {
      async request(req: HttpRequest) {
        return { status: 200, url: req.url, bodyText: "<html>nope</html>" };
      },
    };
    await expect(executeWorkflow(workflow, { http, parseHtml })).rejects.toMatchObject({
      stepId: "graphql",
      message: expect.stringContaining("Invalid JSON"),
    });
  });

  it("runs each record as the outer loop and concatenates scraped rows", async () => {
    const workflow = loadWorkflow(`
version: 1
name: pokemon
input:
  pokemon:
    file: inputs/pokemon.yaml
    fields:
      id: number
      name: string
scrapers:
  pokemon-json:
    format: json
    fields:
      id:
        path: id
      name:
        path: name
data:
  details:
    name: Details
    steps:
      - id: get-pokemon
        each: input.pokemon
        request:
          method: GET
          url: "https://example.test/pokemon/{{ input.pokemon.id }}"
        scrape:
          - id: stats
            selector: "$"
            using: pokemon-json
        output: "Got {{ input.pokemon.name }} -> {{ stats.name }}"
`);
    const urls: string[] = [];
    const events: StepProgress[] = [];
    const http: HttpClient = {
      async request(req: HttpRequest) {
        urls.push(req.url);
        const id = Number(req.url.split("/").at(-1));
        return {
          status: 200,
          url: req.url,
          bodyText: JSON.stringify({ id, name: id === 1 ? "bulbasaur" : "ivysaur" }),
        };
      },
    };

    const result = await executeWorkflow(workflow, {
      http,
      parseHtml,
      inputs: {
        pokemon: [
          { id: 1, name: "Bulbasaur" },
          { id: 2, name: "Ivysaur" },
        ],
      },
      onProgress: (event) => events.push(event),
    });

    expect(urls).toEqual(["https://example.test/pokemon/1", "https://example.test/pokemon/2"]);
    expect(result.data.details.stats).toEqual([
      { id: 1, name: "bulbasaur" },
      { id: 2, name: "ivysaur" },
    ]);
    expect(events.filter((event) => event.status === "tick").map((event) => event.label)).toEqual([
      "Got Bulbasaur -> bulbasaur",
      "Got Ivysaur -> ivysaur",
    ]);
  });

  it("interpolates the full primitive list when each is omitted", async () => {
    const workflow = loadWorkflow(`
version: 1
name: ids
input:
  ids: number[]
scrapers:
  response:
    format: json
    fields:
      ok:
        path: ok
data:
  ids:
    name: IDs
    steps:
      - id: send-ids
        request:
          method: POST
          url: https://example.test/ids
          body:
            ids: "{{ input.ids }}"
        scrape:
          - id: ok
            selector: "$"
            using: response
`);
    const http: HttpClient = {
      async request(req: HttpRequest) {
        expect(req.body).toEqual({ ids: [1, 2, 3] });
        return {
          status: 200,
          url: req.url,
          bodyText: JSON.stringify({ ok: true }),
        };
      },
    };

    await executeWorkflow(workflow, {
      http,
      parseHtml,
      inputs: { ids: [1, 2, 3] },
    });
  });

  it("skips an each step without HTTP when the input list is empty", async () => {
    const workflow = loadWorkflow(`
version: 1
name: empty
input:
  ids: number[]
scrapers:
  response:
    format: json
    fields:
      ok:
        path: ok
data:
  ids:
    name: IDs
    steps:
      - id: no-requests
        each: input.ids
        request:
          method: GET
          url: "https://example.test/{{ input.ids }}"
        scrape:
          - id: ok
            selector: "$"
            using: response
`);
    let requests = 0;
    const http: HttpClient = {
      async request(req: HttpRequest) {
        requests++;
        return { status: 200, url: req.url, bodyText: JSON.stringify({ ok: true }) };
      },
    };

    const result = await executeWorkflow(workflow, {
      http,
      parseHtml,
      inputs: { ids: [] },
    });

    expect(requests).toBe(0);
    expect(result.data.ids).toEqual({});
  });

  it("resets inner pagination for every input item", async () => {
    const workflow = loadWorkflow(`
version: 1
name: paginated-inputs
input:
  ids: number[]
scrapers:
  item:
    format: json
    fields:
      id:
        path: id
data:
  ids:
    name: IDs
    steps:
      - id: fetch-pages
        each: input.ids
        pagination:
          next: page
          start: 1
          max: 2
          stop_when: [empty_items]
        request:
          method: GET
          url: "https://example.test/{{ input.ids }}/{{ pagination.next }}"
        scrape:
          - id: items
            selector: items
            using: item
`);
    const urls: string[] = [];
    const http: HttpClient = {
      async request(req: HttpRequest) {
        urls.push(req.url);
        const [id, page] = req.url.split("/").slice(-2).map(Number);
        return {
          status: 200,
          url: req.url,
          bodyText: JSON.stringify({ items: page === 1 ? [{ id }] : [] }),
        };
      },
    };

    const result = await executeWorkflow(workflow, {
      http,
      parseHtml,
      inputs: { ids: [1, 2] },
    });

    expect(urls).toEqual([
      "https://example.test/1/1",
      "https://example.test/1/2",
      "https://example.test/2/1",
      "https://example.test/2/2",
    ]);
    expect(result.data.ids.items).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("fails before execution when a declared input is missing", async () => {
    const workflow = loadWorkflow(`
version: 1
name: missing
input:
  ids: number[]
scrapers: {}
data: {}
`);

    await expect(executeWorkflow(workflow, { http: mockHttp(), parseHtml })).rejects.toBeInstanceOf(
      WorkFlowValidationError,
    );
    await expect(executeWorkflow(workflow, { http: mockHttp(), parseHtml })).rejects.toMatchObject({
      message: 'Missing required input "ids"',
    });
  });

  it("treats a present undefined input as missing", async () => {
    const workflow = loadWorkflow(`
version: 1
name: missing
input:
  ids: number[]
scrapers: {}
data: {}
`);
    await expect(
      executeWorkflow(workflow, { http: mockHttp(), parseHtml, inputs: { ids: undefined } }),
    ).rejects.toBeInstanceOf(WorkFlowValidationError);
  });

  it("rejects an interpolated request that is no longer a valid HTTP request", async () => {
    const workflow = loadWorkflow(`
version: 1
name: bad-url
input:
  ids: number[]
scrapers:
  item:
    format: json
    fields:
      id:
        path: id
data:
  one:
    name: One
    steps:
      - id: fetch
        request:
          method: GET
          url: "{{ input.ids }}"
        scrape:
          - id: items
            selector: "$"
            using: item
`);
    await expect(
      executeWorkflow(workflow, {
        http: mockHttp(),
        inputs: { ids: [1, 2] },
      }),
    ).rejects.toMatchObject({
      stepId: "fetch",
      message: expect.stringContaining("Invalid request after interpolation"),
    });
  });

  it("does not stop pagination when only a sidecar scrape is empty", async () => {
    const workflow = loadWorkflow(`
version: 1
name: sidecar
scrapers:
  car-detail:
    fields:
      title:
        selector: "h3.card-title a"
  empty-side:
    fields:
      missing:
        selector: ".does-not-exist"
data:
  list_of_cars:
    name: Cars
    steps:
      - id: pages
        pagination:
          next: page
          start: 1
          max: 50
          stop_when: [empty_items]
        request:
          method: GET
          url: "https://example.test/page-{{ pagination.next }}"
        scrape:
          - id: cars
            selector: ".test-sites-card .card-body"
            using: car-detail
          - id: side
            selector: ".nope"
            using: empty-side
`);
    const result = await executeWorkflow(workflow, {
      http: mockHttp(),
      parseHtml,
    });
    const cars = result.data.list_of_cars.cars as Array<{ title: string }>;
    expect(cars.map((row) => row.title)).toEqual(["Laptop", "Phone", "Tablet"]);
  });

  it("emits error progress when a step throws", async () => {
    const workflow = loadWorkflow(`
version: 1
name: boom
scrapers:
  body-text:
    fields:
      target: {}
data:
  one:
    name: One
    steps:
      - id: initial-page
        request:
          method: GET
          url: "https://example.test/page-1"
        scrape:
          - id: page
            selector: body
            using: body-text
`);
    const events: StepProgress[] = [];
    const http: HttpClient = {
      async request() {
        throw new HttpTransportError({
          message: "HTTP 503 for https://example.test/page-1",
          url: "https://example.test/page-1",
          status: 503,
        });
      },
    };
    await expect(
      executeWorkflow(workflow, {
        http,
        parseHtml,
        onProgress: (event) => events.push(event),
      }),
    ).rejects.toMatchObject({ stepId: "initial-page", status: 503 });
    expect(events.map((event) => event.status)).toEqual(["start", "error"]);
  });

  it("renders the landing URL in the spinner label after a redirect-like response", async () => {
    const workflow = loadWorkflow(`
version: 1
name: landing
scrapers: {}
data:
  site:
    name: Site
    steps:
      - id: warm
        request:
          method: GET
          url: https://shop.example.test/login
        output: "Landed {{ response.url }} ({{ response.status }})"
`);
    const events: StepProgress[] = [];
    const requested: string[] = [];
    const http: HttpClient = {
      async request(req: HttpRequest) {
        requested.push(req.url);
        return {
          status: 200,
          url: "https://shop.example.test/account",
          bodyText: "ok",
          headers: {},
        };
      },
    };
    const result = await executeWorkflow(workflow, {
      http,
      onProgress: (event) => events.push(event),
    });
    expect(requested).toEqual(["https://shop.example.test/login"]);
    expect(events.filter((event) => event.status === "tick").map((event) => event.label)).toEqual([
      "Landed https://shop.example.test/account (200)",
    ]);
    expect(result.data.site).toEqual({});
  });

  it("interpolates a prior step landing URL into the next request", async () => {
    const workflow = loadWorkflow(`
version: 1
name: hop-bind
scrapers:
  catalog:
    format: json
    fields:
      title:
        path: title
data:
  site:
    name: Site
    steps:
      - id: warm
        request:
          method: GET
          url: https://shop.example.test/login
      - id: catalog
        request:
          method: GET
          url: "{{ warm.response.url }}/products.json"
          headers:
            X-Landing: "{{ response.url }}"
        scrape:
          - id: products
            selector: "$"
            using: catalog
`);
    const urls: string[] = [];
    const headers: Array<Record<string, string> | undefined> = [];
    const http: HttpClient = {
      async request(req: HttpRequest) {
        urls.push(req.url);
        headers.push(req.headers);
        if (req.url.endsWith("/login")) {
          return {
            status: 200,
            url: "https://shop.example.test/session",
            bodyText: "ok",
            headers: {},
          };
        }
        return {
          status: 200,
          url: req.url,
          bodyText: JSON.stringify([{ title: "Shirt" }]),
        };
      },
    };
    const result = await executeWorkflow(workflow, { http });
    expect(urls).toEqual([
      "https://shop.example.test/login",
      "https://shop.example.test/session/products.json",
    ]);
    expect(headers[1]).toEqual({ "X-Landing": "https://shop.example.test/session" });
    expect(result.data.site).toEqual({ products: [{ title: "Shirt" }] });
  });
});

const logYaml = (logging: string) => `
version: 1
name: log-demo
${logging}
scrapers:
  body-text:
    fields:
      target: {}
data:
  one:
    name: One
    steps:
      - id: initial-page
        request:
          method: GET
          url: "https://example.test/page"
          headers:
            Accept: text/html
        scrape:
          - id: page
            selector: body
            using: body-text
`;

const shortHtml = "<body>hello</body>";

const logHttp = (): HttpClient => ({
  async request(req: HttpRequest) {
    return { status: 200, url: req.url, bodyText: shortHtml };
  },
});

describe("HTTP logging", () => {
  it("does not call onLog when logging is omitted", async () => {
    const workflow = loadWorkflow(logYaml(""));
    const entries: StepHttpLog[] = [];
    await executeWorkflow(workflow, {
      http: logHttp(),
      parseHtml,
      onLog: (entry) => entries.push(entry),
    });
    expect(entries).toEqual([]);
  });

  it("emits the interpolated request without response at INFO", async () => {
    const workflow = loadWorkflow(logYaml("logging:\n  level: INFO\n"));
    const entries: StepHttpLog[] = [];
    await executeWorkflow(workflow, {
      http: logHttp(),
      parseHtml,
      onLog: (entry) => entries.push(entry),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("INFO");
    expect(entries[0]?.stepId).toBe("initial-page");
    expect(entries[0]?.request).toEqual({
      method: "GET",
      url: "https://example.test/page",
      headers: { Accept: "text/html" },
    });
    expect(entries[0]?.response).toBeUndefined();
  });

  it("omits request body and params at INFO", async () => {
    const workflow = loadWorkflow(`
version: 1
name: log-demo
logging:
  level: INFO
scrapers: {}
data:
  one:
    name: One
    steps:
      - id: hit
        request:
          method: POST
          url: "https://example.test/api"
          body:
            token: secret
          params:
            q: 1
`);
    const entries: StepHttpLog[] = [];
    await executeWorkflow(workflow, {
      http: logHttp(),
      onLog: (entry) => entries.push(entry),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.request).not.toHaveProperty("body");
    expect(entries[0]?.request).not.toHaveProperty("params");
  });

  it("includes request body at DEBUG", async () => {
    const workflow = loadWorkflow(`
version: 1
name: log-demo
logging:
  level: DEBUG
scrapers: {}
data:
  one:
    name: One
    steps:
      - id: hit
        request:
          method: POST
          url: "https://example.test/api"
          body:
            token: secret
`);
    const entries: StepHttpLog[] = [];
    await executeWorkflow(workflow, {
      http: logHttp(),
      onLog: (entry) => entries.push(entry),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.request.body).toEqual({ token: "secret" });
  });

  it("includes response.bodyText at DEBUG", async () => {
    const workflow = loadWorkflow(logYaml("logging:\n  level: DEBUG\n"));
    const entries: StepHttpLog[] = [];
    await executeWorkflow(workflow, {
      http: logHttp(),
      parseHtml,
      onLog: (entry) => entries.push(entry),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("DEBUG");
    expect(entries[0]?.request.url).toBe("https://example.test/page");
    expect(entries[0]?.response).toEqual({
      status: 200,
      url: "https://example.test/page",
      bodyText: shortHtml,
    });
  });

  it("emits then rethrows on 5xx", async () => {
    const workflow = loadWorkflow(logYaml("logging:\n  level: DEBUG\n"));
    const entries: StepHttpLog[] = [];
    const http: HttpClient = {
      async request(req: HttpRequest) {
        throw new HttpTransportError({
          message: `HTTP 503 for ${req.url}`,
          url: req.url,
          status: 503,
        });
      },
    };
    await expect(
      executeWorkflow(workflow, {
        http,
        parseHtml,
        onLog: (entry) => entries.push(entry),
      }),
    ).rejects.toMatchObject({ status: 503, stepId: "initial-page" });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.request.url).toBe("https://example.test/page");
    expect(entries[0]?.response?.status).toBe(503);
  });

  it("redacts Authorization and Cookie on logged requests", async () => {
    const workflow = loadWorkflow(`
version: 1
name: log-demo
logging:
  level: INFO
scrapers:
  body-text:
    fields:
      target: {}
data:
  one:
    name: One
    steps:
      - id: initial-page
        request:
          method: GET
          url: "https://example.test/page"
          headers:
            Accept: text/html
            Authorization: Bearer secret
            Cookie: session=1
        scrape:
          - id: page
            selector: body
            using: body-text
`);
    const entries: StepHttpLog[] = [];
    await executeWorkflow(workflow, {
      http: logHttp(),
      parseHtml,
      onLog: (entry) => entries.push(entry),
    });
    expect(entries[0]?.request.headers).toEqual({
      Accept: "text/html",
      Authorization: "[redacted]",
      Cookie: "[redacted]",
    });
  });

  it("sends a request with empty scrape and does not need parseHtml", async () => {
    const urls: string[] = [];
    const http: HttpClient = {
      async request(req: HttpRequest) {
        urls.push(req.url);
        if (req.url.endsWith("/products.json")) {
          return {
            status: 200,
            url: req.url,
            bodyText: JSON.stringify([{ title: "Shirt" }]),
          };
        }
        return { status: 200, url: req.url, bodyText: "ok" };
      },
    };
    const workflow = loadWorkflow(`
version: 1
name: session-warm
scrapers:
  catalog:
    format: json
    fields:
      title:
        path: title
data:
  site:
    name: Site
    steps:
      - id: warm
        request:
          method: GET
          url: https://shop.example.test/login
        scrape: []
      - id: catalog
        request:
          method: GET
          url: https://shop.example.test/products.json
        scrape:
          - id: products
            selector: "$"
            using: catalog
`);
    const result = await executeWorkflow(workflow, { http });
    expect(urls).toEqual([
      "https://shop.example.test/login",
      "https://shop.example.test/products.json",
    ]);
    expect(result.data.site).toEqual({ products: [{ title: "Shirt" }] });
  });

  it("keeps rows and reports healthy when required fields match", async () => {
    const workflow = loadWorkflow(`
version: 1
name: required-ok
scrapers:
  card:
    fields:
      title:
        selector: h3
        required: true
data:
  list:
    name: List
    steps:
      - id: page
        request:
          method: GET
          url: https://example.test
        scrape:
          - id: cards
            selector: .card
            using: card
`);
    const http: HttpClient = {
      async request(req) {
        return {
          status: 200,
          url: req.url,
          bodyText: '<div class="card"><h3>Laptop</h3></div><div class="card"><h3>Phone</h3></div>',
        };
      },
    };
    const run = await executeWorkflow(workflow, { http, parseHtml });
    expect(run.data.list.cards).toEqual([{ title: "Laptop" }, { title: "Phone" }]);
    expect(run.health).toEqual({
      status: "healthy",
      fields: [
        {
          scraperId: "card",
          field: "title",
          attempted: 2,
          matched: 2,
          missing: 0,
          required: true,
        },
      ],
    });
  });

  it("keeps rows and reports degraded when a required field misses some rows", async () => {
    const workflow = loadWorkflow(`
version: 1
name: required-degraded
scrapers:
  card:
    fields:
      title:
        selector: h3
        required: true
data:
  list:
    name: List
    steps:
      - id: page
        request:
          method: GET
          url: https://example.test
        scrape:
          - id: cards
            selector: .card
            using: card
`);
    const http: HttpClient = {
      async request(req) {
        return {
          status: 200,
          url: req.url,
          bodyText:
            '<div class="card"><h3>Laptop</h3></div><div class="card"><p>no title</p></div>',
        };
      },
    };
    const run = await executeWorkflow(workflow, { http, parseHtml });
    expect(run.data.list.cards).toEqual([{ title: "Laptop" }, { title: null }]);
    expect(run.health.status).toBe("degraded");
    expect(run.health.fields).toEqual([
      {
        scraperId: "card",
        field: "title",
        attempted: 2,
        matched: 1,
        missing: 1,
        required: true,
      },
    ]);
  });

  it("keeps rows and reports failed when a required field matches zero times", async () => {
    const workflow = loadWorkflow(`
version: 1
name: required-failed
scrapers:
  card:
    fields:
      title:
        selector: h3
        required: true
data:
  list:
    name: List
    steps:
      - id: page
        request:
          method: GET
          url: https://example.test
        scrape:
          - id: cards
            selector: .card
            using: card
`);
    const http: HttpClient = {
      async request(req) {
        return {
          status: 200,
          url: req.url,
          bodyText:
            '<div class="card"><p>no title</p></div><div class="card"><p>still none</p></div>',
        };
      },
    };
    const run = await executeWorkflow(workflow, { http, parseHtml });
    expect(run.data.list.cards).toEqual([{ title: null }, { title: null }]);
    expect(run.health.status).toBe("failed");
    expect(run.health.fields[0]).toMatchObject({
      field: "title",
      attempted: 2,
      matched: 0,
      missing: 2,
      required: true,
    });
  });

  it("does not fail a required field that was never attempted", async () => {
    const workflow = loadWorkflow(`
version: 1
name: unused-required
scrapers:
  unused:
    fields:
      title:
        selector: h3
        required: true
  body-text:
    fields:
      text: {}
data:
  list:
    name: List
    steps:
      - id: page
        request:
          method: GET
          url: https://example.test
        scrape:
          - id: page
            selector: body
            using: body-text
`);
    const http: HttpClient = {
      async request(req) {
        return { status: 200, url: req.url, bodyText: "<body>ok</body>" };
      },
    };
    const run = await executeWorkflow(workflow, { http, parseHtml });
    expect(run.health.status).toBe("healthy");
    expect(run.health.fields.map((field) => field.scraperId)).toEqual(["body-text"]);
    expect(Object.values(run.sources.cells).map((cell) => cell.scraperId)).toEqual(["body-text"]);
  });
});

describe("source capture", () => {
  it("assigns increasing indexes across paginated HTML pages", async () => {
    const workflow = loadWorkflow(yaml);
    const run = await executeWorkflow(workflow, {
      http: mockHttp(),
      parseHtml,
    });
    expect(run.data.list_of_cars.cars).toEqual([
      { title: "Laptop" },
      { title: "Phone" },
      { title: "Tablet" },
    ]);
    expect(run.sources.cells["list_of_cars.cars[0].title"]).toMatchObject({
      value: "Laptop",
      stepId: "initial-page",
      scraperId: "car-detail",
      scrapeId: "cars",
      selector: "h3.card-title a",
      request: { method: "GET", url: "https://example.test/page-1" },
      response: { status: 200, url: "https://example.test/page-1" },
    });
    expect(run.sources.cells["list_of_cars.cars[0].title"]?.paginationNext).toBeUndefined();
    expect(run.sources.cells["list_of_cars.cars[1].title"]?.value).toBe("Phone");
    expect(run.sources.cells["list_of_cars.cars[2].title"]).toMatchObject({
      value: "Tablet",
      stepId: "remaining-pages",
      selector: "h3.card-title a",
      request: { method: "GET", url: "https://example.test/page-2" },
      paginationNext: 2,
    });
  });

  it("records no cells for an empty scrape list", async () => {
    const workflow = loadWorkflow(`
version: 1
name: warm
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
    const http: HttpClient = {
      async request() {
        return { status: 200, url: "https://shop.example.test/account", bodyText: "ok" };
      },
    };
    const run = await executeWorkflow(workflow, { http });
    expect(run.sources).toEqual({ cells: {} });
  });

  it("uses the landing URL after a redirect-like response", async () => {
    const workflow = loadWorkflow(`
version: 1
name: hop
scrapers:
  catalog:
    format: json
    fields:
      title:
        path: title
data:
  site:
    name: Site
    steps:
      - id: catalog
        request:
          method: GET
          url: https://shop.example.test/login
        scrape:
          - id: products
            selector: "$"
            using: catalog
`);
    const http: HttpClient = {
      async request() {
        return {
          status: 200,
          url: "https://shop.example.test/products.json",
          bodyText: JSON.stringify([{ title: "Shirt" }]),
        };
      },
    };
    const run = await executeWorkflow(workflow, { http });
    expect(run.sources.cells["site.products[0].title"]).toMatchObject({
      value: "Shirt",
      selector: "title",
      request: { method: "GET", url: "https://shop.example.test/login" },
      response: { status: 200, url: "https://shop.example.test/products.json" },
    });
  });
});

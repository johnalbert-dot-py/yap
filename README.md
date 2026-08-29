```
 ██╗   ██╗      █████╗          ██████╗
 ╚██╗ ██╔╝     ██╔══██╗         ██╔══██╗
  ╚████╔╝      ███████║         ██████╔╝
   ╚██╔╝       ██╔══██║         ██╔═══╝
    ██║ou      ██║  ██║utomate  ██║ages
    ╚═╝        ╚═╝  ╚═╝         ╚═╝
```

A local HTTP-first YAML runtime for fetching HTML or JSON, scraping named fields, paginating, and returning JSON.

![YAP](demo.gif)

YAP is one Node 22 ESM package named `yap`. You describe a web task in YAML. The engine fetches with `createFetchClient`. It scrapes named fields, paginates, and returns JSON. The CLI and the library share `executeWorkflow`. There is no browser.

> [!NOTE]
> YAP has no browser in this PoC. It uses HTTP plus Cheerio for HTML or JSON scraping.

## Requirements

- Node.js 22 or newer
- npm, pnpm, or bun, for install

## Install

YAP is not published to npm. Run it from this repository.

```bash
npm install
```

`pnpm install` and `bun install` work the same.

## First run

Run the checked-in HTML pagination workflow:

```bash
npm run yap -- run workflows/examples/web-scraping.dev/products.yaml
```

The workflow GETs `https://web-scraping.dev/products` and scrapes product cards. A second step paginates from page 2 for up to 5 requests. It stops early when a page returns no items.

On success you should see JSON on stdout and `Saved` paths on stderr for the JSON, health, and source files.

Other examples:

- `workflows/examples/webscraper.io/paginated-cars.yaml` uses HTML page pagination and timestamped output.
- `workflows/examples/pokeapi.co/pokemon-details.yaml` uses JSON scraping, `each`, and the YAML file input `inputs/pokemon.yaml`.
- `workflows/examples/web-scraping.dev/graphql-reviews.yaml` uses JSON scraping and cursor pagination for a GraphQL request.

```bash
npm run yap -- inspect workflows/examples/web-scraping.dev/products.yaml
```

`inspect` prints a summary of the workflow.

## Write a workflow

This excerpt follows `workflows/examples/web-scraping.dev/products.yaml`:

```yaml
version: 1.0
name: products
description: "Paginated products from https://web-scraping.dev/products"

scrapers:
  product:
    fields:
      title:
        selector: "h3 a"
      href:
        selector: "h3 a"
        getter:
          type: attribute
          value: "href"
      price:
        selector: ".price"

data:
  products:
    name: "Products"
    steps:
      - id: initial-page
        request:
          method: GET
          url: "https://web-scraping.dev/products"
        scrape:
          - id: products
            selector: "div.row.product"
            many: true
            using: product

      - id: remaining-pages
        pagination:
          next: page
          start: 2
          max: 5
          stop_when: [empty_items]
        request:
          method: GET
          url: "https://web-scraping.dev/products?page={{ pagination.next }}"
        scrape:
          - id: products
            selector: "div.row.product"
            many: true
            using: product
```

The checked-in file also sets `logging`.

## Use YAP as a library

```ts
import { createFetchClient, executeWorkflow, loadWorkflowFromFile, parseHtml } from "yap";

const workflow = loadWorkflowFromFile("workflows/examples/web-scraping.dev/products.yaml");
const { data, health, sources } = await executeWorkflow(workflow, {
  http: createFetchClient(),
  parseHtml,
});

console.log(JSON.stringify(data, null, 2));
console.log(health.status);
console.log(Object.keys(sources.cells).length);
```

`executeWorkflow(workflow, deps)` requires `deps.http`. JSON-only workflows can omit `parseHtml`. It returns `{ data, health, sources }`. `data` is the row map. `health` is field match counts and `healthy | degraded | failed`. `sources` is a map of cell paths to source hop, step, scraper, and selector. Rows stay plain values.

## CLI

The package CLI uses these forms:

```text
yap
yap run
yap run <file.yaml> [--input name=value]
yap inspect
yap inspect <file.yaml>
yap create
yap create <name>
yap explain <path>
yap health [file.yaml]
yap drift [file.yaml]
```

A file on the command line always prints JSON on stdout. Interactive run with a TTY and no file asks whether to view the result first. Spinner ticks and `Saved` lines go to stderr.

## Internals

Run path, schema, CLI codes, and the file map live in [`docs/architecture.md`](docs/architecture.md).

## What this is not

YAP is not Crawlee, Playwright Test, Browse AI, or n8n. There is no browser in this PoC. The runtime uses HTTP plus Cheerio for HTML or JSON scraping.

## Origin

YAP originated in [JScrapeON](https://github.com/johnalbert-dot-py/JScrapeON).

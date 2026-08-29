```
 ██╗   ██╗      █████╗          ██████╗
 ╚██╗ ██╔╝     ██╔══██╗         ██╔══██╗
  ╚████╔╝      ███████║         ██████╔╝
   ╚██╔╝       ██╔══██║         ██╔═══╝
    ██║ou      ██║  ██║utomate  ██║ages
    ╚═╝        ╚═╝  ╚═╝         ╚═╝
```

A local HTTP-first YAML runtime for fetching HTML or JSON, scraping named fields, paginating, and returning JSON.

![YAP](assets/demo.gif)

You write the task in YAML. The CLI and the library both call `executeWorkflow`.

> [!NOTE]
> HTTP only. Cheerio parses HTML. There is no browser.

## Why YAP?

- **HTTP-first.** Fetch HTML or JSON, scrape named fields, and paginate from YAML. Optional `timeout` on a request is a duration like `30s` or `30` (seconds if no unit). Default `30s`.
- **Declarative YAML.** Scrapers, steps, and fields live in one file.
- **`yap explain`.** Point at a cell and print the request, step, scraper, and selector that produced it.
- **Required-field health.** Set `required: true` on a field. After the run, see matched versus attempted, then `degraded` or `failed`.
- **`yap drift`.** Compare this run's health to the previous run when a selector starts missing.

## Requirements

- Node.js 22 or newer
- npm, pnpm, or bun for install

## Install

YAP is not published to npm. Run it from this repository.

```bash
npm install
```

## First run

```bash
npm run yap -- run workflows/examples/web-scraping.dev/products.yaml
```

The workflow GETs `https://web-scraping.dev/products`, scrapes product cards, then paginates from page 2 for up to 5 requests and stops when a page returns no items.

JSON prints on stdout. `Saved` paths for the JSON, health, and source files print on stderr.

Then trace a cell and read health:

```bash
npm run yap -- explain "products.products[0].price"
npm run yap -- health workflows/examples/web-scraping.dev/products.yaml
```

A dead root selector with `required: true` is `failed`, not healthy. `yap drift` compares this run's health file to the previous one.

Other examples:

- `workflows/examples/webscraper.io/paginated-cars.yaml` uses HTML page pagination and timestamped output.
- `workflows/examples/pokeapi.co/pokemon-details.yaml` uses JSON scraping, `each`, and the YAML file input `inputs/pokemon.yaml`.
- `workflows/examples/web-scraping.dev/graphql-reviews.yaml` uses JSON scraping and cursor pagination for a GraphQL request.

## Write a workflow

This excerpt follows `workflows/examples/web-scraping.dev/products.yaml` and sets `required: true` on `price`.

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
        required: true

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

## Trace where data came from

```bash
npm run yap -- explain "products.products[17].price"
```

This repo's CLI is `npm run yap --`.

```text
products.products[17].price

Value:
$19.99

Source:
GET https://web-scraping.dev/products?page=3

Step:
remaining-pages

Scraper:
product

Selector:
.price
```

Rows stay plain JSON. The sources sidecar lets you trace a cell to the request, step, scraper, and selector.

## Know when extraction breaks

![run, explain, dead selector, health and drift](assets/health.gif)

Mark a field `required: true`. After a run, `yap health` prints match counts:

```text
extraction  degraded
  product.title  342/342 matched
  product.price  14/342 matched  required
```

`degraded` means some required values missed. `failed` means a required field matched 0 times.

`yap drift` compares that report to the previous run:

```text
Possible extraction drift
  product.price
  previous  98.0%  (336/342)
  current   4.1%  (14/342)
```

## CLI

The package CLI uses these forms:

```text
yap                      interactive (TTY)
yap run                  pick a workflow (TTY)
yap run <file.yaml> [--input name=value]  JSON on stdout
yap inspect              pick a workflow (TTY)
yap inspect <file.yaml>  print a summary
yap create               write a stub (TTY)
yap create <name>        write workflows/<name>.yaml
yap explain <path>       print where a cell came from
yap health [file.yaml]   print extraction health
yap drift [file.yaml]    compare health to the previous run
```

HTTP logs follow `logging.level`. INFO records method, url, and redacted headers. It omits `body` and `params`. DEBUG may include `body` and `params` unredacted. Those values can contain secrets.

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

`executeWorkflow` requires `deps.http`. JSON-only workflows can omit `parseHtml`.

## Architecture

```text
YAML → validate → runtime → HTTP → extract → data
                                 ├─ sources
                                 └─ health → drift
```

[Architecture deep dive](docs/architecture.md)

## What this is not

YAP is not Crawlee, Playwright Test, Browse AI, or n8n.

## Origin

YAP originated in [JScrapeON](https://github.com/johnalbert-dot-py/JScrapeON).

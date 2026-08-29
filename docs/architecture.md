# YAP architecture

YAP is an HTTP-first YAML runtime. It loads and validates a workflow, resolves its inputs, sends HTTP requests, and turns HTML with Cheerio or JSON responses into row records. The same engine is available through the CLI and the library in one package. The [interactive core map](diagram/yap-core.html) shows the run path. Its [Archify specification](diagram/yap-core.architecture.json) is checked in beside it.

## Run path

Use the [interactive core map](diagram/yap-core.html) to see the runtime boundaries and the data flow.

1. `src/cli.ts` dispatches the command. `yap run <file.yaml>` parses `--input name=value` arguments with `parseInputArgs` and calls `runWorkflowFile`. `yap inspect <file.yaml>` calls `loadWorkflowFromFile` and prints `summarizeWorkflow`. `yap explain <path>` finds the newest source sidecar and prints that cell. `yap health` prints the newest health sidecar. `yap drift` compares it to the previous health snapshot.
2. `runWorkflowFile` in `src/cli/actions.ts` calls the synchronous `loadWorkflowFromFile`. It resolves declared inputs with `resolveInputs`. It supplies `createFetchClient` and `parseHtml` when the caller did not provide them. It then calls `executeWorkflow`.
3. `loadWorkflowFromFile` reads UTF-8 text and calls `loadWorkflow`. `loadWorkflow` parses YAML with `js-yaml`. Its private `parseWorkflow` function validates the parsed value with `workflowSchema`.
4. `executeWorkflow` checks that every declared input has a defined value. It creates a `Run` with empty stats and empty sources. It visits the workflow datasets in object-key order and calls `executeDataset` for each one.
5. `executeDataset` is an inner function in `execute.ts`. It opens a `DatasetRun` from the shared `Run`, then calls `executeStep` in the order declared by the dataset.
6. `executeStep` is an inner function. It emits a progress start event. It runs one pass without `each`, or one pass for every item named by `each`. Each pass can run one request or several page or cursor iterations.
7. Each iteration interpolates `step.request` with input values, earlier step rows, earlier step hops, and the current pagination value. The current step does not see its own hop. `asHttpRequest` validates the interpolated value against `requestSchema` again. Inner `executeOnce` sends the request, parses the response, and applies each scrape operation.
8. The runtime appends rows to the dataset buckets and to the step result map. It stores one `HttpHop` per step id. It emits a progress tick. Pagination either stops or supplies the next page number or cursor. The step then emits `done`, or emits `error` before rethrowing a failure.
9. `executeWorkflow` returns `{ data, health, sources }`. `data` is the row `WorkflowResult`. `health` is per-field attempted, matched, and missing counts plus `healthy | degraded | failed`. `sources` is a `Sources` map of cells keyed by `datasetId.scrapeId[row].field`. `yap run <file>` prints `data` JSON on stdout. Interactive run asks whether to view it. `runWorkflowFile` always writes that JSON under the cwd-relative `output/` tree, a `*.health.json` sidecar, and a `*.source.json` sidecar next to it. It writes an HTTP log under the matching `logs/` tree when the workflow configures logging. A required field that matched 0 times still writes those files. The CLI then prints `YAP_EXTRACTION_FAILED` and exits 1.

The library path starts at `loadWorkflow`, `loadWorkflowFromFile`, or an already validated `WorkflowSchema`. Library callers use the same `executeWorkflow` engine as the CLI.

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

`yap` with no arguments starts an interactive TTY loop. It lists YAML files under `workflows/`, then an action menu for the file you pick. After Run, Inspect, Health, or Explain, you stay on that file. Back returns to the list. Create and Other file sit on the workflow list, not on the per-file menu.

`yap run` and `yap inspect` pick a workflow, do that action once, then stay on that file's action menu. `yap create` writes a stub, then shows the workflow list. `yap inspect <file.yaml>` loads the file with `loadWorkflowFromFile` and prints `summarizeWorkflow`. `yap create <name>` writes `workflows/<name>.yaml` without entering the TTY loop.

`yap run <file.yaml>` prints JSON on stdout. `Saved <path>` and `Logged <path>` messages go to stderr. Extraction health also goes to stderr. A short table prints when stderr is a TTY, plus `YAP_EXTRACTION_FAILED` or `YAP_EXTRACTION_DEGRADED` when contracts fail or degrade. Interactive run asks `View result?` before printing JSON. A step or extraction failure in the TTY loop is logged. It does not exit the session.

`yap explain "<dataset>.<scrape>[row].<field>"` finds the newest `*.source.json` under `{cwd}/output/` by mtime and prints that cell. Missing run prints `YAP_EXPLAIN_NO_RUN` and exits 1. Missing path prints `YAP_EXPLAIN_NOT_FOUND` and exits 1.

`yap health` prints the newest `*.health.json` table. Pass a workflow file to scope it. Missing run prints `YAP_HEALTH_NO_RUN` and exits 1. A TTY Run already prints that table on stderr when stderr is a TTY, or when extraction is degraded or failed. The Health action in the TTY loop is the same report plus drift when a previous sidecar exists.

`yap drift` compares that health file to the previous run. Previous is `*.prev.health.json` after a non-timestamped overwrite, or the next-newest timestamped health file. Match rate falling from `>= 80%` to `<= 20%` is severe drift and exits 1. No previous run prints `YAP_DRIFT_NO_PREVIOUS` and exits 1.

Pass an input as `--input name=value`. Unknown flags fail with `WorkFlowValidationError`. Use `-h` or `--help` for usage. With no file and no TTY, YAP prints usage and exits 1.

`yap create <name>` writes `workflows/<name>.yaml`. The stub has empty `scrapers: {}` and `data: {}`. It is valid YAML, but it is not a runnable workflow until you fill those sections.

The CLI reports `YAP_WORKFLOW_INVALID` for `WorkFlowValidationError`. It reports `YAP_STEP_FAILED` for `StepExecutionError` and prints the step id, URL, and reason. Status is printed when the transport has one.

For repository development, `npm run yap` runs `src/cli.ts` through `tsx`. After `npm run build`, `node dist/cli.js` is the same CLI. The built package exposes the `yap` bin through `dist/cli.js`.

Checked-in examples live under `workflows/examples`, grouped by site hostname. `yap create` still writes new files to `workflows/`.

## Project structure

The current source tree is:

- `src/`
  - `cli.ts` dispatches non-interactive commands and maps runtime errors to CLI output.
  - `error.ts` defines the three runtime error classes.
  - `index.ts` is the package export barrel.
  - `interpolate.ts` resolves template paths and renders step output.
  - `cli/`
    - `actions.ts` loads workflows, resolves inputs, executes them, and writes the CLI result.
    - `artifacts.ts` finds newest health and source sidecars under `output/`.
    - `explain.ts` finds the newest source sidecar and formats a cell for `yap explain`.
    - `health.ts` formats extraction health for stderr and reads health or drift from disk.
    - `http-log.ts` writes HTTP log entries with pino.
    - `interactive.ts` runs the TTY session loop. Clack prompts stay here.
    - `progress.ts` adapts progress events to a Clack spinner.
    - `save.ts` writes workflow output, extraction health, sources, and resolves HTTP log paths.
    - `session.ts` reduces the interactive TTY state machine (`Session`).
  - `http/`
    - `client.ts` defines the HTTP types and the fetch-backed session client.
    - `cookies.ts` parses `Set-Cookie` and holds the per-client jar.
  - `input/`
    - `argv.ts` parses `--input name=value` arguments.
    - `resolve.ts` loads file inputs and coerces primitive inputs.
  - `runtime/`
    - `execute.ts` orchestrates requests, scraping, aggregation, pagination, and progress.
    - `pagination.ts` computes page and cursor transitions.
  - `scrape/`
    - `apply.ts` applies HTML scraper fields to selected nodes and records field hits when stats are passed.
    - `health.ts` aggregates field hit counts, reduces required-field contracts with `toHealth`, and compares two health snapshots.
    - `html.ts` adapts Cheerio to `HtmlDocument` and `HtmlNode`.
    - `json.ts` parses JSON, applies JSON scraper fields, and records field hits when stats are passed.
    - `source.ts` records, looks up, and formats per-cell sources.
  - `workflow/`
    - `load.ts` reads, parses, and validates workflow YAML.
    - `schema.ts` defines the Zod schemas.
    - `types.ts` derives TypeScript types from the schemas.

The error module is `src/error.ts`. There is no `src/errors.ts`.

## Import rules

These rules describe the imports in the current source. They are boundaries in the code, not a plugin system.

| Area                         | May import                                                                                                                                                               | Responsibility                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `src/index.ts`               | Public modules in `src/`                                                                                                                                                 | Re-export library functions, schemas, errors, and types.                                     |
| `src/cli.ts` and `src/cli/*` | `error.ts`, `input/*`, `workflow/load.ts`, `runtime/execute.ts`, `http/client.ts`, `scrape/html.ts`, `scrape/health.ts`, `scrape/source.ts`, and CLI or Node dependencies | Own command input, TTY prompts, stdout, stderr, output files, and log files.                 |
| `src/runtime/execute.ts`     | `error.ts`, HTTP and input types, `interpolate.ts`, `scrape/*`, `workflow/schema.ts`, `workflow/types.ts`, and `runtime/pagination.ts`                                   | Orchestrate the validated workflow without importing CLI code or a fetch implementation.     |
| `src/runtime/pagination.ts`  | `workflow/types.ts`                                                                                                                                                      | Compute pagination state transitions and stop conditions.                                    |
| `src/workflow/load.ts`       | `error.ts`, `workflow/schema.ts`, `workflow/types.ts`, `js-yaml`, and Node file APIs                                                                                     | Convert YAML text or a file into a validated `WorkflowSchema`.                               |
| `src/workflow/schema.ts`     | Zod                                                                                                                                                                      | Define the external workflow contract and cross-field validation.                            |
| `src/workflow/types.ts`      | `workflow/schema.ts` and Zod                                                                                                                                             | Derive TypeScript names from the schemas.                                                    |
| `src/input/*`                | `error.ts` and workflow types                                                                                                                                            | Parse CLI values and resolve declared input data.                                            |
| `src/http/client.ts`         | `error.ts`, `http/cookies.ts`                                                                                                                                            | Implement the default fetch transport, cookie jar, redirect following, and 5xx error policy. |
| `src/http/cookies.ts`        | None                                                                                                                                                                     | Parse `Set-Cookie` and select `Cookie` for a URL.                                            |
| `src/scrape/apply.ts`        | `scrape/html.ts`, `scrape/health.ts`, and workflow types                                                                                                                 | Apply HTML scraping operations and record field hits.                                        |
| `src/scrape/health.ts`       | None                                                                                                                                                                     | Count extracted field hits, reduce required-field contracts, and compare two runs.           |
| `src/scrape/source.ts`       | None                                                                                                                                                                     | Record, look up, and format per-cell sources.                                                |
| `src/scrape/html.ts`         | Cheerio                                                                                                                                                                  | Adapt Cheerio without exposing it to the runtime.                                            |
| `src/scrape/json.ts`         | `interpolate.ts`, `scrape/health.ts`, and workflow types                                                                                                                 | Parse JSON, resolve JSON paths, and record field hits.                                       |
| `src/interpolate.ts`         | No local modules                                                                                                                                                         | Walk template values without knowing about HTTP or scraping.                                 |

`src/runtime/execute.ts` does import `src/workflow/schema.ts`. It uses `requestSchema` to validate the request after interpolation. It does not import `fetch`, Cheerio, or the CLI.

## Domain

`src/workflow/schema.ts` is the source of truth for workflow data. `src/workflow/types.ts` derives the named TypeScript types with `z.infer`. `WorkflowResult` is the one custom result type.

```ts
export type DataSet = z.infer<typeof dataSetSchema>;
export type PrimitiveInputType = z.infer<typeof primitiveInputTypeSchema>;
export type RecordFieldType = z.infer<typeof recordFieldTypeSchema>;
export type InputDeclaration = z.infer<typeof inputDeclarationSchema>;
export type WorkflowInput = z.infer<typeof workflowInputSchema>;
export type Logging = z.infer<typeof loggingSchema>;
export type LoggingLevel = z.infer<typeof loggingLevelSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type Scrape = z.infer<typeof scrapeSchema>;
export type Scraper = z.infer<typeof scraperSchema>;
export type HtmlScraper = Extract<Scraper, { format: "html" }>;
export type JsonScraper = Extract<Scraper, { format: "json" }>;
export type Request = z.infer<typeof requestSchema>;
export type Step = z.infer<typeof stepSchema>;
export type WorkflowOutput = z.infer<typeof workflowOutputSchema>;
export type WorkflowSchema = z.infer<typeof workflowSchema>;

export type WorkflowResult = {
  [datasetId: string]: {
    [scrapeId: string]: Record<string, unknown>[];
  };
};
```

### Workflow and data

A workflow has required `version`, `name`, `scrapers`, and `data`. It can also have an optional `description`, `input`, `output`, and `logging`. `version` is a number or string. `input` defaults to `{}`.

Each dataset has a `name` and at least one step. Each step has an `id`, a request, a scrape list that defaults to `[]`, optional pagination, optional `each`, and optional `output`. An empty scrape list still sends the request. That is how a step loads cookies for later steps on the same `HttpClient`. Pagination is rejected when the scrape list is empty.

### Inputs

`workflow.input` uses interpolation-safe ids that start with a letter or underscore and then contain word characters or hyphens. A primitive declaration can be a type string or an object with `type` and an optional `prompt`. Primitive types are `string`, `number`, `boolean`, `string[]`, and `number[]`.

A file declaration has `file`, optional `key`, and a `fields` map. Field types are `string`, `number`, and `boolean`. `resolveInputs` reads file inputs first. It accepts a YAML array or a mapping whose selected key defaults to the input id. It then validates and coerces every declared field.

Primitive values come from `--input` values or from the prompt callback. Array values use comma-separated strings. A missing required value raises `WorkFlowValidationError`.

Use `each: input.<id>` to iterate a list input.

### Scrapers and scrape operations

A scraper is HTML or JSON. If its `format` is omitted, schema preprocessing treats it as HTML.

An HTML scraper has named fields. A field can select nested nodes, choose a one-based `index`, and read text or an attribute. An omitted field selector reads the selected scrape root. Missing nodes and missing attributes become `null`. A field may set `required: true`. Omitted `required` is treated as false. Extraction health treats `null` and `""` as missing. One missing required value does not stop scraping. After the run, a required field with `attempted > 0` and `matched === 0` is `failed`. A required field with some matches and some misses is `degraded`. A required field that was never attempted, including an unused scraper or a selector that returned no roots, is ignored.

A JSON scraper has named fields with an optional dotted `path` and a one-based `index`. The path can start with `$` or `$.`. A missing path or index becomes `null`. The JSON parser uses the response body as the root when a field path is omitted. JSON fields use the same `required` flag and missing rules.

Each scrape operation has an `id`, a `selector`, a `many` flag that defaults to `true`, and a `using` scraper name. HTML selectors use CSS selectors. JSON selectors use paths. HTML `many: false` keeps the first matching node. JSON `many: false` keeps the first array item. A JSON scalar is one item. A step with `scrape: []`, or with `scrape` omitted, performs the HTTP request and stores no rows. Put that step first when the site sets a session cookie before the catalog request.

Load rejects scrape ids and step ids named `input`, `pagination`, `request`, or `response`. Those names are reserved for interpolation context. `firstRows` still skips a scrape id of `pagination`.

### Requests

Each request has a non-empty `url`, a method of `GET`, `POST`, `PUT`, or `DELETE`, optional string headers, an optional unknown body, and optional string-keyed parameters with unknown values. Interpolation walks all of these request fields.

### Pagination

Page pagination has `next: "page"`, a numeric `start` that defaults to `1`, an integer `max` of at least `1`, and `stop_when` containing `empty_items`.

Cursor pagination has `next: "cursor"`, a `from` path in the form `scrapeId.field`, a cursor `start` that defaults to `null`, an integer `max` of at least `1`, and the same stop condition. Load-time validation checks that the referenced scrape id exists in the same step.

### Interpolation

Use these templates in `step.request` and in `step.output`.

- `{{ input.x }}` reads a resolved input.
- `{{ pagination.next }}` reads the current page or cursor.
- Earlier scrape rows use `{{ scrapeId.field }}` or `{{ stepId.scrapeId.field }}`.
- After a prior step finishes, use `{{ response.url }}`, `{{ response.status }}`, `{{ request.url }}`, or `{{ stepId.response.url }}`.

`createFetchClient` follows redirects. `response.url` is the landing URL. `response.status` is the final status, usually 200 after a 302. A custom client that returns 302 can still expose `{{ response.headers.location }}`.

Do not name a scrape id or a step id `input`, `pagination`, `request`, or `response`. Load rejects those ids.

`step.output` is the spinner label on each tick. Write `Landed {{ response.url }} ({{ response.status }})` when you want the landing URL in the spinner. It is not the JSON file under `output/`. That file contains scrape rows only.

### Logging and output

Every CLI file run writes JSON under `output/`, a health sidecar, and a source sidecar next to them. The path mirrors the workflow path below `workflows/` and drops the `.yaml` or `.yml` suffix. For example, `workflows/examples/web-scraping.dev/products.yaml` writes `output/examples/web-scraping.dev/products.json`, `output/examples/web-scraping.dev/products.health.json`, and `output/examples/web-scraping.dev/products.source.json`. A workflow outside `workflows/` uses its basename. Stdout is still the row JSON only. A required field that matched 0 times still writes those files, then exits 1.

Root `output` only configures the optional `use-timestamps` boolean, which defaults to `false`:

```yaml
output:
  use-timestamps: true
```

When enabled, YAP appends local `YYYY-MM-DD-HH-mm-ss` to the file stem. JSON, health, source, and HTTP logs from the same run share that stem.

Set `logging.level` to `INFO` or `DEBUG` to write HTTP logs under the matching `logs/` tree. `step.output` is a spinner label template. It is not a dump of every row.

The schema lives in [`src/workflow/schema.ts`](../src/workflow/schema.ts). `executeWorkflow` does not write files.

The result has one entry per dataset. Each entry maps scrape ids to arrays of records. It does not include page indexes, `each` indexes, cell sources, HTTP hops, or extraction health. Health and sources are sibling objects on `WorkflowRun` and sidecar files on disk. Cell paths use `datasetId.scrapeId[row].field` with `row` 0-based in the concatenated bucket. `yap explain` walks `{cwd}/output/**/*.source.json` and uses the newest mtime. There is no `last` subcommand and no `output/last` pointer file. `writeHealth` copies an existing health file to `*.prev.health.json` before overwrite. `yap drift` uses that previous file, or the next-newest timestamped health file. A required field whose match rate falls from `>= 80%` to `<= 20%` is severe drift.

## Seams

`executeWorkflow` receives the runtime dependencies through `Deps`.

```ts
export type Deps = {
  http: HttpClient;
  parseHtml?: (html: string) => HtmlDocument;
  inputs?: ResolvedInputs;
  parseJson?: (text: string) => unknown;
  onProgress?: (event: StepProgress) => void;
  onLog?: (entry: StepHttpLog) => void;
  now?: () => Date;
  createId?: () => string;
};
```

`http` is required. `parseHtml` is optional because JSON-only workflows do not need it. `parseJson` is optional and defaults to `parseJson` from `src/scrape/json.ts`. `inputs` defaults to an empty record before required workflow inputs are checked. `now` defaults to a new `Date`. `createId` defaults to `crypto.randomUUID()`.

Progress events include an error state.

```ts
export type StepProgress = {
  stepId: string;
  status: "start" | "tick" | "done" | "error";
  percent: number;
  label: string;
};
```

The log callback receives the interpolated request. INFO entries contain no response. DEBUG entries contain the response status, URL, and text body.

```ts
export type StepHttpLog = {
  id: string;
  ts: string;
  level: LoggingLevel;
  stepId: string;
  request: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
    params?: Record<string, unknown>;
  };
  response?: {
    status: number;
    url: string;
    bodyText: string;
  };
};
```

The HTTP boundary is small.

```ts
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type HttpRequest = {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, unknown>;
};

export type HttpResponse = {
  status: number;
  url: string;
  bodyText: string;
  headers?: Record<string, string>;
};

export interface HttpClient {
  request(req: HttpRequest): Promise<HttpResponse>;
}
```

`createFetchClient` keeps a cookie jar for that client instance. It stores `Set-Cookie` from each response, including 5xx and 3xx hops. Later requests to a matching URL send those cookies. Node `fetch` does not do this, so the client follows redirects with `redirect: "manual"` and applies the jar on each hop. A 301, 302, or 303 that is not GET becomes GET without a body, matching the Fetch spec. YAML `headers.Cookie` is appended after jar cookies. A new `createFetchClient()` starts an empty jar. The CLI creates one client per `runWorkflowFile` call. There is no YAML switch to turn the jar off. Pass a custom `HttpClient` when you want to wrap `fetch`.

`createFetchClient` adds defined `params` to the URL. It sends string bodies as written. It JSON-encodes other body values and adds `Content-Type: application/json` when the caller did not provide a content type. It suppresses the body for `GET`. It returns 4xx responses. A response with status 500 or higher raises `HttpTransportError`.

`HttpTransportError` belongs to the fetch client. It has `url` and `status`. `StepExecutionError` belongs to request execution. It has `stepId`, `url`, and an optional `status`. The runtime wraps transport failures and scraping or request failures in this class. `WorkFlowValidationError` belongs to workflow and input validation. It has the validation message without transport fields.

## Methods

The following table lists runtime and boundary methods with their source signatures. `HtmlFields`, `Buckets`, `HttpHop`, `OnceResult`, `Page`, `Run`, `DatasetRun`, and `ScrapeItems` are internal aliases. `executeOnce`, `executeStep`, and `executeDataset` are inner functions in `execute.ts`. They are not public API.

| Module                      | Signature                                                                                                                                                                                                                                              | Role                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `src/workflow/load.ts`      | `loadWorkflow(yaml: string): WorkflowSchema`                                                                                                                                                                                                           | Parse and validate YAML text synchronously.                           |
| `src/workflow/load.ts`      | `loadWorkflowFromFile(path: string): WorkflowSchema`                                                                                                                                                                                                   | Read and load a workflow file synchronously.                          |
| `src/workflow/load.ts`      | `parseWorkflow(raw: unknown): WorkflowSchema`                                                                                                                                                                                                          | Private validation helper.                                            |
| `src/input/argv.ts`         | `parseInputArgs(args: string[]): Record<string, string>`                                                                                                                                                                                               | Parse non-interactive input assignments.                              |
| `src/input/resolve.ts`      | `resolveInputs({ decls, workflowPath, cliValues, readFile, prompt }: ResolveInputsOptions): Promise<ResolvedInputs>`                                                                                                                                   | Resolve file, CLI, and prompted inputs.                               |
| `src/interpolate.ts`        | `interpolate(value: unknown, ctx: InterpContext): unknown`                                                                                                                                                                                             | Recursively interpolate a value.                                      |
| `src/interpolate.ts`        | `renderStepOutput(template: string, items: Record<string, Record<string, unknown>[]>, ctx: InterpContext): string[]`                                                                                                                                   | Render at most one output line.                                       |
| `src/http/client.ts`        | `createFetchClient(): HttpClient`                                                                                                                                                                                                                      | Create the default fetch transport.                                   |
| `src/scrape/html.ts`        | `parseHtml(html: string): HtmlDocument`                                                                                                                                                                                                                | Adapt HTML through Cheerio.                                           |
| `src/scrape/apply.ts`       | `applyScraper(root: HtmlNode, scraper: HtmlFields): Record<string, unknown>`                                                                                                                                                                           | Apply fields to one HTML root.                                        |
| `src/scrape/apply.ts`       | `scrapeOp(doc: HtmlDocument, op: Scrape, scraper: HtmlFields, stats?: Stats): Record<string, unknown>[]`                                                                                                                                               | Select HTML roots, apply a scraper, and record field hits.            |
| `src/scrape/health.ts`      | `toHealth(stats: Stats): Health`                                                                                                                                                                                                                       | Reduce field hits to `healthy`, `degraded`, or `failed`.              |
| `src/scrape/health.ts`      | `compareHealth(previous: Health, current: Health): DriftReport`                                                                                                                                                                                        | Flag severe match-rate drops between two runs.                        |
| `src/scrape/source.ts`      | `emptySources(): Sources`                                                                                                                                                                                                                              | Create an empty cell map.                                             |
| `src/scrape/source.ts`      | `recordScrapeRows(args): void`                                                                                                                                                                                                                         | Record one cell per field into a `Sources` map.                       |
| `src/scrape/source.ts`      | `lookupCell(index: Sources, path: string): CellSource \| undefined`                                                                                                                                                                                    | Look up a cell by canonical path.                                     |
| `src/scrape/source.ts`      | `formatCell(cell: CellSource): string`                                                                                                                                                                                                                 | Format the locked `yap explain` text.                                 |
| `src/scrape/json.ts`        | `parseJson(text: string): unknown`                                                                                                                                                                                                                     | Parse a JSON response body.                                           |
| `src/scrape/json.ts`        | `scrapeJsonOp(doc: unknown, op: Scrape, scraper: JsonScraper, stats?: Stats): Record<string, unknown>[]`                                                                                                                                                | Select JSON items, apply a scraper, and record field hits.            |
| `src/runtime/pagination.ts` | `initialNext(pagination: Pagination): unknown`                                                                                                                                                                                                         | Select the initial page or cursor.                                    |
| `src/runtime/pagination.ts` | `advancePagination(args: { pagination: Pagination; current: unknown; items: ScrapeItems }): { next: unknown; stop: boolean }`                                                                                                                          | Read the next page or cursor and decide whether to stop.              |
| `src/runtime/pagination.ts` | `shouldStop(args: { iteration: number; max: number; emptyItems: boolean; stopWhen: Pagination["stop_when"] }): boolean`                                                                                                                                | Apply the maximum and empty-item stop rules.                          |
| `src/runtime/execute.ts`    | inner `executeOnce(workflow, step, req, deps, session: DatasetRun, capture: Page): Promise<OnceResult>`                                                                                                                                                | Send one request, scrape one response, and record sources.            |
| `src/runtime/execute.ts`    | inner `executeStep(workflow, step, deps, session: DatasetRun): Promise<void>`                                                                                                                                                                          | Run one step, including `each` and pagination.                        |
| `src/runtime/execute.ts`    | inner `executeDataset(workflow, datasetId, deps, run: Run): Promise<Record<string, Record<string, unknown>[]>>`                                                                                                                                        | Run one dataset into row buckets.                                     |
| `src/runtime/execute.ts`    | `executeWorkflow(workflow: WorkflowSchema, deps: Deps): Promise<WorkflowRun>`                                                                                                                                                                          | Validate inputs, run every dataset, and return health and sources.    |
| `src/cli/actions.ts`        | `runWorkflowFile(file: string, options: RunOptions = {}): Promise<RunOutcome>`                                                                                                                                                                         | Run a workflow file through the CLI boundary.                         |
| `src/cli/actions.ts`        | `summarizeWorkflow(workflow: WorkflowSchema): string`                                                                                                                                                                                                  | Format the `yap inspect` summary.                                     |
| `src/cli/save.ts`           | `writeWorkflowOutput({ workflowFile, result, useTimestamps, now, cwd }): string`                                                                                                                                                                       | Write a CLI JSON result under the path-mirrored `output/` tree.       |
| `src/cli/save.ts`           | `writeHealth({ workflowFile, health, useTimestamps, now, cwd }): string`                                                                                                                                                                               | Write the health sidecar next to that JSON result.                    |
| `src/cli/save.ts`           | `writeSources({ workflowFile, sources, useTimestamps, now, cwd }): string`                                                                                                                                                                             | Write the source sidecar next to that JSON result.                    |
| `src/cli/session.ts`        | `reduceSession(session: Session, event: SessionEvent): Session`                                                                                                                                                                                        | Reduce the interactive workflow-first TTY session.                    |
| `src/cli/explain.ts`        | `newestSourceFile(cwd: string, workflowFile?: string): string \| undefined`                                                                                                                                                                            | Pick the newest `*.source.json` under `{cwd}/output/` by mtime.       |
| `src/cli/explain.ts`        | `explainCell(path: string, cwd?: string, workflowFile?: string): string`                                                                                                                                                                               | Look up and format a cell from that file.                             |

`parseWorkflow` appears in the table to identify the private helper. It is not a public package method. `inspect` uses `loadWorkflowFromFile`. There is no `inspectWorkflowFile`. Page pagination increments inside `advancePagination`. There is no `advanceNext`.

## Execute loop

`executeWorkflow` first checks every id in `workflow.input`. The value must exist in `deps.inputs` and must not be `undefined`. It then creates a `Run` with an empty `Stats` map and `emptySources()`. It calls inner `executeDataset` for each dataset. After every dataset finishes, it calls `toHealth` and returns `{ data, health, sources }`.

`executeDataset` opens a `DatasetRun` from that `Run`. The `DatasetRun` owns a `buckets` map for the final rows, a `stepResults` map for scrape interpolation, and an `httpByStep` map for one HTTP hop per step id. Hops stay out of `buckets`. It calls inner `executeStep` in declaration order.

`executeStep` emits `start` with `percent: 0`. Without `each`, it runs one `executeStepPass`. With `each`, it finds the named input and requires its resolved value to be an array. It shallow-copies the input map for each item and replaces the named input with that item. The same pass handles every item, so rows append across the full `each` run. Schema validation restricts primitive `each` inputs to `string[]` and `number[]`. File inputs still need to resolve to an array at runtime.

Each pass sets `next` with `initialNext` when pagination exists. It sets `max` to the pagination maximum or `1`. For every iteration it interpolates `step.request` with the current context. That context includes prior steps' hops as `byStep[stepId].request` and `byStep[stepId].response`. Top-level `request` and `response` are the last completed hop. The step that is about to request does not see its own hop. `asHttpRequest` then runs `requestSchema.safeParse` on that interpolated value. This second validation catches invalid method, URL, headers, body, or params values created by interpolation.

Inner `executeOnce` calls `deps.http.request`. It emits the HTTP log after the request succeeds. It also emits a log before wrapping a transport error. It returns scraped items and an `HttpHop` with the request method and URL plus the response status, URL, and headers. The hop has no body and no cookie jar. HTML scraping parses the body once with `deps.parseHtml`. JSON scraping parses it once with `deps.parseJson` or the default `parseJson`. Each scrape operation selects rows, stores them under its operation id, and records field hits on the shared stats map.

`emptyItems` starts as `true`. It becomes `false` when any scrape operation returns at least one row. It is `true` when every scrape operation returned `[]`, including when the scrape list is empty. This value feeds the `empty_items` stop condition. Pagination cannot be set on a step with an empty scrape list, so that vacuous `true` does not page a cookie-warm request.

After each scrape operation produces rows, `executeOnce` records one source cell per field. The row index is the current concatenated bucket length plus the offset in that response. HTML locators use the field selector or the scrape op selector, with ` -> ${index}` when `index` is set. JSON locators use the field path or the scrape op selector, with the same index suffix. `value` is the extracted field. `paginationNext` is stored only when the step has pagination. An empty scrape list records no cells. Unused scrapers record no cells. Row objects stay plain values.

The runtime appends each iteration's rows to both `buckets` and `stepResults`. It writes `httpByStep[step.id]` with that iteration's hop. A non-paginated step emits a tick at `100`. A paginated step emits `min(99, round(iteration / max * 100))`. The tick label is the rendered `step.output` line for that iteration, or the step id when no output template exists. `progressLabel` interpolates `step.output` with `{ input, pagination: { next }, request, response }` plus the existing scrape-join behavior. `step.output` is the spinner label. It is not the JSON under `output/`.

Page pagination starts at `pagination.start`. `advancePagination` returns `current + 1` for `next: "page"`. Cursor pagination starts at its configured value. It reads the first row of the scrape named by `pagination.from` and takes the requested field. It stops when that value is `null`, `undefined`, an empty string, or equal to the current cursor. `shouldStop` also stops at `max`, or when `empty_items` is configured and `emptyItems` is true.

After successful work, `executeStep` emits `done` with `percent: 100`. On any failure, it emits `error` with `percent: 0` and rethrows the original error. The step result map supplies prior first rows to later request interpolation. `httpByStep` supplies prior hops.

## Errors

`WorkFlowValidationError` reports invalid YAML, invalid workflow data, missing declared inputs, or an unknown dataset. `loadWorkflow` and `loadWorkflowFromFile` use it for parse and schema failures. `resolveInputs` uses it for invalid input files, missing values, and coercion failures.

`HttpTransportError` is the default fetch client's 5xx error. It records the final URL and status. The client does not throw it for 4xx responses.

`StepExecutionError` reports a failure tied to a step. It records the step id and URL and may record a status. The runtime uses it for invalid requests after interpolation, missing HTML parsing, invalid JSON, unknown scrapers, and wrapped HTTP failures.

The non-interactive CLI maps `WorkFlowValidationError` to `YAP_WORKFLOW_INVALID`. It maps `StepExecutionError` to `YAP_STEP_FAILED` and prints the step id, URL, status when present, and reason. Extraction contract failure is not one of those classes. The run still writes JSON, the health sidecar, and the source sidecar, prints `YAP_EXTRACTION_FAILED`, and exits 1. Degraded extraction prints `YAP_EXTRACTION_DEGRADED` and exits 0. Interactive step and extraction failures log and stay on the action menu. `yap explain` prints `YAP_EXPLAIN_NO_RUN` or `YAP_EXPLAIN_NOT_FOUND` and exits 1. `yap health` prints `YAP_HEALTH_NO_RUN` when no sidecar exists. `yap drift` prints `YAP_DRIFT_NO_PREVIOUS` when there is only one snapshot, and exits 1 on severe drift. Other errors use their message without either marker.

## Public API

`src/index.ts` is the public barrel. It exports:

- Execution and loading functions. `executeWorkflow`, `loadWorkflow`, and `loadWorkflowFromFile`.
- Error classes. `HttpTransportError`, `StepExecutionError`, and `WorkFlowValidationError`.
- HTTP functions and types. `createFetchClient`, `HttpClient`, `HttpRequest`, and `HttpResponse`.
- Parsing and interpolation functions. `parseHtml`, `parseJson`, `interpolate`, and `renderStepOutput`, plus `HtmlDocument` and `HtmlNode`.
- Extraction health. `toHealth`, `compareHealth`, `isMissingExtractedValue`, `processExitCode`, `Health`, `ExtractionStatus`, `FieldStats`, `DriftReport`, and `FieldDrift`.
- Sources. `emptySources`, `cellPath`, `cellSelector`, `parseCellPath`, `recordScrapeRows`, `lookupCell`, `formatCell`, `Sources`, `CellSource`, and `CellPathParts`.
- Input functions and types. `resolveInputs`, `InputPrompt`, `ReadInputFile`, `ResolvedInputs`, and `ResolveInputsOptions`.
- Schemas. `dataSetSchema`, `inputDeclarationSchema`, `loggingLevelSchema`, `loggingSchema`, `paginationSchema`, `requestSchema`, `primitiveInputTypeSchema`, `recordFieldTypeSchema`, `jsonFieldSchema`, `scrapeSchema`, `scraperSchema`, `stepSchema`, `workflowInputSchema`, `workflowOutputSchema`, and `workflowSchema`.
- Domain types. `DataSet`, `InputDeclaration`, `Logging`, `LoggingLevel`, `Pagination`, `PrimitiveInputType`, `RecordFieldType`, `Request`, `Scrape`, `HtmlScraper`, `JsonScraper`, `Scraper`, `Step`, `WorkflowOutput`, `WorkflowInput`, `WorkflowResult`, and `WorkflowSchema`.
- Runtime callback types. `Deps`, `StepHttpLog`, `StepProgress`, and `WorkflowRun`.

`parseWorkflow` is a private function in `src/workflow/load.ts`. It is not exported from the package. Call `loadWorkflow` with YAML text or `loadWorkflowFromFile` with a path. Inner `executeDataset` and `executeOnce` are not exported.

`package.json` maps the package import and the `yap` binary to `dist`. The library and CLI therefore use the same built engine. The package exposes only the root import and `./package.json`.

## Open, missing, unconsidered

- Named workspace plugins are not built. A future loader belongs at the CLI or configuration boundary. It can map YAML plugin names to npm packages and compose a `Deps` object. `execute.ts` remains a consumer of `Deps`. It does not become a registry.
- Flat interpolation aliases use last-writer-wins behavior when steps reuse a scrape id. Top-level `request` and `response` use the same last-writer-wins rule across completed hops. The per-step map remains available. The flat alias is overwritten as later steps finish. After an `each` run, later steps see the first row of the accumulated scrape bucket.
- `WorkflowResult` does not record page indexes or `each` indexes. It has no cell sources. It does not contain HTTP hops or extraction health. Health lives on `WorkflowRun.health` and in `*.health.json`. Sources live on `WorkflowRun.sources` and in `*.source.json`, keyed by `datasetId.scrapeId[row].field`.
- `onLog` runs only when `workflow.logging` is configured and an `onLog` callback exists. The log contains the interpolated request. It does not include cookies the fetch client adds from the jar, or headers that a wrapping `HttpClient` adds later.
- Playwright and a browser client are later work. The default `createFetchClient` is a per-instance cookie session over `fetch`. That unblocks HTTP cookie carts. It does not fill a Shopify checkout page.
- `src/workflow/types.ts` uses `z.infer` from `src/workflow/schema.ts`. The schema remains the source of truth.
- `dist` must be built before publishing. `package.json` runs `tsc` in `prepack`.
- Load rejects duplicate scrape ids within a step. Load also rejects scrape ids and step ids named `input`, `pagination`, `request`, or `response`. HTML `many` is honored. `pagination.max` rejects fractional values because the schema requires an integer. An empty scrape list is valid. Pagination on that step is not.

## Not architecture

These are not current YAP architecture:

- Effect.
- A monorepo.
- A plugin registry inside `execute.ts`.
- A request queue.
- A `primitives` package.

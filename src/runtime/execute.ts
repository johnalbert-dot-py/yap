import { HttpTransportError, StepExecutionError, WorkFlowValidationError } from "../error.js";
import type { HttpClient, HttpRequest } from "../http/client.js";
import type { ResolvedInputs } from "../input/resolve.js";
import { interpolate, renderStepOutput } from "../interpolate.js";
import { scrapeOp } from "../scrape/apply.js";
import { emptyStats, toHealth, type Health, type Stats } from "../scrape/health.js";
import { emptySources, recordScrapeRows, type Sources } from "../scrape/source.js";
import type { HtmlDocument } from "../scrape/html.js";
import { isJsonScraper, parseJson, scrapeJsonOp } from "../scrape/json.js";
import { requestSchema } from "../workflow/schema.js";
import type { LoggingLevel, Step, WorkflowResult, WorkflowSchema } from "../workflow/types.js";
import { advancePagination, initialNext, shouldStop } from "./pagination.js";

export type StepProgress = {
  stepId: string;
  status: "start" | "tick" | "done" | "error";
  percent: number;
  label: string;
};

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

export type WorkflowRun = {
  data: WorkflowResult;
  health: Health;
  sources: Sources;
};

type Buckets = Record<string, Record<string, unknown>[]>;

type HttpHop = {
  request: { method: string; url: string };
  response: {
    status: number;
    url: string;
    headers: Record<string, string>;
  };
};

type Run = {
  stats: Stats;
  sources: Sources;
};

type DatasetRun = Run & {
  datasetId: string;
  buckets: Buckets;
  stepResults: Record<string, Buckets>;
  httpByStep: Record<string, HttpHop>;
};

type Page = {
  includePagination: boolean;
  paginationNext?: unknown;
};

const openDataset = (run: Run, datasetId: string): DatasetRun => ({
  stats: run.stats,
  sources: run.sources,
  datasetId,
  buckets: {},
  stepResults: {},
  httpByStep: {},
});

type OnceResult = {
  items: Record<string, Record<string, unknown>[]>;
  emptyItems: boolean;
  hop: HttpHop;
};

const formatZodError = (error: { issues: { path: PropertyKey[]; message: string }[] }) =>
  error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("\n");

const requestUrl = (value: unknown): string => {
  if (
    typeof value === "object" &&
    value !== null &&
    "url" in value &&
    typeof value.url === "string"
  ) {
    return value.url;
  }
  return "";
};

const asHttpRequest = (value: unknown, stepId: string): HttpRequest => {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) {
    throw new StepExecutionError({
      message: `Invalid request after interpolation:\n${formatZodError(parsed.error)}`,
      stepId,
      url: requestUrl(value),
    });
  }
  return parsed.data;
};

const transportStatus = (cause: unknown): number | undefined => {
  if (cause instanceof HttpTransportError || cause instanceof StepExecutionError) {
    return cause.status;
  }
  return undefined;
};

const transportUrl = (cause: unknown, fallback: string): string => {
  if (cause instanceof HttpTransportError) {
    return cause.url;
  }
  if (cause instanceof StepExecutionError && cause.url) {
    return cause.url;
  }
  return fallback;
};

const SENSITIVE_LOG_HEADERS = /^(authorization|cookie|proxy-authorization)$/i;

const redactHeaders = (headers: Record<string, string>): Record<string, string> => {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    next[key] = SENSITIVE_LOG_HEADERS.test(key) ? "[redacted]" : value;
  }
  return next;
};

const requestLog = (req: HttpRequest): StepHttpLog["request"] => ({
  method: req.method,
  url: req.url,
  ...(req.headers !== undefined ? { headers: redactHeaders(req.headers) } : {}),
  ...(req.body !== undefined ? { body: req.body } : {}),
  ...(req.params !== undefined ? { params: req.params } : {}),
});

const emitHttpLog = (
  workflow: WorkflowSchema,
  deps: Deps,
  stepId: string,
  req: HttpRequest,
  response?: StepHttpLog["response"],
): void => {
  const level = workflow.logging?.level;
  if (!level || !deps.onLog) {
    return;
  }
  const entry: StepHttpLog = {
    id: deps.createId?.() ?? crypto.randomUUID(),
    ts: (deps.now?.() ?? new Date()).toISOString(),
    level,
    stepId,
    request: requestLog(req),
  };
  if (level === "DEBUG" && response) {
    entry.response = response;
  }
  deps.onLog(entry);
};

const executeOnce = async (
  workflow: WorkflowSchema,
  step: Step,
  req: HttpRequest,
  deps: Deps,
  session: DatasetRun,
  capture: Page,
): Promise<OnceResult> => {
  let response;
  try {
    response = await deps.http.request(req);
  } catch (cause) {
    const status = transportStatus(cause);
    const url = transportUrl(cause, req.url);
    emitHttpLog(
      workflow,
      deps,
      step.id,
      req,
      status !== undefined ? { status, url, bodyText: "" } : undefined,
    );
    throw new StepExecutionError({
      message: cause instanceof Error ? cause.message : String(cause),
      stepId: step.id,
      url,
      status,
    });
  }

  emitHttpLog(workflow, deps, step.id, req, {
    status: response.status,
    url: response.url,
    bodyText: response.bodyText,
  });

  let htmlDoc: HtmlDocument | undefined;
  let jsonDoc: { ok: true; value: unknown } | { ok: false; error: unknown } | undefined;
  const items: Record<string, Record<string, unknown>[]> = {};
  let emptyItems = true;

  const html = (): HtmlDocument => {
    if (htmlDoc) {
      return htmlDoc;
    }
    if (!deps.parseHtml) {
      throw new StepExecutionError({
        message: `Step "${step.id}" needs parseHtml for HTML scraping`,
        stepId: step.id,
        url: req.url,
        status: response.status,
      });
    }
    try {
      htmlDoc = deps.parseHtml(response.bodyText);
    } catch (error) {
      throw new StepExecutionError({
        message: error instanceof Error ? error.message : String(error),
        stepId: step.id,
        url: req.url,
        status: response.status,
      });
    }
    return htmlDoc;
  };

  const json = (): unknown => {
    if (jsonDoc === undefined) {
      try {
        jsonDoc = { ok: true, value: (deps.parseJson ?? parseJson)(response.bodyText) };
      } catch (error) {
        jsonDoc = { ok: false, error };
      }
    }
    if (!jsonDoc.ok) {
      const message =
        jsonDoc.error instanceof Error ? jsonDoc.error.message : String(jsonDoc.error);
      throw new StepExecutionError({
        message: `Invalid JSON for ${req.url}: ${message}`,
        stepId: step.id,
        url: req.url,
        status: response.status,
      });
    }
    return jsonDoc.value;
  };

  for (const op of step.scrape) {
    const scraper = workflow.scrapers[op.using];
    if (!scraper) {
      throw new StepExecutionError({
        message: `Unknown scraper "${op.using}"`,
        stepId: step.id,
        url: req.url,
      });
    }
    const rows = isJsonScraper(scraper)
      ? scrapeJsonOp(json(), op, scraper, session.stats)
      : scrapeOp(html(), op, scraper, session.stats);
    items[op.id] = rows;
    recordScrapeRows({
      index: session.sources,
      datasetId: session.datasetId,
      scrapeId: op.id,
      scraperId: op.using,
      stepId: step.id,
      opSelector: op.selector,
      fields: scraper.fields,
      rows,
      rowStart: session.buckets[op.id]?.length ?? 0,
      request: { method: req.method, url: req.url },
      response: { status: response.status, url: response.url },
      paginationNext: capture.paginationNext,
      includePagination: capture.includePagination,
    });
    if (rows.length > 0) {
      emptyItems = false;
    }
  }

  return {
    items,
    emptyItems,
    hop: {
      request: { method: req.method, url: req.url },
      response: {
        status: response.status,
        url: response.url,
        headers: response.headers ?? {},
      },
    },
  };
};

const concatItems = (buckets: Buckets, items: Record<string, Record<string, unknown>[]>) => {
  for (const [id, rows] of Object.entries(items)) {
    buckets[id] ??= [];
    buckets[id].push(...rows);
  }
};

const firstRow = (rows: Record<string, unknown>[] | undefined): Record<string, unknown> =>
  rows?.[0] ?? {};

const requestContext = (
  next: unknown,
  stepResults: Record<string, Buckets>,
  httpByStep: Record<string, HttpHop>,
  inputs: ResolvedInputs,
  currentStepId: string,
): Record<string, unknown> => {
  const firstRows: Record<string, unknown> = {};
  const byStep: Record<string, unknown> = {};
  let lastHop: HttpHop | undefined;
  for (const [stepId, scrapes] of Object.entries(stepResults)) {
    const stepMap: Record<string, unknown> = {};
    for (const [scrapeId, rows] of Object.entries(scrapes)) {
      const row = firstRow(rows);
      stepMap[scrapeId] = row;
      if (scrapeId !== "pagination") {
        firstRows[scrapeId] = row;
      }
    }
    if (stepId !== currentStepId) {
      const hop = httpByStep[stepId];
      if (hop) {
        stepMap.request = hop.request;
        stepMap.response = hop.response;
        lastHop = hop;
      }
    }
    byStep[stepId] = stepMap;
  }
  return {
    ...byStep,
    ...firstRows,
    input: inputs,
    pagination: { next },
    ...(lastHop ? { request: lastHop.request, response: lastHop.response } : {}),
  };
};

const tickPercent = (paginated: boolean, iteration: number, max: number): number => {
  if (!paginated) {
    return 100;
  }
  return Math.min(99, Math.round((iteration / max) * 100));
};

const progressLabel = (
  step: Step,
  items: Record<string, Record<string, unknown>[]>,
  next: unknown,
  inputs: ResolvedInputs,
  hop: HttpHop,
): string => {
  if (!step.output) {
    return step.id;
  }
  const [line] = renderStepOutput(step.output, items, {
    input: inputs,
    pagination: { next },
    request: hop.request,
    response: hop.response,
  });
  return line ? line : step.id;
};

const executeStepPass = async (
  workflow: WorkflowSchema,
  step: Step,
  deps: Deps,
  session: DatasetRun,
  inputs: ResolvedInputs,
  emit: (status: StepProgress["status"], percent: number, label: string) => void,
): Promise<void> => {
  const pagination = step.pagination;
  let next: unknown = pagination ? initialNext(pagination) : undefined;
  const max = pagination?.max ?? 1;

  for (let iteration = 1; iteration <= max; iteration++) {
    const req = asHttpRequest(
      interpolate(
        step.request,
        requestContext(next, session.stepResults, session.httpByStep, inputs, step.id),
      ),
      step.id,
    );
    const capture: Page = pagination
      ? { includePagination: true, paginationNext: next }
      : { includePagination: false };
    const once = await executeOnce(workflow, step, req, deps, session, capture);
    concatItems(session.buckets, once.items);
    session.stepResults[step.id] ??= {};
    concatItems(session.stepResults[step.id], once.items);
    session.httpByStep[step.id] = once.hop;
    emit(
      "tick",
      tickPercent(Boolean(pagination), iteration, max),
      progressLabel(step, once.items, next, inputs, once.hop),
    );

    if (!pagination) {
      break;
    }
    if (
      shouldStop({
        iteration,
        max: pagination.max,
        emptyItems: once.emptyItems,
        stopWhen: pagination.stop_when,
      })
    ) {
      break;
    }
    const advanced = advancePagination({
      pagination,
      current: next,
      items: once.items,
    });
    if (advanced.stop) {
      break;
    }
    next = advanced.next;
  }
};

const executeStep = async (
  workflow: WorkflowSchema,
  step: Step,
  deps: Deps,
  session: DatasetRun,
): Promise<void> => {
  const emit = (status: StepProgress["status"], percent: number, label: string) => {
    deps.onProgress?.({ stepId: step.id, status, percent, label });
  };

  emit("start", 0, step.id);
  try {
    const inputs = deps.inputs ?? {};
    if (!step.each) {
      await executeStepPass(workflow, step, deps, session, inputs, emit);
    } else {
      const inputId = step.each.slice("input.".length);
      const items = inputs[inputId];
      if (!Array.isArray(items)) {
        throw new StepExecutionError({
          message: `Step each input "${inputId}" must be an array`,
          stepId: step.id,
          url: "",
        });
      }
      for (const item of items) {
        await executeStepPass(
          workflow,
          step,
          deps,
          session,
          { ...inputs, [inputId]: item },
          emit,
        );
      }
    }
    emit("done", 100, step.id);
  } catch (cause) {
    emit("error", 0, step.id);
    throw cause;
  }
};

const executeDataset = async (
  workflow: WorkflowSchema,
  datasetId: string,
  deps: Deps,
  run: Run,
): Promise<Record<string, Record<string, unknown>[]>> => {
  const dataset = workflow.data[datasetId];
  if (!dataset) {
    throw new WorkFlowValidationError({
      message: `Unknown dataset "${datasetId}"`,
    });
  }
  const session = openDataset(run, datasetId);
  for (const step of dataset.steps) {
    await executeStep(workflow, step, deps, session);
  }
  return session.buckets;
};

export const executeWorkflow = async (
  workflow: WorkflowSchema,
  deps: Deps,
): Promise<WorkflowRun> => {
  const inputs = deps.inputs ?? {};
  for (const inputId of Object.keys(workflow.input)) {
    if (!Object.hasOwn(inputs, inputId) || inputs[inputId] === undefined) {
      throw new WorkFlowValidationError({
        message: `Missing required input "${inputId}"`,
      });
    }
  }
  const result: WorkflowResult = {};
  const run: Run = {
    stats: emptyStats(),
    sources: emptySources(),
  };
  for (const datasetId of Object.keys(workflow.data)) {
    result[datasetId] = await executeDataset(workflow, datasetId, deps, run);
  }
  return {
    data: result,
    health: toHealth(run.stats),
    sources: run.sources,
  };
};

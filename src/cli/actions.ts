import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WorkFlowValidationError } from "../error.js";
import { createFetchClient } from "../http/client.js";
import type { HttpClient } from "../http/client.js";
import { resolveInputs } from "../input/resolve.js";
import type { InputPrompt } from "../input/resolve.js";
import type { StepHttpLog, StepProgress } from "../runtime/execute.js";
import { executeWorkflow } from "../runtime/execute.js";
import type { Health } from "../scrape/health.js";
import { parseHtml } from "../scrape/html.js";
import type { HtmlDocument } from "../scrape/html.js";
import type { Sources } from "../scrape/source.js";
import { loadWorkflowFromFile } from "../workflow/load.js";
import type { WorkflowResult, WorkflowSchema } from "../workflow/types.js";
import { createHttpLogSession } from "./http-log.js";
import { writeHealth, writeSources, writeWorkflowOutput } from "./save.js";

export type RunOptions = {
  onProgress?: (event: StepProgress) => void;
  onLog?: (entry: StepHttpLog) => void;
  http?: HttpClient;
  parseHtml?: (html: string) => HtmlDocument;
  now?: Date;
  cwd?: string;
  cliValues?: Record<string, string>;
  prompt?: InputPrompt;
};

export type RunOutcome = {
  workflow: WorkflowSchema;
  result: WorkflowResult;
  health: Health;
  sources: Sources;
  outputPath: string;
  healthPath: string;
  sourcePath: string;
  logPath?: string;
};

export const runWorkflowFile = async (
  file: string,
  options: RunOptions = {},
): Promise<RunOutcome> => {
  const workflow = loadWorkflowFromFile(file);
  const inputs = await resolveInputs({
    decls: workflow.input,
    workflowPath: file,
    cliValues: options.cliValues ?? {},
    readFile: (path) => readFileSync(path, "utf8"),
    prompt: options.prompt,
  });
  const now = options.now ?? new Date();
  const cwd = options.cwd ?? process.cwd();
  const session = createHttpLogSession(workflow, file, cwd, now);
  const {
    data: result,
    health,
    sources,
  } = await executeWorkflow(workflow, {
    http: options.http ?? createFetchClient(),
    parseHtml: options.parseHtml ?? parseHtml,
    inputs,
    onProgress: options.onProgress,
    onLog: (entry) => {
      session?.onLog(entry);
      options.onLog?.(entry);
    },
  });
  const artifact = {
    workflowFile: file,
    useTimestamps: workflow.output?.["use-timestamps"] ?? false,
    now,
    cwd,
  };
  const outputPath = writeWorkflowOutput({ ...artifact, result });
  const healthPath = writeHealth({ ...artifact, health });
  const sourcePath = writeSources({ ...artifact, sources });
  return {
    workflow,
    result,
    health,
    sources,
    outputPath,
    healthPath,
    sourcePath,
    logPath: session?.logPath,
  };
};

export const countRows = (result: WorkflowResult): number =>
  Object.values(result).reduce(
    (total, buckets) => total + Object.values(buckets).reduce((sum, rows) => sum + rows.length, 0),
    0,
  );

export const summarizeWorkflow = (workflow: WorkflowSchema): string => {
  const scraperNames = Object.keys(workflow.scrapers);
  const datasets = Object.entries(workflow.data).map(([id, dataset]) => {
    const steps = dataset.steps
      .map((step) => {
        const extra = step.pagination ? " (paginated)" : "";
        return `    ${step.id}  ${step.request.method} ${step.request.url}${extra}`;
      })
      .join("\n");
    return `  ${id} - ${dataset.name}\n${steps}`;
  });

  return [
    `Name: ${workflow.name}`,
    `Description: ${workflow.description ?? "(none)"}`,
    `Version: ${workflow.version}`,
    `Scrapers: ${scraperNames.join(", ") || "(none)"}`,
    "Datasets:",
    ...datasets,
  ].join("\n");
};

const yamlString = (value: string): string =>
  value === "" || /[:#\n"'\\]/.test(value) || /^\s|\s$/.test(value) ? JSON.stringify(value) : value;

export const isWorkflowFileBaseName = (name: string): boolean => {
  const base = name.trim().replace(/\.ya?ml$/i, "");
  return /^[A-Za-z0-9._-]+$/.test(base) && base !== "." && base !== "..";
};

export const createWorkflow = (
  name: string,
  description = "",
  version: number | string = 1.0,
  dir = join(process.cwd(), "workflows"),
): string => {
  const base = name.trim().replace(/\.ya?ml$/i, "");
  if (!isWorkflowFileBaseName(base)) {
    throw new WorkFlowValidationError({
      message: `Invalid workflow name "${name}". Use letters, numbers, dots, dashes, and underscores.`,
    });
  }
  const versionText = typeof version === "number" ? String(version) : yamlString(version);
  const template = `version: ${versionText}
name: ${yamlString(base)}
description: ${yamlString(description)}

scrapers: {}

data: {}
`;

  mkdirSync(dir, { recursive: true });
  const workflowFile = join(dir, `${base}.yaml`);
  if (existsSync(workflowFile)) {
    throw new WorkFlowValidationError({
      message: `Workflow file already exists: ${workflowFile}`,
    });
  }
  try {
    writeFileSync(workflowFile, template, "utf8");
  } catch (cause) {
    throw new WorkFlowValidationError({
      message: `Failed to write "${workflowFile}": ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
  return workflowFile;
};

import { dirname, resolve } from "node:path";
import { load } from "js-yaml";
import { WorkFlowValidationError } from "../error.js";
import type {
  InputDeclaration,
  PrimitiveInputType,
  RecordFieldType,
  WorkflowInput,
} from "../workflow/types.js";

export type ResolvedInputs = Record<string, unknown>;

export type ReadInputFile = (path: string) => string | Promise<string>;

export type InputPrompt = (message: string) => string | Promise<string>;

export type ResolveInputsOptions = {
  decls: WorkflowInput;
  workflowPath: string;
  cliValues: Record<string, string>;
  readFile: ReadInputFile;
  prompt?: InputPrompt;
};

const fail = (message: string): never => {
  throw new WorkFlowValidationError({ message });
};

const coerceScalar = (
  type: "string" | "number" | "boolean",
  value: unknown,
  label: string,
): string | number | boolean => {
  if (value === null || value === undefined) {
    return fail(`${label} cannot be null`);
  }
  if (type === "string") {
    return String(value);
  }
  if (type === "number") {
    const number = Number(value);
    return Number.isNaN(number) ? fail(`${label} must be a number`) : number;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return fail(`${label} must be true or false`);
};

const coercePrimitive = (type: PrimitiveInputType, value: string, id: string): unknown => {
  if (type === "string[]") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  if (type === "number[]") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .map((item) => coerceScalar("number", item, `Input "${id}"`));
  }
  return coerceScalar(type, value, `Input "${id}"`);
};

const readDeclaredFile = async (
  file: string,
  workflowPath: string,
  readFile: ReadInputFile,
): Promise<{ contents: string; path: string }> => {
  const candidates = [
    ...new Set([resolve(process.cwd(), file), resolve(dirname(resolve(workflowPath)), file)]),
  ];
  let lastCause: unknown;
  for (const path of candidates) {
    try {
      return { contents: await readFile(path), path };
    } catch (cause) {
      lastCause = cause;
    }
  }
  const reason = lastCause instanceof Error ? lastCause.message : String(lastCause);
  return fail(`Failed to read input file "${file}": ${reason}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const rowsFromYaml = (root: unknown, id: string, key: string | undefined): unknown[] => {
  if (Array.isArray(root)) {
    return root;
  }
  if (!isRecord(root)) {
    return fail(`Input "${id}" file must contain a YAML array or mapping`);
  }
  const selectedKey = key ?? id;
  const selected = root[selectedKey];
  return Array.isArray(selected)
    ? selected
    : fail(`Input "${id}" key "${selectedKey}" must contain a YAML array`);
};

const coerceRecord = (
  row: unknown,
  fields: Record<string, RecordFieldType>,
  id: string,
  rowIndex: number,
): Record<string, unknown> => {
  if (!isRecord(row)) {
    return fail(`Input "${id}" row ${rowIndex + 1} must be a mapping`);
  }
  const resolved = { ...row };
  for (const [field, type] of Object.entries(fields)) {
    if (!Object.hasOwn(row, field)) {
      return fail(`Input "${id}" row ${rowIndex + 1} is missing field "${field}"`);
    }
    resolved[field] = coerceScalar(
      type,
      row[field],
      `Input "${id}" row ${rowIndex + 1} field "${field}"`,
    );
  }
  return resolved;
};

const resolveFileInput = async (
  id: string,
  declaration: Extract<InputDeclaration, { file: string }>,
  workflowPath: string,
  readFile: ReadInputFile,
): Promise<Record<string, unknown>[]> => {
  const source = await readDeclaredFile(declaration.file, workflowPath, readFile);
  let root: unknown;
  try {
    root = load(source.contents);
  } catch (cause) {
    return fail(
      `Failed to parse input file "${source.path}": ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  return rowsFromYaml(root, id, declaration.key).map((row, index) =>
    coerceRecord(row, declaration.fields, id, index),
  );
};

export const resolveInputs = async ({
  decls,
  workflowPath,
  cliValues,
  readFile,
  prompt,
}: ResolveInputsOptions): Promise<ResolvedInputs> => {
  const resolved: ResolvedInputs = {};
  const declarations = Object.entries(decls);
  for (const [id, declaration] of declarations) {
    if ("file" in declaration) {
      resolved[id] = await resolveFileInput(id, declaration, workflowPath, readFile);
    }
  }
  for (const [id, declaration] of declarations) {
    if ("file" in declaration) {
      continue;
    }
    let value = cliValues[id];
    if (value === undefined) {
      if (!prompt) {
        return fail(`Missing required input "${id}"`);
      }
      value = await prompt(declaration.prompt ?? `Enter ${id}`);
    }
    resolved[id] = coercePrimitive(declaration.type, value, id);
  }
  return resolved;
};

import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { WorkflowValidationError } from "../error.js";
import { workflowSchema } from "./schema.js";
import type { WorkflowSchema } from "./types.js";

const formatZodError = (error: { issues: { path: PropertyKey[]; message: string }[] }) =>
  error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("\n");

const parseWorkflow = (raw: unknown): WorkflowSchema => {
  if (typeof raw === "string") {
    throw new WorkflowValidationError({
      message:
        "Invalid workflow: YAML parsed as a string, not an object. loadWorkflow() expects file contents, not a path. Use loadWorkflowFromFile(path).",
    });
  }

  const parsed = workflowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new WorkflowValidationError({
      message: `Invalid workflow:\n${formatZodError(parsed.error)}`,
    });
  }
  return parsed.data;
};

export const loadWorkflow = (yaml: string): WorkflowSchema => {
  let raw: unknown;
  try {
    raw = load(yaml);
  } catch (cause) {
    throw new WorkflowValidationError({
      message: `Failed to parse YAML: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
  return parseWorkflow(raw);
};

export const loadWorkflowFromFile = (path: string): WorkflowSchema => {
  let yaml: string;
  try {
    yaml = readFileSync(path, "utf8");
  } catch (cause) {
    throw new WorkflowValidationError({
      message: `Failed to read workflow file "${path}": ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
  return loadWorkflow(yaml);
};

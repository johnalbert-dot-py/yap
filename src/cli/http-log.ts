import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import pino from "pino";
import type { StepHttpLog } from "../runtime/execute.js";
import type { WorkflowSchema } from "../workflow/types.js";
import { resolveHttpLogPath } from "./save.js";

export const createHttpLogSession = (
  workflow: WorkflowSchema,
  workflowFile: string,
  cwd: string,
  now = new Date(),
): { logPath: string; onLog: (entry: StepHttpLog) => void } | undefined => {
  const logPath = resolveHttpLogPath({
    workflowFile,
    logging: workflow.logging,
    useTimestamps: workflow.output?.["use-timestamps"] ?? false,
    now,
    cwd,
  });
  const yamlLevel = workflow.logging?.level;
  if (!logPath || !yamlLevel) {
    return undefined;
  }
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath, "");
  const logger = pino(
    {
      level: yamlLevel === "DEBUG" ? "debug" : "info",
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.destination({ dest: logPath, mkdir: true, sync: true }),
  );
  return {
    logPath,
    onLog(entry) {
      const payload = {
        id: entry.id,
        stepId: entry.stepId,
        request: entry.request,
        ...(entry.response !== undefined ? { response: entry.response } : {}),
      };
      switch (entry.level) {
        case "DEBUG":
          logger.debug(payload);
          return;
        case "INFO":
          logger.info(payload);
          return;
        default: {
          const _exhaustive: never = entry.level;
          return _exhaustive;
        }
      }
    },
  };
};

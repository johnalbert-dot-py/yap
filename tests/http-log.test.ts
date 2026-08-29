import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHttpLogSession } from "../src/cli/http-log.js";
import type { StepHttpLog } from "../src/runtime/execute.js";
import type { WorkflowSchema } from "../src/workflow/types.js";

const infoEntry: StepHttpLog = {
  id: "11111111-1111-4111-8111-111111111111",
  ts: "2026-08-29T00:00:00.000Z",
  level: "INFO",
  stepId: "initial-page",
  request: {
    method: "GET",
    url: "https://example.test/page",
    headers: { Accept: "text/html" },
  },
};

const debugEntry: StepHttpLog = {
  ...infoEntry,
  id: "22222222-2222-4222-8222-222222222222",
  level: "DEBUG",
  response: { status: 200, url: "https://example.test/page", bodyText: "<body>hello</body>" },
};

const workflowForLog = (level: "INFO" | "DEBUG"): WorkflowSchema => ({
  version: 1,
  name: "log-demo",
  scrapers: {},
  data: {},
  logging: { level },
});

const readLines = (path: string): Record<string, unknown>[] =>
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe("createHttpLogSession", () => {
  it("writes INFO as pino JSONL with id, stepId, request, and time", () => {
    const directory = mkdtempSync(join(tmpdir(), "yap-pino-"));
    try {
      const workflowFile = join(directory, "log-demo.yaml");
      const session = createHttpLogSession(workflowForLog("INFO"), workflowFile, directory);
      expect(session?.logPath).toBe(join(directory, "logs/log-demo.log"));
      session?.onLog(infoEntry);
      const [row] = readLines(session!.logPath);
      expect(row?.id).toBe(infoEntry.id);
      expect(row?.stepId).toBe("initial-page");
      expect(row?.request).toEqual(infoEntry.request);
      expect(row?.time).toEqual(expect.any(String));
      expect(row?.level).toBe(30);
      expect(row?.ts).toBeUndefined();
      expect(row?.response).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("includes response on a DEBUG line", () => {
    const directory = mkdtempSync(join(tmpdir(), "yap-pino-"));
    try {
      const workflowFile = join(directory, "log-demo.yaml");
      const session = createHttpLogSession(workflowForLog("DEBUG"), workflowFile, directory);
      session?.onLog(debugEntry);
      const [row] = readLines(session!.logPath);
      expect(row).toBeDefined();
      expect(row.id).toBe(debugEntry.id);
      expect(row.stepId).toBe("initial-page");
      expect((row.request as { url: string }).url).toBe("https://example.test/page");
      expect(row.time).toEqual(expect.any(String));
      expect(row.level).toBe(20);
      expect(row.response).toEqual(debugEntry.response);
      expect(row.ts).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  countRows,
  createWorkflow,
  runWorkflowFile,
  summarizeWorkflow,
} from "../src/cli/actions.js";
import { WorkFlowValidationError } from "../src/error.js";
import type { HttpClient, HttpRequest } from "../src/http/client.js";
import type { StepHttpLog } from "../src/runtime/execute.js";
import { parseHtml } from "../src/scrape/html.js";
import { loadWorkflow, loadWorkflowFromFile } from "../src/workflow/load.js";
import type { WorkflowResult } from "../src/workflow/types.js";

describe("cli actions", () => {
  it("counts rows across datasets", () => {
    const result: WorkflowResult = {
      list_of_cars: {
        cars: [{ title: "A" }, { title: "B" }],
      },
      other: {
        items: [{ id: 1 }],
      },
    };
    expect(countRows(result)).toBe(3);
  });

  it("summarizes a workflow", () => {
    const workflow = loadWorkflow(`
version: 1
name: demo
scrapers:
  card:
    fields:
      title:
        selector: h1
data:
  list:
    name: List
    steps:
      - id: open
        request:
          method: GET
          url: https://example.test
        scrape:
          - id: cars
            selector: .card
            using: card
`);
    const text = summarizeWorkflow(workflow);
    expect(text).toContain("Name: demo");
    expect(text).toContain("open");
    expect(text).toContain("card");
  });

  it("resolves CLI inputs before running a workflow file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yap-inputs-"));
    try {
      const file = join(dir, "inputs.yaml");
      writeFileSync(
        file,
        `version: 1
name: inputs
input:
  ids: number[]
scrapers:
  body-text:
    fields:
      text: {}
data:
  ids:
    name: IDs
    steps:
      - id: fetch
        each: input.ids
        request:
          method: GET
          url: "https://example.test/{{ input.ids }}"
        scrape:
          - id: pages
            selector: body
            using: body-text
`,
      );
      const urls: string[] = [];
      const http: HttpClient = {
        async request(req) {
          urls.push(req.url);
          return { status: 200, url: req.url, bodyText: "<body>ok</body>" };
        },
      };

      await runWorkflowFile(file, {
        cwd: dir,
        cliValues: { ids: "4,5" },
        http,
        parseHtml,
      });

      expect(urls).toEqual(["https://example.test/4", "https://example.test/5"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("createWorkflow", () => {
  it("writes a loadable stub under the given dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yap-create-"));
    try {
      const path = createWorkflow("demo-cars", "List of cars", 1.0, dir);
      expect(path).toBe(join(dir, "demo-cars.yaml"));
      const contents = readFileSync(path, "utf8");
      expect(contents).toContain("name: demo-cars");
      expect(contents).toContain("scrapers: {}");
      expect(contents).toContain("data: {}");
      expect(contents).not.toContain("output:");
      expect(contents).not.toContain("directory:");
      const workflow = loadWorkflowFromFile(path);
      expect(workflow.name).toBe("demo-cars");
      expect(workflow.description).toBe("List of cars");
      expect(workflow.output).toBeUndefined();
      expect(workflow.scrapers).toEqual({});
      expect(workflow.data).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("quotes description when it contains a colon", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yap-create-"));
    try {
      const path = createWorkflow("quoted", "Cars: list", "1.0", dir);
      const contents = readFileSync(path, "utf8");
      expect(contents).toContain('"Cars: list"');
      const workflow = loadWorkflowFromFile(path);
      expect(workflow.description).toBe("Cars: list");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an existing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "yap-create-"));
    try {
      createWorkflow("demo-cars", "", 1.0, dir);
      expect(() => createWorkflow("demo-cars", "", 1.0, dir)).toThrow(WorkFlowValidationError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const mockHttp = (): HttpClient => ({
  async request(req: HttpRequest) {
    return { status: 200, url: req.url, bodyText: "<body>hello</body>" };
  },
});

const writeLogWorkflow = (dir: string, logging: string, twoSteps: boolean): string => {
  const second = twoSteps
    ? `
      - id: second
        request:
          method: GET
          url: "https://example.test/b"
        scrape:
          - id: page
            selector: body
            using: body-text`
    : "";
  const file = join(dir, "log-demo.yaml");
  writeFileSync(
    file,
    `version: 1
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
      - id: first
        request:
          method: GET
          url: "https://example.test/a"
        scrape:
          - id: page
            selector: body
            using: body-text${second}
`,
  );
  return file;
};

describe("HTTP log files", () => {
  it("writes INFO blocks to a file and still calls onLog", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yap-http-log-"));
    try {
      const file = writeLogWorkflow(dir, "logging:\n  level: INFO\n", true);
      mkdirSync(join(dir, "logs"), { recursive: true });
      writeFileSync(join(dir, "logs/log-demo.log"), "OLD JUNK\n");
      const extras: StepHttpLog[] = [];
      const outcome = await runWorkflowFile(file, {
        cwd: dir,
        http: mockHttp(),
        parseHtml,
        onLog: (entry) => extras.push(entry),
      });
      expect(outcome.logPath).toBe(join(dir, "logs/log-demo.log"));
      expect(outcome.outputPath).toBe(join(dir, "output/log-demo.json"));
      const lines = readFileSync(outcome.logPath!, "utf8")
        .trim()
        .split("\n")
        .filter((line) => line.length > 0);
      expect(lines).toHaveLength(2);
      const rows = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      const first = rows[0];
      const second = rows[1];
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      const firstRequest = first.request as { method: string; url: string };
      const secondRequest = second.request as { url: string };
      expect(first.level).toBe(30);
      expect(firstRequest.method).toBe("GET");
      expect(firstRequest.url).toBe("https://example.test/a");
      expect(secondRequest.url).toBe("https://example.test/b");
      expect(first.id).toEqual(expect.any(String));
      expect(first.time).toEqual(expect.any(String));
      expect(first.ts).toBeUndefined();
      expect(first.response).toBeUndefined();
      expect(second.response).toBeUndefined();
      expect(extras).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes DEBUG response body in the file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yap-http-log-"));
    try {
      const file = writeLogWorkflow(dir, "logging:\n  level: DEBUG\n", false);
      const outcome = await runWorkflowFile(file, {
        cwd: dir,
        http: mockHttp(),
        parseHtml,
      });
      const lines = readFileSync(outcome.logPath!, "utf8")
        .trim()
        .split("\n")
        .filter((line) => line.length > 0);
      expect(lines).toHaveLength(1);
      const row = JSON.parse(lines[0]!) as Record<string, unknown>;
      expect(row.level).toBe(20);
      expect(row.time).toEqual(expect.any(String));
      expect((row.response as { bodyText: string }).bodyText).toContain("<body>hello</body>");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes no log file when logging is omitted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yap-http-log-"));
    try {
      const file = writeLogWorkflow(dir, "", false);
      const extras: StepHttpLog[] = [];
      const outcome = await runWorkflowFile(file, {
        cwd: dir,
        http: mockHttp(),
        parseHtml,
        onLog: (entry) => extras.push(entry),
      });
      expect(outcome.logPath).toBeUndefined();
      expect(existsSync(join(dir, "logs/log-demo.log"))).toBe(false);
      expect(existsSync(join(dir, "output/log-demo.json"))).toBe(true);
      expect(existsSync(join(dir, "output/log-demo.health.json"))).toBe(true);
      expect(existsSync(join(dir, "output/log-demo.provenance.json"))).toBe(true);
      expect(outcome.healthPath).toBe(join(dir, "output/log-demo.health.json"));
      expect(outcome.provenancePath).toBe(join(dir, "output/log-demo.provenance.json"));
      expect(outcome.extractionHealth.status).toBe("healthy");
      expect(outcome.provenance.cells["one.page[0].target"]?.value).toBe("hello");
      expect(extras).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

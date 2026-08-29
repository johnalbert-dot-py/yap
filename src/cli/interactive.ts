import { readdir } from "node:fs/promises";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
  path,
  select,
  spinner,
  text,
} from "@clack/prompts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { StepExecutionError, WorkflowValidationError } from "../error.js";
import {
  countRows,
  createWorkflow,
  isWorkflowFileBaseName,
  runWorkflowFile,
  summarizeWorkflow,
} from "./actions.js";
import { loadWorkflowFromFile } from "../workflow/load.js";
import { ExplainError, explainCell } from "./explain.js";
import {
  formatDriftReport,
  formatHealthReport,
  HealthError,
  readCurrentHealth,
  readDrift,
  YAP_DRIFT_NO_PREVIOUS,
} from "./health.js";
import { createProgressSpinner } from "./progress.js";
import { reduceSession, type Session } from "./session.js";

const BROWSE = "__browse__";
const CREATE = "__create__";
const QUIT = "__quit__";
const WORKFLOWS_DIR = "workflows";

const exitCancel = (): never => {
  cancel("Cancelled.");
  process.exit(0);
};

const unwrap = <T>(value: T): Exclude<T, symbol> => {
  if (isCancel(value)) {
    exitCancel();
  }
  return value as Exclude<T, symbol>;
};

const listYamlFiles = async (): Promise<string[]> => {
  const found: string[] = [];
  const walk = async (dir: string) => {
    if (!existsSync(dir)) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
        found.push(full);
      }
    }
  };
  await walk(WORKFLOWS_DIR);
  return [...new Set(found)].sort();
};

type WorkflowPick = { kind: "file"; file: string } | { kind: "create" } | { kind: "quit" };

const browseWorkflowFile = async (): Promise<string> => {
  const workflowsRoot = join(process.cwd(), WORKFLOWS_DIR);
  const startDir = existsSync(workflowsRoot) ? workflowsRoot : process.cwd();
  const pickedPath = unwrap(
    await path({
      message: "Path to workflow YAML",
      directory: false,
      root: startDir,
      initialValue: startDir,
      validate(value) {
        const file = Array.isArray(value) ? value[0] : value;
        if (!file) return "Path is required.";
        if (!/\.ya?ml$/i.test(file)) return "File must be .yaml or .yml.";
        if (!existsSync(file)) return "File not found.";
      },
    }),
  );
  return Array.isArray(pickedPath) ? (pickedPath[0] ?? "") : pickedPath;
};

const pickWorkflowFile = async (): Promise<WorkflowPick> => {
  const files = await listYamlFiles();
  const picked = unwrap(
    await select({
      message: "Workflow file",
      options: [
        ...files.map((file) => ({ value: file, label: file })),
        { value: BROWSE, label: "Other file…", hint: "browse" },
        { value: CREATE, label: "Create", hint: "write YAML stub" },
        { value: QUIT, label: "Quit" },
      ],
    }),
  );

  if (picked === QUIT) {
    return { kind: "quit" };
  }
  if (picked === CREATE) {
    return { kind: "create" };
  }
  if (picked !== BROWSE) {
    return { kind: "file", file: picked };
  }
  return { kind: "file", file: await browseWorkflowFile() };
};

const pickAction = async (file: string) =>
  unwrap(
    await select({
      message: file,
      options: [
        { value: "run" as const, label: "Run" },
        { value: "inspect" as const, label: "Inspect" },
        { value: "health" as const, label: "Health" },
        { value: "explain" as const, label: "Explain" },
        { value: "back" as const, label: "Back" },
        { value: "quit" as const, label: "Quit" },
      ],
    }),
  );

const printCliError = (error: unknown) => {
  if (error instanceof WorkflowValidationError) {
    log.error(error.message);
    return;
  }
  if (error instanceof StepExecutionError) {
    const lines = [
      `Step ${error.stepId}`,
      error.url ? `URL ${error.url}` : "",
      error.status !== undefined ? `Status ${error.status}` : "",
      error.message,
    ].filter(Boolean);
    log.error(lines.join("\n"));
    return;
  }
  log.error(error instanceof Error ? error.message : String(error));
};

const runInteractive = async (file: string) => {
  log.info(`Running ${file}`);
  const progress = createProgressSpinner();
  try {
    const { workflow, result, health, outputPath, healthPath, sourcePath, logPath } =
      await runWorkflowFile(file, {
        onProgress: progress.onProgress,
        prompt: async (message) =>
          unwrap(
            await text({
              message,
            }),
          ),
      });
    const rows = countRows(result);
    log.success(`Ran ${workflow.name} - ${rows} row${rows === 1 ? "" : "s"}`);
    log.info(`Saved ${outputPath}`);
    log.info(`Saved ${healthPath}`);
    log.info(`Saved ${sourcePath}`);
    if (logPath) {
      log.info(`Logged ${logPath}`);
    }
    if (health.status === "degraded") {
      log.warn("Extraction degraded. A required field missed some rows.");
    }
    if (health.status === "failed") {
      log.error("Extraction failed. A required field matched 0 times.");
    }
    const view = unwrap(
      await confirm({
        message: "View result?",
        initialValue: true,
      }),
    );
    if (view) {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    progress.fail("Run failed");
    printCliError(error);
  }
};

const createInteractive = async () => {
  const name = unwrap(
    await text({
      message: "Workflow name",
      placeholder: "paginated-cars",
      validate(value) {
        const raw = value ?? "";
        if (!raw.trim()) return "Name is required.";
        if (!isWorkflowFileBaseName(raw)) {
          return "Use letters, numbers, dots, dashes, and underscores.";
        }
      },
    }),
  ).trim();
  const description = unwrap(
    await text({
      message: "Description",
      placeholder: "optional",
      defaultValue: "",
    }),
  );
  const versionRaw = unwrap(
    await text({
      message: "Version",
      placeholder: "1.0",
      defaultValue: "1.0",
    }),
  ).trim();
  try {
    const created = createWorkflow(name, description, versionRaw === "" ? 1.0 : versionRaw);
    log.success(`Created ${created}`);
  } catch (error) {
    printCliError(error);
  }
};

const inspectInteractive = async (file: string) => {
  const spin = spinner();
  spin.start(`Loading ${file}`);
  try {
    const workflow = loadWorkflowFromFile(file);
    spin.stop(`Loaded ${workflow.name}`);
    note(summarizeWorkflow(workflow), workflow.name);
  } catch (error) {
    spin.stop("Load failed");
    printCliError(error);
  }
};

const healthInteractive = (file: string) => {
  try {
    note(formatHealthReport(readCurrentHealth(process.cwd(), file)), "Health");
    try {
      note(formatDriftReport(readDrift(process.cwd(), file)), "Drift");
    } catch (error) {
      if (error instanceof HealthError && error.code === YAP_DRIFT_NO_PREVIOUS) {
        log.info("No previous run to compare.");
        return;
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof HealthError) {
      log.error(error.code);
      return;
    }
    printCliError(error);
  }
};

const explainInteractive = async (file: string) => {
  const cellPath = unwrap(
    await text({
      message: "Cell path",
      placeholder: "list_of_cars.cars[17].year",
    }),
  ).trim();
  try {
    note(explainCell(cellPath, process.cwd(), file), cellPath);
  } catch (error) {
    if (error instanceof ExplainError) {
      log.error(error.code);
      return;
    }
    printCliError(error);
  }
};

const openWorkflow = async (): Promise<Session> => {
  const picked = await pickWorkflowFile();
  if (picked.kind === "quit") {
    return reduceSession({ screen: "workflows" }, { type: "quit" });
  }
  if (picked.kind === "create") {
    await createInteractive();
    return { screen: "workflows" };
  }
  return reduceSession({ screen: "workflows" }, { type: "open", file: picked.file });
};

export const runInteractiveCli = async (start?: "run" | "inspect" | "create") => {
  const banner = `
  ██╗   ██╗      █████╗          ██████╗
  ╚██╗ ██╔╝     ██╔══██╗         ██╔══██╗
   ╚████╔╝      ███████║         ██████╔╝
    ╚██╔╝       ██╔══██║         ██╔═══╝
     ██║ou      ██║  ██║utomate  ██║ages
     ╚═╝        ╚═╝  ╚═╝         ╚═╝
  `;
  console.log(banner);
  intro("Start Yapping :>");

  let session: Session = { screen: "workflows" };

  if (start === "create") {
    await createInteractive();
  } else if (start === "run" || start === "inspect") {
    const next = await openWorkflow();
    if (next.screen === "done") {
      outro("Bye.");
      return;
    }
    if (next.screen === "actions") {
      if (start === "run") {
        await runInteractive(next.file);
      } else {
        await inspectInteractive(next.file);
      }
      session = next;
    }
  }

  while (session.screen !== "done") {
    if (session.screen === "workflows") {
      session = await openWorkflow();
      continue;
    }
    const action = await pickAction(session.file);
    if (action === "run") {
      await runInteractive(session.file);
      session = reduceSession(session, { type: "ran" });
      continue;
    }
    if (action === "inspect") {
      await inspectInteractive(session.file);
      session = reduceSession(session, { type: "inspected" });
      continue;
    }
    if (action === "health") {
      healthInteractive(session.file);
      session = reduceSession(session, { type: "health" });
      continue;
    }
    if (action === "explain") {
      await explainInteractive(session.file);
      session = reduceSession(session, { type: "explained" });
      continue;
    }
    if (action === "back") {
      session = reduceSession(session, { type: "back" });
      continue;
    }
    session = reduceSession(session, { type: "quit" });
  }

  outro("Bye.");
};

#!/usr/bin/env node
import { StepExecutionError, WorkFlowValidationError } from "./error.js";
import { runInteractiveCli } from "./cli/interactive.js";
import { parseInputArgs } from "./input/argv.js";
import { createWorkflow, runWorkflowFile, summarizeWorkflow } from "./cli/actions.js";
import { loadWorkflowFromFile } from "./workflow/load.js";
import { ExplainError, explainCell } from "./cli/explain.js";
import {
  formatDriftReport,
  formatHealthReport,
  HealthError,
  healthStderrLines,
  readCurrentHealth,
  readDrift,
} from "./cli/health.js";
import { createProgressSpinner } from "./cli/progress.js";
import { processExitCode } from "./scrape/health.js";

const usage = () => {
  console.error("Usage:");
  console.error("  yap                      interactive (TTY)");
  console.error("  yap run                  pick a workflow (TTY)");
  console.error("  yap run <file.yaml> [--input name=value]  JSON on stdout");
  console.error("  yap inspect              pick a workflow (TTY)");
  console.error("  yap inspect <file.yaml>  print a summary");
  console.error("  yap create               write a stub (TTY)");
  console.error("  yap create <name>        write workflows/<name>.yaml");
  console.error("  yap explain <path>       print where a cell came from");
  console.error("  yap health [file.yaml]   print extraction health");
  console.error("  yap drift [file.yaml]    compare health to the previous run");
};

const printStepFailed = (error: StepExecutionError) => {
  console.error("YAP_STEP_FAILED");
  console.error("");
  console.error("Step:");
  console.error(error.stepId);
  if (error.url) {
    console.error("");
    console.error("URL:");
    console.error(error.url);
  }
  if (error.status !== undefined) {
    console.error("");
    console.error("Status:");
    console.error(String(error.status));
  }
  console.error("");
  console.error("Reason:");
  console.error(error.message);
};

const fail = (error: unknown): never => {
  if (error instanceof WorkFlowValidationError) {
    console.error("YAP_WORKFLOW_INVALID");
    console.error("");
    console.error(error.message);
    process.exit(1);
  }
  if (error instanceof StepExecutionError) {
    printStepFailed(error);
    process.exit(1);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
};

const requireTty = () => {
  if (!process.stdin.isTTY) {
    usage();
    process.exit(1);
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  const command = args[0];
  const file = args[1];

  if (command === "-h" || command === "--help") {
    usage();
    return;
  }

  if (args.length === 0) {
    requireTty();
    await runInteractiveCli();
    return;
  }

  if (command === "run" && file) {
    const progress = process.stderr.isTTY ? createProgressSpinner(process.stderr) : undefined;
    try {
      const cliValues = parseInputArgs(args.slice(2));
      const { result, health, outputPath, healthPath, sourcePath, logPath } = await runWorkflowFile(
        file,
        {
          onProgress: progress?.onProgress,
          cliValues,
        },
      );
      console.error(`Saved ${outputPath}`);
      console.error(`Saved ${healthPath}`);
      console.error(`Saved ${sourcePath}`);
      if (logPath) {
        console.error(`Logged ${logPath}`);
      }
      for (const line of healthStderrLines(health, Boolean(process.stderr.isTTY))) {
        console.error(line);
      }
      console.log(JSON.stringify(result, null, 2));
      const code = processExitCode(health.status);
      if (code !== 0) {
        process.exit(code);
      }
    } catch (error) {
      progress?.fail("Run failed");
      fail(error);
    }
    return;
  }

  if (command === "run") {
    requireTty();
    await runInteractiveCli("run");
    return;
  }

  if (command === "inspect" && file) {
    const workflow = loadWorkflowFromFile(file);
    console.log(summarizeWorkflow(workflow));
    return;
  }

  if (command === "inspect") {
    requireTty();
    await runInteractiveCli("inspect");
    return;
  }

  if (command === "create" && file) {
    const created = createWorkflow(file);
    console.log(created);
    return;
  }

  if (command === "create") {
    requireTty();
    await runInteractiveCli("create");
    return;
  }

  if (command === "explain" && file) {
    try {
      console.log(explainCell(file));
    } catch (error) {
      if (error instanceof ExplainError) {
        console.error(error.code);
        process.exit(1);
      }
      fail(error);
    }
    return;
  }

  if (command === "health") {
    try {
      console.log(formatHealthReport(readCurrentHealth(process.cwd(), file)));
    } catch (error) {
      if (error instanceof HealthError) {
        console.error(error.code);
        process.exit(1);
      }
      fail(error);
    }
    return;
  }

  if (command === "drift") {
    try {
      const drift = readDrift(process.cwd(), file);
      console.log(formatDriftReport(drift));
      if (drift.status === "severe") {
        process.exit(1);
      }
    } catch (error) {
      if (error instanceof HealthError) {
        console.error(error.code);
        process.exit(1);
      }
      fail(error);
    }
    return;
  }

  usage();
  process.exit(1);
};

main().catch(fail);

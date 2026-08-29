import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtractionHealth } from "../scrape/health.js";
import type { ProvenanceIndex } from "../scrape/provenance.js";
import type { Logging, WorkflowResult } from "../workflow/types.js";

const pad = (value: number): string => String(value).padStart(2, "0");

const formatOutputTimestamp = (now: Date): string =>
  [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("-");

export const outputFileStem = (name: string, useTimestamps: boolean, now: Date): string => {
  if (!useTimestamps) {
    return name;
  }
  return `${name}-${formatOutputTimestamp(now)}`;
};

const withoutYamlSuffix = (file: string): string => file.replace(/\.ya?ml$/i, "");

export const workflowArtifactRel = (workflowFile: string, cwd: string): string => {
  const absoluteWorkflowFile = resolve(cwd, workflowFile);
  const workflowsRoot = resolve(cwd, "workflows");
  const workflowRelative = relative(workflowsRoot, absoluteWorkflowFile);
  const isUnderWorkflows =
    workflowRelative !== "" &&
    !workflowRelative.startsWith(`..${sep}`) &&
    workflowRelative !== ".." &&
    !isAbsolute(workflowRelative);

  return withoutYamlSuffix(isUnderWorkflows ? workflowRelative : basename(absoluteWorkflowFile));
};

type ArtifactPathOptions = {
  workflowFile: string;
  useTimestamps: boolean;
  now: Date;
  cwd: string;
};

export const resolveOutputPath = ({
  workflowFile,
  useTimestamps,
  now,
  cwd,
}: ArtifactPathOptions): string =>
  join(
    cwd,
    "output",
    `${outputFileStem(workflowArtifactRel(workflowFile, cwd), useTimestamps, now)}.json`,
  );

export const resolveHealthPath = ({
  workflowFile,
  useTimestamps,
  now,
  cwd,
}: ArtifactPathOptions): string =>
  join(
    cwd,
    "output",
    `${outputFileStem(workflowArtifactRel(workflowFile, cwd), useTimestamps, now)}.health.json`,
  );

export const resolveProvenancePath = ({
  workflowFile,
  useTimestamps,
  now,
  cwd,
}: ArtifactPathOptions): string =>
  join(
    cwd,
    "output",
    `${outputFileStem(workflowArtifactRel(workflowFile, cwd), useTimestamps, now)}.provenance.json`,
  );

export const resolveHttpLogPath = ({
  workflowFile,
  logging,
  useTimestamps,
  now,
  cwd,
}: ArtifactPathOptions & { logging: Logging | undefined }): string | undefined => {
  if (!logging) {
    return undefined;
  }
  return join(
    cwd,
    "logs",
    `${outputFileStem(workflowArtifactRel(workflowFile, cwd), useTimestamps, now)}.log`,
  );
};

export const writeWorkflowOutput = ({
  workflowFile,
  result,
  useTimestamps,
  now,
  cwd,
}: ArtifactPathOptions & { result: WorkflowResult }): string => {
  const filePath = resolveOutputPath({ workflowFile, useTimestamps, now, cwd });
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return filePath;
};

export const writeExtractionHealth = ({
  workflowFile,
  health,
  useTimestamps,
  now,
  cwd,
}: ArtifactPathOptions & { health: ExtractionHealth }): string => {
  const filePath = resolveHealthPath({ workflowFile, useTimestamps, now, cwd });
  mkdirSync(dirname(filePath), { recursive: true });
  if (existsSync(filePath)) {
    copyFileSync(filePath, filePath.replace(/\.health\.json$/u, ".prev.health.json"));
  }
  writeFileSync(filePath, `${JSON.stringify(health, null, 2)}\n`, "utf8");
  return filePath;
};

export const writeProvenance = ({
  workflowFile,
  provenance,
  useTimestamps,
  now,
  cwd,
}: ArtifactPathOptions & { provenance: ProvenanceIndex }): string => {
  const filePath = resolveProvenancePath({ workflowFile, useTimestamps, now, cwd });
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
  return filePath;
};

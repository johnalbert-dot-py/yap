import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { workflowArtifactRel } from "./save.js";

export const HEALTH_SUFFIX = ".health.json";
export const PREV_HEALTH_SUFFIX = ".prev.health.json";
export const PROVENANCE_SUFFIX = ".provenance.json";

const TIMESTAMP_TAIL = /-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/;

const collectFiles = (dir: string, found: string[]): void => {
  if (!existsSync(dir)) {
    return;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, found);
      continue;
    }
    if (entry.isFile()) {
      found.push(full);
    }
  }
};

const sidecarStem = (
  relativePath: string,
): { stem: string; kind: "health" | "prev" | "provenance" } | undefined => {
  if (relativePath.endsWith(PREV_HEALTH_SUFFIX)) {
    return { stem: relativePath.slice(0, -PREV_HEALTH_SUFFIX.length), kind: "prev" };
  }
  if (relativePath.endsWith(HEALTH_SUFFIX)) {
    return { stem: relativePath.slice(0, -HEALTH_SUFFIX.length), kind: "health" };
  }
  if (relativePath.endsWith(PROVENANCE_SUFFIX)) {
    return { stem: relativePath.slice(0, -PROVENANCE_SUFFIX.length), kind: "provenance" };
  }
  return undefined;
};

export const matchesWorkflowRel = (stem: string, rel: string): boolean => {
  if (stem === rel) {
    return true;
  }
  if (!stem.startsWith(`${rel}-`)) {
    return false;
  }
  return TIMESTAMP_TAIL.test(stem.slice(rel.length));
};

const outputRelative = (cwd: string, file: string): string =>
  relative(join(cwd, "output"), file).split(sep).join("/");

type SidecarKind = "health" | "prev" | "provenance";

const listSidecars = (cwd: string, kind: SidecarKind, workflowFile?: string): string[] => {
  const files: string[] = [];
  collectFiles(join(cwd, "output"), files);
  const rel = workflowFile
    ? workflowArtifactRel(workflowFile, cwd).split(sep).join("/")
    : undefined;
  const matched: { path: string; mtimeMs: number }[] = [];
  for (const file of files) {
    const parsed = sidecarStem(outputRelative(cwd, file));
    if (!parsed || parsed.kind !== kind) {
      continue;
    }
    if (rel && !matchesWorkflowRel(parsed.stem, rel)) {
      continue;
    }
    matched.push({ path: file, mtimeMs: statSync(file).mtimeMs });
  }
  matched.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return matched.map((entry) => entry.path);
};

export const newestSidecar = (
  cwd: string,
  kind: "health" | "provenance",
  workflowFile?: string,
): string | undefined => listSidecars(cwd, kind, workflowFile)[0];

export const healthSnapshotPair = (
  cwd: string,
  workflowFile?: string,
): { current: string; previous?: string } | undefined => {
  const current = newestSidecar(cwd, "health", workflowFile);
  if (!current) {
    return undefined;
  }
  const prevSibling = current.endsWith(HEALTH_SUFFIX)
    ? `${current.slice(0, -HEALTH_SUFFIX.length)}${PREV_HEALTH_SUFFIX}`
    : undefined;
  if (prevSibling && existsSync(prevSibling)) {
    return { current, previous: prevSibling };
  }
  const ranked = listSidecars(cwd, "health", workflowFile);
  return { current, previous: ranked[1] };
};

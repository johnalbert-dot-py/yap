export type InterpContext = Record<string, unknown>;

const PATH = "[a-zA-Z_][\\w-]*(?:\\.[a-zA-Z_][\\w-]*)*";

const wholeRe = () => new RegExp(`^\\{\\{\\s*(${PATH})\\s*\\}\\}$`);
const tokenRe = () => new RegExp(`\\{\\{\\s*(${PATH})\\s*\\}\\}`, "g");

export const lookup = (ctx: InterpContext, path: string): unknown => {
  let current: unknown = ctx;
  for (const part of path.split(".")) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    if (!(part in current)) {
      return undefined;
    }
    current = Reflect.get(current, part);
  }
  return current;
};

const stringifyToken = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
};

export const interpolate = (value: unknown, ctx: InterpContext): unknown => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const whole = wholeRe().exec(trimmed);
    if (whole?.[1]) {
      const found = lookup(ctx, whole[1]);
      return found === undefined ? "" : found;
    }
    return value.replace(tokenRe(), (_match, path: string) => stringifyToken(lookup(ctx, path)));
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolate(item, ctx));
  }

  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = interpolate(nested, ctx);
    }
    return out;
  }

  return value;
};

const scrapeIdsInTemplate = (
  template: string,
  items: Record<string, Record<string, unknown>[]>,
): string[] => {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of template.matchAll(tokenRe())) {
    const root = match[1]?.split(".")[0];
    if (!root || seen.has(root) || !(root in items)) {
      continue;
    }
    seen.add(root);
    ids.push(root);
  }
  return ids;
};

const joinField = (rows: Record<string, unknown>[], field: string): string =>
  rows
    .map((row) => stringifyToken(lookup(row, field)))
    .filter((value) => value.length > 0)
    .join(", ");

const joinedScrapeCtx = (
  template: string,
  items: Record<string, Record<string, unknown>[]>,
): InterpContext => {
  const out: Record<string, Record<string, string>> = {};
  for (const match of template.matchAll(tokenRe())) {
    const parts = match[1]?.split(".") ?? [];
    const root = parts[0];
    const field = parts[1];
    if (!root || !field || !(root in items)) {
      continue;
    }
    out[root] ??= {};
    if (field in out[root]) {
      continue;
    }
    out[root][field] = joinField(items[root] ?? [], field);
  }
  return out;
};

export const renderStepOutput = (
  template: string,
  items: Record<string, Record<string, unknown>[]>,
  ctx: InterpContext,
): string[] => {
  const scrapeIds = scrapeIdsInTemplate(template, items);
  if (scrapeIds.length === 0) {
    return [stringifyToken(interpolate(template, ctx))];
  }
  if (scrapeIds.every((id) => (items[id] ?? []).length === 0)) {
    return [];
  }
  return [stringifyToken(interpolate(template, { ...ctx, ...joinedScrapeCtx(template, items) }))];
};

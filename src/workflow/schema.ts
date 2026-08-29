import z from "zod";

export const getterSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
    })
    .strict(),
  z
    .object({
      type: z.literal("attribute"),
      value: z.string().min(1),
    })
    .strict(),
]);

export const fieldSchema = z
  .object({
    selector: z
      .string()
      .optional()
      .transform((value) => (value === "" ? undefined : value)),
    index: z.number().int().min(1).optional(),
    getter: getterSchema.optional(),
    required: z.boolean().optional(),
  })
  .strict();

export const jsonFieldSchema = z
  .object({
    path: z
      .string()
      .optional()
      .transform((value) => (value === "" ? undefined : value)),
    index: z.number().int().min(1).optional(),
    required: z.boolean().optional(),
  })
  .strict();

const htmlScraperSchema = z
  .object({
    format: z.literal("html"),
    fields: z.record(z.string(), fieldSchema),
  })
  .strict();

const jsonScraperSchema = z
  .object({
    format: z.literal("json"),
    fields: z.record(z.string(), jsonFieldSchema),
  })
  .strict();

export const scraperSchema = z.preprocess(
  (value) => {
    if (typeof value === "object" && value !== null && !("format" in value)) {
      return { ...value, format: "html" };
    }
    return value;
  },
  z.discriminatedUnion("format", [htmlScraperSchema, jsonScraperSchema]),
);

export const scrapeSchema = z
  .object({
    id: z.string().min(1),
    selector: z.string().min(1),
    many: z.boolean().optional().default(true),
    using: z.string().min(1),
  })
  .strict();

const TIMEOUT_PATTERN = /^([1-9]\d*)(ms|s|m)?$/;

export const timeoutToMs = (timeout: string | number): number => {
  const match = TIMEOUT_PATTERN.exec(String(timeout));
  if (!match) {
    throw new Error(`Invalid timeout "${timeout}"`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  if (unit === "ms") {
    return amount;
  }
  if (unit === "s") {
    return amount * 1000;
  }
  if (unit === "m") {
    return amount * 60_000;
  }
  throw new Error(`Invalid timeout "${timeout}"`);
};

export const requestSchema = z
  .object({
    url: z.string().min(1),
    method: z.enum(["GET", "POST", "PUT", "DELETE"]),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.unknown().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    timeout: z
      .union([
        z.number().int().min(1),
        z.string().regex(TIMEOUT_PATTERN, 'must be a duration like "5s"'),
      ])
      .optional(),
  })
  .strict();

export const primitiveInputTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "string[]",
  "number[]",
]);

export const recordFieldTypeSchema = z.enum(["string", "number", "boolean"]);

const primitiveInputSchema = z
  .object({
    type: primitiveInputTypeSchema,
    prompt: z.string().min(1).optional(),
  })
  .strict();

const fileInputSchema = z
  .object({
    file: z.string().min(1),
    key: z.string().min(1).optional(),
    fields: z.record(z.string().min(1), recordFieldTypeSchema),
  })
  .strict();

export const inputDeclarationSchema = z.preprocess(
  (value) => (typeof value === "string" ? { type: value } : value),
  z.union([primitiveInputSchema, fileInputSchema]),
);

const inputIdSchema = z.string().regex(/^[a-zA-Z_][\w-]*$/, "must be an interpolation path id");

export const workflowInputSchema = z.record(inputIdSchema, inputDeclarationSchema);

export const paginationSchema = z.discriminatedUnion("next", [
  z
    .object({
      next: z.literal("page"),
      start: z.number().optional().default(1),
      max: z.number().int().min(1),
      stop_when: z.array(z.enum(["empty_items"])).min(1),
    })
    .strict(),
  z
    .object({
      next: z.literal("cursor"),
      from: z.string().regex(/^[^.]+\.[^.]+$/, "must be scrapeId.field"),
      start: z.unknown().optional().default(null),
      max: z.number().int().min(1),
      stop_when: z.array(z.enum(["empty_items"])).min(1),
    })
    .strict(),
]);

export const stepSchema = z
  .object({
    id: z.string().min(1),
    each: z
      .string()
      .regex(/^input\.[a-zA-Z_][\w-]*$/, "must match input.<id>")
      .optional(),
    request: requestSchema,
    scrape: z.array(scrapeSchema).default([]),
    pagination: paginationSchema.optional(),
    output: z.string().min(1).optional(),
  })
  .strict();

export const workflowOutputSchema = z
  .object({
    "use-timestamps": z.boolean().optional().default(false),
  })
  .strict();

export const loggingLevelSchema = z.enum(["INFO", "DEBUG"]);

export const loggingSchema = z
  .object({
    level: loggingLevelSchema,
  })
  .strict();

export const dataSetSchema = z
  .object({
    name: z.string().min(1),
    steps: z.array(stepSchema).min(1),
  })
  .strict();

const reservedInterpIds = new Set(["input", "pagination", "request", "response"]);

export const workflowSchema = z
  .object({
    version: z.union([z.number(), z.string()]),
    name: z.string().min(1),
    description: z.string().optional(),
    input: workflowInputSchema.optional().default({}),
    scrapers: z.record(z.string(), scraperSchema),
    data: z.record(z.string(), dataSetSchema),
    output: workflowOutputSchema.optional(),
    logging: loggingSchema.optional(),
  })
  .strict()
  .superRefine((workflow, ctx) => {
    const scraperIds = new Set(Object.keys(workflow.scrapers));

    for (const [datasetId, dataset] of Object.entries(workflow.data)) {
      const stepIds = new Set<string>();

      for (const [stepIndex, step] of dataset.steps.entries()) {
        if (stepIds.has(step.id)) {
          ctx.addIssue({
            code: "custom",
            message: `duplicate step id "${step.id}"`,
            path: ["data", datasetId, "steps", stepIndex, "id"],
          });
        }
        stepIds.add(step.id);

        if (reservedInterpIds.has(step.id)) {
          ctx.addIssue({
            code: "custom",
            message: `reserved step id "${step.id}"`,
            path: ["data", datasetId, "steps", stepIndex, "id"],
          });
        }

        if (step.each) {
          const inputId = step.each.slice("input.".length);
          const declaration = workflow.input[inputId];
          if (!declaration) {
            ctx.addIssue({
              code: "custom",
              message: `each references unknown input "${inputId}"`,
              path: ["data", datasetId, "steps", stepIndex, "each"],
            });
          } else if (
            "type" in declaration &&
            declaration.type !== "string[]" &&
            declaration.type !== "number[]"
          ) {
            ctx.addIssue({
              code: "custom",
              message: `each input "${inputId}" must be a list`,
              path: ["data", datasetId, "steps", stepIndex, "each"],
            });
          }
        }

        const scrapeIds = new Set<string>();
        for (const [scrapeIndex, scrape] of step.scrape.entries()) {
          if (scrapeIds.has(scrape.id)) {
            ctx.addIssue({
              code: "custom",
              message: `duplicate scrape id "${scrape.id}"`,
              path: ["data", datasetId, "steps", stepIndex, "scrape", scrapeIndex, "id"],
            });
          }
          scrapeIds.add(scrape.id);
          if (reservedInterpIds.has(scrape.id)) {
            ctx.addIssue({
              code: "custom",
              message: `reserved scrape id "${scrape.id}"`,
              path: ["data", datasetId, "steps", stepIndex, "scrape", scrapeIndex, "id"],
            });
          }
          if (!scraperIds.has(scrape.using)) {
            ctx.addIssue({
              code: "custom",
              message: `unknown scraper "${scrape.using}"`,
              path: ["data", datasetId, "steps", stepIndex, "scrape", scrapeIndex, "using"],
            });
          }
        }

        if (step.pagination && step.scrape.length === 0) {
          ctx.addIssue({
            code: "custom",
            message: "pagination requires at least one scrape operation",
            path: ["data", datasetId, "steps", stepIndex, "pagination"],
          });
        } else if (step.pagination?.next === "cursor") {
          const [fromScrapeId] = step.pagination.from.split(".");
          if (!step.scrape.some((scrape) => scrape.id === fromScrapeId)) {
            ctx.addIssue({
              code: "custom",
              message: `pagination cursor references unknown scrape id "${fromScrapeId}"`,
              path: ["data", datasetId, "steps", stepIndex, "pagination", "from"],
            });
          }
        }
      }
    }
  });

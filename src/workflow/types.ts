import { z } from "zod";
import {
  dataSetSchema,
  inputDeclarationSchema,
  loggingLevelSchema,
  loggingSchema,
  paginationSchema,
  primitiveInputTypeSchema,
  recordFieldTypeSchema,
  scrapeSchema,
  scraperSchema,
  requestSchema,
  stepSchema,
  workflowInputSchema,
  workflowOutputSchema,
  workflowSchema,
} from "./schema.js";

export type DataSet = z.infer<typeof dataSetSchema>;
export type PrimitiveInputType = z.infer<typeof primitiveInputTypeSchema>;
export type RecordFieldType = z.infer<typeof recordFieldTypeSchema>;
export type InputDeclaration = z.infer<typeof inputDeclarationSchema>;
export type WorkflowInput = z.infer<typeof workflowInputSchema>;
export type Logging = z.infer<typeof loggingSchema>;
export type LoggingLevel = z.infer<typeof loggingLevelSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type Scrape = z.infer<typeof scrapeSchema>;
export type Scraper = z.infer<typeof scraperSchema>;
export type HtmlScraper = Extract<Scraper, { format: "html" }>;
export type JsonScraper = Extract<Scraper, { format: "json" }>;
export type Request = z.infer<typeof requestSchema>;
export type Step = z.infer<typeof stepSchema>;
export type WorkflowOutput = z.infer<typeof workflowOutputSchema>;
export type WorkflowSchema = z.infer<typeof workflowSchema>;

// custom type
export type WorkflowResult = {
  [datasetId: string]: {
    [scrapeId: string]: Record<string, unknown>[];
  };
};

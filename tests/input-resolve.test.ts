import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkflowValidationError } from "../src/error.js";
import { resolveInputs } from "../src/input/resolve.js";
import type { WorkflowInput } from "../src/workflow/types.js";

describe("resolveInputs", () => {
  it("splits and coerces a primitive number list from CLI values", async () => {
    const decls = {
      ids: { type: "number[]" },
    } satisfies WorkflowInput;

    await expect(
      resolveInputs({
        decls,
        workflowPath: "workflows/demo.yaml",
        cliValues: { ids: "1, 2, ,3" },
        readFile: () => {
          throw new Error("unexpected file read");
        },
      }),
    ).resolves.toEqual({ ids: [1, 2, 3] });
  });

  it("uses the declared prompt for a missing primitive", async () => {
    const messages: string[] = [];
    const decls = {
      active: { type: "boolean", prompt: "Is it active?" },
    } satisfies WorkflowInput;

    const inputs = await resolveInputs({
      decls,
      workflowPath: "workflows/demo.yaml",
      cliValues: {},
      readFile: () => {
        throw new Error("unexpected file read");
      },
      prompt: (message) => {
        messages.push(message);
        return "TRUE";
      },
    });

    expect(messages).toEqual(["Is it active?"]);
    expect(inputs).toEqual({ active: true });
  });

  it("builds the default prompt from the input id", async () => {
    const decls = {
      "top-pokemon-id": { type: "number" },
    } satisfies WorkflowInput;
    const messages: string[] = [];

    const inputs = await resolveInputs({
      decls,
      workflowPath: "workflows/demo.yaml",
      cliValues: {},
      readFile: () => "",
      prompt: (message) => {
        messages.push(message);
        return "25";
      },
    });

    expect(messages).toEqual(["Enter top-pokemon-id"]);
    expect(inputs).toEqual({ "top-pokemon-id": 25 });
  });

  it("loads a YAML array and ignores the declared key", async () => {
    const file = resolve(process.cwd(), "records.yaml");
    const decls = {
      pokemon: {
        file: "records.yaml",
        key: "ignored",
        fields: { id: "number", name: "string", active: "boolean" },
      },
    } satisfies WorkflowInput;

    const inputs = await resolveInputs({
      decls,
      workflowPath: "workflows/demo.yaml",
      cliValues: {},
      readFile: (path) => {
        if (path === file) {
          return "- id: '1'\n  name: Bulbasaur\n  active: TRUE\n  extra: kept\n";
        }
        throw new Error(`missing ${path}`);
      },
    });

    expect(inputs.pokemon).toEqual([{ id: 1, name: "Bulbasaur", active: true, extra: "kept" }]);
  });

  it("loads a mapping key relative to the workflow after the cwd path is missing", async () => {
    const workflowPath = resolve("/tmp/yap-workflows", "demo.yaml");
    const expectedPath = resolve("/tmp/yap-workflows", "records.yaml");
    const decls = {
      pokemon: {
        file: "records.yaml",
        key: "my-pokemon",
        fields: { id: "number", name: "string" },
      },
    } satisfies WorkflowInput;

    const inputs = await resolveInputs({
      decls,
      workflowPath,
      cliValues: {},
      readFile: (path) => {
        if (path === expectedPath) {
          return "my-pokemon:\n  - id: 2\n    name: Ivysaur\n";
        }
        throw new Error(`missing ${path}`);
      },
    });

    expect(inputs.pokemon).toEqual([{ id: 2, name: "Ivysaur" }]);
  });

  it("fails when a primitive is missing and no prompt is available", async () => {
    const decls = {
      id: { type: "number" },
    } satisfies WorkflowInput;

    await expect(
      resolveInputs({
        decls,
        workflowPath: "workflows/demo.yaml",
        cliValues: {},
        readFile: () => "",
      }),
    ).rejects.toBeInstanceOf(WorkflowValidationError);
  });

  it("fails when a file record omits a declared field", async () => {
    const decls = {
      pokemon: {
        file: "records.yaml",
        fields: { id: "number", name: "string" },
      },
    } satisfies WorkflowInput;

    await expect(
      resolveInputs({
        decls,
        workflowPath: "workflows/demo.yaml",
        cliValues: {},
        readFile: () => "- id: 1\n",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('missing field "name"'),
    });
  });
});

import { describe, expect, it } from "vitest";
import { WorkFlowValidationError } from "../src/error.js";
import { parseInputArgs } from "../src/input/argv.js";

describe("parseInputArgs", () => {
  it("parses repeated input flags and keeps the last value", () => {
    expect(
      parseInputArgs(["--input", "ids=1,2", "--input", "token=abc=123", "--input", "ids=3,4"]),
    ).toEqual({
      ids: "3,4",
      token: "abc=123",
    });
  });

  it("rejects malformed input flags", () => {
    expect(() => parseInputArgs(["--input", "ids"])).toThrow(WorkFlowValidationError);
    expect(() => parseInputArgs(["--unknown", "ids=1"])).toThrow(WorkFlowValidationError);
  });
});

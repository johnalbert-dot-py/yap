import { WorkflowValidationError } from "../error.js";

export const parseInputArgs = (args: string[]): Record<string, string> => {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag !== "--input") {
      throw new WorkflowValidationError({ message: `Unknown run option "${flag}"` });
    }
    const assignment = args[++index];
    const separator = assignment?.indexOf("=") ?? -1;
    if (!assignment || separator < 1) {
      throw new WorkflowValidationError({
        message: '--input must use the form "--input name=value"',
      });
    }
    const name = assignment.slice(0, separator).trim();
    if (!name) {
      throw new WorkflowValidationError({ message: "Input name cannot be empty" });
    }
    values[name] = assignment.slice(separator + 1);
  }
  return values;
};

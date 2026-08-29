import type { Writable } from "node:stream";
import { spinner } from "@clack/prompts";
import type { StepProgress } from "../runtime/execute.js";

const formatTick = (event: StepProgress): string => `${event.percent}%  ${event.label}`;

export const createProgressSpinner = (output?: Writable) => {
  const spin = spinner(output ? { output } : {});
  let stopped = false;
  const stopError = (message: string) => {
    if (stopped) {
      return;
    }
    stopped = true;
    spin.error(message);
  };
  const onProgress = (event: StepProgress): void => {
    switch (event.status) {
      case "start":
        spin.start(formatTick(event));
        return;
      case "tick":
        spin.message(formatTick(event));
        return;
      case "done":
        stopped = true;
        spin.stop(`Done "${event.stepId}"`);
        return;
      case "error":
        stopError(`Failed "${event.stepId}"`);
        return;
      default: {
        const _exhaustive: never = event.status;
        return _exhaustive;
      }
    }
  };
  return {
    onProgress,
    fail(message: string): void {
      stopError(message);
    },
  };
};

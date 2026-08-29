export class WorkflowValidationError extends Error {
  constructor({ message }: { message: string }) {
    super(message);
    this.name = "WorkflowValidationError";
  }
}

export class HttpTransportError extends Error {
  readonly url: string;
  readonly status: number;

  constructor({ message, url, status }: { message: string; url: string; status: number }) {
    super(message);
    this.name = "HttpTransportError";
    this.url = url;
    this.status = status;
  }
}

export class StepExecutionError extends Error {
  readonly stepId: string;
  readonly url: string;
  readonly status?: number;

  constructor({
    message,
    stepId,
    url,
    status,
  }: {
    message: string;
    stepId: string;
    url: string;
    status?: number;
  }) {
    super(message);
    this.name = "StepExecutionError";
    this.stepId = stepId;
    this.url = url;
    this.status = status;
  }
}

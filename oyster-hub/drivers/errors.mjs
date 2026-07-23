export class WorkspaceDriverError extends Error {
  constructor(message, { status = 502, cause } = {}) {
    super(message, { cause });
    this.name = "WorkspaceDriverError";
    this.status = status;
  }
}

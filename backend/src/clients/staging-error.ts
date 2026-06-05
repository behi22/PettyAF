export class StagingError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'StagingError';
    this.status = status;
  }
}

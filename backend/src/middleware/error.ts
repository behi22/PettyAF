import type { Request, Response, NextFunction } from 'express';
import { StagingError } from '../clients/staging-error';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  const status =
    err instanceof StagingError || err instanceof ApiError ? err.status : err?.status || 500;
  const message = err?.message || 'Internal error';
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: message });
}

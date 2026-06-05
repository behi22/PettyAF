import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Forwards async route errors to the Express error handler.
export const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

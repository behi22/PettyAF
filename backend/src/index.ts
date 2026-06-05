import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { staging } from './clients/stagingClient';
import { requestLog } from './middleware/requestLog';
import { errorHandler, notFound } from './middleware/error';
import { isDialingEnabled } from './engine/campaignEngine';
import campaigns from './routes/campaigns.routes';
import cases from './routes/cases.routes';
import live from './routes/live.routes';
import dashboard from './routes/dashboard.routes';

async function main(): Promise<void> {
  await staging.init(); // login at boot

  const app = express();
  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json({ limit: '1mb' }));
  app.use(requestLog);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, dialingEnabled: isDialingEnabled(), time: new Date().toISOString() });
  });
  app.use('/api/campaigns', campaigns);
  app.use('/api/cases', cases);
  app.use('/api/live', live);
  app.use('/api/dashboard', dashboard);

  app.use(notFound);
  app.use(errorHandler);

  app.listen(env.port, () => {
    console.log(
      `[pettyaf] backend listening on http://localhost:${env.port} (dialing ${
        env.dialingEnabled ? 'ENABLED' : 'DISABLED'
      })`,
    );
  });
}

main().catch((e) => {
  console.error('[pettyaf] fatal startup error', e);
  process.exit(1);
});

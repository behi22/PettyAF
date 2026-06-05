import { Router } from 'express';
import { wrap } from './wrap';
import { env } from '../config/env';
import * as cases from '../services/cases';
import { manualDeploy, setCaseRelentless } from '../engine/campaignEngine';

const r = Router();

r.get(
  '/',
  wrap(async (req, res) => {
    const campaignId = req.query.campaignId as string | undefined;
    const q = `?source=PettyAF&limit=100${campaignId ? `&campaignId=${campaignId}` : ''}`;
    res.json(await cases.listCases(q));
  }),
);

r.post('/', wrap(async (req, res) => res.status(201).json(await cases.createCase(req.body))));
r.get('/:id', wrap(async (req, res) => res.json(await cases.getCase(req.params.id))));
r.get(
  '/:id/result',
  wrap(async (req, res) => {
    const result = await cases.buildLastCall(req.params.id);
    res.json(result ?? { phase: 'pending' });
  }),
);

r.patch(
  '/:id',
  wrap(async (req, res) => {
    const status = req.body?.status;
    if (!status) {
      res.status(400).json({ error: 'status is required' });
      return;
    }
    res.json(await cases.patchStatus(req.params.id, status));
  }),
);

// The main.md single-case demo spine. Honors the DIALING_ENABLED safety rail.
r.post(
  '/:id/deploy',
  wrap(async (req, res) => {
    const callId = await manualDeploy(req.params.id);
    res.json({ callId: callId ?? null, dialingEnabled: env.dialingEnabled });
  }),
);

// Per-case relentless toggle (main.md 7.5).
r.post(
  '/:id/relentless',
  wrap(async (req, res) => {
    const enabled = req.body?.enabled !== false;
    res.json(await setCaseRelentless(req.params.id, enabled));
  }),
);

export default r;

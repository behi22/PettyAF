import { Router } from 'express';
import { wrap } from './wrap';
import * as svc from '../services/campaigns';

const r = Router();

r.get('/', wrap(async (_req, res) => res.json(await svc.listCampaigns())));
r.post('/', wrap(async (req, res) => res.status(201).json(await svc.createCampaign(req.body))));
r.get('/:id', wrap(async (req, res) => res.json(await svc.getCampaign(req.params.id))));
r.patch('/:id', wrap(async (req, res) => res.json(await svc.updateCampaign(req.params.id, req.body))));

r.post(
  '/:id/leads',
  wrap(async (req, res) => {
    const body = req.body;
    const leads = Array.isArray(body) ? body : Array.isArray(body?.leads) ? body.leads : [body];
    res.status(201).json(await svc.addLeads(req.params.id, leads));
  }),
);

r.post('/:id/start', wrap(async (req, res) => res.json(await svc.start(req.params.id))));
r.post('/:id/pause', wrap(async (req, res) => res.json(svc.pause(req.params.id))));
r.delete('/:id', wrap(async (req, res) => res.json(await svc.cancel(req.params.id))));

export default r;

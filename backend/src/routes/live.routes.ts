import { Router } from 'express';
import { liveRegistry } from '../engine/liveRegistry';
import { getQueued, isStopped, pauseCampaign, stopAll } from '../engine/campaignEngine';

const r = Router();

// Snapshot of all live calls now. FE polls this every 2s (no SSE for MVP).
r.get('/', (_req, res) => {
  const calls = liveRegistry.all();
  const byCampaign: Record<string, number> = {};
  for (const c of calls) {
    const k = c.campaignId || 'manual';
    byCampaign[k] = (byCampaign[k] || 0) + 1;
  }
  res.json({ liveNow: calls.length, byCampaign, calls, stopped: isStopped(), queued: getQueued() });
});

// Focused "listen in" view for one call.
r.get('/:callId', (req, res) => {
  const c = liveRegistry.get(req.params.callId);
  if (!c) {
    res.status(404).json({ error: 'No such live call (it may have ended)' });
    return;
  }
  res.json(c);
});

// Emergency stop. Global by default; pass { campaignId } to scope to one campaign.
// Stops all new dialing instantly; connected calls finish on their own.
r.post('/stop', (req, res) => {
  const campaignId = req.body?.campaignId as string | undefined;
  if (campaignId) {
    pauseCampaign(campaignId);
    res.json({ ok: true, stopped: campaignId });
    return;
  }
  stopAll();
  res.json({ ok: true, stopped: 'all' });
});

export default r;

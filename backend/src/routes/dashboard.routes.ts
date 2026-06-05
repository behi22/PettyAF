import { Router } from 'express';
import { wrap } from './wrap';
import { getDashboard } from '../services/dashboard';

const r = Router();

r.get('/', wrap(async (_req, res) => res.json(await getDashboard())));

export default r;

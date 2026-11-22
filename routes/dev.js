import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, httpError } from '../middleware/errorHandler.js';
import { adminKeyRequired, requireAdminKey } from '../middleware/adminKey.js';
import {
  cancelJob,
  createJob,
  devAgentEnabled,
  devDeployMode,
  getJob,
  listJobs,
} from '../services/devAgent.js';

const router = Router();

const jobSchema = z.object({ prompt: z.string().trim().min(5).max(2000) });

// Open endpoint so the page can show "disabled" / "needs key" before asking for anything
router.get('/status', (_req, res) => {
  res.json({ enabled: devAgentEnabled(), keyRequired: adminKeyRequired(), deploy: devDeployMode() });
});

router.use(requireAdminKey);
router.use((_req, _res, next) => {
  if (!devAgentEnabled()) return next(httpError('Dev agent is disabled (set DEV_AGENT_ENABLED=true)', 503));
  next();
});

router.get('/jobs', (_req, res) => res.json({ success: true, data: listJobs() }));

router.post(
  '/jobs',
  asyncHandler(async (req, res) => {
    const parsed = jobSchema.safeParse(req.body);
    if (!parsed.success) throw httpError('prompt must be 5-2000 characters', 400);
    res.status(202).json({ success: true, data: createJob(parsed.data.prompt) });
  })
);

router.get('/jobs/:id', (req, res, next) => {
  const job = getJob(req.params.id);
  if (!job) return next(httpError('Job not found', 404));
  res.json({ success: true, data: job });
});

router.post('/jobs/:id/cancel', (req, res, next) => {
  const job = cancelJob(req.params.id);
  if (!job) return next(httpError('Job not found', 404));
  res.json({ success: true, data: job });
});

export default router;

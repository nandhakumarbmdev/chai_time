import { Router } from 'express';
import { getToday, getTally, getHistory } from '../controllers/sessionController.js';

const router = Router();

router.get('/today', getToday);
router.get('/tally', getTally);
router.get('/history', getHistory);

export default router;


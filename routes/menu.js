import { Router } from 'express';
import { listMenu } from '../controllers/menuController.js';

const router = Router();

router.get('/', listMenu);

export default router;


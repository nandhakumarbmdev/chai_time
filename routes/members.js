import { Router } from 'express';
import { listMembers, createMember } from '../controllers/memberController.js';

const router = Router();

router.get('/', listMembers);
router.post('/', createMember);

export default router;


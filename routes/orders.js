import { Router } from 'express';
import {
  placeOrder,
  skipOrder,
  cancelOrder,
  getYesterday,
} from '../controllers/orderController.js';

const router = Router();

router.post('/', placeOrder);
router.post('/skip', skipOrder);
router.delete('/my-order', cancelOrder);
router.get('/yesterday', getYesterday);

export default router;


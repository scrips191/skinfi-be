import { Router } from 'express';

import authRoutes from './auth';
import userRoutes from './user';
import inventoryRoutes from './inventory';
import listingRoutes from './listing';
import tradeRoutes from './trade';
import priceRoutes from './price';
import blockchainRoutes from './blockchain';
import adminRoutes from './admin';

import { verifyRequest, verifyScheduler, verifyAdmin } from '../middlewares/auth';

const router = Router();

router.use('/auth', authRoutes);
router.use('/user', verifyRequest(false), userRoutes);
router.use('/inventory', verifyRequest(false), inventoryRoutes);
router.use('/listing', verifyRequest(false), listingRoutes);
router.use('/trade', verifyRequest(false), tradeRoutes);
router.use('/price', verifyScheduler, priceRoutes);
router.use('/blockchain', verifyScheduler, blockchainRoutes);
router.use('/admin', verifyRequest(false), verifyAdmin, adminRoutes);

export default router;

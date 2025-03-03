import { Router, Request, Response } from 'express';

import { CustomError } from '../models/error';
import { asyncHandler } from '../middlewares/error';
import { ItemPrice } from '../models/db/item-price';
import priceEmpireService from '../services/price-empire';

const router = Router();

router.post(
    '/refresh',
    asyncHandler(async (req: Request, res: Response) => {
        // TODO: Rate limit this endpoint
        const prices = await priceEmpireService.fetchPrices(730);
        if (!prices) throw new CustomError('Failed to fetch prices', 500);

        // TODO: Update prices instead of deleting all
        await ItemPrice.deleteMany({ appId: 730 });
        await ItemPrice.insertMany(prices);

        res.send(`Fetched ${prices.length} prices`);
    }),
);

export default router;

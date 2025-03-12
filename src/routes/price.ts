import { Router, Request, Response } from 'express';

import { CustomError } from '../models/error';
import { asyncHandler } from '../middlewares/error';
import { ItemPrice } from '../models/db/item-price';
import priceEmpireService from '../services/price-empire';

const router = Router();

router.post(
    '/refresh',
    asyncHandler(async (req: Request, res: Response) => {
        const prices = await priceEmpireService.fetchPrices(730);
        if (!prices || prices.length === 0) throw new CustomError('Cannot refresh prices', 500);

        await ItemPrice.updateMany({ appId: 730 }, { $set: { deleted: true } });
        await ItemPrice.insertMany(prices);
        await ItemPrice.deleteMany({ deleted: true, appId: 730 });

        res.send(`Fetched ${prices.length} prices`);
    }),
);

export default router;

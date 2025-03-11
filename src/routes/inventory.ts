import { Router, Response } from 'express';
import { query } from 'express-validator';
import { RootFilterQuery } from 'mongoose';

import inventoryService from '../services/inventory';
import { asyncHandler } from '../middlewares/error';
import { validate } from '../middlewares/validation';

import { IItem, Item } from '../models/db/item';
import { User } from '../models/db/user';
import { AuthRequest } from '../models/auth';
import { CustomError } from '../models/error';
import { Listing, ListingState } from '../models/db/listing';

const router = Router();

router.get(
    '/',
    validate(
        query('page').isInt({ min: 1 }),
        query('perPage').isInt({ min: 10, max: 200 }),
        query('sort').isIn([1, -1]).optional(),
        query('order').isIn(['createdAt', 'price', 'percentage']).optional(),
        query('search').matches(new RegExp('^[a-zA-Z0-9\\s-]+$')).optional(),
    ),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { page, perPage, sort, search, order }: { [x: string]: any } = req.query;

        const words: string[] =
            search
                ?.split(' ')
                .map((word: string) => word.trim())
                .filter((word: string) => word.length > 0) || [];

        let sortBy: { [field: string]: number } = {};
        if (order !== 'createdAt') {
            sortBy[`${order || 'price'}`] = Number(sort) || -1;
            sortBy = { ...sortBy, _id: -1 };
        } else sortBy = { _id: Number(sort) || -1 };

        const filter: RootFilterQuery<IItem> = {
            ownerId: req.user.id,
        };

        if (words.length > 0) {
            filter.$and = words.map(word => ({
                marketName: { $regex: `${word}`, $options: 'i' },
            }));
        }

        // TODO: Filter return fields
        const inventory = await Item.find(filter, '-assetId', {
            skip: (page - 1) * perPage,
            limit: perPage,
            sort: sortBy,
        }).populate('listed');

        res.json(inventory);
    }),
);

router.post(
    '/refresh',
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const user = await User.findById(req.user.id);
        if (!user) throw new CustomError('User not found', 404);

        if (user.invRefreshCooldown.getTime() > Date.now())
            throw new CustomError('Inventory cooldown not expired', 400);
        user.invRefreshCooldown = new Date(Date.now() + 60_000); // 1 minute

        // Save user with new cooldown
        await user.save();

        const inventory = await inventoryService.getInventory(user.steamId, 730);
        const items = inventory.map((item: any) => ({ ...item, ownerId: user.id }));
        const assetIds = inventory.map((x: any) => x.assetId);

        await Item.deleteMany({ ownerId: user.id, appId: 730, assetId: { $nin: assetIds } });
        await Item.bulkWrite(
            items.map((item: any) => ({
                updateOne: {
                    filter: { ownerId: user.id, appId: 730, assetId: item.assetId },
                    update: { $set: item },
                    upsert: true,
                },
            })),
        );

        await Listing.updateMany(
            {
                seller: user.id,
                'item.appId': 730,
                'item.assetId': { $nin: assetIds },
                state: ListingState.ACTIVE,
            },
            { state: ListingState.CANCELED },
        );

        res.json({ newCooldown: user.invRefreshCooldown });
    }),
);

export default router;

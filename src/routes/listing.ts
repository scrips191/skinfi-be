import { Router, Response } from 'express';
import { body, param, query } from 'express-validator';
import { RootFilterQuery } from 'mongoose';

import socketService from '../services/socket';
import { asyncHandler } from '../middlewares/error';
import { validate } from '../middlewares/validation';

import { CustomError } from '../models/error';
import { Item } from '../models/db/item';
import { IListing, Listing, ListingState } from '../models/db/listing';
import { Token } from '../models/db/token';
import { AuthRequest } from '../models/auth';

const router = Router();

router.post(
    '/',
    validate(
        body('itemId').isMongoId(),
        body('price').isInt({ min: 1, max: 1_000_000_000 }),
        body('type').isIn(['sell', 'lend']),
        body('minWeek').isInt({ min: 2, max: 52 }).optional(),
        body('maxWeek').isInt({ min: 2, max: 52 }).optional(),
        body('weeklyPrice').isInt({ min: 1, max: 100_000_000 }).optional(),
        body('hidden').isBoolean(),
        body('token').notEmpty(),
    ),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { itemId, price, hidden, token, type } = req.body;
        const { minWeek, maxWeek, weeklyPrice } = req.body;

        const item = await Item.findOne({ _id: itemId, ownerId: req.user.id }).populate('listed');
        if (!item || item.listed || !item.tradable) throw new CustomError('Item not found', 404);
        if (!item.price || item.price < 10) throw new CustomError('Not accepted', 400);

        let lend = undefined;
        if (type === 'lend') {
            if (item.price < 50_00) throw new CustomError('Not accepted', 400);
            if (!item.lendable) throw new CustomError('Item not lendable', 400);
            if (!minWeek || !maxWeek || !weeklyPrice) throw new CustomError('Invalid lend data', 400);
            if (minWeek > maxWeek) throw new CustomError('Invalid week range', 400);
            lend = { minWeek, maxWeek, weeklyPrice };
        }

        let percentage = 0;
        if (item.price) percentage = Number(((100 * (price - item.price!)) / item.price!).toFixed(2));

        const tokenExists = await Token.exists({ symbol: token });
        if (!tokenExists) throw new CustomError('Unsupported token', 400);

        const listing = await Listing.create({
            type,
            seller: req.user.id,
            token,
            price,
            lend,
            percentage,
            hidden,
            state: ListingState.ACTIVE,
            item,
        });

        //  TODO: Filter returned fields
        if (!hidden) socketService.emit('listing-created', { ...listing.toJSON(), sellerOnline: true });

        res.json(listing);
    }),
);

router.get(
    '/list',
    validate(
        query('type').isIn(['sell', 'lend']),
        query('page').isInt({ min: 1 }),
        query('perPage').isInt({ min: 10, max: 200 }),
        query('sort').isIn([1, -1]).optional(),
        query('order').isIn(['createdAt', 'price', 'percentage']).optional(),
        query('search').matches(new RegExp('^[a-zA-Z0-9\\s-]+$')).optional(),
        query('minPrice').isInt().optional(),
        query('maxPrice').isInt().optional(),
    ),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { page, perPage, sort, order, search, minPrice, maxPrice, type }: { [x: string]: any } = req.query;

        const words: string[] =
            search
                ?.split(' ')
                .map((word: string) => word.trim())
                .filter((word: string) => word.length > 0) || [];

        let sortBy: { [field: string]: number } = {};
        sortBy[`${order || 'price'}`] = Number(sort) || -1;
        sortBy = { ...sortBy, _id: -1 };

        const filter: RootFilterQuery<IListing> = {
            state: ListingState.ACTIVE,
            type,
            hidden: false,
        };

        if (minPrice) {
            filter.price = { $gte: minPrice };
        }

        if (maxPrice) {
            filter.price = { ...filter.price, $lte: maxPrice };
        }

        if (words.length > 0) {
            filter.$and = words.map(word => ({
                'item.marketName': { $regex: `${word}`, $options: 'i' },
            }));
        }

        const listings = await Listing.find(filter, '-item.assetId -_id -__v', {
            skip: (page - 1) * perPage,
            limit: perPage,
            sort: sortBy,
        })
            .populate('sellerOnline')
            .populate('seller', 'steamLevel steamJoinDate')
            .populate('sellerHasTelegram');

        res.send(listings);
    }),
);

router.get(
    '/my',
    validate(query('page').isInt({ min: 1 }), query('perPage').isInt({ min: 10, max: 200 })),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { page, perPage }: { [x: string]: any } = req.query;

        const listings = await Listing.find(
            {
                seller: req.user.id,
            },
            '-item.assetId -__v -_id',
            {
                skip: (page - 1) * perPage,
                limit: perPage,
                sort: { createdAt: -1 },
            },
        ).populate({ path: 'trade', select: '-logs' });

        res.json(listings);
    }),
);

router.get(
    '/:id',
    validate(param('id').isUUID()),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { id } = req.params;

        const listing = await Listing.findOne({ id }, '-_id -__v')
            .populate('seller', 'steamLevel steamJoinDate')
            .populate('sellerHasTelegram');

        if (!listing) throw new CustomError('Listing not found', 404);

        res.json(listing);
    }),
);

router.delete(
    '/:id',
    validate(param('id').isUUID()),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { id } = req.params;
        const listing = await Listing.findOne({ id });

        if (!listing) throw new CustomError('Listing not found', 404);
        if (listing.seller.toString() !== req.user.id) throw new CustomError('Listing not found', 404);
        if (listing.state !== ListingState.ACTIVE) throw new CustomError('Listing not active', 400);

        listing.state = ListingState.CANCELED;
        await listing.save();

        socketService.emit('listing-deleted', { id: listing.id });
        res.json(listing);
    }),
);

export default router;

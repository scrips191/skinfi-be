import { Router, Response, Request } from 'express';
import { body, param, query } from 'express-validator';
import { RootFilterQuery } from 'mongoose';

import socketService from '../services/socket';
import { CustomError } from '../models/error';
import { asyncHandler } from '../middlewares/error';
import { validate } from '../middlewares/validation';
import { Listing, ListingState } from '../models/db/listing';
import { ITrade, Trade, TradeState } from '../models/db/trade';
import { AuthRequest } from '../models/auth';

const router = Router();

// update trade state
router.post(
    '/trade/:id',
    validate(param('id').isUUID(), body('releaseTo').isIn(['buyer', 'seller'])),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const tradeId = req.params.id;
        const { releaseTo } = req.body;

        const trade = await Trade.findOne({ id: tradeId, state: [TradeState.DISPUTE1, TradeState.DISPUTE2] });
        if (!trade) throw new CustomError('Invalid trade', 404);

        if (trade.type === 'sell') {
            if (trade.state === TradeState.DISPUTE1) {
                if (releaseTo === 'buyer') {
                    trade.state = TradeState.CAN_WITHDRAW;
                } else {
                    trade.state = TradeState.CAN_RELEASE;
                }
            } else {
                throw new CustomError('Invalid trade state', 400);
            }
        } else {
            if (trade.state === TradeState.DISPUTE1) {
                if (releaseTo === 'buyer') {
                    trade.state = TradeState.CAN_WITHDRAW;
                } else {
                    trade.state = TradeState.CAN_RELEASE;
                }
            } else {
                if (releaseTo === 'buyer') {
                    trade.state = TradeState.CAN_RECLAIM;
                } else {
                    trade.state = TradeState.CAN_SEIZE;
                }
            }
        }

        const logs = trade.logs || [];
        logs.push({
            initiator: 'admin',
            state: trade.state,
            createdAt: new Date(),
        });
        trade.logs = logs;
        await trade.save();

        await Listing.updateOne({ id: trade.listingId }, { state: ListingState.CANCELED });

        socketService.emit('trade-updated', trade.toJSON(), trade.buyer);
        socketService.emit('trade-updated', trade.toJSON(), trade.seller);

        res.json(trade);
    }),
);

// get disputed trades
router.get(
    '/trade/list',
    validate(query('page').isInt({ min: 1 }), query('perPage').isInt({ min: 10, max: 200 })),
    asyncHandler(async (req: Request, res: Response) => {
        const { page, perPage }: { [x: string]: any } = req.query;

        const filter: RootFilterQuery<ITrade> = {
            state: [TradeState.DISPUTE1, TradeState.DISPUTE2],
        };

        // TODO: Filter returned fields
        const trades = await Trade.find(filter, '-_id -__v')
            .sort({ updatedAt: -1, _id: 1 })
            .skip((page - 1) * perPage)
            .limit(perPage)
            .populate('buyer')
            .populate('seller')
            .populate('listing');

        res.json(trades);
    }),
);

export default router;

import { Router, Response } from 'express';
import { body, param, query } from 'express-validator';
import mongoose, { RootFilterQuery } from 'mongoose';

import socketService from '../services/socket';
import web3Service from '../services/web3';
import { centsToToken } from '../utils/helper';
import { uuidToBigInt } from '../utils/helper';

import { CustomError } from '../models/error';
import { asyncHandler } from '../middlewares/error';
import { validate } from '../middlewares/validation';
import { Item } from '../models/db/item';
import { Listing, ListingState } from '../models/db/listing';
import { ITrade, Trade, TradeState } from '../models/db/trade';
import { Token } from '../models/db/token';
import { AuthRequest } from '../models/auth';
import { Config } from '../models/db/config';
import { User } from '../models/db/user';

const router = Router();

const hours = 60 * 60 * 1000;
const acceptTradeDuration = 12 * hours;
const returnItemExtension = 24 * hours;

router.post(
    '/',
    validate(body('listingId').isUUID(), body('weeks').isInt({ min: 2 }).optional()),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { listingId, weeks } = req.body;

        const listing = await Listing.findOne({ id: listingId });
        if (!listing) throw new CustomError('Listing not found', 404);
        if (listing.state !== ListingState.ACTIVE) throw new CustomError('Listing not active', 400);
        if (listing.seller === req.user.id) throw new CustomError('Invalid trade', 400);

        let fee, rent;
        const isLending = listing.type === 'lend';
        if (isLending) {
            if (!listing.lend) throw new CustomError('Invalid listing', 400);
            if (!weeks || weeks < listing.lend.minWeek || weeks > listing.lend.maxWeek)
                throw new CustomError('Invalid weeks', 400);

            const feeConfig = await Config.findOne({ key: 'rentFee' });
            const feePercentage = Number(feeConfig?.value) || 0;

            rent = listing.lend.weeklyPrice * weeks;
            fee = Math.floor((rent * feePercentage) / 100);
        }

        // check if the seller still has the item
        const item = await Item.findOne({ _id: listing.item._id, ownerId: listing.seller });
        if (!item) throw new CustomError('Item not found', 404);

        const trade = await Trade.findOneAndUpdate(
            { listingId, state: TradeState.CREATED, buyer: req.user.id },
            {
                listingId,
                buyer: req.user.id,
                seller: listing.seller,
                type: listing.type,
                deadline: new Date(Date.now() + 24 * hours),
                weeks: isLending ? weeks : undefined,
                rent,
                fee,
                state: TradeState.CREATED,
            },
            {
                new: true,
                upsert: true,
            },
        );

        res.json(trade);
    }),
);

// update trade state
router.post(
    '/:id',
    validate(param('id').isUUID(), body('action').isIn(['confirm', 'reject'])),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const tradeId = req.params.id;
        const { action } = req.body;

        const trade = await Trade.findOne({ id: tradeId });
        if (!trade) throw new CustomError('Invalid trade', 404);

        const isBuyer = trade.buyer === req.user.id; // buyer/borrower user id
        const isSeller = trade.seller === req.user.id; // seller/lender user id

        if (!isBuyer && !isSeller) throw new CustomError('Invalid trade', 404);

        let newListingState: ListingState | undefined;

        if (trade.type === 'sell') {
            switch (trade.state) {
                case TradeState.DEPOSITED:
                    if (isBuyer) {
                        // buyer can withdraw after deadline,
                        if (action !== 'reject') throw new CustomError('Invalid action', 400);
                        if (trade.deadline.getTime() > Date.now()) throw new CustomError('Deadline not reached', 400);

                        trade.state = TradeState.CAN_WITHDRAW;
                        newListingState = ListingState.CANCELED;
                    } else {
                        // seller can confirm the trade or cancel
                        if (action === 'confirm') {
                            trade.state = TradeState.TRADE_SENT;
                            trade.deadline = new Date(Date.now() + acceptTradeDuration);
                        } else {
                            trade.state = TradeState.CAN_WITHDRAW;
                            newListingState = ListingState.CANCELED;
                        }
                    }
                    break;
                case TradeState.TRADE_SENT:
                    if (isBuyer) {
                        // buyer can confirm the trade or reject and dispute
                        if (action === 'confirm') {
                            trade.state = TradeState.CAN_RELEASE;
                            newListingState = ListingState.COMPLETED;
                        } else {
                            trade.state = TradeState.DISPUTE1;
                        }
                    } else {
                        // seller can confirm buyer get the item after deadline and go for the dispute
                        // or can reject and let the buyer withdraw
                        if (trade.deadline.getTime() > Date.now()) throw new CustomError('Deadline not reached', 400);

                        if (action === 'confirm') {
                            trade.state = TradeState.DISPUTE1;
                        } else {
                            trade.state = TradeState.CAN_WITHDRAW;
                            // TODO: decide active or canceled
                            newListingState = ListingState.ACTIVE;
                        }
                    }
                    break;
                default:
                    throw new CustomError('Invalid trade', 404);
            }
        } else {
            switch (trade.state) {
                case TradeState.DEPOSITED:
                    if (isBuyer) {
                        // borrower can withdraw after deadline,
                        if (action !== 'reject') throw new CustomError('Invalid action', 400);
                        if (trade.deadline.getTime() > Date.now()) throw new CustomError('Deadline not reached', 400);

                        trade.state = TradeState.CAN_WITHDRAW;
                        newListingState = ListingState.CANCELED;
                    } else {
                        // lender can confirm the trade or cancel
                        if (action === 'confirm') {
                            trade.state = TradeState.TRADE_SENT;
                            trade.deadline = new Date(Date.now() + acceptTradeDuration);
                        } else {
                            trade.state = TradeState.CAN_WITHDRAW;
                            newListingState = ListingState.CANCELED;
                        }
                    }
                    break;
                case TradeState.TRADE_SENT:
                    if (isBuyer) {
                        // borrower can confirm the trade and start lending period or reject and dispute
                        if (action === 'confirm') {
                            trade.state = TradeState.PERIOD_STARTED;
                            trade.rentClaimable = true;
                            if (trade.fee) trade.feeClaimable = true;
                            trade.deadline = new Date(
                                Date.now() + (trade.weeks as number) * 7 * 24 * hours + returnItemExtension,
                            );
                        } else {
                            trade.state = TradeState.DISPUTE1;
                        }
                    } else {
                        // lender can confirm buyer get the item after deadline and go for the dispute
                        // or can reject and let the buyer withdraw
                        if (trade.deadline.getTime() > Date.now()) throw new CustomError('Deadline not reached', 400);

                        if (action === 'confirm') {
                            trade.state = TradeState.DISPUTE1;
                        } else {
                            trade.state = TradeState.CAN_WITHDRAW;
                            // TODO: decide active or canceled
                            newListingState = ListingState.ACTIVE;
                        }
                    }
                    break;
                case TradeState.PERIOD_STARTED:
                    // check deadline
                    if (isBuyer) {
                        // borrower can return the item
                        if (action !== 'confirm') throw new CustomError('Invalid action', 400);
                        trade.state = TradeState.RETURN_TRADE_SENT;
                        trade.deadline = new Date(Date.now() + acceptTradeDuration);
                    } else {
                        // lender can claim collateral after deadline
                        if (trade.deadline.getTime() > Date.now()) throw new CustomError('Deadline not reached', 400);
                        trade.state = TradeState.CAN_SEIZE;
                        newListingState = ListingState.CANCELED;
                        // TODO: think about listing state
                    }
                    break;
                case TradeState.RETURN_TRADE_SENT:
                    if (isBuyer) {
                        // borrower can go for dispute after deadline
                        if (action !== 'confirm') throw new CustomError('Invalid action', 400);
                        if (trade.deadline.getTime() > Date.now()) throw new CustomError('Deadline not reached', 400);
                        trade.state = TradeState.DISPUTE2;
                    } else {
                        // lender can confirm or reject the return
                        if (action === 'confirm') {
                            trade.state = TradeState.CAN_RECLAIM;
                            newListingState = ListingState.COMPLETED;
                        } else {
                            trade.state = TradeState.DISPUTE2;
                        }
                    }
                    break;
                default:
                    throw new CustomError('Invalid trade', 404);
            }
        }

        if (newListingState) {
            const listing = await Listing.findOne({ id: trade.listingId });
            if (!listing) throw new CustomError('Invalid Listing', 400);

            listing.state = newListingState;
            await listing.save();
            // socketService.emit('listing-updated', trade, trade.seller);
        }

        const logs = trade.logs || [];
        logs.push({
            initiator: isBuyer ? 'buyer' : 'seller',
            state: trade.state,
            createdAt: new Date(),
        });
        trade.logs = logs;

        await trade.save();
        socketService.emit('trade-updated', trade.toJSON(), isBuyer ? trade.seller : trade.buyer);

        res.json(trade);
    }),
);

router.get(
    '/list',
    validate(
        query('page').isInt({ min: 1 }),
        query('perPage').isInt({ min: 10, max: 200 }),
        query('onlyActive').isBoolean().optional(),
    ),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { page, perPage, onlyActive }: { [x: string]: any } = req.query;

        let filter: RootFilterQuery<ITrade> = {
            $or: [{ buyer: req.user.id }, { seller: req.user.id }],
            state: { $ne: TradeState.CREATED },
        };

        if (onlyActive) {
            filter = {
                $or: [
                    {
                        seller: req.user.id,
                        state: {
                            $in: [
                                TradeState.DEPOSITED,
                                TradeState.TRADE_SENT,
                                TradeState.PERIOD_STARTED,
                                TradeState.RETURN_TRADE_SENT,
                                TradeState.CAN_RELEASE,
                                TradeState.CAN_SEIZE,
                                TradeState.DISPUTE1,
                                TradeState.DISPUTE2,
                            ],
                        },
                    },
                    {
                        buyer: req.user.id,
                        state: {
                            $in: [
                                TradeState.DEPOSITED,
                                TradeState.TRADE_SENT,
                                TradeState.PERIOD_STARTED,
                                TradeState.RETURN_TRADE_SENT,
                                TradeState.CAN_WITHDRAW,
                                TradeState.CAN_RECLAIM,
                                TradeState.DISPUTE1,
                                TradeState.DISPUTE2,
                            ],
                        },
                    },
                    {
                        seller: req.user.id,
                        rentClaimable: true,
                    },
                ],
            };
        }

        // TODO: Filter returned fields
        const trades = await Trade.find(filter, '-_id -__v -logs')
            .sort({ updatedAt: -1, _id: 1 })
            .skip((page - 1) * perPage)
            .limit(perPage)
            .populate('buyer')
            .populate('seller')
            .populate('listing');

        res.json(trades);
    }),
);

router.get(
    '/signature/:id',
    validate(
        param('id').isUUID(),
        query('address').isHexadecimal().optional(),
        query('type').isIn(['deposit', 'withdraw', 'release', 'reclaim', 'seize', 'rent', 'fee']).optional(),
    ),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const tradeId = req.params.id;
        // TODO: validate address
        const address = req.query.address as string;
        const type = req.query.type as string;

        const trade = await Trade.findOne({ id: tradeId, $or: [{ buyer: req.user.id }, { seller: req.user.id }] });
        if (!trade) throw new CustomError('Invalid trade', 404);

        if (trade.state !== TradeState.CREATED && !address) throw new CustomError('Address is required', 400);

        const listing = await Listing.findOne({ id: trade.listingId });
        if (!listing) throw new CustomError('Listing not found', 500);

        const token = await Token.findOne({ symbol: listing.token }).populate('chain');
        if (!token || !token.chain) throw new CustomError('Token not found', 500);

        const response: any = {
            id: uuidToBigInt(trade.id).toString(),
            token: token.contract,
            contract: token.chain?.contract,
            chainId: token.chain?.chainId,
        };

        if (type === 'rent') {
            if (!trade.rent || trade.fee === undefined) throw new CustomError('Invalid trade', 400);
            if (!trade.rentClaimable) throw new CustomError('Invalid trade state', 400);
            if (trade.seller !== req.user.id) throw new CustomError('Invalid user role', 400);

            response.amount = centsToToken(trade.rent - trade.fee, token.decimals);
            response.signature = web3Service.signClaim('rent', trade.id, response.amount, address);
            res.json(response);
            return;
        } else if (type === 'fee') {
            if (!trade.fee) throw new CustomError('Invalid trade', 400);
            if (!trade.feeClaimable) throw new CustomError('Invalid trade state', 400);

            // check if the user is admin
            const user = await User.findById(req.user.id);
            if (!user || user.role !== 'admin') throw new CustomError('Unauthorized', 403);

            response.amount = centsToToken(trade.fee, token.decimals);
            response.signature = web3Service.signClaim('fee', trade.id, response.amount, address);
            res.json(response);
            return;
        }

        switch (trade.state) {
            case TradeState.CREATED: {
                if (trade.buyer !== req.user.id) throw new CustomError('Invalid user role', 400);
                if (listing.state !== ListingState.ACTIVE) throw new CustomError('Invalid listing state', 400);

                if (listing.type === 'lend') {
                    if (!listing.lend || !trade.rent) throw new CustomError('Invalid listing', 400);
                    response.amount = centsToToken(trade.rent + listing.price, token.decimals);
                    response.signature = web3Service.signDeposit(trade.id, response.amount, token.contract);
                } else {
                    response.amount = centsToToken(listing.price, token.decimals);
                    response.signature = web3Service.signDeposit(trade.id, response.amount, token.contract);
                }
                break;
            }
            case TradeState.CAN_WITHDRAW:
                if (trade.buyer !== req.user.id) throw new CustomError('Invalid user role', 400);
                if (listing.type === 'lend') {
                    if (!listing.lend || !trade.rent) throw new CustomError('Invalid listing', 400);
                    response.amount = centsToToken(trade.rent + listing.price, token.decimals);
                    response.signature = web3Service.signClaim('withdraw', trade.id, response.amount, address);
                } else {
                    response.amount = centsToToken(listing.price, token.decimals);
                    response.signature = web3Service.signClaim('withdraw', trade.id, response.amount, address);
                }
                break;
            case TradeState.CAN_RELEASE:
                if (trade.seller !== req.user.id) throw new CustomError('Invalid user role', 400);
                if (listing.type !== 'sell') throw new CustomError('Invalid listing type', 500);
                response.amount = centsToToken(listing.price, token.decimals);
                response.signature = web3Service.signClaim('release', trade.id, response.amount, address);
                break;
            case TradeState.CAN_RECLAIM:
                if (trade.buyer !== req.user.id) throw new CustomError('Invalid user role', 400);
                if (listing.type !== 'lend') throw new CustomError('Invalid listing type', 500);
                response.amount = centsToToken(listing.price, token.decimals);
                response.signature = web3Service.signClaim('reclaim', trade.id, response.amount, address);
                break;
            case TradeState.CAN_SEIZE:
                if (trade.seller !== req.user.id) throw new CustomError('Invalid user role', 400);
                if (listing.type !== 'lend') throw new CustomError('Invalid listing type', 500);
                response.amount = centsToToken(listing.price, token.decimals);
                response.signature = web3Service.signClaim('seize', trade.id, response.amount, address);
                break;
            default:
                throw new CustomError('Invalid trade state', 400);
        }

        res.json(response);
    }),
);

router.post(
    '/confirm/:id',
    validate(param('id').isUUID(), body('txHash').isHexadecimal()),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const id = req.params.id as string;
        const { txHash } = req.body;

        // TODO: filter returning fields
        let trade = await Trade.findOne({ id, $or: [{ seller: req.user.id }, { buyer: req.user.id }] })
            .populate('buyer')
            .populate('seller')
            .populate('listing');
        if (!trade) throw new CustomError('Invalid trade id', 400);

        const token = await Token.findOne({ symbol: trade.listing?.token }).populate('chain');
        if (!token || !token.chain) throw new CustomError('Token not found', 500);

        const event = await web3Service.fetchTransactionEvent(txHash, token.chain);
        if (event.data.id !== id) throw new CustomError('Onchain id and provided id do not match', 400);

        if (event.deposit) {
            if (trade.state === TradeState.CREATED) {
                if (trade.listing.state !== ListingState.ACTIVE) throw new CustomError('Invalid listing state', 400);

                const session = await mongoose.startSession();
                try {
                    const { updatedTrade, listing } = await session.withTransaction(async () => {
                        const sendTradeDuration = 2 * hours;
                        const updatedTrade = await Trade.findOneAndUpdate(
                            { id, state: TradeState.CREATED },
                            {
                                $set: {
                                    state: TradeState.DEPOSITED,
                                    deadline: new Date(Date.now() + sendTradeDuration),
                                    depositTx: txHash,
                                },
                                $push: {
                                    logs: { initiator: 'buyer', state: TradeState.DEPOSITED, createdAt: new Date() },
                                },
                            },
                            { new: true, session },
                        )
                            .populate('listing')
                            .populate('buyer')
                            .populate('seller');

                        if (!updatedTrade) throw new Error('Trade update failed within transaction');
                        const listing = await Listing.findOneAndUpdate(
                            { id: updatedTrade.listingId, state: ListingState.ACTIVE },
                            { state: ListingState.ONGOING },
                            { new: true, session },
                        );
                        if (!listing) throw new Error('Listing update failed within transaction');

                        return { updatedTrade, listing };
                    });
                    trade = updatedTrade;
                    if (!listing.hidden) socketService.emit('listing-deleted', { id: trade.listingId });
                    socketService.emit('trade-updated', trade.toJSON(), trade.seller.id);
                } catch {
                    throw new CustomError('Transaction failed during deposit event confirmatino', 500);
                } finally {
                    await session.endSession();
                }
            } else if (trade.state !== TradeState.DEPOSITED) throw new CustomError('Invalid trade state', 400);
        } else {
            switch (event.data.claim_type) {
                case 'withdraw':
                    if (trade.state !== TradeState.CAN_WITHDRAW) throw new CustomError('Invalid trade state', 400);

                    trade.state = TradeState.WITHDRAWN;
                    trade.logs?.push({ initiator: 'buyer', state: TradeState.WITHDRAWN, createdAt: new Date() });
                    break;
                case 'release':
                    if (trade.state !== TradeState.CAN_RELEASE) throw new CustomError('Invalid trade state', 400);

                    trade.state = TradeState.RELEASED;
                    trade.logs?.push({ initiator: 'seller', state: TradeState.RELEASED, createdAt: new Date() });
                    break;
                case 'reclaim':
                    if (trade.state !== TradeState.CAN_RECLAIM) throw new CustomError('Invalid trade state', 400);

                    trade.state = TradeState.RECLAIMED;
                    trade.logs?.push({ initiator: 'buyer', state: TradeState.RECLAIMED, createdAt: new Date() });
                    break;
                case 'seize':
                    if (trade.state !== TradeState.CAN_SEIZE) throw new CustomError('Invalid trade state', 400);

                    trade.state = TradeState.SEIZED;
                    trade.logs?.push({ initiator: 'seller', state: TradeState.SEIZED, createdAt: new Date() });
                    break;
                case 'rent':
                    if (trade.rentClaimable) trade.rentClaimable = false;
                    else throw new CustomError('Invalid trade state', 400);
                    break;
                case 'fee':
                    if (trade.feeClaimable) trade.feeClaimable = false;
                    else throw new CustomError('Invalid trade state', 400);
                    break;
                default:
                    throw new CustomError('Invalid event type', 400);
            }
            await trade.save();
        }
        res.json(trade);
    }),
);

router.get(
    '/:id',
    validate(param('id').isUUID()),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { id }: { [x: string]: any } = req.params;

        const filter: RootFilterQuery<ITrade> = {
            $or: [{ buyer: req.user.id }, { seller: req.user.id }],
            id,
        };

        const trades = await Trade.findOne(filter, '-_id -__v -logs')
            .populate('buyer')
            .populate('seller')
            .populate('listing');

        if (!trades) throw new CustomError('Trade not found', 404);

        res.json(trades);
    }),
);

export default router;

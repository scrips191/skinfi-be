import mongoose from 'mongoose';
import { Router, Request, Response } from 'express';

import socketService from '../services/socket';
import web3Service from '../services/web3';

import { CustomError } from '../models/error';
import { asyncHandler } from '../middlewares/error';
import { Chain } from '../models/db/chain';
import { TradeState, Trade } from '../models/db/trade';
import { Listing, ListingState } from '../models/db/listing';
import Logger from '../utils/logger';

const router = Router();

const hours = 60 * 60 * 1000;
const sendTradeDuration = 2 * hours;

router.post(
    '/listen',
    asyncHandler(async (req: Request, res: Response) => {
        // TODO: Rate limit this endpoint
        const config = await Chain.findOne({ name: 'supra' });
        if (!config) throw new CustomError('Failed to fetch blockchain config from db', 500);

        const { depositEvents, claimEvents, blockHeight } = await web3Service.fetchEvents(config);
        config.lastBlockHeight = blockHeight;

        for (const event of depositEvents) {
            const trade = await Trade.findOne({
                id: event.id,
                state: TradeState.CREATED,
            }).populate('listing');

            if (!trade) {
                Logger.error('Trade related to deposit event not found');
                continue;
            }
            if (!trade.listing) {
                Logger.error('Listing related to deposit event not found');
                continue;
            }

            if (trade.listing.state !== ListingState.ACTIVE) {
                // someone already deposited to this listing
                const updatedTrade = await Trade.findOneAndUpdate(
                    { id: event.id, state: TradeState.CREATED },
                    { state: TradeState.CAN_WITHDRAW },
                    { new: true },
                );
                if (updatedTrade) socketService.emit('trade-updated', updatedTrade.toJSON(), updatedTrade.buyer);
                continue;
            }

            const session = await mongoose.startSession();
            try {
                const { updatedTrade, listing } = await session.withTransaction(async () => {
                    const updatedTrade = await Trade.findOneAndUpdate(
                        { id: event.id, state: TradeState.CREATED },
                        {
                            $set: { state: TradeState.DEPOSITED, deadline: new Date(Date.now() + sendTradeDuration) },
                            $push: {
                                logs: { initiator: 'blockchain', state: TradeState.DEPOSITED, createdAt: new Date() },
                            },
                        },
                        { new: true, session },
                    );
                    if (!updatedTrade) throw new Error('Trade update failed within transaction');
                    const listing = await Listing.findOneAndUpdate(
                        { id: trade.listingId, state: ListingState.ACTIVE },
                        { state: ListingState.ONGOING },
                        { new: true, session },
                    );
                    if (!listing) throw new Error('Listing update failed within transaction');

                    return { updatedTrade, listing };
                });

                const tradeJson = updatedTrade.toJSON();
                if (!listing.hidden) socketService.emit('listing-deleted', { id: listing.id });
                socketService.emit('trade-updated', tradeJson, updatedTrade.seller);
                socketService.emit('trade-updated', tradeJson, updatedTrade.buyer);
            } catch (e) {
                Logger.error('Transaction failed during deposit event processing', e);
                continue;
            } finally {
                await session.endSession();
            }
        }

        for (const event of claimEvents) {
            switch (event.claim_type) {
                case 'withdraw': {
                    const trade = await Trade.findOneAndUpdate(
                        { id: event.id, state: TradeState.CAN_WITHDRAW },
                        {
                            $set: { state: TradeState.WITHDRAWN },
                            $push: {
                                logs: {
                                    initiator: 'buyer',
                                    state: TradeState.WITHDRAWN,
                                    createdAt: new Date(),
                                },
                            },
                        },
                        { new: true },
                    );
                    if (!trade) {
                        Logger.error('Trade related to claim event not found');
                        break;
                    }
                    socketService.emit('trade-updated', trade.toJSON(), trade.buyer);
                    break;
                }
                case 'release': {
                    const trade = await Trade.findOneAndUpdate(
                        { id: event.id, state: TradeState.CAN_RELEASE },
                        {
                            $set: { state: TradeState.RELEASED },
                            $push: {
                                logs: {
                                    initiator: 'seller',
                                    state: TradeState.RELEASED,
                                    createdAt: new Date(),
                                },
                            },
                        },
                        { new: true },
                    );
                    if (!trade) {
                        Logger.error('Trade related to claim event not found');
                        break;
                    }
                    socketService.emit('trade-updated', trade.toJSON(), trade.seller);
                    break;
                }
                case 'reclaim': {
                    const trade = await Trade.findOneAndUpdate(
                        { id: event.id, state: TradeState.CAN_RECLAIM },
                        {
                            $set: { state: TradeState.RECLAIMED },
                            $push: {
                                logs: {
                                    initiator: 'buyer',
                                    state: TradeState.RECLAIMED,
                                    createdAt: new Date(),
                                },
                            },
                        },
                        { new: true },
                    );
                    if (!trade) {
                        Logger.error('Trade related to claim event not found');
                        break;
                    }
                    socketService.emit('trade-updated', trade.toJSON(), trade.buyer);
                    break;
                }
                case 'seize': {
                    const trade = await Trade.findOneAndUpdate(
                        { id: event.id, state: TradeState.CAN_SEIZE },
                        {
                            $set: { state: TradeState.SEIZED },
                            $push: {
                                logs: { initiator: 'seller', state: TradeState.SEIZED, createdAt: new Date() },
                            },
                        },
                        { new: true },
                    );
                    if (!trade) {
                        Logger.error('Trade related to claim event not found');
                        break;
                    }
                    socketService.emit('trade-updated', trade.toJSON(), trade.seller);
                    socketService.emit('trade-updated', trade.toJSON(), trade.buyer);
                    break;
                }
                case 'rent': {
                    const trade = await Trade.findOneAndUpdate(
                        { id: event.id, rentClaimable: true },
                        { rentClaimable: false },
                        { new: true },
                    );
                    if (!trade) {
                        Logger.error('Trade related to claim event not found');
                        break;
                    }
                    socketService.emit('trade-updated', trade.toJSON(), trade.seller);
                    break;
                }
                case 'fee': {
                    const trade = await Trade.findOneAndUpdate(
                        { id: event.id, feeClaimable: true },
                        { feeClaimable: false },
                        { new: true },
                    );
                    if (!trade) {
                        Logger.error('Trade related to claim event not found');
                        break;
                    }
                    break;
                }
            }
        }
        await config.save();

        res.send({ success: true });
    }),
);

export default router;

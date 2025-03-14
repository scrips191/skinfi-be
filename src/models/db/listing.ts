import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

import { IItem } from './item';
import { IUserSocket } from './user-socket';
import { ITrade, TradeState } from './trade';

export enum ListingState {
    ACTIVE = 'active',
    ONGOING = 'ongoing',
    COMPLETED = 'completed',
    CANCELED = 'canceled',
}

export interface IListing {
    id: string; // unique listing id
    seller: string; // seller/lender user id
    token: string;
    percentage: number;
    type: string; // listing type (sell, lend)
    price: number; // item price for selling, collateral price for lending
    lend?: { minWeek: number; maxWeek: number; weeklyPrice: number };
    hidden: boolean;
    state: ListingState;
    item: IItem;
    sellerOnline?: boolean;
    trade?: ITrade;
}

const listingSchema = new mongoose.Schema<IListing>(
    {
        id: { type: String, required: true, unique: true, default: randomUUID },
        seller: { type: String, required: true, ref: 'User' },
        token: { type: String, required: true },
        percentage: { type: Number, required: true },
        type: { type: String, required: true, default: 'sell' },
        price: { type: Number, required: true },
        lend: { type: Object, required: false },
        hidden: { type: Boolean, required: true },
        state: { type: String, required: true },
        item: { type: Object, required: true },
    },
    { toJSON: { virtuals: true }, timestamps: true },
);

listingSchema.virtual('sellerOnline', {
    ref: 'UserSocket',
    localField: 'seller',
    foreignField: 'userId',
    justOne: true,
    get: (doc: IUserSocket) => !!doc,
});

listingSchema.virtual('trade', {
    ref: 'Trade',
    localField: 'id',
    foreignField: 'listingId',
    justOne: true,
    match: { state: { $nin: [TradeState.CREATED] } },
    get: (doc: IUserSocket) => (doc ? doc : undefined),
});

listingSchema.virtual('sellerHasTelegram', {
    ref: 'User',
    localField: 'seller',
    foreignField: '_id',
    justOne: true,
    get: (doc: any) => !!doc?.telegramHandle,
});

listingSchema.index(
    { seller: 1, 'item._id': 1 },
    {
        unique: true,
        partialFilterExpression: {
            state: { $in: [ListingState.ACTIVE, ListingState.ONGOING] },
        },
    },
);

export const Listing = mongoose.model<IListing>('Listing', listingSchema);

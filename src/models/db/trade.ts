import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

export enum TradeState {
    CREATED = 'created',
    DEPOSITED = 'deposited',
    TRADE_SENT = 'trade_sent',
    PERIOD_STARTED = 'period_started',
    RETURN_TRADE_SENT = 'return_trade_sent',
    CAN_WITHDRAW = 'can_withdraw',
    CAN_RELEASE = 'can_release',
    CAN_RECLAIM = 'can_reclaim',
    CAN_SEIZE = 'can_seize',
    WITHDRAWN = 'withdrawn',
    RELEASED = 'released',
    RECLAIMED = 'reclaimed',
    SEIZED = 'seized',
    DISPUTE1 = 'dispute1',
    DISPUTE2 = 'dispute2',
}

export interface ITradeLogs {
    initiator: string; // buyer, seller, admin
    state: TradeState;
    createdAt: Date;
}

export interface ITrade {
    id: string; // unique trade id
    listingId: string; // listing id
    listing?: any;
    buyer: string; // buyer/borrower user id
    seller: any; // seller/lender user id
    type: string; // trade type (sell, lend)
    deadline: Date;
    rentClaimable?: boolean;
    fee?: { amount: number; claimed: boolean };
    weeks?: number;
    state: TradeState;
    depositTx?: string;
    logs?: ITradeLogs[];
    updatedAt: Date;
    createdAt: Date;
}

const tradeSchema = new mongoose.Schema<ITrade>(
    {
        id: { type: String, required: true, unique: true, default: () => randomUUID() },
        listingId: { type: String, required: true, ref: 'Listing' },
        buyer: { type: String, required: true, ref: 'User' },
        seller: { type: String, required: true, ref: 'User' },
        type: { type: String, required: true, default: 'sell' },
        deadline: { type: Date, required: true },
        rentClaimable: { type: Boolean, required: false },
        fee: { type: Object, required: false },
        weeks: { type: Number, required: false },
        state: { type: String, required: true },
        depositTx: { type: String, required: false },
        logs: { type: Array, required: true, default: [] },
    },
    { toJSON: { virtuals: true }, timestamps: true },
);

tradeSchema.index(
    { buyer: 1, listingId: 1 },
    {
        unique: true,
        partialFilterExpression: {
            state: TradeState.CREATED,
        },
    },
);

tradeSchema.virtual('listing', {
    ref: 'Listing',
    localField: 'listingId',
    foreignField: 'id',
    justOne: true,
});

export const Trade = mongoose.model<ITrade>('Trade', tradeSchema);

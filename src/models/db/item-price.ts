import mongoose from 'mongoose';

export interface IItemPrice {
    appId: number;
    marketName: string;
    price: number;
    deleted?: boolean;
}

const itemPriceSchema = new mongoose.Schema<IItemPrice>({
    appId: { type: Number, required: true },
    marketName: { type: String, required: true },
    price: { type: Number, required: true },
    deleted: { type: Boolean },
});

export const ItemPrice = mongoose.model<IItemPrice>('ItemPrice', itemPriceSchema);

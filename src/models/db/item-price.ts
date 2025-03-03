import mongoose from 'mongoose';

export interface IItemPrice {
    appId: number;
    marketName: string;
    price: number;
}

const itemPriceSchema = new mongoose.Schema<IItemPrice>({
    appId: { type: Number, required: true },
    marketName: { type: String, required: true },
    price: { type: Number, required: true },
});

export const ItemPrice = mongoose.model<IItemPrice>('ItemPrice', itemPriceSchema);

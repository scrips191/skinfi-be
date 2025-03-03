import mongoose from 'mongoose';
import { ListingState } from './listing';

export interface IItem {
    _id: string;
    ownerId: string; // owner steam id
    assetId: string;
    appId: number;
    tradable: boolean; // steam=0/1 | empire tradelock boolean
    family?: string; // split hashname[0]
    name: string; // name split hashname[1]
    marketName: string; // market hash name
    image: string; // slug or icon_url
    type?: string; // price empire(category | type), steam(category type)
    weapon?: string; // steam -> categories.weapon, price empire -> family null
    float?: number;
    exterior?: string; // steam -> categories.exterior
    stickers?: ISticker[];
    charm?: ICharm;
    nameTag?: string;
    price?: number;
    lendable?: boolean;
    listed?: boolean;
}

export interface ISticker {
    price?: number;
    wear?: number;
    name?: string;
    image?: string;
}

export interface ICharm {
    price?: number;
    name?: string;
    image?: string;
}

const itemSchema = new mongoose.Schema<IItem>(
    {
        ownerId: { type: String, required: true, ref: 'User' },
        assetId: { type: String, required: true, unique: true },
        appId: { type: Number, required: true },
        tradable: { type: Boolean, required: true },
        family: { type: String, required: false },
        name: { type: String, required: true },
        marketName: { type: String, required: true },
        image: { type: String, required: true },
        type: { type: String, required: false },
        weapon: { type: String, required: false },
        float: { type: Number, required: false },
        exterior: { type: String, required: false },
        stickers: { type: Array, required: false },
        charm: { type: Object, required: false },
        nameTag: { type: String, required: false },
        price: { type: Number, required: false },
        lendable: { type: Boolean, required: false },
    },
    { toJSON: { virtuals: true } },
);

itemSchema.virtual('listed', {
    ref: 'Listing',
    localField: '_id',
    foreignField: 'item._id',
    match: { state: [ListingState.ACTIVE, ListingState.ONGOING, ListingState.COMPLETED] },
    justOne: true,
    get: (doc: any) => !!doc,
});

export const Item = mongoose.model<IItem>('Item', itemSchema);

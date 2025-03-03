import mongoose from 'mongoose';

export interface IToken {
    name: string;
    symbol: string;
    chainId: string;
    decimals: number;
    contract: string;
    updatedAt: Date;
    createdAt: Date;
}

const tokenSchema = new mongoose.Schema<IToken>(
    {
        name: { type: String, required: true },
        symbol: { type: String, required: true },
        chainId: { type: String, required: true, ref: 'Chain' },
        decimals: { type: Number, required: true },
        contract: { type: String, required: true },
    },
    { timestamps: true },
);

export const Token = mongoose.model<IToken>('Token', tokenSchema);

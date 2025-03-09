import mongoose from 'mongoose';

export interface IChain {
    name: string;
    chainId: number;
    rpcUrl: string;
    contract: string;
    lastBlockHeight: number;
    scanningSize: number;
    updatedAt: Date;
    createdAt: Date;
}

const chainSchema = new mongoose.Schema<IChain>(
    {
        name: { type: String, required: true },
        chainId: { type: Number, required: true },
        rpcUrl: { type: String, required: true },
        contract: { type: String, required: true },
        lastBlockHeight: { type: Number, required: true },
        scanningSize: { type: Number, required: true },
    },
    { timestamps: true },
);

export const Chain = mongoose.model<IChain>('Chain', chainSchema);

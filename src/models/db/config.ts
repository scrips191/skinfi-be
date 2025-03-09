import mongoose from 'mongoose';

export interface IConfig {
    key: string;
    value: string;
}

const configSchema = new mongoose.Schema<IConfig>({
    key: { type: String, required: true, unique: true },
    value: { type: String, required: true },
});

export const Config = mongoose.model<IConfig>('Config', configSchema);

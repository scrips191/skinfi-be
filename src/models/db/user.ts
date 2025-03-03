import mongoose from 'mongoose';

interface IUser {
    steamId: string;
    username: string;
    avatarUrl: string;
    steamProfile: string;
    steamTradeUrl?: string;
    steamLevel?: number;
    steamJoinDate?: Date;
    invRefreshCooldown: Date;
    accounts?: string[];
    telegramHandle?: string;
    role?: string;
    createdAt: Date;
}

const userSchema = new mongoose.Schema<IUser>({
    steamId: { type: String, required: true },
    username: { type: String, required: true },
    avatarUrl: { type: String, required: true },
    steamProfile: { type: String, required: true },
    steamTradeUrl: { type: String, required: false },
    steamLevel: { type: Number, required: false },
    steamJoinDate: { type: Date, required: false },
    invRefreshCooldown: { type: Date, required: false },
    accounts: { type: Array, required: false },
    telegramHandle: { type: String, required: false },
    role: { type: String, required: false },
    createdAt: { type: Date, required: true, default: Date.now },
});

export const User = mongoose.model<IUser>('User', userSchema);

import mongoose from 'mongoose';

export interface IUserSocket {
    userId: string;
    socketId: string;
    createdAt: Date;
}

const userSocketSchema = new mongoose.Schema<IUserSocket>({
    userId: { type: String, required: true },
    socketId: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: Date.now },
});

userSocketSchema.index({ createdAt: 1 }, { expires: '10m' });

export const UserSocket = mongoose.model<IUserSocket>('UserSocket', userSocketSchema);

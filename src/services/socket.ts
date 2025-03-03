import http from 'http';
import { Server, Socket } from 'socket.io';
import { Connection } from 'mongoose';
import { createAdapter } from '@socket.io/mongo-adapter';

import app from '../app';
import Logger from '../utils/logger';
import { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData } from '../models/socket';
import { verifySocket } from '../middlewares/auth';
import { UserSocket } from '../models/db/user-socket';

class SocketService {
    private io: Server;

    constructor(server: http.Server) {
        const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(server, {
            cors: { origin: ['http://localhost:3000', process.env.UI_BASE_URL as string] },
        });
        io.use(verifySocket);
        io.on('connection', async (socket: Socket) => {
            socket.on('disconnect', async () => {
                Logger.debug(`Socket disconnected: ${socket.id}`);
                setTimeout(async () => {
                    await UserSocket.deleteOne({ socketId: socket.id });
                    const socketCount = await UserSocket.countDocuments({ userId: socket.data.userId });
                    if (socketCount === 0) {
                        socket.broadcast.emit('user-status-update', { id: socket.data.userId, online: false });
                    }
                }, 1000);
            });

            Logger.debug(`Socket connected: ${socket.id}-${socket.data?.steamId}`);
            const socketCount = await UserSocket.countDocuments({ userId: socket.data.userId });
            if (socketCount === 0) {
                socket.broadcast.emit('user-status-update', { id: socket.data.userId, online: true });
            }
            await UserSocket.create({ userId: socket.data.userId, socketId: socket.id });
        });

        this.io = io;
    }

    async init(connection: Connection) {
        const adapterCollection = await connection.createCollection('socket.io-adapter-events', {
            capped: true,
            size: 1e6,
        });

        await adapterCollection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 30, background: true });
        this.io.adapter(createAdapter(adapterCollection, { heartbeatInterval: 10_000, addCreatedAtField: true }));
    }

    emit(event: string, data: any, room?: string) {
        if (room) this.io.to(room).emit(event, data);
        else this.io.emit(event, data);
    }
}

export default new SocketService(app);

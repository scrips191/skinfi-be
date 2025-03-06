import jwt, { JwtPayload } from 'jsonwebtoken';
import { Response, Request, NextFunction } from 'express';

import Logger from '../utils/logger';
import { ExtendedError, Socket } from 'socket.io';
import { User } from '../models/db/user';
import { AuthRequest } from '../models/auth';
import { CustomError } from '../models/error';

export const verifyRequest = (force: boolean) => (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    try {
        if (!token) throw new CustomError('Unauthorized', 401);

        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
        if (force && !decoded.role) throw new CustomError('Forbidden', 403);

        req.user = { id: decoded.userId, steamId: decoded.steamId };
        next();
    } catch (err) {
        next(err);
    }
};

export const verifyScheduler = (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'];

    if (apiKey !== process.env.SCHEDULER_SECRET) next(new CustomError('Unauthorized', 401));
    else next();
};

export const verifyAdmin = async (req: Request, res: Response, next: NextFunction) => {
    const user = await User.findById((<AuthRequest>req).user?.id);
    if (!user || user.role !== 'admin') next(new CustomError('Forbidden', 403));
    else next();
};

export const verifySocket = async (socket: Socket, next: (err?: ExtendedError) => void) => {
    const token = socket.handshake.auth.token;

    if (!token) socket.disconnect();
    else {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
            socket.data = { userId: decoded.userId, steamId: decoded.steamId };
            await socket.join(decoded.userId);
            next();
        } catch (err) {
            Logger.debug(`Unauthorized socket connection: ${socket.id}`);
            next(new Error('Unauthorized Socket Connection'));
        }
    }
};

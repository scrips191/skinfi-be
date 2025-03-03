import jwt, { JwtPayload } from 'jsonwebtoken';
import { Response, Request, NextFunction } from 'express';
import { STATUS_CODES } from 'http';

import Logger from '../utils/logger';
import { ExtendedError, Socket } from 'socket.io';
import { User } from '../models/db/user';
import { AuthRequest } from 'models/auth';

export const verifyRequest = (force: boolean) => (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token && force) res.status(401).send(STATUS_CODES[401]);
    else {
        try {
            if (token) {
                const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
                req.user = { id: decoded.userId, steamId: decoded.steamId };
            }
            next();
        } catch (err) {
            res.status(403).send(STATUS_CODES[403]);
        }
    }
};

export const verifyScheduler = (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'];

    if (apiKey !== process.env.SCHEDULER_SECRET) res.status(401).send(STATUS_CODES[401]);
    else next();
};

export const verifyAdmin = async (req: Request, res: Response, next: NextFunction) => {
    const user = await User.findById((<AuthRequest>req).user?.id);
    if (!user || user.role !== 'admin') res.status(403).send(STATUS_CODES[403]);
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

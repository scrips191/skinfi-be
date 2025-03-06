import { Request, Response, NextFunction } from 'express';
import Logger from '../utils/logger';
import { CustomError } from '../models/error';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (error: CustomError, req: Request, res: Response, next: NextFunction) => {
    if (error instanceof CustomError) {
        Logger.warn(error.msg);
        res.status(error.code).json(error);
    } else {
        Logger.error(error);
        res.status(500).json(new CustomError('Internal server error', 500));
    }
};

export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

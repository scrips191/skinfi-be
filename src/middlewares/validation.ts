import { Response, Request, NextFunction } from 'express';
import { ContextRunner, FieldValidationError, validationResult } from 'express-validator';
import { CustomError } from '../models/error';

export const validate =
    (...validators: ContextRunner[]) =>
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            await Promise.all(validators.map(validator => validator.run(req)));
            const result = validationResult(req);
            if (!result.isEmpty()) {
                const arr = result.array() as FieldValidationError[];
                next(new CustomError(`${arr[0].msg} ${arr[0].path}`, 400));
            }
            next();
        } catch (e) {
            next(e);
        }
    };

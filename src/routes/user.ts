import { Router, Response } from 'express';
import { Ed25519PublicKey, Ed25519Signature } from '@aptos-labs/ts-sdk';
import { createHash } from 'crypto';
import { body, oneOf } from 'express-validator';

import { asyncHandler } from '../middlewares/error';
import { validate } from '../middlewares/validation';
import { CustomError } from '../models/error';
import { User } from '../models/db/user';
import { AuthRequest } from '../models/auth';
import steamService from '../services/steam';

const router = Router();

router.get(
    '/profile',
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const user = await User.findById(req.user.id).lean();
        if (!user) throw new CustomError('User not found', 500);

        res.json(user);
    }),
);

router.post(
    '/profile',
    validate(
        oneOf([body('telegramHandle').exists(), body('tradeUrl').exists()]),
        body('telegramHandle').notEmpty().optional(),
        body('tradeUrl').custom(steamService.validateTradeUrl).withMessage('Invalid trade url').optional(),
    ),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { tradeUrl, telegramHandle } = req.body;

        const user = await User.findByIdAndUpdate(
            req.user.id,
            { steamTradeUrl: tradeUrl, telegramHandle },
            { new: true },
        );
        if (!user) throw new CustomError('User not found', 500);

        res.json(user);
    }),
);

router.post(
    '/wallet',
    validate(
        body('message').notEmpty(),
        body('signature').isHexadecimal(),
        body('publicKey').isHexadecimal().isLength({ min: 64, max: 66 }).withMessage('Invalid publicKey'),
    ),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { signature, publicKey, message } = req.body;

        if (Date.now() > Number(message) + 60_000) throw new CustomError('Signature expired', 400);

        const pubkey = new Ed25519PublicKey(publicKey);
        const verify = pubkey.verifySignature({
            message: '0x' + Buffer.from(message, 'utf8').toString('hex'),
            signature: new Ed25519Signature(signature),
        });

        if (!verify) throw new CustomError('Signature is not valid for the public key', 400);

        const address = `0x${createHash('sha3-256')
            .update(pubkey.toUint8Array())
            .update(new Uint8Array([0]))
            .digest('hex')}`;

        const user = await User.findById(req.user.id);
        if (!user) throw new CustomError('User not found', 500);

        const accounts = user.accounts || [];
        if (!accounts.includes(address)) accounts.push(address);
        else throw new CustomError('Address already exists', 400);

        user.accounts = accounts;
        await user.save();

        res.json(user);
    }),
);

router.delete(
    '/wallet',
    validate(body('address').isHexadecimal()),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { address } = req.body;

        const user = await User.findById(req.user.id);
        if (!user) throw new CustomError('User not found', 500);

        const accounts = user.accounts || [];
        const idx = accounts.indexOf(address);
        if (idx !== -1) accounts.splice(idx, 1);
        else throw new CustomError('Address does not exist', 400);

        user.accounts = accounts;
        await user.save();

        res.json(user);
    }),
);

export default router;

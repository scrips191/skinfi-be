import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { query } from 'express-validator';

import steamService from '../services/steam';
import { CustomError } from '../models/error';
import { asyncHandler } from '../middlewares/error';
import { User } from '../models/db/user';
import { Item } from '../models/db/item';
import { ItemPrice } from '../models/db/item-price';
import { validate } from '../middlewares/validation';

const router = Router();

router.get(
    '/steam/callback',
    asyncHandler(async (req: Request, res: Response) => {
        const steamId = await steamService.verifyAssertion(req.query);
        if (!steamId) {
            throw new CustomError('Invalid steamId', 400);
        }
        const steamUser = await steamService.fetchUserProfile(steamId);
        if (!steamUser) {
            throw new CustomError('Failed to fetch user profile', 400);
        }

        const steamLevel = await steamService.fetchSteamLevel(steamId);

        let user = await User.findOne({ steamId: steamUser.steamid });
        if (!user) {
            const newUser = await User.create({
                steamId: steamUser.steamid,
                steamProfile: steamUser.profileurl,
                username: steamUser.personaname,
                avatarUrl: steamUser.avatarfull,
                steamJoinDate: steamUser.steamJoinDate,
                steamLevel,
                invRefreshCooldown: new Date(Date.now() + 60_000), // 1 minute
                accounts: [],
            });

            if (!newUser) {
                throw new CustomError('Failed to create user', 500);
            }

            const inventory = await steamService.fetchInventory(steamId, 730);
            const items = inventory.map((item: any) => ({ ...item, ownerId: newUser.id }));
            const marketNames = items.map((x: any) => x.marketName);

            const itemPrices = await ItemPrice.find({ marketName: { $in: marketNames } });

            for (const item of items) {
                const itemPrice = itemPrices.find(x => x.marketName === item.marketName);
                if (itemPrice) {
                    item.price = itemPrice.price;
                }
            }

            await Item.deleteMany({ ownerId: newUser.id });
            await Item.insertMany(items);

            user = newUser;
        } else {
            user.steamProfile = steamUser.profileurl;
            user.username = steamUser.personaname;
            user.avatarUrl = steamUser.avatarfull;
            user.steamLevel = steamLevel;
            await user.save();
        }

        const token = jwt.sign(
            {
                steamId: user.steamId,
                userId: user.id,
                role: user.role,
            },
            process.env.JWT_SECRET as string,
            { expiresIn: '24h' },
        );

        //Redirect to frontend with token
        res.redirect(`${process.env.UI_BASE_URL}/auth?token=${token}`);
    }),
);

router.get(
    '/admin',
    validate(query('steamId').isInt(), query('key').notEmpty()),
    asyncHandler(async (req: Request, res: Response) => {
        const { steamId, key } = req.query;

        if (key !== process.env.ADMIN_KEY) throw new CustomError('Invalid key', 403);

        const steamUser = await steamService.fetchUserProfile(steamId as string);
        if (!steamUser) {
            throw new CustomError('Failed to fetch user profile', 400);
        }

        const steamLevel = await steamService.fetchSteamLevel(steamId as string);

        let user = await User.findOne({ steamId: steamUser.steamid });
        if (!user) {
            const newUser = await User.create({
                steamId: steamUser.steamid,
                steamProfile: steamUser.profileurl,
                username: steamUser.personaname,
                avatarUrl: steamUser.avatarfull,
                steamJoinDate: steamUser.steamJoinDate,
                steamLevel,
                invRefreshCooldown: new Date(Date.now() + 60_000), // 1 minute
                accounts: [],
            });

            if (!newUser) {
                throw new CustomError('Failed to create user', 500);
            }

            const inventory = await steamService.fetchInventory(steamId as string, 730);
            const items = inventory.map((item: any) => ({ ...item, ownerId: newUser.id }));
            const marketNames = items.map((x: any) => x.marketName);

            const itemPrices = await ItemPrice.find({ marketName: { $in: marketNames } });

            for (const item of items) {
                const itemPrice = itemPrices.find(x => x.marketName === item.marketName);
                if (itemPrice) {
                    item.price = itemPrice.price;
                }
            }

            await Item.deleteMany({ ownerId: newUser.id });
            await Item.insertMany(items);

            user = newUser;
        } else {
            user.steamProfile = steamUser.profileurl;
            user.username = steamUser.personaname;
            user.avatarUrl = steamUser.avatarfull;
            user.steamLevel = steamLevel;
            await user.save();
        }

        const token = jwt.sign(
            {
                steamId: user.steamId,
                userId: user.id,
                role: user.role,
            },
            process.env.JWT_SECRET as string,
            { expiresIn: '24h' },
        );

        //Redirect to frontend with token
        res.redirect(`${process.env.UI_BASE_URL}/auth?token=${token}`);
    }),
);

export default router;

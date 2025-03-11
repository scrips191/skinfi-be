import axios from 'axios';

import { CustomError } from '../models/error';
import { IItemPrice } from '../models/db/item-price';
import { lendableItemTypes } from '../models/steam';

class PriceEmpireService {
    private apiKey = process.env.PRICE_EMPIRE_API_KEY as string;
    private baseUrl = 'https://api.pricempire.com';
    private priceUrl = 'v4/paid/items/prices';
    private inventoryUrl = 'v3/inventory';
    private imageUrl = 'https://community.fastly.steamstatic.com/economy/image';

    async fetchPrices(appId: number) {
        const url = `${this.baseUrl}/${this.priceUrl}?app_id=${appId}&api_key=${this.apiKey}&sources=buff163,steam&currency=USD`;

        try {
            const response = await axios.get(url);

            const prices: IItemPrice[] = response.data.reduce((acc: IItemPrice[], item: any): IItemPrice[] => {
                const price = item.prices?.[0]?.price || item.prices?.[1]?.price;
                if (price) {
                    acc.push({
                        marketName: item.market_hash_name,
                        appId,
                        price,
                    });
                }
                return acc;
            }, []);

            return prices;
        } catch (error) {
            throw new CustomError('Failed to fetch prices', 500);
        }
    }

    async fetchInventory(steamId: string, appId: number) {
        const url = `${this.baseUrl}/${this.inventoryUrl}/${steamId}?&api_key=${this.apiKey}&sources=buff&currency=USD&refresh=true&force=true`;

        try {
            const response = await axios.get(url);
            const items = response.data?.items;

            const inventory = items
                .filter((item: any) => {
                    return item.image && item.marketHashName;
                })
                .map((item: any) => {
                    const splitName = item.marketHashName.split(' | ');
                    const specialName = item.marketHashName.split(' - ')[1];
                    const name =
                        splitName.length > 1
                            ? splitName[1].split(' (')[0] + (splitName[2] ? ' - ' + splitName[2] : '')
                            : splitName[0].split(' (')[0];

                    const image = item.image.includes('https://') ? item.image : `${this.imageUrl}/${item.image}`;
                    const stickers = item.stickers?.map((sticker: any) => {
                        if (!sticker?.image) return;

                        const image = sticker.image.includes('https://')
                            ? sticker.image
                            : `${this.imageUrl}/${sticker.image}`;
                        return {
                            name: sticker.marketHashName,
                            image,
                            wear: sticker.wear ? sticker.wear : undefined,
                        };
                    });

                    return {
                        assetId: item.assetId,
                        appId,
                        tradable: !item.tradeLock,
                        family: splitName.length > 1 ? splitName[0] : undefined,
                        name: specialName ? `${name} - ${specialName}` : name,
                        marketName: item.marketHashName,
                        image,
                        type: item.category,
                        weapon: item.family,
                        exterior: item.exterior,
                        stickers,
                        lendable: lendableItemTypes.includes(item.category) && !item.tradeLock,
                        price: item.price ? item.price : undefined,
                        float: item.float ? Number(Number(item.float).toFixed(4)) : undefined,
                    };
                });

            return inventory;
        } catch (error) {
            throw new CustomError('Failed to fetch inventory', 500);
        }
    }
}

export default new PriceEmpireService();

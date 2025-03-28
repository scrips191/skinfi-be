import axios from 'axios';

import { CustomError } from '../models/error';
import { IItemPrice } from '../models/db/item-price';
import { lendableItemTypes } from '../models/steam';

class PriceEmpireService {
    private apiKey = process.env.PRICE_EMPIRE_API_KEY as string;
    private baseUrl = 'https://api.pricempire.com';
    private priceUrl = 'v3/items/prices';
    private inventoryUrl = 'v3/inventory';
    private inventoryUrlV4 = 'v4/paid/inventory';
    private imageUrl = 'https://community.fastly.steamstatic.com/economy/image';

    async fetchPrices(appId: number) {
        const url = `${this.baseUrl}/${this.priceUrl}?app_id=${appId}&api_key=${this.apiKey}&sources=buff,steam&currency=USD`;

        try {
            const response = await axios.get(url);
            const itemPrices = response.data;
            const marketNames = Object.keys(itemPrices);

            const prices: IItemPrice[] = [];
            for (const marketName of marketNames) {
                const item = itemPrices[marketName];
                const price: number = item.buff?.price || item.steam?.price || 0;
                if (price) {
                    prices.push({
                        appId,
                        marketName,
                        price,
                    });
                }
            }

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

    async fetchInventoryV4(steamId: string, appId: number) {
        const url = `${this.baseUrl}/${this.inventoryUrlV4}?app_id=${appId}&steam_id=${steamId}&api_key=${this.apiKey}&force=true`;
        try {
            const response = await axios.get(url);
            const items = response.data?.items;

            const inventory = items
                .filter((inv: any) => {
                    return inv.item;
                })
                .map((inv: any) => {
                    const item = inv.item;

                    const splitName = item.market_hash_name.split(' | ');
                    const specialName = item.market_hash_name.split(' - ')[1];
                    const name =
                        splitName.length > 1
                            ? splitName[1].split(' (')[0] + (splitName[2] ? ' - ' + splitName[2] : '')
                            : splitName[0].split(' (')[0];

                    const image = item.image.includes('https://') ? item.image : `${this.imageUrl}/${item.image}`;
                    const stickers = inv.stickers?.map((sticker: any) => {
                        //if (!sticker?.image) return; // ??

                        const image = sticker.image?.includes('https://')
                            ? sticker.image
                            : `${this.imageUrl}/${sticker.image}`;
                        return {
                            name: sticker.market_hash_name,
                            image,
                            wear: sticker.wear ? sticker.wear : undefined,
                        };
                    });

                    return {
                        assetId: inv.assetId,
                        appId,
                        tradable: !item.tradeLock, // not available in v4?
                        family: splitName.length > 1 ? splitName[0] : undefined,
                        name: specialName ? `${name} - ${specialName}` : name,
                        marketName: item.market_hash_name,
                        image,
                        type: item.category,
                        weapon: item.weapon_name,
                        exterior: item.exterior ? item.exterior : undefined,
                        stickers,
                        lendable: lendableItemTypes.includes(item.category) && !item.tradeLock,
                        price: item.price ? item.price : undefined,
                        float: inv.float_value ? Number(Number(inv.float_value).toFixed(4)) : undefined,
                    };
                });

            return inventory;
        } catch (error) {
            console.log(error);
            throw new CustomError('Failed to fetch inventory', 500);
        }
    }
}

export default new PriceEmpireService();

import axios from 'axios';

import { CustomError } from '../models/error';
import { IItemPrice } from '../models/db/item-price';

class PriceEmpireService {
    private apiKey = process.env.PRICE_EMPIRE_API_KEY as string;
    private baseUrl = 'https://api.pricempire.com';
    private priceUrl = 'v4/paid/items/prices';
    //private inventoryUrl = 'v4/paid/inventory';

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
}

export default new PriceEmpireService();

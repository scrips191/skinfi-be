import steamService from './steam';
import priceEmpireService from './price-empire';

import { ItemPrice } from '../models/db/item-price';

class InventoryService {
    async getInventory(steamId: string, appId: number) {
        let inventory;
        try {
            inventory = await priceEmpireService.fetchInventory(steamId, appId);
        } catch (err) {
            inventory = await steamService.fetchInventory(steamId, appId);
            if (!inventory || inventory.length === 0) return [];

            const marketNames = inventory.map((x: any) => x.marketName);
            const itemPrices = await ItemPrice.find({ marketName: { $in: marketNames } });

            for (const item of inventory) {
                const itemPrice = itemPrices.find(x => x.marketName === item.marketName);
                if (itemPrice) {
                    item.price = itemPrice.price;
                }
            }
        }

        return inventory;
    }
}

export default new InventoryService();

/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { JSDOM } from 'jsdom';

import { CustomError } from '../models/error';
import { ISticker, ICharm } from '../models/db/item';
import { lendableItemTypes } from '../models/steam';
import Logger from '../utils/logger';

class SteamService {
    private steamRegex = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;
    private apiKey = process.env.STEAM_API_KEY as string;
    private openIdUrl = 'https://steamcommunity.com/openid/login';
    private inventoryUrl = 'https://steamcommunity.com/inventory';
    private imageUrl = 'https://community.fastly.steamstatic.com/economy/image';
    private axiosInstance = axios.create();

    constructor() {
        if (process.env.PROXY_URL) {
            const proxyUrl = `socks5://${process.env.PROXY_URL}`;
            this.axiosInstance = axios.create({ httpsAgent: new SocksProxyAgent(proxyUrl) });
        }
    }

    async verifyAssertion(params: any): Promise<string> {
        const matches = params['openid.claimed_id'].match(this.steamRegex);
        if (!matches) {
            throw new CustomError('Invalid Steam ID', 400);
        }

        const validationParams = new URLSearchParams({
            ...params,
            'openid.mode': 'check_authentication',
        });

        const response = await this.axiosInstance.get(`${this.openIdUrl}?${validationParams.toString()}`);

        if (!response.data.includes('is_valid:true')) {
            throw new CustomError('Invalid Steam assertion', 400);
        }

        return matches[1];
    }

    async fetchUserProfile(steamId: string) {
        const url = `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${this.apiKey}&steamids=${steamId}`;

        try {
            const response = await this.axiosInstance.get(url);
            const player = response.data.response.players[0];

            return player
                ? {
                      steamid: player.steamid,
                      personaname: player.personaname,
                      avatarfull: player.avatarfull,
                      profileurl: player.profileurl,
                      steamJoinDate: new Date(player.timecreated * 1000),
                  }
                : null;
        } catch (error) {
            throw new CustomError('Failed to fetch user profile', 500);
        }
    }

    async fetchInventory(steamId: string, appId: number) {
        const url = `${this.inventoryUrl}/${steamId}/${appId}/2?l=english&count=5000`;

        try {
            const response = await this.axiosInstance.get(url);
            const assets = response.data.assets;

            const items = assets.map((asset: any) => {
                const description = response.data.descriptions.find(
                    (desc: any) => desc.classid === asset.classid && desc.instanceid === asset.instanceid,
                );

                const tags = description.tags;
                const typeTag = tags.find((el: any) => el.category === 'Type');
                const type = typeTag?.localized_tag_name || 'Unknown';
                const weaponTag = tags.find((el: any) => el.category === 'Weapon');
                const exteriorTag = tags.find((el: any) => el.category === 'Exterior');

                const exterior = description.market_hash_name.split('(')[1]?.split(')')[0];

                const stickers = this.parseStickers(description);
                const charm = this.parseCharm(description);
                const nameTag = this.parseNameTag(description);

                const splitName = description.market_hash_name.split(' | ');
                const specialName = description.market_hash_name.split(' - ')[1];
                const name =
                    splitName.length > 1
                        ? splitName[1].split(' (')[0] + (splitName[2] ? ' - ' + splitName[2] : '')
                        : splitName[0].split(' (')[0];

                const tradable = description.tradable === 1;
                const lendable = lendableItemTypes.includes(type) && tradable;

                return {
                    assetId: asset.assetid,
                    appId,
                    tradable,
                    family: splitName.length > 1 ? splitName[0] : undefined,
                    name: specialName ? `${name} - ${specialName}` : name,
                    marketName: description.market_hash_name,
                    image: `${this.imageUrl}/${description.icon_url}`,
                    type,
                    weapon: weaponTag?.localized_tag_name,
                    exterior: exteriorTag?.localized_tag_name || exterior,
                    stickers,
                    charm,
                    nameTag,
                    lendable,
                };
            });

            return items;
        } catch (error) {
            Logger.error('Failed to fetch inventory', error);
            return [];
        }
    }

    async fetchSteamLevel(steamId: string) {
        const url = `http://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${this.apiKey}&steamid=${steamId}`;
        try {
            const response = await this.axiosInstance.get(url);
            return response.data.response.player_level;
        } catch (error) {
            return 0;
        }
    }

    async validateApiKey(apiKey: string) {
        const url = `https://api.steampowered.com/ISteamWebAPIUtil/GetSupportedAPIList/v1?key=${apiKey}`;
        try {
            const response = await this.axiosInstance.get(url);
            return response.data.apilist.interfaces.length > 0;
        } catch {
            return false;
        }
    }

    validateTradeUrl(url: string) {
        const urlRegex = /^https:\/\/steamcommunity\.com\/tradeoffer\/new\/\?partner=\d+&token=[a-zA-Z0-9-]+$/;
        return !!url.match(urlRegex);
    }

    private parseStickers(description: any): ISticker[] {
        const descriptions = description.descriptions;
        const stickersDesc = descriptions.find((desc: any) => desc.type === 'html' && desc.name === 'sticker_info');

        if (!stickersDesc?.value) {
            return [];
        }

        const parser = new JSDOM(stickersDesc.value);

        const divElement = parser.window.document.getElementById('sticker_info');
        const images = divElement!.getElementsByTagName('img');
        const stickers = divElement!.textContent!.split(', ');

        const result: ISticker[] = [];
        for (let i = 0; i < images.length; i++) {
            const sticker: ISticker = {
                name: stickers[i],
                image: images[i].src,
            };

            result.push(sticker);
        }

        return result;
    }

    private parseCharm(description: any): ICharm | undefined {
        const descriptions = description.descriptions;
        const charmsDesc = descriptions.find((desc: any) => desc.type === 'html' && desc.name === 'keychain_info');

        if (!charmsDesc?.value) {
            return undefined;
        }

        const parser = new JSDOM(charmsDesc.value);

        const divElement = parser.window.document.getElementById('keychain_info');
        const images = divElement!.getElementsByTagName('img');
        const title = divElement!.textContent;

        const charm = {
            name: title || 'Charm',
            image: images[0].src,
        };

        return charm;
    }

    private parseNameTag(description: any): ICharm | undefined {
        const descriptions = description.descriptions;
        const nameTagDesc = descriptions.find((desc: any) => desc.name === 'nametag');

        if (!nameTagDesc?.value) {
            return undefined;
        }

        const split = nameTagDesc.value.split("''");
        if (split.length < 3) {
            return undefined;
        }

        split.shift();
        split.pop();
        return split.join("''");
    }
}

export default new SteamService();

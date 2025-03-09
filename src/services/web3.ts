import axios from 'axios';
import { BCS, HexString, SupraAccount } from 'supra-l1-sdk';

import { CustomError } from '../models/error';
import { IChain } from '../models/db/chain';
import { U128ToUuid, uuidToBigInt } from '../utils/helper';

type DepositEvent = { id: string; amount: string; sender: string; token: string };
type ClaimEvent = { id: string; claim_type: string; amount: string; receiver: string };

class Web3Service {
    async fetchEvents(config: IChain) {
        const block = await axios.get(`${config.rpcUrl}/block`);
        const onchainHeight = block.data?.height;
        if (!onchainHeight) throw new CustomError('Failed to fetch current height', 500);
        if (onchainHeight < config.lastBlockHeight) throw new CustomError('Onchain height less than db somehow', 500);

        let depositEvents: DepositEvent[] = [];
        let claimEvents: ClaimEvent[] = [];
        const end = Math.min(config.lastBlockHeight + config.scanningSize * 10, onchainHeight);
        for (let i = config.lastBlockHeight; i < end; i += 10) {
            const depositRes = await axios.get(
                `${config.rpcUrl}/events/${config.contract}::DepositEvent?start=${i}&end=${Math.min(end, i + 10)}`,
            );

            const claimRes = await axios.get(
                `${config.rpcUrl}/events/${config.contract}::ClaimEvent?start=${i}&end=${Math.min(end, i + 10)}`,
            );

            if (!claimRes?.data?.data || !depositRes?.data?.data) {
                throw new CustomError('Error during fetching events', 500);
            }

            depositEvents = depositEvents.concat(
                depositRes.data.data.map((x: { data: DepositEvent }) => ({ ...x.data, id: U128ToUuid(x.data.id) })),
            );
            claimEvents = claimEvents.concat(
                claimRes.data.data.map((x: { data: ClaimEvent }) => ({ ...x.data, id: U128ToUuid(x.data.id) })),
            );
        }

        return { depositEvents, claimEvents, blockHeight: end };
    }

    signDeposit(tradeId: string, amount: number, token: string) {
        const signer = new SupraAccount(Buffer.from(process.env.SIGNER_PRIVATE_KEY as string, 'hex'));

        const data = [
            ...Buffer.from('deposit'),
            ...BCS.bcsSerializeU128(uuidToBigInt(tradeId)),
            ...BCS.bcsSerializeUint64(amount),
            ...Buffer.from(token),
        ];

        const signature = signer.signBuffer(new Uint8Array(data));
        return signature.toString();
    }

    signClaim(type: string, tradeId: string, amount: number, receiver: string) {
        const signer = new SupraAccount(Buffer.from(process.env.SIGNER_PRIVATE_KEY as string, 'hex'));

        const data = [
            ...Buffer.from(type),
            ...BCS.bcsSerializeU128(uuidToBigInt(tradeId)),
            ...BCS.bcsSerializeUint64(amount),
            ...new HexString(receiver).toUint8Array(),
        ];

        const signature = signer.signBuffer(new Uint8Array(data));
        return signature.toString();
    }

    async fetchTransactionEvent(txHash: string, config: IChain) {
        const txRes = await axios.get(`${config.rpcUrl}/transactions/${txHash}`);
        const events = txRes?.data?.output?.Move?.events;
        if (!events || !events.length) throw new CustomError('Transaction has no events', 400);

        const [address, module] = config.contract.split('::');
        const contract = [new HexString(address).toShortString(), module].join('::');

        for (const event of events) {
            if (event.type === `${contract}::ClaimEvent`) {
                return { deposit: false, data: { ...event.data, id: U128ToUuid(event.data.id) } };
            } else if (event.type === `${contract}::DepositEvent`) {
                return { deposit: true, data: { ...event.data, id: U128ToUuid(event.data.id) } };
            }
        }

        throw new CustomError('No matching events found', 400);
    }
}

export default new Web3Service();

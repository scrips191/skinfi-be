export const U128ToUuid = (id: string) => {
    const hex = BigInt(id).toString(16).padStart(32, '0');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const uuidToBigInt = (id: string) => BigInt('0x' + id.replaceAll('-', ''));

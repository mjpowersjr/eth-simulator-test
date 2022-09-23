import { ethers } from 'ethers';
import {
    Address
} from '@ethereumjs/util'

interface AccountData {
    transactionCount: bigint;
    balance: bigint;
    code: Buffer;
}

export class JsonRpcClient {
    protected provider: ethers.providers.Provider;

    constructor(provider: ethers.providers.Provider) {
        this.provider = provider;
    }

    async getAccountData(address: Address, blockNumber: bigint) : Promise<AccountData> {

        const addressString = address.toString();
        const blockTag = '0x' + blockNumber.toString(16);

        // console.log({
        //     method: 'getAccountData',
        //     address: addressString,
        //     blockNumber: blockNumber.toString(),
        //     blockTag: blockTag,
        // });

        const codeRequest = this.provider.getCode(
            addressString, 
            blockTag,
        );
        const txnCountRequest = this.provider.getTransactionCount(
            addressString, 
            blockTag,
        );
        const balanceRequest = this.provider.getBalance(
            addressString, 
            blockTag,
        );

        const [code, txnCount, balance] = 
            await Promise.all([codeRequest, txnCountRequest, balanceRequest]);


        // console.log({
        //     address,
        //     code, txnCount, balance
        // });

        return {
            code: code.length ? Buffer.from(code.slice(2), 'hex') : Buffer.alloc(0),
            transactionCount: BigInt(txnCount),//.isub(new BN(1)), // FIXME: this is prob. not the correct way to fix this...
            balance: BigInt(balance.toHexString())
        }

    }

    async getStorageAt(
        address: Address,
        key: bigint,
        blockNumber: bigint
      ): Promise<Buffer> {
          const addressString = address.toString();
          const keyString = '0x' + key.toString(16);
          // TODO: Upstream Erigon doesn't seem to support hex blockTag
          const blockTag = '0x' + blockNumber.toString(16)

        // console.log({
        //     method: 'getStorageAt',
        //     address,
        //     addressString,
        //     key,
        //     keyString,
        //     blockNumber,
        //     blockTag,
        // });

        const storage = await this.provider.getStorageAt(
            addressString,
            keyString,
            blockTag
        )

        const value = Buffer.from(storage.slice(2), 'hex');

        // console.log({
        //     storage,
        //     value,
        // })

        return value;
      }
  
}

export default JsonRpcClient;

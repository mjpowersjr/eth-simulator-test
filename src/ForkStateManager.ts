import {
  DefaultStateManager,
} from "@ethereumjs/statemanager";
import { Trie } from '@ethereumjs/trie'
import { keccak256 } from 'ethereum-cryptography/keccak'
import {
  bufferToBigInt
} from '@ethereumjs/util'

import {
  Account,
  Address,
  unpadBuffer,
} from "@ethereumjs/util";
import { JsonRpcClient } from './JsonRpcClient';

import { Cache } from './Cache';

interface DefaultStateManagerOpts {
  trie?: Trie
  prefixCodeHashes?: boolean
}

interface ForkStateManagerOpts extends DefaultStateManagerOpts {
  jsonRpcClient: JsonRpcClient;
  forkBlockNumber: bigint;
}

export class ForkStateManager extends DefaultStateManager {

  jsonRpcClient: JsonRpcClient;
  forkBlockNumber: bigint;
  cache: Cache;

  constructor(opts: ForkStateManagerOpts) {
    super(opts);

    this.jsonRpcClient = opts.jsonRpcClient;
    this.forkBlockNumber = opts.forkBlockNumber;
    this.cache = new Cache();
  }

  public async getAccount(address: Address): Promise<Account> {

    let account: Account;

    const cacheKey = address.toString() + ":account"
    let cachedAccount = await this.cache.get({
      key: cacheKey,
    });

    if (cachedAccount) {
      return Account.fromRlpSerializedAccount(cachedAccount);
    }

    const accountExists = await this.accountExists(address);
    if (accountExists) {
      account = await super.getAccount(address);
    } else {
      const accountData = await this.jsonRpcClient.getAccountData(
        address,
        this.forkBlockNumber
      );

      const nonce = accountData.transactionCount;
      const balance = accountData.balance;
      const code = accountData.code;
      const codeHash = keccak256(code);

      account = Account.fromAccountData({
        balance,
        codeHash,
        nonce,
      });

      await this.cache.set({
        key: cacheKey,
        value: account.serialize(),
      });
    }

    return account;
  }

  public async getContractCode(address: Address): Promise<Buffer> {

    const account = await this.getAccount(address)
    if (!account.isContract()) {
      return Buffer.alloc(0)
    }

    const cacheKey = 'codehash:' + account.codeHash.toString('hex');
    let code = await this.cache.get({
      key: cacheKey,
    });

    if (!code) {
      const accountData = await this.jsonRpcClient.getAccountData(
        address,
        this.forkBlockNumber
      );
      code = accountData.code ?? Buffer.alloc(0);
      await this.cache.set({
        key: cacheKey,
        value: code,
      });
    }

    return code
  }

  public async getContractStorage(
    address: Address,
    key: Buffer
  ): Promise<Buffer> {
    if (key.length !== 32) {
      throw new Error("Storage key must be 32 bytes long");
    }

    const cacheKey = address.toString() + ':storage:' + key.toString('hex');
    let value = await this.cache.get({
      key: cacheKey,
    });

    if ((!value) || (!value.length)) {

      const remoteValue = await this.jsonRpcClient.getStorageAt(
        address,
        // new BN(key, 'hex'),
        bufferToBigInt(key),
        this.forkBlockNumber
      );

      value = unpadBuffer(remoteValue);

      await this.cache.set({
        key: cacheKey,
        value: value,
      });
    }

    return value;
  }

}

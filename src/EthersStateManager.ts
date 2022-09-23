import { blockFromRpc } from '@ethereumjs/block/dist/from-rpc'
import { RLP } from '@ethereumjs/rlp'
import { Trie } from '@ethereumjs/trie'
import {
  Account,
  bigIntToHex,
  bufferToHex,
  intToHex,
  isHexPrefixed,
  toBuffer,
  unpadBuffer,
} from '@ethereumjs/util'
import { JsonRpcProvider, StaticJsonRpcProvider } from '@ethersproject/providers'
import { debug } from 'debug'
import { keccak256 } from 'ethereum-cryptography/keccak'
import { hexToBytes } from 'ethereum-cryptography/utils'

import { 
    BaseStateManager,
    Proof,
    StateManager,
} from '@ethereumjs/statemanager'

import type { Common } from '@ethereumjs/common'
import type { Address, PrefixedHexString } from '@ethereumjs/util'

interface StorageDump {
  [key: string]: string
}

type StorageProof = {
  key: PrefixedHexString
  proof: PrefixedHexString[]
  value: PrefixedHexString
}

const log = debug('statemanager')

type BlockTagType = bigint | 'latest' | 'earliest' | 'pending'
export interface EthersStateManagerOpts {
  provider: string | StaticJsonRpcProvider | JsonRpcProvider
  blockTag?: BlockTagType
}

export class EthersStateManager extends BaseStateManager implements StateManager {
  private provider: StaticJsonRpcProvider | JsonRpcProvider
  private contractCache: Map<string, Buffer>
  private storageTries: { [key: string]: Trie }
  // This map tracks which storage slots for each account have been retrieved from the provider.
  // This ensures that slots retrieved from the provider aren't pulled again and overwrite updates
  // that occur during the course of running EVM message calls.
  private externallyRetrievedStorageKeys: Map<string, Map<string, boolean>>
  private blockTag: string
  private trie: Trie

  constructor(opts: EthersStateManagerOpts) {
    super({})
    // useKeyHashing = true since the web3 api provides proof nodes which are hashed
    // If there were direct api access to devp2p stack, a normal Trie could have been constructed
    this.trie = new Trie({ useKeyHashing: true })
    this.storageTries = {}
    if (typeof opts.provider === 'string') {
      this.provider = new StaticJsonRpcProvider(opts.provider)
    } else if (opts.provider instanceof JsonRpcProvider) {
      this.provider = opts.provider
    } else {
      throw new Error(`valid JsonRpcProvider or url required; got ${opts.provider}`)
    }

    this.blockTag =
      typeof opts.blockTag === 'bigint' ? bigIntToHex(opts.blockTag) : opts.blockTag ?? 'latest'

    this.contractCache = new Map()
    this.externallyRetrievedStorageKeys = new Map<string, Map<string, boolean>>()
  }

  copy(): EthersStateManager {
    const newState = new EthersStateManager({ provider: this.provider })
    ;(newState as any).trie = this.trie.copy(false)
    ;(newState as any).contractCache = new Map(this.contractCache)
    ;(newState as any).externallyRetrievedStorageKeys = new Map(this.externallyRetrievedStorageKeys)
    ;(newState as any).storageTries = { ...this.storageTries }
    return newState
  }

  /**
   * Sets the new block tag used when querying the provider and clears the
   * internal cache.
   * @param blockTag - the new block tag to use when querying the provider
   */
  setBlockTag(blockTag: BlockTagType): void {
    if (typeof blockTag === 'bigint') {
      this.blockTag = bigIntToHex(blockTag)
    } else {
      this.blockTag = blockTag
    }
    this.clearCache()
  }

  /**
   * Clears the internal cache so all accounts, contract code, and storage slots will
   * initially be retrieved from the provider
   */
  clearCache(): void {
    this.contractCache.clear()
    this.storageTries = {}
    this.externallyRetrievedStorageKeys.clear()
  }

  /**
   * Gets the code corresponding to the provided `address`.
   * @param address - Address to get the `code` for
   * @returns {Promise<Buffer>} - Resolves with the code corresponding to the provided address.
   * Returns an empty `Buffer` if the account has no associated code.
   */
  async getContractCode(address: Address): Promise<Buffer> {
    let codeBuffer = this.contractCache.get(address.toString())
    if (codeBuffer !== undefined) return codeBuffer
    const code = await this.provider.getCode(address.toString(), this.blockTag)
    codeBuffer = toBuffer(code)
    this.contractCache.set(address.toString(), codeBuffer)
    return codeBuffer
  }

  /**
   * Adds `value` to the state trie as code, and sets `codeHash` on the account
   * corresponding to `address` to reference this.
   * @param address - Address of the `account` to add the `code` for
   * @param value - The value of the `code`
   */
  async putContractCode(address: Address, value: Buffer): Promise<void> {
    // Store contract code in the cache
    this.contractCache.set(address.toString(), value)
  }

  /**
   * Gets the storage value associated with the provided `address` and `key`. This method returns
   * the shortest representation of the stored value.
   * @param address - Address of the account to get the storage for
   * @param key - Key in the account's storage to get the value for. Must be 32 bytes long.
   * @returns {Buffer} - The storage value for the account
   * corresponding to the provided address at the provided key.
   * If this does not exist an empty `Buffer` is returned.
   */
  async getContractStorage(address: Address, key: Buffer): Promise<Buffer> {
    // Ensure storage slot trie nodes have been retrieved from provider
    await this.getContractStorageFromProvider(address, key)

    const storageTrie = await this._getStorageTrie(address)
    const foundValue = await storageTrie.get(key)
    return Buffer.from(RLP.decode(Uint8Array.from(foundValue ?? [])) as Uint8Array)
  }

  /**
   * Retrieves a storage slot from the provider and stores the proof nodes in the local trie
   * @param address - Address to be retrieved from provider
   * @param key - Key of storage slot to be returned
   * @private
   */
  private async getContractStorageFromProvider(address: Address, key: Buffer): Promise<void> {
    if (this.externallyRetrievedStorageKeys.has(address.toString())) {
      const map = this.externallyRetrievedStorageKeys.get(address.toString())
      if (map?.get(key.toString('hex')) !== undefined) {
        // Return early if slot has already been retrieved from provider
        return
      }
    }

    const accountData = await this.provider.send('eth_getProof', [
      address.toString(),
      [bufferToHex(key)],
      this.blockTag,
    ])

    const rawAccountProofData = accountData.accountProof
    await this.trie.fromProof(rawAccountProofData.map((e: string) => hexToBytes(e)))

    const storageData = accountData.storageProof.find(
      (el: any) => el.key === '0x' + key.toString('hex')
    )

    const storageTrie = await this._getStorageTrie(address)

    await storageTrie.fromProof(storageData.proof.map((e: string) => hexToBytes(e)))

    let map = this.externallyRetrievedStorageKeys.get(address.toString())
    if (!map) {
      this.externallyRetrievedStorageKeys.set(address.toString(), new Map())
      map = this.externallyRetrievedStorageKeys.get(address.toString())!
    }
    map.set(key.toString('hex'), true)
  }

  /**
   * Adds value to the state trie for the `account`
   * corresponding to `address` at the provided `key`.
   * @param address - Address to set a storage value for
   * @param key - Key to set the value at. Must be 32 bytes long.
   * @param value - Value to set at `key` for account corresponding to `address`.
   * Cannot be more than 32 bytes. Leading zeros are stripped.
   * If it is empty or filled with zeros, deletes the value.
   */
  async putContractStorage(address: Address, key: Buffer, value: Buffer): Promise<void> {
    await this.getContractStorageFromProvider(address, key)
    const storageTrie = await this._getStorageTrie(address)

    if (key.length !== 32) {
      throw new Error('Storage key must be 32 bytes long')
    }

    if (value.length > 32) {
      throw new Error('Storage value cannot be longer than 32 bytes')
    }

    value = unpadBuffer(value)
    const encodedValue = Buffer.from(RLP.encode(Uint8Array.from(value)))
    // if (value.length > 0) {
      await storageTrie.put(key, encodedValue)
    // } else {
    //   try {
    //     await storageTrie.del(key)
    //   } catch (err: any) {
    //     if (
    //       err.message === 'Missing node in DB' &&
    //       (err.stack as string).includes('async Trie.del')
    //     ) {
    //       throw new Error(
    //         `This block cannot be run because 0x${key.toString(
    //           'hex'
    //         )} accesses a trie node that cannot be found in the state trie. ${err.toString()}`
    //       )
    //     } else {
    //       throw err
    //     }
    //   }
    // }
    this.storageTries[address.buf.toString('hex')] = storageTrie

    const contract = await this.getAccount(address)
    contract.storageRoot = storageTrie.root()

    await this.putAccount(address, contract)
  }

  /**
   * Clears all storage entries for the account corresponding to `address`.
   * @param address - Address to clear the storage of
   */
  async clearContractStorage(address: Address): Promise<void> {
    const storageTrie = await this._getStorageTrie(address)
    storageTrie.root(this.trie.EMPTY_TRIE_ROOT)
    const contract = await this.getAccount(address)
    contract.storageRoot = storageTrie.root()
    await this.putAccount(address, contract)
  }

  /**
   * Dumps the RLP-encoded storage values for an `account` specified by `address`.
   * @param address - The address of the `account` to return storage for
   * @returns {Promise<StorageDump>} - The state of the account as an `Object` map.
   * Keys are the storage keys, values are the storage values as strings.
   * Both are represented as `0x` prefixed hex strings.
   */
  dumpStorage(address: Address): Promise<StorageDump> {
    return new Promise((resolve, reject) => {
      this._getStorageTrie(address)
        .then((trie) => {
          const storage: StorageDump = {}
          const stream = trie.createReadStream() as any;

          stream.on('data', (val: any) => {
            storage['0x' + val.key.toString('hex')] = '0x' + val.value.toString('hex')
          })
          stream.on('end', () => {
            resolve(storage)
          })
        })
        .catch((e) => {
          reject(e)
        })
    })
  }

  /**
   * Checks if an `account` exists at `address`
   * @param address - Address of the `account` to check
   */
  async accountExists(address: Address): Promise<boolean> {
    log(`Verify if ${address.toString()} exists`)

    // Get merkle proof for `address` from provider
    const proof = await this.provider.send('eth_getProof', [address.toString(), [], this.blockTag])

    const proofBuf = proof.accountProof.map((proofNode: string) => toBuffer(proofNode))

    const trie = new Trie({ useKeyHashing: true })
    const verified = await trie.verifyProof(
      Buffer.from(keccak256(proofBuf[0])),
      address.buf,
      proofBuf
    )
    // if not verified (i.e. verifyProof returns null), account does not exist
    return verified === null ? false : true
  }

  /**
   * Gets the code corresponding to the provided `address`.
   * @param address - Address to get the `code` for
   * @returns {Promise<Buffer>} - Resolves with the code corresponding to the provided address.
   * Returns an empty `Buffer` if the account has no associated code.
   */
  async getAccount(address: Address): Promise<Account> {
    const accountBuffer = await this.trie.get(address.buf)
    let account: Account

    if (accountBuffer === null) {
      account = await this.getAccountFromProvider(address)
    } else {
      account = Account.fromRlpSerializedAccount(accountBuffer)
    }

    return account
  }

  /**
   * Retrieves an account from the provider and stores in the local trie
   * @param address Address of account to be retrieved from provider
   * @private
   */
  async getAccountFromProvider(address: Address): Promise<Account> {
    const accountData = await this.provider.send('eth_getProof', [
      address.toString(),
      [],
      this.blockTag,
    ])

    const rawData = accountData.accountProof

    await this.trie.fromProof(rawData.map((e: string) => hexToBytes(e)))

    const account = Account.fromAccountData({
      balance: BigInt(accountData.balance),
      nonce: BigInt(accountData.nonce),
      codeHash: toBuffer(accountData.codeHash),
      storageRoot: toBuffer(accountData.storageHash),
    })
    return account
  }

  /**
   * Saves an account into state under the provided `address`.
   * @param address - Address under which to store `account`
   * @param account - The account to store
   */
  async putAccount(address: Address, account: Account): Promise<void> {
    await this.trie.put(address.buf, account.serialize())
  }

  /**
   * Gets the state-root of the Merkle-Patricia trie representation
   * of the state of this StateManager.
   * @returns {Buffer} - Returns the state-root of the `StateManager`
   */
  async getStateRoot(): Promise<Buffer> {
    return this.trie.root()
  }

  /**
   * Sets the state of the instance to that represented
   * by the provided `stateRoot`.
   * @param stateRoot - The state-root to reset the instance to
   */
  async setStateRoot(stateRoot: Buffer): Promise<void> {
    this.trie.root(stateRoot)
  }

  /**
   * Checks whether there is a state corresponding to a stateRoot
   */
  async hasStateRoot(root: Buffer): Promise<boolean> {
    const hasRoot = await this.trie.checkRoot(root)
    return hasRoot
  }

  /**
   * Get an EIP-1186 proof
   * @param address address to get proof of
   * @param storageSlots storage slots to get proof of
   * @returns an EIP-1186 formatted proof
   */
  async getProof(address: Address, storageSlots: Buffer[] = []): Promise<Proof> {
    const account = await this.getAccount(address)
    const accountProof: PrefixedHexString[] = (await this.trie.createProof(address.buf)).map((p) =>
      bufferToHex(p)
    )
    const storageProof: StorageProof[] = []
    const storageTrie = await this._getStorageTrie(address)

    for (const storageKey of storageSlots) {
      const proof = (await storageTrie.createProof(storageKey)).map((p) => bufferToHex(p))
      let value = bufferToHex(await this.getContractStorage(address, storageKey))
      if (value === '0x') {
        value = '0x0'
      }
      const proofItem: StorageProof = {
        key: bufferToHex(storageKey),
        value,
        proof,
      }
      storageProof.push(proofItem)
    }

    const returnValue: Proof = {
      address: address.toString(),
      balance: bigIntToHex(account.balance),
      codeHash: bufferToHex(account.codeHash),
      nonce: bigIntToHex(account.nonce),
      storageHash: bufferToHex(account.storageRoot),
      accountProof,
      storageProof,
    }
    return returnValue
  }

  /**
   * Helper method to retrieve a block from the provider to use in the VM
   * @param blockTag block hash or block number to be run
   * @param common Common instance used in VM
   * @returns the block specified by `blockTag`
   */
  getBlockFromProvider = async (blockTag: string | bigint, common: Common) => {
    let blockData
    if (typeof blockTag === 'string' && blockTag.length === 66) {
      blockData = await this.provider.send('eth_getBlockByHash', [blockTag, true])
    } else if (typeof blockTag === 'bigint') {
      blockData = await this.provider.send('eth_getBlockByNumber', [bigIntToHex(blockTag), true])
    } else if (
      isHexPrefixed(blockTag) ||
      blockTag === 'latest' ||
      blockTag === 'earliest' ||
      blockTag === 'pending'
    ) {
      blockData = await this.provider.send('eth_getBlockByNumber', [blockTag, true])
    } else {
      throw new Error(
        `expected blockTag to be block hash, bigint, hex prefixed string, or earliest/latest/pending; got ${blockTag}`
      )
    }

    const uncleHeaders = []
    if (blockData.uncles.length > 0) {
      for (let x = 0; x < blockData.uncles.length; x++) {
        const headerData = await this.provider.send('eth_getUncleByBlockHashAndIndex', [
          blockData.hash,
          intToHex(x),
        ])
        uncleHeaders.push(headerData)
      }
    }

    return blockFromRpc(blockData, uncleHeaders, {
      common,
    })
  }

  /**
   * Creates a storage trie from the primary storage trie
   * for an account and saves this in the storage cache.
   * @private
   */
  private async _lookupStorageTrie(address: Address): Promise<Trie> {
    // from state trie
    const account = await this.getAccount(address)
    const storageTrie = this.trie.copy(false)
    storageTrie.root(account.storageRoot)
    storageTrie.flushCheckpoints()
    return storageTrie
  }

  /**
   * Gets the storage trie for an account from the storage
   * cache or does a lookup.
   * @private
   */
  private async _getStorageTrie(address: Address): Promise<Trie> {
    // from storage cache
    const addressHex = address.buf.toString('hex')
    let storageTrie = this.storageTries[addressHex]
    if (storageTrie === undefined || storageTrie === null) {
      // lookup from state
      storageTrie = await this._lookupStorageTrie(address)
    }
    return storageTrie
  }

  /**
   * Checkpoints the current state of the StateManager instance.
   * State changes that follow can then be committed by calling
   * `commit` or `reverted` by calling rollback.
   */
  async checkpoint(): Promise<void> {
    this.trie.checkpoint()
  }

  /**
   * Commits the current change-set to the instance since the
   * last call to checkpoint.
   */
  async commit(): Promise<void> {
    // setup cache checkpointing
    await this.trie.commit()
  }

  /**
   * Reverts the current change-set to the instance since the
   * last call to checkpoint.
   */
  async revert(): Promise<void> {
    // setup cache checkpointing
    await this.trie.revert()
  }

  /**
   * Dummy method needed by base state manager interface
   */
  async flush(): Promise<void> {
    return Promise.resolve()
  }

  async deleteAccount(address: Address) {
    if (this.DEBUG) {
      this._debug(`Delete account ${address}`)
    }
    this._cache?.del(address)
  }
}

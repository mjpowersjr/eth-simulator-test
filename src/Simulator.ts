import { ethers } from "ethers"
import { Common, Hardfork, Chain } from "@ethereumjs/common";
import { RunTxResult, VM } from '@ethereumjs/vm'
import { ForkStateManager } from './ForkStateManager';
import JsonRpcClient from './JsonRpcClient';
import { TransactionBuilder } from "./TransactionBuilder";
import { BlockBuilder } from "./BlockBuilder";
import { EthersStateManager } from "./EthersStateManager";
import { TransactionFactory } from "@ethereumjs/tx";
import { TypeOutput, setLengthLeft, toBuffer, toType } from '@ethereumjs/util'

function normalizeTxParams(_txParams: any) {
    const txParams = Object.assign({}, _txParams)

    txParams.gasLimit = toType(txParams.gasLimit ?? txParams.gas, TypeOutput.BigInt)
    txParams.data = txParams.data === undefined ? txParams.input : txParams.data

    // check and convert gasPrice and value params
    txParams.gasPrice = txParams.gasPrice !== undefined ? BigInt(txParams.gasPrice) : undefined
    txParams.value = txParams.value !== undefined ? BigInt(txParams.value) : undefined

    // strict byte length checking
    txParams.to =
        txParams.to !== null && txParams.to !== undefined
            ? setLengthLeft(toBuffer(txParams.to), 20)
            : null

    txParams.v = toType(txParams.v, TypeOutput.BigInt)!

    return txParams
}

export class Simulator {
    provider: ethers.providers.JsonRpcProvider;
    jsonRpcClient: JsonRpcClient;

    constructor(provider: ethers.providers.JsonRpcProvider) {
        this.provider = provider;
        this.jsonRpcClient = new JsonRpcClient(provider);
    }

    async simulateExistingTxn(transactionHash: string): Promise<RunTxResult> {
        // build common
        const common = new Common({
            chain: Chain.Mainnet,
            // hardfork: Hardfork.London,
        });

        // collect txn data
        // console.debug(`building txn`);
        const ethersTransaction = await this.provider.getTransaction(transactionHash);
        // const ethersReceipt = await this.provider.getTransactionReceipt(transactionHash);
        // const ethersBlock = await this.provider.getBlock(ethersReceipt.blockNumber);
        // const tx = TransactionBuilder.build(ethersTransaction, ethersReceipt, common);
        if (!ethersTransaction.blockNumber) {
            throw new Error();
        }
        const blockTag = BigInt(ethersTransaction.blockNumber.toString());
        const txData = await this.provider.send('eth_getTransactionByHash', [
            transactionHash,
        ]);

        const normedTx = normalizeTxParams(txData)
        const tx = TransactionFactory.fromTxData(normedTx, { common })

        // Set the common to HF, doesn't impact this specific blockTag, but will impact much recent
        // blocks, also for post merge network, ttd should also be passed
        common.setHardforkByBlockNumber(blockTag - 1n)

        // build block
        // console.debug(`building block`);
        // const block = BlockBuilder.buildFromExisting(ethersBlock, common);

        // build state manager
        // console.debug(`building state manager`);
        // const stateManager = new ForkStateManager({
        //     jsonRpcClient: this.jsonRpcClient,
        //     forkBlockNumber: block.header.number,
        // });

        const stateManager = new EthersStateManager({
            provider: this.provider,
            // Set the state manager to look at the state of the chain before the block has been executed
            blockTag: blockTag - 1n,
        })

        // build vm
        // console.debug(`building vm`);
        const vm = await VM.create({
            common,
            // activatePrecompiles: true,
            stateManager,
        });

        const results = await vm.runTx({
            tx,
            // block,
            // skipBalance: true,
            // reportAccessList: true,
            // skipNonce: true,
        });

        return results;
    }

}

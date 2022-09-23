import { ethers } from "ethers"
import { Common, Hardfork, Chain } from "@ethereumjs/common";
import { RunTxResult, VM } from '@ethereumjs/vm'
import { ForkStateManager } from './ForkStateManager';
import JsonRpcClient from './JsonRpcClient';
import { TransactionBuilder } from "./TransactionBuilder";
import { BlockBuilder } from "./BlockBuilder";

export class Simulator {
    provider: ethers.providers.JsonRpcProvider;
    jsonRpcClient: JsonRpcClient;

    constructor(provider: ethers.providers.JsonRpcProvider) {
        this.provider = provider;
        this.jsonRpcClient = new JsonRpcClient(provider);
    }

    async simulateExistingTxn(transactionHash: string) : Promise<RunTxResult> {
        // build common
        const common = new Common({
            chain: Chain.Mainnet,
        });

        // collect txn data
        // console.debug(`building txn`);
        const ethersTransaction = await this.provider.getTransaction(transactionHash);
        const ethersReceipt = await this.provider.getTransactionReceipt(transactionHash);
        const ethersBlock = await this.provider.getBlock(ethersReceipt.blockNumber);
        const tx = TransactionBuilder.build(ethersTransaction, ethersReceipt, common);

        // build block
        // console.debug(`building block`);
        const block = BlockBuilder.buildFromExisting(ethersBlock, common);

        // build state manager
        // console.debug(`building state manager`);
        const stateManager = new ForkStateManager({
            jsonRpcClient: this.jsonRpcClient,
            forkBlockNumber: block.header.number,
        });

        // build vm
        // console.debug(`building vm`);
        const vm = await VM.create({
            common,
            activatePrecompiles: true,
            stateManager,
        });

        const results = await vm.runTx({
            tx,
            block,
            skipBalance: true,
            reportAccessList: true,
            skipNonce: true,
        });

        return results;
    }

}

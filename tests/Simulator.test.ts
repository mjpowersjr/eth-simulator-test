import { Simulator } from '../src';
import { ethers } from 'ethers';
import {
    TxReceipt,
    PostByzantiumTxReceipt,
} from '@ethereumjs/vm';
import { inspect } from 'node:util';

function assertIsPostByzantiumTxReceipt(receipt: TxReceipt)
    : asserts receipt is PostByzantiumTxReceipt {
    if (!('status' in receipt)) {
        throw new Error(`status is missing`);
    }
}

function summarize(result: any) {
    console.log(inspect(result, false, 4, true));
}

describe('Simulator', () => {

    const timeout = 60_000;
    const chainId = 1;

    let rpcEndpoint: string;
    if (process.env.INFURA_PROJECT_ID) {
        rpcEndpoint = `https://mainnet.infura.io/v3/${process.env.INFURA_PROJECT_ID}`
    } else if (process.env.ETHEREUM_RPC) {
        rpcEndpoint = process.env.ETHEREUM_RPC;
    } else {
        throw new Error(`INFURA_PROJECT_ID or ETHEREUM_RPC env var is required`);
    }
    if (!rpcEndpoint.startsWith('http')) {
        throw new Error(`rpcEndpoint must be http or https`);
    }


    const provider = new ethers.providers.StaticJsonRpcProvider(
        rpcEndpoint,
        chainId,
    );

    const simulator = new Simulator(provider);

    it('simulate existing type:0 txn', async () => {
        // NOTE: pick the first txn from a block due to the fact that we
        // don't currently try and simulate a full block's batch of txns
        const result = await simulator.simulateExistingTxn(
            '0xdc6ad308df2471a4f1a31f30e7b988cf8ecdd960d2164426ef8f4dcfb774abc0'
        );
        // summarize(result);

        assertIsPostByzantiumTxReceipt(result.receipt);
        // expect(result.receipt.cumulativeBlockGasUsed).toEqual(46637n);
        expect(result.receipt.status).toEqual(1);
        expect(result.receipt.logs.length).toEqual(1);
    }, timeout)

    it('simulate existing type:2 txn', async () => {
        // NOTE: pick the first txn from a block due to the fact that we
        // don't currently try and simulate a full block's batch of txns
        const result = await simulator.simulateExistingTxn(
            '0x260017384e32392e7f8386264e1017b6efdf076416905cefd2c7d2f85b364bc5'
        );
        // summarize(result);

        assertIsPostByzantiumTxReceipt(result.receipt);
        expect(result.receipt.cumulativeBlockGasUsed).toEqual(69529n);
        expect(result.receipt.status).toEqual(1);
        expect(result.receipt.logs.length).toEqual(1);
    }, timeout)

    it('simulate existing complex txn', async () => {
        const result = await simulator.simulateExistingTxn(
            '0x80728928c158510863630fda3563024afc47da611ec20f9897ac27236e81dfb3'
        );
        // summarize(result);

        assertIsPostByzantiumTxReceipt(result.receipt);
        // expect(result.receipt.cumulativeBlockGasUsed).toEqual(69529n);
        expect(result.receipt.status).toEqual(1);
        expect(result.receipt.logs.length).toEqual(13);
    }, timeout)


})

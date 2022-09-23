import { Block, BlockHeader } from '@ethereumjs/block';
import { Common } from '@ethereumjs/common';
import { ethers } from 'ethers';

export class BlockBuilder {

    static buildFromExisting(
        blockResponse: ethers.providers.Block,
        common: Common,
    ): Block {

        const baseFeePerGas = blockResponse.baseFeePerGas
            ? BigInt(blockResponse.baseFeePerGas.toHexString())
            : undefined;

        const blockHeader = BlockHeader.fromHeaderData({
            number: blockResponse.number,
            baseFeePerGas,
        },
            {
                common,
            });

        const block = new Block(blockHeader)

        return block;
    }

}

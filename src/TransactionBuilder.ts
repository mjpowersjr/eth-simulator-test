import {
    Transaction,
    FeeMarketEIP1559Transaction,
    TransactionFactory,
} from '@ethereumjs/tx'
import { BigNumber, ethers } from 'ethers';
import { Common } from '@ethereumjs/common';

export class TransactionBuilder {

    static build(
        txnResponse: ethers.providers.TransactionResponse,
        txnReceipt: ethers.providers.TransactionReceipt,
        common: Common
    ) {
        const baseTxData = {
            chainId: BigNumber.from(txnResponse.chainId).toHexString(),
            data: txnResponse.data,
            gasLimit: txnResponse.gasLimit.toHexString(),
            nonce: BigNumber.from(txnResponse.nonce).toHexString(),
            to: txnResponse.to,
            type: BigNumber.from(txnResponse.type).toHexString(),
            value: txnResponse.value.toHexString(),
            r: txnResponse.r,
            s: txnResponse.s,
            v: BigNumber.from(txnResponse.v).toHexString(),
            accessList: txnResponse.accessList || [],
        }

        let transaction: Transaction | FeeMarketEIP1559Transaction;
        let gasData;

        if (common.isActivatedEIP(1559) && (txnResponse.maxPriorityFeePerGas || txnResponse.maxFeePerGas)) {
            gasData = {
                maxPriorityFeePerGas: txnResponse.maxPriorityFeePerGas?.toHexString(),
                maxFeePerGas: txnResponse.maxFeePerGas?.toHexString(),
            }

            transaction = FeeMarketEIP1559Transaction.fromTxData({
                ...baseTxData,
                ...gasData,
            }, { common });

        } else {
            gasData = {
                gasPrice: txnReceipt.effectiveGasPrice.toHexString()
            }

            transaction = TransactionFactory.fromTxData({
                ...baseTxData,
                ...gasData,
            }, { common, freeze: false }) as any;
        }

        // const sender = transaction.getSenderAddress();
        // console.log({
        //     sender,
        // });

        return transaction;
    }
}

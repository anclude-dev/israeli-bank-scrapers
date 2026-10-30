import { type Frame, type Page } from 'puppeteer';
import { type TransferDetails } from '../transactions';
type TransferEntry = TransferDetails & {
    date: string;
    amount: number;
};
export type TransferLookup = {
    date: string;
    processingStage: string;
};
type TransferTransaction = {
    date: string;
    debit: string;
    credit: string;
    transferLookup?: TransferLookup;
    transferDetails?: TransferDetails;
};
export declare function transferAmount(value: string): number;
/** Validate the popup layout before interpreting any destination columns. Amounts are in agorot. */
export declare function parseTransferEntries(rows: string[][]): TransferEntry[];
export declare function matchTransferDetails(tx: TransferTransaction, transactions: TransferTransaction[], entries: TransferEntry[]): TransferDetails | undefined;
/** Query the same read-only daily popup as a.PW1[sugbakasha="523"], in the current account/session. */
export declare function enrichShekelTransfers(page: Page | Frame, transactions: TransferTransaction[]): Promise<void>;
export {};

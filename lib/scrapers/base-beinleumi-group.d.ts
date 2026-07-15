import { type Page } from 'puppeteer';
import { TransactionStatuses, type Transaction, type TransactionsAccount } from '../transactions';
import { BaseScraperWithBrowser, type PossibleLoginResults } from './base-scraper-with-browser';
import { type ScraperOptions } from './interface';
type TransactionsTrTds = string[];
interface ScrapedTransaction {
    reference: string;
    date: string;
    credit: string;
    debit: string;
    memo?: string;
    description: string;
    status: TransactionStatuses;
}
/** A `#dataTable040` row: its cell texts, plus whether it links to a SWIFT detail. */
type FcRow = {
    tds: TransactionsTrTds;
    hasDetailLink: boolean;
};
/** An FC transaction, carrying the reference to look a beneficiary up by (transfers only). */
type ScrapedFcTransaction = ScrapedTransaction & {
    detailReference?: string;
};
export declare function getPossibleLoginResults(): PossibleLoginResults;
export declare function createLoginFields(credentials: ScraperSpecificCredentials): {
    selector: string;
    value: string;
}[];
export declare function waitForPostLogin(page: Page): Promise<void>;
/**
 * Ensures the account dropdown is open, then returns the available account labels.
 *
 * This method:
 * - Checks if the dropdown is already open.
 * - If not open, clicks the account selector to open it.
 * - Waits for the dropdown to render.
 * - Extracts and returns the list of available account labels.
 *
 * Graceful handling:
 * - If any error occurs (e.g., selectors not found, timing issues, UI version changes),
 *   the function returns an empty list.
 *
 * @param page Puppeteer Page object.
 * @returns An array of available account labels (e.g., ["127 | XXXX1", "127 | XXXX2"]),
 *          or an empty array if something goes wrong.
 */
export declare function clickAccountSelectorGetAccountIds(page: Page): Promise<string[]>;
/**
 * Selects an account from the dropdown based on the provided account label.
 *
 * This method:
 * - Clicks the account selector button to open the dropdown.
 * - Retrieves the list of available account labels.
 * - Checks if the provided account label exists in the list.
 * - Finds and clicks the matching account option if found.
 *
 * @param page Puppeteer Page object.
 * @param accountLabel The text of the account to select (e.g., "127 | XXXXX").
 * @returns True if the account option was found and clicked; false otherwise.
 */
export declare function selectAccountFromDropdown(page: Page, accountLabel: string): Promise<boolean>;
export declare function foreignCurrencyToIso(label: string): string | undefined;
export declare function extractForeignCurrencyTransactions(rows: FcRow[]): ScrapedFcTransaction[];
export declare function extractForeignCurrencyBalance(rows: FcRow[]): number | undefined;
export declare function convertForeignCurrencyTransactions(txns: ScrapedTransaction[], currency: string, options?: ScraperOptions): Transaction[];
type ScraperSpecificCredentials = {
    username: string;
    password: string;
    expectedForeignCurrencyAccount?: string;
};
declare class BeinleumiGroupBaseScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
    BASE_URL: string;
    LOGIN_URL: string;
    TRANSACTIONS_URL: string;
    FC_TRANSACTIONS_URL: string;
    private expectedForeignCurrencyAccount?;
    getLoginOptions(credentials: ScraperSpecificCredentials): {
        loginUrl: string;
        fields: {
            selector: string;
            value: string;
        }[];
        submitButtonSelector: string;
        postAction: () => Promise<void>;
        possibleResults: PossibleLoginResults;
        preAction: () => Promise<void>;
    };
    fetchData(): Promise<{
        success: boolean;
        accounts: TransactionsAccount[];
    }>;
}
export default BeinleumiGroupBaseScraper;

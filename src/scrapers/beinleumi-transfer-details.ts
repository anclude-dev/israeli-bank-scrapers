import { type Frame, type Page } from 'puppeteer';
import moment from 'moment';
import { type TransferDetails } from '../transactions';
import { getDebug } from '../helpers/debug';

const debug = getDebug('beinleumi');
const HEADERS = ['תאריך', 'שעה', 'סכום', 'בנק', 'סניף', 'מס.חשבון', 'שם', 'מהות העברה', 'מקור פעולה'];
type TransferEntry = TransferDetails & { date: string; amount: number };
export type TransferLookup = { date: string; processingStage: string };
type TransferTransaction = {
  date: string;
  debit: string;
  credit: string;
  transferLookup?: TransferLookup;
  transferDetails?: TransferDetails;
};

const clean = (value: string) =>
  value
    .replace(/[\u200e\u200f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
export function transferAmount(value: string): number {
  const normalized = clean(value);
  return /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(normalized)
    ? Math.round(Number(normalized.replace(/,/g, '')) * 100)
    : NaN;
}

/** Validate the popup layout before interpreting any destination columns. Amounts are in agorot. */
export function parseTransferEntries(rows: string[][]): TransferEntry[] {
  if (rows[0]?.length !== HEADERS.length || HEADERS.some((header, index) => clean(rows[0][index] ?? '') !== header))
    return [];
  return rows.slice(1).flatMap(row => {
    if (row.length !== HEADERS.length) return [];
    const [date, , amountText, bank, branch, account, recipient, purpose] = row.map(clean);
    const amount = transferAmount(amountText);
    if (
      !moment(date, 'DD/MM/YYYY', true).isValid() ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !recipient ||
      !/^\d+$/.test(bank) ||
      !/^\d+$/.test(branch) ||
      !/^[\d-]+$/.test(account)
    )
      return [];
    return [{ date, amount, bank, branch, account, recipient, ...(purpose ? { purpose } : {}) }];
  });
}

export function matchTransferDetails(
  tx: TransferTransaction,
  transactions: TransferTransaction[],
  entries: TransferEntry[],
): TransferDetails | undefined {
  const amount = transferAmount(tx.debit);
  if (
    !tx.transferLookup ||
    tx.date !== tx.transferLookup.date ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    clean(tx.credit)
  )
    return undefined;
  // A daily popup can contain multiple transfers. Never select a recipient by row order.
  // The popup is scoped by posting date, but its date column is the execution
  // date: evening transfers can appear on the following day's statement.
  const matches = entries.filter(entry => {
    const days = moment(tx.date, 'DD/MM/YYYY', true).diff(moment(entry.date, 'DD/MM/YYYY', true), 'days');
    return (days === 0 || days === 1) && entry.amount === amount;
  });
  const sourceMatches = transactions.filter(
    other => other.transferLookup && other.date === tx.date && transferAmount(other.debit) === amount,
  );
  if (matches.length !== 1 || sourceMatches.length !== 1) return undefined;
  const { date: _date, amount: _amount, ...details } = matches[0];
  return details;
}

/** Query the same read-only daily popup as a.PW1[sugbakasha="523"], in the current account/session. */
export async function enrichShekelTransfers(page: Page | Frame, transactions: TransferTransaction[]): Promise<void> {
  const cache = new Map<string, TransferEntry[]>();
  for (const tx of transactions) {
    const lookup = tx.transferLookup;
    if (!lookup || !/^\d{2}\/\d{2}\/\d{4}$/.test(lookup.date) || !/^\d+$/.test(lookup.processingStage)) continue;
    const key = `${lookup.date}:${lookup.processingStage}`;
    if (!cache.has(key)) {
      try {
        const rows = await page.evaluate(async ({ date, processingStage }) => {
          const url = new URL('/MatafServiceServlets/MatafPortalServiceServlet', location.href);
          url.search = new URLSearchParams({
            ajaxAction: 'ajax',
            xslKey: 'ajax',
            fileType: 'html',
            SUGBAKA: '523',
            'IN-SHLVIBUD': processingStage,
            'IN-TR-FROM': date,
            'IN-TR-TILL': date,
            B_SUGBAKA: '077',
          }).toString();
          const response = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(15000) });
          if (!response.ok) return [];
          const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
          return Array.from(doc.querySelectorAll<HTMLTableRowElement>('#dataTable523_ajax tr')).map(row =>
            Array.from(row.cells, cell => cell.textContent ?? ''),
          );
        }, lookup);
        cache.set(key, parseTransferEntries(rows));
      } catch {
        // An expired/unavailable popup must not discard the base transactions or log private HTML.
        debug('Shekel transfer details unavailable; retaining base transactions');
        cache.set(key, []);
      }
    }
    const details = matchTransferDetails(tx, transactions, cache.get(key)!);
    if (details) tx.transferDetails = details;
  }
}

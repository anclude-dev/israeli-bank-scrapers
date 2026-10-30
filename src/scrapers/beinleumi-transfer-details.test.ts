import { type Frame } from 'puppeteer';
import {
  enrichShekelTransfers,
  matchTransferDetails,
  parseTransferEntries,
  transferAmount,
} from './beinleumi-transfer-details';

// Layout verified against the bank's 523 popup; all values here are synthetic.
const header = ['תאריך', 'שעה', 'סכום', 'בנק', 'סניף', 'מס.חשבון', 'שם', 'מהות העברה', 'מקור פעולה'];
const row = (amount = '1,234.50', recipient = 'מוטב לדוגמה', date = '28/10/2026') => [
  date,
  '14:11',
  amount,
  '10',
  '001',
  '000123456',
  recipient,
  'תשלום (הערת לקוח)',
  'אינטרנט',
];
const tx = (debit = '1,234.50') => ({
  date: '28/10/2026',
  debit,
  credit: '\u00a0',
  transferLookup: { date: '28/10/2026', processingStage: '99999999' },
});

describe('Beinleumi shekel transfer details', () => {
  it('reads the verified popup layout and preserves leading account/branch zeros', () => {
    expect(parseTransferEntries([header, row()])).toEqual([
      {
        date: '28/10/2026',
        amount: 123450,
        bank: '10',
        branch: '001',
        account: '000123456',
        recipient: 'מוטב לדוגמה',
        purpose: 'תשלום (הערת לקוח)',
      },
    ]);
  });

  it('rejects changed layouts, login pages, missing recipients and malformed amounts', () => {
    expect(parseTransferEntries([])).toEqual([]);
    expect(parseTransferEntries([[...header].reverse(), row()])).toEqual([]);
    expect(parseTransferEntries([header, row('1,234.50', ''), row('invalid')])).toEqual([]);
    expect(transferAmount('')).toBeNaN();
    expect(transferAmount('\u200e 1,234.50\u200f')).toBe(123450);
  });

  it('matches by date and exact amount rather than popup order', () => {
    const transaction = tx();
    const entries = parseTransferEntries([header, row('999.00', 'אחר'), row()]);
    expect(matchTransferDetails(transaction, [transaction], entries)?.recipient).toBe('מוטב לדוגמה');
    expect(
      matchTransferDetails(
        transaction,
        [transaction],
        parseTransferEntries([header, row('1,234.50', 'אחר', '26/10/2026')]),
      ),
    ).toBeUndefined();
  });

  it('resolves previous-evening execution in the requested posting-day popup', () => {
    const transaction = tx();
    expect(
      matchTransferDetails(
        transaction,
        [transaction],
        parseTransferEntries([header, row('1,234.50', 'מוטב ערב', '27/10/2026')]),
      )?.recipient,
    ).toBe('מוטב ערב');
    expect(
      matchTransferDetails(
        transaction,
        [transaction],
        parseTransferEntries([header, row('1,234.50', 'עתידי', '29/10/2026')]),
      ),
    ).toBeUndefined();
    expect(
      matchTransferDetails(
        transaction,
        [transaction],
        parseTransferEntries([header, row(), row('1,234.50', 'מוטב ערב', '27/10/2026')]),
      ),
    ).toBeUndefined();
  });

  it('leaves equal-amount recipients, duplicate source rows, and daily totals unresolved', () => {
    const transaction = tx();
    const entries = parseTransferEntries([header, row()]);
    expect(
      matchTransferDetails(transaction, [transaction], parseTransferEntries([header, row(), row('1,234.50', 'אחר')])),
    ).toBeUndefined();
    expect(matchTransferDetails(transaction, [transaction, tx()], entries)).toBeUndefined();
    expect(matchTransferDetails(tx('2,469.00'), [tx('2,469.00')], entries)).toBeUndefined();
    expect(matchTransferDetails({ ...transaction, credit: '1.00' }, [transaction], entries)).toBeUndefined();
  });

  it('fetches once per daily popup, matching all page results without changing identity fields', async () => {
    const evaluate = jest.fn().mockResolvedValue([header, row(), row('999.00', 'אחר')]);
    const page = { evaluate } as unknown as Frame;
    const transactions = [tx(), tx('999.00')];
    const before = transactions.map(({ date, debit, credit }) => ({ date, debit, credit }));
    await enrichShekelTransfers(page, transactions);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(transactions.map(({ date, debit, credit }) => ({ date, debit, credit }))).toEqual(before);
    expect(transactions[0]).toHaveProperty('transferDetails.recipient', 'מוטב לדוגמה');
    expect(transactions[1]).toHaveProperty('transferDetails.recipient', 'אחר');
  });

  it('retains base transactions when the bank detail request fails', async () => {
    const evaluate = jest.fn().mockRejectedValue(new Error('timeout'));
    const transactions = [tx(), tx('999.00')];
    await enrichShekelTransfers({ evaluate } as unknown as Frame, transactions);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(transactions[0]).not.toHaveProperty('transferDetails');
  });
});

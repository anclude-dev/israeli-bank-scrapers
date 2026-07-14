import {
  foreignCurrencyToIso,
  extractForeignCurrencyTransactions,
  extractForeignCurrencyBalance,
  convertForeignCurrencyTransactions,
} from './base-beinleumi-group';

// Rows captured verbatim from a live `#dataTable040` (Beinleumi FC / USD account).
// Column order: [balance, value-date, credit, debit, description, branch-code, reference, date]
const REAL_FC_ROWS: string[][] = [
  ['373.65', '', '', '', 'יתרת פתיחה', '', '', ''], // opening balance — no date, must be skipped
  ['', '13/07/2026', '1,000.00', '', 'רכישת מט"ח שער מוסכם', '022', '0', '13/07/2026'], // +1000
  ['', '13/07/2026', '500.00', '', 'רכישת מט"ח שער מוסכם', '022', '0', '13/07/2026'], // +500
  ['', '13/07/2026', '', '1,000.00', 'העברה מחשבון לחשבון', '272', '9160350', '13/07/2026'], // -1000
  ['871.90', '13/07/2026', '', '1.75', 'עמלות מכותבים', '272', '9160350', '13/07/2026'], // -1.75
];

describe('Beinleumi foreign-currency parsing', () => {
  describe('foreignCurrencyToIso', () => {
    it.each([
      ['106 - פמ"ח תאגידים - דולר ארה"ב', 'USD'],
      ['106 - פמ"ח תאגידים - אירו', 'EUR'],
      ['106 - פמ"ח תאגידים - פרנק שויצרי', 'CHF'],
    ])('maps %s → %s', (label, iso) => {
      expect(foreignCurrencyToIso(label)).toBe(iso);
    });

    it('returns undefined for an unmapped label', () => {
      expect(foreignCurrencyToIso('106 - משהו לא ידוע')).toBeUndefined();
    });
  });

  describe('extractForeignCurrencyTransactions', () => {
    const scraped = extractForeignCurrencyTransactions(REAL_FC_ROWS);

    it('skips the opening-balance row (no date)', () => {
      expect(scraped).toHaveLength(4);
    });

    it('reads credit/debit and description positionally', () => {
      expect(scraped[0]).toMatchObject({ credit: '1,000.00', debit: '', description: 'רכישת מט"ח שער מוסכם' });
      expect(scraped[2]).toMatchObject({ credit: '', debit: '1,000.00', description: 'העברה מחשבון לחשבון' });
    });
  });

  describe('extractForeignCurrencyBalance', () => {
    it('returns the last non-empty balance cell', () => {
      expect(extractForeignCurrencyBalance(REAL_FC_ROWS)).toBe(871.9);
    });

    it('returns undefined when no balance is present', () => {
      expect(
        extractForeignCurrencyBalance([['', '13/07/2026', '5.00', '', 'x', '', '1', '13/07/2026']]),
      ).toBeUndefined();
    });
  });

  describe('convertForeignCurrencyTransactions', () => {
    const txns = convertForeignCurrencyTransactions(extractForeignCurrencyTransactions(REAL_FC_ROWS), 'USD');

    it('computes amount as credit − debit', () => {
      expect(txns.map(t => t.chargedAmount)).toEqual([1000, 500, -1000, -1.75]);
    });

    it('stamps the FC currency as originalCurrency and leaves chargedCurrency unset', () => {
      expect(txns.every(t => t.originalCurrency === 'USD')).toBe(true);
      expect(txns.every(t => t.chargedCurrency === undefined)).toBe(true);
    });

    it('mirrors originalAmount and chargedAmount (single-currency account)', () => {
      expect(txns.every(t => t.originalAmount === t.chargedAmount)).toBe(true);
    });

    it('parses the reference into a numeric identifier', () => {
      expect(txns[2].identifier).toBe(9160350);
    });
  });
});

import {
  foreignCurrencyToIso,
  extractForeignCurrencyTransactions,
  extractForeignCurrencyBalance,
  convertForeignCurrencyTransactions,
} from './base-beinleumi-group';

// Rows captured verbatim from a live `#dataTable040` (Beinleumi FC / USD account).
// Column order: [balance, value-date, credit, debit, description, branch-code, reference, date]
// `hasDetailLink` mirrors the אסמכתא cell carrying a `call276` SWIFT link.
const row = (tds: string[], hasDetailLink = false) => ({ tds, hasDetailLink });

const REAL_FC_ROWS = [
  row(['373.65', '', '', '', 'יתרת פתיחה', '', '', '']), // opening balance — no date, must be skipped
  row(['', '13/07/2026', '1,000.00', '', 'רכישת מט"ח שער מוסכם', '022', '0', '13/07/2026']), // +1000, no link
  row(['', '13/07/2026', '500.00', '', 'רכישת מט"ח שער מוסכם', '022', '0', '13/07/2026']), // +500, no link
  row(['', '13/07/2026', '', '1,000.00', 'העברה מחשבון לחשבון', '272', '9160350', '13/07/2026'], true), // -1000, transfer
  row(['871.90', '13/07/2026', '', '1.75', 'עמלות מכותבים', '272', '9160350', '13/07/2026'], true), // -1.75, paired fee
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

    it('marks only the transfer row for beneficiary lookup', () => {
      // the transfer (linked + description contains העברה)
      expect(scraped[2].detailReference).toBe('9160350');
    });

    it('does not mark the paired fee row, though it links to the same SWIFT message', () => {
      expect(scraped[3].description).toBe('עמלות מכותבים');
      expect(scraped[3].detailReference).toBeUndefined();
    });

    it('does not mark unlinked rows (FX purchases)', () => {
      expect(scraped[0].detailReference).toBeUndefined();
      expect(scraped[1].detailReference).toBeUndefined();
    });

    it('does not mark a linked row that is not a transfer (e.g. card settlement)', () => {
      const [cardRow] = extractForeignCurrencyTransactions([
        row(['', '02/06/2026', '', '44.00', 'דיינרס קלאב', '022', '44200', '02/06/2026'], true),
      ]);
      expect(cardRow.detailReference).toBeUndefined();
    });
  });

  describe('extractForeignCurrencyBalance', () => {
    it('returns the last non-empty balance cell', () => {
      expect(extractForeignCurrencyBalance(REAL_FC_ROWS)).toBe(871.9);
    });

    it('returns undefined when no balance is present', () => {
      expect(
        extractForeignCurrencyBalance([row(['', '13/07/2026', '5.00', '', 'x', '', '1', '13/07/2026'])]),
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

    it('carries an already-applied beneficiary prefix through to the description', () => {
      const scraped = extractForeignCurrencyTransactions(REAL_FC_ROWS);
      scraped[2].description = `ANCLUDE LLC – ${scraped[2].description}`;
      const converted = convertForeignCurrencyTransactions(scraped, 'USD');
      expect(converted[2].description).toBe('ANCLUDE LLC – העברה מחשבון לחשבון');
    });
  });
});

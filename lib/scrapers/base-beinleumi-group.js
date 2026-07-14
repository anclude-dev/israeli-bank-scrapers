"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.clickAccountSelectorGetAccountIds = clickAccountSelectorGetAccountIds;
exports.convertForeignCurrencyTransactions = convertForeignCurrencyTransactions;
exports.createLoginFields = createLoginFields;
exports.default = void 0;
exports.extractForeignCurrencyBalance = extractForeignCurrencyBalance;
exports.extractForeignCurrencyTransactions = extractForeignCurrencyTransactions;
exports.foreignCurrencyToIso = foreignCurrencyToIso;
exports.getPossibleLoginResults = getPossibleLoginResults;
exports.selectAccountFromDropdown = selectAccountFromDropdown;
exports.waitForPostLogin = waitForPostLogin;
var _moment = _interopRequireDefault(require("moment"));
var _constants = require("../constants");
var _elementsInteractions = require("../helpers/elements-interactions");
var _debug = require("../helpers/debug");
var _navigation = require("../helpers/navigation");
var _transactions = require("../helpers/transactions");
var _waiting = require("../helpers/waiting");
var _transactions2 = require("../transactions");
var _baseScraperWithBrowser = require("./base-scraper-with-browser");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const DATE_FORMAT = 'DD/MM/YYYY';
const NO_TRANSACTION_IN_DATE_RANGE_TEXT = 'לא נמצאו נתונים בנושא המבוקש';
const DATE_COLUMN_CLASS_COMPLETED = 'date first';
const DATE_COLUMN_CLASS_PENDING = 'first date';
const DESCRIPTION_COLUMN_CLASS_COMPLETED = 'reference wrap_normal';
const DESCRIPTION_COLUMN_CLASS_PENDING = 'details wrap_normal';
const REFERENCE_COLUMN_CLASS = 'details';
const DEBIT_COLUMN_CLASS = 'debit';
const CREDIT_COLUMN_CLASS = 'credit';
const ERROR_MESSAGE_CLASS = 'NO_DATA';
const ACCOUNTS_NUMBER = 'div.fibi_account span.acc_num';
const CLOSE_SEARCH_BY_DATES_BUTTON_CLASS = 'ui-datepicker-close';
const SHOW_SEARCH_BY_DATES_BUTTON_VALUE = 'הצג';
const COMPLETED_TRANSACTIONS_TABLE = 'table#dataTable077';
const PENDING_TRANSACTIONS_TABLE = 'table#dataTable023';
const NEXT_PAGE_LINK = 'a#Npage.paging';
const CURRENT_BALANCE = '.main_balance';
const IFRAME_NAME = 'iframe-old-pages';
const ELEMENT_RENDER_TIMEOUT_MS = 10000;
const debug = (0, _debug.getDebug)('beinleumi');

// --- Foreign-currency (מט"ח) account section --------------------------------
// FC movements are served from the same `iframe-old-pages`, on a separate portal
// page (FC_TRANSACTIONS_URL). Only the Beinleumi (FIBI) subclass sets that URL,
// so the pass is a no-op for any group bank that leaves it empty. The pass is
// additionally gated on `expectedForeignCurrencyAccount` (config), which is both
// the opt-in and a read-only guard: we never touch the top-level account
// switcher (different switcher accounts map to different app profiles).
const FC_CURRENCY_SELECT = 'select#IN-SCH-MTB';
const FC_FROM_DATE_INPUT = 'input#fromDate';
const FC_TILL_DATE_INPUT = 'input#tillDate';
const FC_TRANSACTIONS_TABLE = 'table#dataTable040';
const CURRENT_ACCOUNT_LABEL = 'div.current-account';
// `#dataTable040` has fixed positional columns (some carry a class, some don't),
// so it is parsed by index rather than by column class like the NIS tables:
//   [0] balance  [1] value-date  [2] credit  [3] debit
//   [4] description  [5] branch-code  [6] reference (asmachta)  [7] date
const FC_COL = {
  balance: 0,
  credit: 2,
  debit: 3,
  description: 4,
  reference: 6,
  date: 7
};
// Map the FC currency-dropdown Hebrew label → ISO 4217. Matched by substring
// because each label is padded and prefixed with the account/product name
// (e.g. `106 - פמ"ח תאגידים - דולר ארה"ב`).
const FC_CURRENCY_BY_HEBREW = [[/דולר/, 'USD'], [/אירו|יורו/, 'EUR'], [/פרנק/, 'CHF'], [/שטרלינג|לירה/, 'GBP'], [/יין/, 'JPY'], [/קנד/, 'CAD'], [/אוסטרל/, 'AUD']];
function getPossibleLoginResults() {
  const urls = {};
  urls[_baseScraperWithBrowser.LoginResults.Success] = [/fibi.*accountSummary/,
  // New UI pattern
  /Resources\/PortalNG\/shell/,
  // New UI pattern
  /FibiMenu\/Online/ // Old UI pattern
  ];
  urls[_baseScraperWithBrowser.LoginResults.InvalidPassword] = [/FibiMenu\/Marketing\/Private\/Home/];
  return urls;
}
function createLoginFields(credentials) {
  return [{
    selector: '#username',
    value: credentials.username
  }, {
    selector: '#password',
    value: credentials.password
  }];
}
function getAmountData(amountStr) {
  let amountStrCopy = amountStr.replace(_constants.SHEKEL_CURRENCY_SYMBOL, '');
  amountStrCopy = amountStrCopy.replaceAll(',', '');
  return parseFloat(amountStrCopy);
}
function getTxnAmount(txn) {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}
function convertTransactions(txns, options) {
  return txns.map(txn => {
    const convertedDate = (0, _moment.default)(txn.date, DATE_FORMAT).toISOString();
    const convertedAmount = getTxnAmount(txn);
    const result = {
      type: _transactions2.TransactionTypes.Normal,
      identifier: txn.reference ? parseInt(txn.reference, 10) : undefined,
      date: convertedDate,
      processedDate: convertedDate,
      originalAmount: convertedAmount,
      originalCurrency: _constants.SHEKEL_CURRENCY,
      chargedAmount: convertedAmount,
      status: txn.status,
      description: txn.description,
      memo: txn.memo
    };
    if (options?.includeRawTransaction) {
      result.rawTransaction = (0, _transactions.getRawTransaction)(txn);
    }
    return result;
  });
}
function getTransactionDate(tds, transactionType, transactionsColsTypes) {
  if (transactionType === 'completed') {
    return (tds[transactionsColsTypes[DATE_COLUMN_CLASS_COMPLETED]] || '').trim();
  }
  return (tds[transactionsColsTypes[DATE_COLUMN_CLASS_PENDING]] || '').trim();
}
function getTransactionDescription(tds, transactionType, transactionsColsTypes) {
  if (transactionType === 'completed') {
    return (tds[transactionsColsTypes[DESCRIPTION_COLUMN_CLASS_COMPLETED]] || '').trim();
  }
  return (tds[transactionsColsTypes[DESCRIPTION_COLUMN_CLASS_PENDING]] || '').trim();
}
function getTransactionReference(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[REFERENCE_COLUMN_CLASS]] || '').trim();
}
function getTransactionDebit(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[DEBIT_COLUMN_CLASS]] || '').trim();
}
function getTransactionCredit(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[CREDIT_COLUMN_CLASS]] || '').trim();
}
function extractTransactionDetails(txnRow, transactionStatus, transactionsColsTypes) {
  const tds = txnRow.innerTds;
  const item = {
    status: transactionStatus,
    date: getTransactionDate(tds, transactionStatus, transactionsColsTypes),
    description: getTransactionDescription(tds, transactionStatus, transactionsColsTypes),
    reference: getTransactionReference(tds, transactionsColsTypes),
    debit: getTransactionDebit(tds, transactionsColsTypes),
    credit: getTransactionCredit(tds, transactionsColsTypes)
  };
  return item;
}
async function getTransactionsColsTypeClasses(page, tableLocator) {
  const result = {};
  const typeClassesObjs = await (0, _elementsInteractions.pageEvalAll)(page, `${tableLocator} tbody tr:first-of-type td`, null, tds => {
    return tds.map((td, index) => ({
      colClass: td.getAttribute('class'),
      index
    }));
  });
  for (const typeClassObj of typeClassesObjs) {
    if (typeClassObj.colClass) {
      result[typeClassObj.colClass] = typeClassObj.index;
    }
  }
  return result;
}
function extractTransaction(txns, transactionStatus, txnRow, transactionsColsTypes) {
  const txn = extractTransactionDetails(txnRow, transactionStatus, transactionsColsTypes);
  if (txn.date !== '') {
    txns.push(txn);
  }
}
async function extractTransactions(page, tableLocator, transactionStatus) {
  const txns = [];
  const transactionsColsTypes = await getTransactionsColsTypeClasses(page, tableLocator);
  const transactionsRows = await (0, _elementsInteractions.pageEvalAll)(page, `${tableLocator} tbody tr`, [], trs => {
    return trs.map(tr => ({
      innerTds: Array.from(tr.getElementsByTagName('td')).map(td => td.innerText)
    }));
  });
  for (const txnRow of transactionsRows) {
    extractTransaction(txns, transactionStatus, txnRow, transactionsColsTypes);
  }
  return txns;
}
async function isNoTransactionInDateRangeError(page) {
  const hasErrorInfoElement = await (0, _elementsInteractions.elementPresentOnPage)(page, `.${ERROR_MESSAGE_CLASS}`);
  if (hasErrorInfoElement) {
    const errorText = await page.$eval(`.${ERROR_MESSAGE_CLASS}`, errorElement => {
      return errorElement.innerText;
    });
    return errorText.trim() === NO_TRANSACTION_IN_DATE_RANGE_TEXT;
  }
  return false;
}
async function searchByDates(page, startDate) {
  await (0, _elementsInteractions.clickButton)(page, 'a#tabHeader4');
  await (0, _elementsInteractions.waitUntilElementFound)(page, 'div#fibi_dates');
  await (0, _elementsInteractions.fillInput)(page, 'input#fromDate', startDate.format(DATE_FORMAT));
  await (0, _elementsInteractions.clickButton)(page, `button[class*=${CLOSE_SEARCH_BY_DATES_BUTTON_CLASS}]`);
  await (0, _elementsInteractions.clickButton)(page, `input[value=${SHOW_SEARCH_BY_DATES_BUTTON_VALUE}]`);
  await (0, _navigation.waitForNavigation)(page);
}
async function getAccountNumber(page) {
  // Wait until the account number element is present in the DOM
  await (0, _elementsInteractions.waitUntilElementFound)(page, ACCOUNTS_NUMBER, true, ELEMENT_RENDER_TIMEOUT_MS);
  const selectedSnifAccount = await page.$eval(ACCOUNTS_NUMBER, option => {
    return option.innerText;
  });
  return selectedSnifAccount.replace('/', '_').trim();
}
async function checkIfHasNextPage(page) {
  return (0, _elementsInteractions.elementPresentOnPage)(page, NEXT_PAGE_LINK);
}
async function navigateToNextPage(page) {
  await (0, _elementsInteractions.clickButton)(page, NEXT_PAGE_LINK);
  await (0, _navigation.waitForNavigation)(page);
}

/* Couldn't reproduce scenario with multiple pages of pending transactions - Should support if exists such case.
   needToPaginate is false if scraping pending transactions */
async function scrapeTransactions(page, tableLocator, transactionStatus, needToPaginate, options) {
  const txns = [];
  let hasNextPage = false;
  do {
    const currentPageTxns = await extractTransactions(page, tableLocator, transactionStatus);
    txns.push(...currentPageTxns);
    if (needToPaginate) {
      hasNextPage = await checkIfHasNextPage(page);
      if (hasNextPage) {
        await navigateToNextPage(page);
      }
    }
  } while (hasNextPage);
  return convertTransactions(txns, options);
}
async function getAccountTransactions(page, options) {
  await Promise.race([(0, _elementsInteractions.waitUntilElementFound)(page, "div[id*='divTable']", false), (0, _elementsInteractions.waitUntilElementFound)(page, `.${ERROR_MESSAGE_CLASS}`, false)]);
  const noTransactionInRangeError = await isNoTransactionInDateRangeError(page);
  if (noTransactionInRangeError) {
    return [];
  }
  const pendingTxns = await scrapeTransactions(page, PENDING_TRANSACTIONS_TABLE, _transactions2.TransactionStatuses.Pending, false, options);
  const completedTxns = await scrapeTransactions(page, COMPLETED_TRANSACTIONS_TABLE, _transactions2.TransactionStatuses.Completed, true, options);
  const txns = [...pendingTxns, ...completedTxns];
  return txns;
}
async function getCurrentBalance(page) {
  // Wait for the balance element to appear and be visible
  await (0, _elementsInteractions.waitUntilElementFound)(page, CURRENT_BALANCE, true, ELEMENT_RENDER_TIMEOUT_MS);

  // Extract text content
  const balanceStr = await page.$eval(CURRENT_BALANCE, el => {
    return el.innerText;
  });
  return getAmountData(balanceStr);
}
async function waitForPostLogin(page) {
  return Promise.race([(0, _elementsInteractions.waitUntilElementFound)(page, '#card-header', false),
  // New UI
  (0, _elementsInteractions.waitUntilElementFound)(page, '#account_num', true),
  // New UI
  (0, _elementsInteractions.waitUntilElementFound)(page, '#matafLogoutLink', true),
  // Old UI
  (0, _elementsInteractions.waitUntilElementFound)(page, '#validationMsg', true) // Old UI
  ]);
}
async function fetchAccountData(page, startDate, options) {
  const accountNumber = await getAccountNumber(page);
  const balance = await getCurrentBalance(page);
  await searchByDates(page, startDate);
  const txns = await getAccountTransactions(page, options);
  return {
    accountNumber,
    txns,
    balance
  };
}
async function getAccountIdsOldUI(page) {
  return page.evaluate(() => {
    const selectElement = document.getElementById('account_num_select');
    const options = selectElement ? selectElement.querySelectorAll('option') : [];
    if (!options) return [];
    return Array.from(options, option => option.value);
  });
}

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
async function clickAccountSelectorGetAccountIds(page) {
  try {
    const accountSelector = 'div.current-account'; // Direct selector to clickable element
    const dropdownPanelSelector = 'div.mat-mdc-autocomplete-panel.account-select-dd'; // The dropdown list box
    const optionSelector = 'mat-option .mdc-list-item__primary-text'; // Account option labels

    // Check if dropdown is already open
    const dropdownVisible = await page.$eval(dropdownPanelSelector, el => {
      return el && window.getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
    }).catch(() => false); // catch if dropdown is not in the DOM yet

    if (!dropdownVisible) {
      await (0, _elementsInteractions.waitUntilElementFound)(page, accountSelector, true, ELEMENT_RENDER_TIMEOUT_MS);

      // Click the account selector to open the dropdown
      await (0, _elementsInteractions.clickButton)(page, accountSelector);

      // Wait for the dropdown to open
      await (0, _elementsInteractions.waitUntilElementFound)(page, dropdownPanelSelector, true, ELEMENT_RENDER_TIMEOUT_MS);
    }

    // Extract account labels from the dropdown options
    const accountLabels = await page.$$eval(optionSelector, options => {
      return options.map(option => option.textContent?.trim() || '').filter(label => label !== '');
    });
    return accountLabels;
  } catch (error) {
    return []; // Graceful fallback
  }
}
async function getAccountIdsBothUIs(page) {
  let accountsIds = await clickAccountSelectorGetAccountIds(page);
  if (accountsIds.length === 0) {
    accountsIds = await getAccountIdsOldUI(page);
  }
  return accountsIds;
}

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
async function selectAccountFromDropdown(page, accountLabel) {
  // Call clickAccountSelector to get the available accounts and open the dropdown
  const availableAccounts = await clickAccountSelectorGetAccountIds(page);

  // Check if the account label exists in the available accounts
  if (!availableAccounts.includes(accountLabel)) {
    return false;
  }

  // Wait for the dropdown options to be rendered
  const optionSelector = 'mat-option .mdc-list-item__primary-text';
  await (0, _elementsInteractions.waitUntilElementFound)(page, optionSelector, true, ELEMENT_RENDER_TIMEOUT_MS);

  // Query all matching options
  const accountOptions = await page.$$(optionSelector);

  // Find and click the option matching the accountLabel
  for (const option of accountOptions) {
    const text = await page.evaluate(el => el.textContent?.trim(), option);
    if (text === accountLabel) {
      const optionHandle = await option.evaluateHandle(el => el);
      await page.evaluate(el => el.click(), optionHandle);
      return true;
    }
  }
  return false;
}
async function getTransactionsFrame(page) {
  // Try a few times to find the iframe, as it might not be immediately available
  for (let attempt = 0; attempt < 3; attempt++) {
    await (0, _waiting.sleep)(2000);
    const frames = page.frames();
    const targetFrame = frames.find(f => f.name() === IFRAME_NAME);
    if (targetFrame) {
      return targetFrame;
    }
  }
  return null;
}
async function selectAccountBothUIs(page, accountId) {
  const accountSelected = await selectAccountFromDropdown(page, accountId);
  if (!accountSelected) {
    // Old UI format
    await page.select('#account_num_select', accountId);
    await (0, _elementsInteractions.waitUntilElementFound)(page, '#account_num_select', true);
  }
}
async function fetchAccountDataBothUIs(page, startDate, options) {
  // Try to get the iframe for the new UI
  const frame = await getTransactionsFrame(page);

  // Use the frame if available (new UI), otherwise use the page directly (old UI)
  const targetPage = frame || page;
  return fetchAccountData(targetPage, startDate, options);
}
async function fetchAccounts(page, startDate, options) {
  const accountsIds = await getAccountIdsBothUIs(page);
  if (accountsIds.length === 0) {
    // In case accountsIds could no be parsed just return the transactions of the currently selected account
    const accountData = await fetchAccountDataBothUIs(page, startDate, options);
    return [accountData];
  }
  const accounts = [];
  for (const accountId of accountsIds) {
    await selectAccountBothUIs(page, accountId);
    const accountData = await fetchAccountDataBothUIs(page, startDate, options);
    accounts.push(accountData);
  }
  return accounts;
}
function foreignCurrencyToIso(label) {
  return FC_CURRENCY_BY_HEBREW.find(([re]) => re.test(label))?.[1];
}
async function getForeignCurrencyOptions(frame) {
  return (0, _elementsInteractions.pageEvalAll)(frame, `${FC_CURRENCY_SELECT} option`, [], opts => opts.map(o => ({
    value: o.value,
    label: (o.textContent || '').trim()
  })));
}
async function getForeignCurrencyRows(frame) {
  return (0, _elementsInteractions.pageEvalAll)(frame, `${FC_TRANSACTIONS_TABLE} tbody tr`, [], trs => trs.map(tr => Array.from(tr.getElementsByTagName('td')).map(td => td.innerText)));
}
function extractForeignCurrencyTransactions(rows) {
  const txns = [];
  for (const tds of rows) {
    const date = (tds[FC_COL.date] || '').trim();
    // An empty date cell is the opening-balance (יתרת פתיחה) row — skip it, same
    // as the NIS parser drops rows without a date.
    if (date === '') continue;
    txns.push({
      status: _transactions2.TransactionStatuses.Completed,
      date,
      description: (tds[FC_COL.description] || '').trim(),
      reference: (tds[FC_COL.reference] || '').trim(),
      debit: (tds[FC_COL.debit] || '').trim(),
      credit: (tds[FC_COL.credit] || '').trim()
    });
  }
  return txns;
}
function extractForeignCurrencyBalance(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const balanceStr = (rows[i][FC_COL.balance] || '').trim();
    if (balanceStr !== '') {
      const parsed = getAmountData(balanceStr);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
  }
  return undefined;
}
function convertForeignCurrencyTransactions(txns, currency, options) {
  return txns.map(txn => {
    const convertedDate = (0, _moment.default)(txn.date, DATE_FORMAT).toISOString();
    const convertedAmount = getTxnAmount(txn);
    const result = {
      type: _transactions2.TransactionTypes.Normal,
      identifier: txn.reference ? parseInt(txn.reference, 10) : undefined,
      date: convertedDate,
      processedDate: convertedDate,
      originalAmount: convertedAmount,
      // The FC account's own currency. chargedCurrency is intentionally left
      // unset — downstream consumers fall back to originalCurrency, and the
      // amount is already denominated in that currency (like the Mercury scraper).
      originalCurrency: currency,
      chargedAmount: convertedAmount,
      status: txn.status,
      description: txn.description,
      memo: txn.memo
    };
    if (options?.includeRawTransaction) {
      result.rawTransaction = (0, _transactions.getRawTransaction)(txn);
    }
    return result;
  });
}
async function runForeignCurrencyQuery(frame, currencyOptionValue, startDate) {
  await frame.select(FC_CURRENCY_SELECT, currencyOptionValue);
  await (0, _elementsInteractions.fillInput)(frame, FC_FROM_DATE_INPUT, startDate.format(DATE_FORMAT));
  await (0, _elementsInteractions.fillInput)(frame, FC_TILL_DATE_INPUT, (0, _moment.default)().format(DATE_FORMAT));
  await (0, _elementsInteractions.clickButton)(frame, `input[value=${SHOW_SEARCH_BY_DATES_BUTTON_VALUE}]`);
  await (0, _navigation.waitForNavigation)(frame);
}

/**
 * Scrapes the Beinleumi foreign-currency (מט"ח) current account, one
 * sub-account per currency in the `#IN-SCH-MTB` dropdown.
 *
 * The top-level account switcher is never touched — a different switcher account
 * belongs to a different app profile. Instead we read it (`div.current-account`)
 * and bail if it doesn't match `expectedAccount`, so a wrong login can't record
 * FC rows against the wrong account.
 */
async function fetchForeignCurrencyAccounts(page, expectedAccount, startDate, options) {
  const frame = await getTransactionsFrame(page);
  if (!frame) {
    debug('foreign-currency: transactions iframe not found, skipping');
    return [];
  }
  const selectedAccount = await page.$eval(CURRENT_ACCOUNT_LABEL, el => el.innerText.trim()).catch(() => '');
  if (!selectedAccount.includes(expectedAccount)) {
    debug('foreign-currency: switcher shows "%s", expected "%s" — skipping FC pass', selectedAccount, expectedAccount);
    return [];
  }
  const currencies = await getForeignCurrencyOptions(frame);
  const accounts = [];
  for (const {
    value,
    label
  } of currencies) {
    const currency = foreignCurrencyToIso(label);
    if (!currency) {
      debug('foreign-currency: unmapped currency label "%s" (value %s) — skipping', label, value);
      continue;
    }
    await runForeignCurrencyQuery(frame, value, startDate);
    const accountNumber = `${expectedAccount} ${currency}`;
    if (await isNoTransactionInDateRangeError(frame)) {
      accounts.push({
        accountNumber,
        txns: []
      });
      continue;
    }
    const rows = await getForeignCurrencyRows(frame);
    accounts.push({
      accountNumber,
      balance: extractForeignCurrencyBalance(rows),
      txns: convertForeignCurrencyTransactions(extractForeignCurrencyTransactions(rows), currency, options)
    });
  }
  return accounts;
}
class BeinleumiGroupBaseScraper extends _baseScraperWithBrowser.BaseScraperWithBrowser {
  BASE_URL = '';
  LOGIN_URL = '';
  TRANSACTIONS_URL = '';

  // Empty by default → the FC pass is skipped. Only the Beinleumi (FIBI) subclass
  // sets this to the foreign-currency movements portal URL.
  FC_TRANSACTIONS_URL = '';

  // Captured from credentials in getLoginOptions; gates + guards the FC pass.

  getLoginOptions(credentials) {
    this.expectedForeignCurrencyAccount = credentials.expectedForeignCurrencyAccount;
    return {
      loginUrl: `${this.LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#continueBtn',
      postAction: async () => waitForPostLogin(this.page),
      possibleResults: getPossibleLoginResults(),
      // HACK: For some reason, though the login button (#continueBtn) is present and visible, the click action does not perform.
      // Adding this delay fixes the issue.
      preAction: async () => {
        await (0, _waiting.sleep)(1000);
      }
    };
  }
  async fetchData() {
    const defaultStartMoment = (0, _moment.default)().subtract(1, 'years').add(1, 'day');
    const startMomentLimit = (0, _moment.default)({
      year: 1600
    });
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = _moment.default.max(startMomentLimit, (0, _moment.default)(startDate));
    await this.navigateTo(this.TRANSACTIONS_URL);
    const accounts = await fetchAccounts(this.page, startMoment, this.options);

    // Second pass on the same login: foreign-currency (מט"ח) accounts, which live
    // in a separate portal section the NIS flow never visits. Opt-in + guarded by
    // `expectedForeignCurrencyAccount`; a no-op unless the subclass sets an FC URL.
    if (this.FC_TRANSACTIONS_URL && this.expectedForeignCurrencyAccount) {
      await this.navigateTo(this.FC_TRANSACTIONS_URL);
      const fcAccounts = await fetchForeignCurrencyAccounts(this.page, this.expectedForeignCurrencyAccount, startMoment, this.options);
      accounts.push(...fcAccounts);
    }
    return {
      success: true,
      accounts
    };
  }
}
var _default = exports.default = BeinleumiGroupBaseScraper;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbW9tZW50IiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfY29uc3RhbnRzIiwiX2VsZW1lbnRzSW50ZXJhY3Rpb25zIiwiX2RlYnVnIiwiX25hdmlnYXRpb24iLCJfdHJhbnNhY3Rpb25zIiwiX3dhaXRpbmciLCJfdHJhbnNhY3Rpb25zMiIsIl9iYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiREFURV9GT1JNQVQiLCJOT19UUkFOU0FDVElPTl9JTl9EQVRFX1JBTkdFX1RFWFQiLCJEQVRFX0NPTFVNTl9DTEFTU19DT01QTEVURUQiLCJEQVRFX0NPTFVNTl9DTEFTU19QRU5ESU5HIiwiREVTQ1JJUFRJT05fQ09MVU1OX0NMQVNTX0NPTVBMRVRFRCIsIkRFU0NSSVBUSU9OX0NPTFVNTl9DTEFTU19QRU5ESU5HIiwiUkVGRVJFTkNFX0NPTFVNTl9DTEFTUyIsIkRFQklUX0NPTFVNTl9DTEFTUyIsIkNSRURJVF9DT0xVTU5fQ0xBU1MiLCJFUlJPUl9NRVNTQUdFX0NMQVNTIiwiQUNDT1VOVFNfTlVNQkVSIiwiQ0xPU0VfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9DTEFTUyIsIlNIT1dfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9WQUxVRSIsIkNPTVBMRVRFRF9UUkFOU0FDVElPTlNfVEFCTEUiLCJQRU5ESU5HX1RSQU5TQUNUSU9OU19UQUJMRSIsIk5FWFRfUEFHRV9MSU5LIiwiQ1VSUkVOVF9CQUxBTkNFIiwiSUZSQU1FX05BTUUiLCJFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TIiwiZGVidWciLCJnZXREZWJ1ZyIsIkZDX0NVUlJFTkNZX1NFTEVDVCIsIkZDX0ZST01fREFURV9JTlBVVCIsIkZDX1RJTExfREFURV9JTlBVVCIsIkZDX1RSQU5TQUNUSU9OU19UQUJMRSIsIkNVUlJFTlRfQUNDT1VOVF9MQUJFTCIsIkZDX0NPTCIsImJhbGFuY2UiLCJjcmVkaXQiLCJkZWJpdCIsImRlc2NyaXB0aW9uIiwicmVmZXJlbmNlIiwiZGF0ZSIsIkZDX0NVUlJFTkNZX0JZX0hFQlJFVyIsImdldFBvc3NpYmxlTG9naW5SZXN1bHRzIiwidXJscyIsIkxvZ2luUmVzdWx0cyIsIlN1Y2Nlc3MiLCJJbnZhbGlkUGFzc3dvcmQiLCJjcmVhdGVMb2dpbkZpZWxkcyIsImNyZWRlbnRpYWxzIiwic2VsZWN0b3IiLCJ2YWx1ZSIsInVzZXJuYW1lIiwicGFzc3dvcmQiLCJnZXRBbW91bnREYXRhIiwiYW1vdW50U3RyIiwiYW1vdW50U3RyQ29weSIsInJlcGxhY2UiLCJTSEVLRUxfQ1VSUkVOQ1lfU1lNQk9MIiwicmVwbGFjZUFsbCIsInBhcnNlRmxvYXQiLCJnZXRUeG5BbW91bnQiLCJ0eG4iLCJOdW1iZXIiLCJpc05hTiIsImNvbnZlcnRUcmFuc2FjdGlvbnMiLCJ0eG5zIiwib3B0aW9ucyIsIm1hcCIsImNvbnZlcnRlZERhdGUiLCJtb21lbnQiLCJ0b0lTT1N0cmluZyIsImNvbnZlcnRlZEFtb3VudCIsInJlc3VsdCIsInR5cGUiLCJUcmFuc2FjdGlvblR5cGVzIiwiTm9ybWFsIiwiaWRlbnRpZmllciIsInBhcnNlSW50IiwidW5kZWZpbmVkIiwicHJvY2Vzc2VkRGF0ZSIsIm9yaWdpbmFsQW1vdW50Iiwib3JpZ2luYWxDdXJyZW5jeSIsIlNIRUtFTF9DVVJSRU5DWSIsImNoYXJnZWRBbW91bnQiLCJzdGF0dXMiLCJtZW1vIiwiaW5jbHVkZVJhd1RyYW5zYWN0aW9uIiwicmF3VHJhbnNhY3Rpb24iLCJnZXRSYXdUcmFuc2FjdGlvbiIsImdldFRyYW5zYWN0aW9uRGF0ZSIsInRkcyIsInRyYW5zYWN0aW9uVHlwZSIsInRyYW5zYWN0aW9uc0NvbHNUeXBlcyIsInRyaW0iLCJnZXRUcmFuc2FjdGlvbkRlc2NyaXB0aW9uIiwiZ2V0VHJhbnNhY3Rpb25SZWZlcmVuY2UiLCJnZXRUcmFuc2FjdGlvbkRlYml0IiwiZ2V0VHJhbnNhY3Rpb25DcmVkaXQiLCJleHRyYWN0VHJhbnNhY3Rpb25EZXRhaWxzIiwidHhuUm93IiwidHJhbnNhY3Rpb25TdGF0dXMiLCJpbm5lclRkcyIsIml0ZW0iLCJnZXRUcmFuc2FjdGlvbnNDb2xzVHlwZUNsYXNzZXMiLCJwYWdlIiwidGFibGVMb2NhdG9yIiwidHlwZUNsYXNzZXNPYmpzIiwicGFnZUV2YWxBbGwiLCJ0ZCIsImluZGV4IiwiY29sQ2xhc3MiLCJnZXRBdHRyaWJ1dGUiLCJ0eXBlQ2xhc3NPYmoiLCJleHRyYWN0VHJhbnNhY3Rpb24iLCJwdXNoIiwiZXh0cmFjdFRyYW5zYWN0aW9ucyIsInRyYW5zYWN0aW9uc1Jvd3MiLCJ0cnMiLCJ0ciIsIkFycmF5IiwiZnJvbSIsImdldEVsZW1lbnRzQnlUYWdOYW1lIiwiaW5uZXJUZXh0IiwiaXNOb1RyYW5zYWN0aW9uSW5EYXRlUmFuZ2VFcnJvciIsImhhc0Vycm9ySW5mb0VsZW1lbnQiLCJlbGVtZW50UHJlc2VudE9uUGFnZSIsImVycm9yVGV4dCIsIiRldmFsIiwiZXJyb3JFbGVtZW50Iiwic2VhcmNoQnlEYXRlcyIsInN0YXJ0RGF0ZSIsImNsaWNrQnV0dG9uIiwid2FpdFVudGlsRWxlbWVudEZvdW5kIiwiZmlsbElucHV0IiwiZm9ybWF0Iiwid2FpdEZvck5hdmlnYXRpb24iLCJnZXRBY2NvdW50TnVtYmVyIiwic2VsZWN0ZWRTbmlmQWNjb3VudCIsIm9wdGlvbiIsImNoZWNrSWZIYXNOZXh0UGFnZSIsIm5hdmlnYXRlVG9OZXh0UGFnZSIsInNjcmFwZVRyYW5zYWN0aW9ucyIsIm5lZWRUb1BhZ2luYXRlIiwiaGFzTmV4dFBhZ2UiLCJjdXJyZW50UGFnZVR4bnMiLCJnZXRBY2NvdW50VHJhbnNhY3Rpb25zIiwiUHJvbWlzZSIsInJhY2UiLCJub1RyYW5zYWN0aW9uSW5SYW5nZUVycm9yIiwicGVuZGluZ1R4bnMiLCJUcmFuc2FjdGlvblN0YXR1c2VzIiwiUGVuZGluZyIsImNvbXBsZXRlZFR4bnMiLCJDb21wbGV0ZWQiLCJnZXRDdXJyZW50QmFsYW5jZSIsImJhbGFuY2VTdHIiLCJlbCIsIndhaXRGb3JQb3N0TG9naW4iLCJmZXRjaEFjY291bnREYXRhIiwiYWNjb3VudE51bWJlciIsImdldEFjY291bnRJZHNPbGRVSSIsImV2YWx1YXRlIiwic2VsZWN0RWxlbWVudCIsImRvY3VtZW50IiwiZ2V0RWxlbWVudEJ5SWQiLCJxdWVyeVNlbGVjdG9yQWxsIiwiY2xpY2tBY2NvdW50U2VsZWN0b3JHZXRBY2NvdW50SWRzIiwiYWNjb3VudFNlbGVjdG9yIiwiZHJvcGRvd25QYW5lbFNlbGVjdG9yIiwib3B0aW9uU2VsZWN0b3IiLCJkcm9wZG93blZpc2libGUiLCJ3aW5kb3ciLCJnZXRDb21wdXRlZFN0eWxlIiwiZGlzcGxheSIsIm9mZnNldFBhcmVudCIsImNhdGNoIiwiYWNjb3VudExhYmVscyIsIiQkZXZhbCIsInRleHRDb250ZW50IiwiZmlsdGVyIiwibGFiZWwiLCJlcnJvciIsImdldEFjY291bnRJZHNCb3RoVUlzIiwiYWNjb3VudHNJZHMiLCJsZW5ndGgiLCJzZWxlY3RBY2NvdW50RnJvbURyb3Bkb3duIiwiYWNjb3VudExhYmVsIiwiYXZhaWxhYmxlQWNjb3VudHMiLCJpbmNsdWRlcyIsImFjY291bnRPcHRpb25zIiwiJCQiLCJ0ZXh0Iiwib3B0aW9uSGFuZGxlIiwiZXZhbHVhdGVIYW5kbGUiLCJjbGljayIsImdldFRyYW5zYWN0aW9uc0ZyYW1lIiwiYXR0ZW1wdCIsInNsZWVwIiwiZnJhbWVzIiwidGFyZ2V0RnJhbWUiLCJmaW5kIiwiZiIsIm5hbWUiLCJzZWxlY3RBY2NvdW50Qm90aFVJcyIsImFjY291bnRJZCIsImFjY291bnRTZWxlY3RlZCIsInNlbGVjdCIsImZldGNoQWNjb3VudERhdGFCb3RoVUlzIiwiZnJhbWUiLCJ0YXJnZXRQYWdlIiwiZmV0Y2hBY2NvdW50cyIsImFjY291bnREYXRhIiwiYWNjb3VudHMiLCJmb3JlaWduQ3VycmVuY3lUb0lzbyIsInJlIiwidGVzdCIsImdldEZvcmVpZ25DdXJyZW5jeU9wdGlvbnMiLCJvcHRzIiwibyIsImdldEZvcmVpZ25DdXJyZW5jeVJvd3MiLCJleHRyYWN0Rm9yZWlnbkN1cnJlbmN5VHJhbnNhY3Rpb25zIiwicm93cyIsImV4dHJhY3RGb3JlaWduQ3VycmVuY3lCYWxhbmNlIiwiaSIsInBhcnNlZCIsImNvbnZlcnRGb3JlaWduQ3VycmVuY3lUcmFuc2FjdGlvbnMiLCJjdXJyZW5jeSIsInJ1bkZvcmVpZ25DdXJyZW5jeVF1ZXJ5IiwiY3VycmVuY3lPcHRpb25WYWx1ZSIsImZldGNoRm9yZWlnbkN1cnJlbmN5QWNjb3VudHMiLCJleHBlY3RlZEFjY291bnQiLCJzZWxlY3RlZEFjY291bnQiLCJjdXJyZW5jaWVzIiwiQmVpbmxldW1pR3JvdXBCYXNlU2NyYXBlciIsIkJhc2VTY3JhcGVyV2l0aEJyb3dzZXIiLCJCQVNFX1VSTCIsIkxPR0lOX1VSTCIsIlRSQU5TQUNUSU9OU19VUkwiLCJGQ19UUkFOU0FDVElPTlNfVVJMIiwiZ2V0TG9naW5PcHRpb25zIiwiZXhwZWN0ZWRGb3JlaWduQ3VycmVuY3lBY2NvdW50IiwibG9naW5VcmwiLCJmaWVsZHMiLCJzdWJtaXRCdXR0b25TZWxlY3RvciIsInBvc3RBY3Rpb24iLCJwb3NzaWJsZVJlc3VsdHMiLCJwcmVBY3Rpb24iLCJmZXRjaERhdGEiLCJkZWZhdWx0U3RhcnRNb21lbnQiLCJzdWJ0cmFjdCIsImFkZCIsInN0YXJ0TW9tZW50TGltaXQiLCJ5ZWFyIiwidG9EYXRlIiwic3RhcnRNb21lbnQiLCJtYXgiLCJuYXZpZ2F0ZVRvIiwiZmNBY2NvdW50cyIsInN1Y2Nlc3MiLCJfZGVmYXVsdCIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi9zcmMvc2NyYXBlcnMvYmFzZS1iZWlubGV1bWktZ3JvdXAudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IG1vbWVudCwgeyB0eXBlIE1vbWVudCB9IGZyb20gJ21vbWVudCc7XG5pbXBvcnQgeyB0eXBlIEZyYW1lLCB0eXBlIFBhZ2UgfSBmcm9tICdwdXBwZXRlZXInO1xuaW1wb3J0IHsgU0hFS0VMX0NVUlJFTkNZLCBTSEVLRUxfQ1VSUkVOQ1lfU1lNQk9MIH0gZnJvbSAnLi4vY29uc3RhbnRzJztcbmltcG9ydCB7XG4gIGNsaWNrQnV0dG9uLFxuICBlbGVtZW50UHJlc2VudE9uUGFnZSxcbiAgZmlsbElucHV0LFxuICBwYWdlRXZhbEFsbCxcbiAgd2FpdFVudGlsRWxlbWVudEZvdW5kLFxufSBmcm9tICcuLi9oZWxwZXJzL2VsZW1lbnRzLWludGVyYWN0aW9ucyc7XG5pbXBvcnQgeyBnZXREZWJ1ZyB9IGZyb20gJy4uL2hlbHBlcnMvZGVidWcnO1xuaW1wb3J0IHsgd2FpdEZvck5hdmlnYXRpb24gfSBmcm9tICcuLi9oZWxwZXJzL25hdmlnYXRpb24nO1xuaW1wb3J0IHsgZ2V0UmF3VHJhbnNhY3Rpb24gfSBmcm9tICcuLi9oZWxwZXJzL3RyYW5zYWN0aW9ucyc7XG5pbXBvcnQgeyBzbGVlcCB9IGZyb20gJy4uL2hlbHBlcnMvd2FpdGluZyc7XG5pbXBvcnQgeyBUcmFuc2FjdGlvblN0YXR1c2VzLCBUcmFuc2FjdGlvblR5cGVzLCB0eXBlIFRyYW5zYWN0aW9uLCB0eXBlIFRyYW5zYWN0aW9uc0FjY291bnQgfSBmcm9tICcuLi90cmFuc2FjdGlvbnMnO1xuaW1wb3J0IHsgQmFzZVNjcmFwZXJXaXRoQnJvd3NlciwgTG9naW5SZXN1bHRzLCB0eXBlIFBvc3NpYmxlTG9naW5SZXN1bHRzIH0gZnJvbSAnLi9iYXNlLXNjcmFwZXItd2l0aC1icm93c2VyJztcbmltcG9ydCB7IHR5cGUgU2NyYXBlck9wdGlvbnMgfSBmcm9tICcuL2ludGVyZmFjZSc7XG5cbmNvbnN0IERBVEVfRk9STUFUID0gJ0REL01NL1lZWVknO1xuY29uc3QgTk9fVFJBTlNBQ1RJT05fSU5fREFURV9SQU5HRV9URVhUID0gJ9ec15Ag16DXntem15DXlSDXoNeq15XXoNeZ150g15HXoNeV16nXkCDXlNee15HXlden16knO1xuY29uc3QgREFURV9DT0xVTU5fQ0xBU1NfQ09NUExFVEVEID0gJ2RhdGUgZmlyc3QnO1xuY29uc3QgREFURV9DT0xVTU5fQ0xBU1NfUEVORElORyA9ICdmaXJzdCBkYXRlJztcbmNvbnN0IERFU0NSSVBUSU9OX0NPTFVNTl9DTEFTU19DT01QTEVURUQgPSAncmVmZXJlbmNlIHdyYXBfbm9ybWFsJztcbmNvbnN0IERFU0NSSVBUSU9OX0NPTFVNTl9DTEFTU19QRU5ESU5HID0gJ2RldGFpbHMgd3JhcF9ub3JtYWwnO1xuY29uc3QgUkVGRVJFTkNFX0NPTFVNTl9DTEFTUyA9ICdkZXRhaWxzJztcbmNvbnN0IERFQklUX0NPTFVNTl9DTEFTUyA9ICdkZWJpdCc7XG5jb25zdCBDUkVESVRfQ09MVU1OX0NMQVNTID0gJ2NyZWRpdCc7XG5jb25zdCBFUlJPUl9NRVNTQUdFX0NMQVNTID0gJ05PX0RBVEEnO1xuY29uc3QgQUNDT1VOVFNfTlVNQkVSID0gJ2Rpdi5maWJpX2FjY291bnQgc3Bhbi5hY2NfbnVtJztcbmNvbnN0IENMT1NFX1NFQVJDSF9CWV9EQVRFU19CVVRUT05fQ0xBU1MgPSAndWktZGF0ZXBpY2tlci1jbG9zZSc7XG5jb25zdCBTSE9XX1NFQVJDSF9CWV9EQVRFU19CVVRUT05fVkFMVUUgPSAn15TXpteSJztcbmNvbnN0IENPTVBMRVRFRF9UUkFOU0FDVElPTlNfVEFCTEUgPSAndGFibGUjZGF0YVRhYmxlMDc3JztcbmNvbnN0IFBFTkRJTkdfVFJBTlNBQ1RJT05TX1RBQkxFID0gJ3RhYmxlI2RhdGFUYWJsZTAyMyc7XG5jb25zdCBORVhUX1BBR0VfTElOSyA9ICdhI05wYWdlLnBhZ2luZyc7XG5jb25zdCBDVVJSRU5UX0JBTEFOQ0UgPSAnLm1haW5fYmFsYW5jZSc7XG5jb25zdCBJRlJBTUVfTkFNRSA9ICdpZnJhbWUtb2xkLXBhZ2VzJztcbmNvbnN0IEVMRU1FTlRfUkVOREVSX1RJTUVPVVRfTVMgPSAxMDAwMDtcblxuY29uc3QgZGVidWcgPSBnZXREZWJ1ZygnYmVpbmxldW1pJyk7XG5cbi8vIC0tLSBGb3JlaWduLWN1cnJlbmN5ICjXnteYXCLXlykgYWNjb3VudCBzZWN0aW9uIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBGQyBtb3ZlbWVudHMgYXJlIHNlcnZlZCBmcm9tIHRoZSBzYW1lIGBpZnJhbWUtb2xkLXBhZ2VzYCwgb24gYSBzZXBhcmF0ZSBwb3J0YWxcbi8vIHBhZ2UgKEZDX1RSQU5TQUNUSU9OU19VUkwpLiBPbmx5IHRoZSBCZWlubGV1bWkgKEZJQkkpIHN1YmNsYXNzIHNldHMgdGhhdCBVUkwsXG4vLyBzbyB0aGUgcGFzcyBpcyBhIG5vLW9wIGZvciBhbnkgZ3JvdXAgYmFuayB0aGF0IGxlYXZlcyBpdCBlbXB0eS4gVGhlIHBhc3MgaXNcbi8vIGFkZGl0aW9uYWxseSBnYXRlZCBvbiBgZXhwZWN0ZWRGb3JlaWduQ3VycmVuY3lBY2NvdW50YCAoY29uZmlnKSwgd2hpY2ggaXMgYm90aFxuLy8gdGhlIG9wdC1pbiBhbmQgYSByZWFkLW9ubHkgZ3VhcmQ6IHdlIG5ldmVyIHRvdWNoIHRoZSB0b3AtbGV2ZWwgYWNjb3VudFxuLy8gc3dpdGNoZXIgKGRpZmZlcmVudCBzd2l0Y2hlciBhY2NvdW50cyBtYXAgdG8gZGlmZmVyZW50IGFwcCBwcm9maWxlcykuXG5jb25zdCBGQ19DVVJSRU5DWV9TRUxFQ1QgPSAnc2VsZWN0I0lOLVNDSC1NVEInO1xuY29uc3QgRkNfRlJPTV9EQVRFX0lOUFVUID0gJ2lucHV0I2Zyb21EYXRlJztcbmNvbnN0IEZDX1RJTExfREFURV9JTlBVVCA9ICdpbnB1dCN0aWxsRGF0ZSc7XG5jb25zdCBGQ19UUkFOU0FDVElPTlNfVEFCTEUgPSAndGFibGUjZGF0YVRhYmxlMDQwJztcbmNvbnN0IENVUlJFTlRfQUNDT1VOVF9MQUJFTCA9ICdkaXYuY3VycmVudC1hY2NvdW50Jztcbi8vIGAjZGF0YVRhYmxlMDQwYCBoYXMgZml4ZWQgcG9zaXRpb25hbCBjb2x1bW5zIChzb21lIGNhcnJ5IGEgY2xhc3MsIHNvbWUgZG9uJ3QpLFxuLy8gc28gaXQgaXMgcGFyc2VkIGJ5IGluZGV4IHJhdGhlciB0aGFuIGJ5IGNvbHVtbiBjbGFzcyBsaWtlIHRoZSBOSVMgdGFibGVzOlxuLy8gICBbMF0gYmFsYW5jZSAgWzFdIHZhbHVlLWRhdGUgIFsyXSBjcmVkaXQgIFszXSBkZWJpdFxuLy8gICBbNF0gZGVzY3JpcHRpb24gIFs1XSBicmFuY2gtY29kZSAgWzZdIHJlZmVyZW5jZSAoYXNtYWNodGEpICBbN10gZGF0ZVxuY29uc3QgRkNfQ09MID0geyBiYWxhbmNlOiAwLCBjcmVkaXQ6IDIsIGRlYml0OiAzLCBkZXNjcmlwdGlvbjogNCwgcmVmZXJlbmNlOiA2LCBkYXRlOiA3IH0gYXMgY29uc3Q7XG4vLyBNYXAgdGhlIEZDIGN1cnJlbmN5LWRyb3Bkb3duIEhlYnJldyBsYWJlbCDihpIgSVNPIDQyMTcuIE1hdGNoZWQgYnkgc3Vic3RyaW5nXG4vLyBiZWNhdXNlIGVhY2ggbGFiZWwgaXMgcGFkZGVkIGFuZCBwcmVmaXhlZCB3aXRoIHRoZSBhY2NvdW50L3Byb2R1Y3QgbmFtZVxuLy8gKGUuZy4gYDEwNiAtINek155cIteXINeq15DXkteZ15PXmdedIC0g15PXldec16gg15DXqNeUXCLXkWApLlxuY29uc3QgRkNfQ1VSUkVOQ1lfQllfSEVCUkVXOiBSZWFkb25seUFycmF5PHJlYWRvbmx5IFtSZWdFeHAsIHN0cmluZ10+ID0gW1xuICBbL9eT15XXnNeoLywgJ1VTRCddLFxuICBbL9eQ15nXqNeVfNeZ15XXqNeVLywgJ0VVUiddLFxuICBbL9ek16jXoNenLywgJ0NIRiddLFxuICBbL9ep15jXqNec15nXoNeSfNec15nXqNeULywgJ0dCUCddLFxuICBbL9eZ15nXny8sICdKUFknXSxcbiAgWy/Xp9eg15MvLCAnQ0FEJ10sXG4gIFsv15DXldeh15jXqNecLywgJ0FVRCddLFxuXTtcblxudHlwZSBUcmFuc2FjdGlvbnNDb2xzVHlwZXMgPSBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+O1xudHlwZSBUcmFuc2FjdGlvbnNUclRkcyA9IHN0cmluZ1tdO1xudHlwZSBUcmFuc2FjdGlvbnNUciA9IHsgaW5uZXJUZHM6IFRyYW5zYWN0aW9uc1RyVGRzIH07XG5cbmludGVyZmFjZSBTY3JhcGVkVHJhbnNhY3Rpb24ge1xuICByZWZlcmVuY2U6IHN0cmluZztcbiAgZGF0ZTogc3RyaW5nO1xuICBjcmVkaXQ6IHN0cmluZztcbiAgZGViaXQ6IHN0cmluZztcbiAgbWVtbz86IHN0cmluZztcbiAgZGVzY3JpcHRpb246IHN0cmluZztcbiAgc3RhdHVzOiBUcmFuc2FjdGlvblN0YXR1c2VzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0UG9zc2libGVMb2dpblJlc3VsdHMoKTogUG9zc2libGVMb2dpblJlc3VsdHMge1xuICBjb25zdCB1cmxzOiBQb3NzaWJsZUxvZ2luUmVzdWx0cyA9IHt9O1xuICB1cmxzW0xvZ2luUmVzdWx0cy5TdWNjZXNzXSA9IFtcbiAgICAvZmliaS4qYWNjb3VudFN1bW1hcnkvLCAvLyBOZXcgVUkgcGF0dGVyblxuICAgIC9SZXNvdXJjZXNcXC9Qb3J0YWxOR1xcL3NoZWxsLywgLy8gTmV3IFVJIHBhdHRlcm5cbiAgICAvRmliaU1lbnVcXC9PbmxpbmUvLCAvLyBPbGQgVUkgcGF0dGVyblxuICBdO1xuICB1cmxzW0xvZ2luUmVzdWx0cy5JbnZhbGlkUGFzc3dvcmRdID0gWy9GaWJpTWVudVxcL01hcmtldGluZ1xcL1ByaXZhdGVcXC9Ib21lL107XG4gIHJldHVybiB1cmxzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlTG9naW5GaWVsZHMoY3JlZGVudGlhbHM6IFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzKSB7XG4gIHJldHVybiBbXG4gICAgeyBzZWxlY3RvcjogJyN1c2VybmFtZScsIHZhbHVlOiBjcmVkZW50aWFscy51c2VybmFtZSB9LFxuICAgIHsgc2VsZWN0b3I6ICcjcGFzc3dvcmQnLCB2YWx1ZTogY3JlZGVudGlhbHMucGFzc3dvcmQgfSxcbiAgXTtcbn1cblxuZnVuY3Rpb24gZ2V0QW1vdW50RGF0YShhbW91bnRTdHI6IHN0cmluZykge1xuICBsZXQgYW1vdW50U3RyQ29weSA9IGFtb3VudFN0ci5yZXBsYWNlKFNIRUtFTF9DVVJSRU5DWV9TWU1CT0wsICcnKTtcbiAgYW1vdW50U3RyQ29weSA9IGFtb3VudFN0ckNvcHkucmVwbGFjZUFsbCgnLCcsICcnKTtcbiAgcmV0dXJuIHBhcnNlRmxvYXQoYW1vdW50U3RyQ29weSk7XG59XG5cbmZ1bmN0aW9uIGdldFR4bkFtb3VudCh0eG46IFNjcmFwZWRUcmFuc2FjdGlvbikge1xuICBjb25zdCBjcmVkaXQgPSBnZXRBbW91bnREYXRhKHR4bi5jcmVkaXQpO1xuICBjb25zdCBkZWJpdCA9IGdldEFtb3VudERhdGEodHhuLmRlYml0KTtcbiAgcmV0dXJuIChOdW1iZXIuaXNOYU4oY3JlZGl0KSA/IDAgOiBjcmVkaXQpIC0gKE51bWJlci5pc05hTihkZWJpdCkgPyAwIDogZGViaXQpO1xufVxuXG5mdW5jdGlvbiBjb252ZXJ0VHJhbnNhY3Rpb25zKHR4bnM6IFNjcmFwZWRUcmFuc2FjdGlvbltdLCBvcHRpb25zPzogU2NyYXBlck9wdGlvbnMpOiBUcmFuc2FjdGlvbltdIHtcbiAgcmV0dXJuIHR4bnMubWFwKCh0eG4pOiBUcmFuc2FjdGlvbiA9PiB7XG4gICAgY29uc3QgY29udmVydGVkRGF0ZSA9IG1vbWVudCh0eG4uZGF0ZSwgREFURV9GT1JNQVQpLnRvSVNPU3RyaW5nKCk7XG4gICAgY29uc3QgY29udmVydGVkQW1vdW50ID0gZ2V0VHhuQW1vdW50KHR4bik7XG4gICAgY29uc3QgcmVzdWx0OiBUcmFuc2FjdGlvbiA9IHtcbiAgICAgIHR5cGU6IFRyYW5zYWN0aW9uVHlwZXMuTm9ybWFsLFxuICAgICAgaWRlbnRpZmllcjogdHhuLnJlZmVyZW5jZSA/IHBhcnNlSW50KHR4bi5yZWZlcmVuY2UsIDEwKSA6IHVuZGVmaW5lZCxcbiAgICAgIGRhdGU6IGNvbnZlcnRlZERhdGUsXG4gICAgICBwcm9jZXNzZWREYXRlOiBjb252ZXJ0ZWREYXRlLFxuICAgICAgb3JpZ2luYWxBbW91bnQ6IGNvbnZlcnRlZEFtb3VudCxcbiAgICAgIG9yaWdpbmFsQ3VycmVuY3k6IFNIRUtFTF9DVVJSRU5DWSxcbiAgICAgIGNoYXJnZWRBbW91bnQ6IGNvbnZlcnRlZEFtb3VudCxcbiAgICAgIHN0YXR1czogdHhuLnN0YXR1cyxcbiAgICAgIGRlc2NyaXB0aW9uOiB0eG4uZGVzY3JpcHRpb24sXG4gICAgICBtZW1vOiB0eG4ubWVtbyxcbiAgICB9O1xuXG4gICAgaWYgKG9wdGlvbnM/LmluY2x1ZGVSYXdUcmFuc2FjdGlvbikge1xuICAgICAgcmVzdWx0LnJhd1RyYW5zYWN0aW9uID0gZ2V0UmF3VHJhbnNhY3Rpb24odHhuKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9KTtcbn1cblxuZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25EYXRlKFxuICB0ZHM6IFRyYW5zYWN0aW9uc1RyVGRzLFxuICB0cmFuc2FjdGlvblR5cGU6IHN0cmluZyxcbiAgdHJhbnNhY3Rpb25zQ29sc1R5cGVzOiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMsXG4pIHtcbiAgaWYgKHRyYW5zYWN0aW9uVHlwZSA9PT0gJ2NvbXBsZXRlZCcpIHtcbiAgICByZXR1cm4gKHRkc1t0cmFuc2FjdGlvbnNDb2xzVHlwZXNbREFURV9DT0xVTU5fQ0xBU1NfQ09NUExFVEVEXV0gfHwgJycpLnRyaW0oKTtcbiAgfVxuICByZXR1cm4gKHRkc1t0cmFuc2FjdGlvbnNDb2xzVHlwZXNbREFURV9DT0xVTU5fQ0xBU1NfUEVORElOR11dIHx8ICcnKS50cmltKCk7XG59XG5cbmZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uRGVzY3JpcHRpb24oXG4gIHRkczogVHJhbnNhY3Rpb25zVHJUZHMsXG4gIHRyYW5zYWN0aW9uVHlwZTogc3RyaW5nLFxuICB0cmFuc2FjdGlvbnNDb2xzVHlwZXM6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcyxcbikge1xuICBpZiAodHJhbnNhY3Rpb25UeXBlID09PSAnY29tcGxldGVkJykge1xuICAgIHJldHVybiAodGRzW3RyYW5zYWN0aW9uc0NvbHNUeXBlc1tERVNDUklQVElPTl9DT0xVTU5fQ0xBU1NfQ09NUExFVEVEXV0gfHwgJycpLnRyaW0oKTtcbiAgfVxuICByZXR1cm4gKHRkc1t0cmFuc2FjdGlvbnNDb2xzVHlwZXNbREVTQ1JJUFRJT05fQ09MVU1OX0NMQVNTX1BFTkRJTkddXSB8fCAnJykudHJpbSgpO1xufVxuXG5mdW5jdGlvbiBnZXRUcmFuc2FjdGlvblJlZmVyZW5jZSh0ZHM6IFRyYW5zYWN0aW9uc1RyVGRzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXM6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcykge1xuICByZXR1cm4gKHRkc1t0cmFuc2FjdGlvbnNDb2xzVHlwZXNbUkVGRVJFTkNFX0NPTFVNTl9DTEFTU11dIHx8ICcnKS50cmltKCk7XG59XG5cbmZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uRGViaXQodGRzOiBUcmFuc2FjdGlvbnNUclRkcywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzOiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMpIHtcbiAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW0RFQklUX0NPTFVNTl9DTEFTU11dIHx8ICcnKS50cmltKCk7XG59XG5cbmZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uQ3JlZGl0KHRkczogVHJhbnNhY3Rpb25zVHJUZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzKSB7XG4gIHJldHVybiAodGRzW3RyYW5zYWN0aW9uc0NvbHNUeXBlc1tDUkVESVRfQ09MVU1OX0NMQVNTXV0gfHwgJycpLnRyaW0oKTtcbn1cblxuZnVuY3Rpb24gZXh0cmFjdFRyYW5zYWN0aW9uRGV0YWlscyhcbiAgdHhuUm93OiBUcmFuc2FjdGlvbnNUcixcbiAgdHJhbnNhY3Rpb25TdGF0dXM6IFRyYW5zYWN0aW9uU3RhdHVzZXMsXG4gIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzLFxuKTogU2NyYXBlZFRyYW5zYWN0aW9uIHtcbiAgY29uc3QgdGRzID0gdHhuUm93LmlubmVyVGRzO1xuICBjb25zdCBpdGVtID0ge1xuICAgIHN0YXR1czogdHJhbnNhY3Rpb25TdGF0dXMsXG4gICAgZGF0ZTogZ2V0VHJhbnNhY3Rpb25EYXRlKHRkcywgdHJhbnNhY3Rpb25TdGF0dXMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlcyksXG4gICAgZGVzY3JpcHRpb246IGdldFRyYW5zYWN0aW9uRGVzY3JpcHRpb24odGRzLCB0cmFuc2FjdGlvblN0YXR1cywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzKSxcbiAgICByZWZlcmVuY2U6IGdldFRyYW5zYWN0aW9uUmVmZXJlbmNlKHRkcywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzKSxcbiAgICBkZWJpdDogZ2V0VHJhbnNhY3Rpb25EZWJpdCh0ZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlcyksXG4gICAgY3JlZGl0OiBnZXRUcmFuc2FjdGlvbkNyZWRpdCh0ZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlcyksXG4gIH07XG5cbiAgcmV0dXJuIGl0ZW07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uc0NvbHNUeXBlQ2xhc3NlcyhcbiAgcGFnZTogUGFnZSB8IEZyYW1lLFxuICB0YWJsZUxvY2F0b3I6IHN0cmluZyxcbik6IFByb21pc2U8VHJhbnNhY3Rpb25zQ29sc1R5cGVzPiB7XG4gIGNvbnN0IHJlc3VsdDogVHJhbnNhY3Rpb25zQ29sc1R5cGVzID0ge307XG4gIGNvbnN0IHR5cGVDbGFzc2VzT2JqcyA9IGF3YWl0IHBhZ2VFdmFsQWxsKHBhZ2UsIGAke3RhYmxlTG9jYXRvcn0gdGJvZHkgdHI6Zmlyc3Qtb2YtdHlwZSB0ZGAsIG51bGwsIHRkcyA9PiB7XG4gICAgcmV0dXJuIHRkcy5tYXAoKHRkLCBpbmRleCkgPT4gKHtcbiAgICAgIGNvbENsYXNzOiB0ZC5nZXRBdHRyaWJ1dGUoJ2NsYXNzJyksXG4gICAgICBpbmRleCxcbiAgICB9KSk7XG4gIH0pO1xuXG4gIGZvciAoY29uc3QgdHlwZUNsYXNzT2JqIG9mIHR5cGVDbGFzc2VzT2Jqcykge1xuICAgIGlmICh0eXBlQ2xhc3NPYmouY29sQ2xhc3MpIHtcbiAgICAgIHJlc3VsdFt0eXBlQ2xhc3NPYmouY29sQ2xhc3NdID0gdHlwZUNsYXNzT2JqLmluZGV4O1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBleHRyYWN0VHJhbnNhY3Rpb24oXG4gIHR4bnM6IFNjcmFwZWRUcmFuc2FjdGlvbltdLFxuICB0cmFuc2FjdGlvblN0YXR1czogVHJhbnNhY3Rpb25TdGF0dXNlcyxcbiAgdHhuUm93OiBUcmFuc2FjdGlvbnNUcixcbiAgdHJhbnNhY3Rpb25zQ29sc1R5cGVzOiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMsXG4pIHtcbiAgY29uc3QgdHhuID0gZXh0cmFjdFRyYW5zYWN0aW9uRGV0YWlscyh0eG5Sb3csIHRyYW5zYWN0aW9uU3RhdHVzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpO1xuICBpZiAodHhuLmRhdGUgIT09ICcnKSB7XG4gICAgdHhucy5wdXNoKHR4bik7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZXh0cmFjdFRyYW5zYWN0aW9ucyhwYWdlOiBQYWdlIHwgRnJhbWUsIHRhYmxlTG9jYXRvcjogc3RyaW5nLCB0cmFuc2FjdGlvblN0YXR1czogVHJhbnNhY3Rpb25TdGF0dXNlcykge1xuICBjb25zdCB0eG5zOiBTY3JhcGVkVHJhbnNhY3Rpb25bXSA9IFtdO1xuICBjb25zdCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMgPSBhd2FpdCBnZXRUcmFuc2FjdGlvbnNDb2xzVHlwZUNsYXNzZXMocGFnZSwgdGFibGVMb2NhdG9yKTtcblxuICBjb25zdCB0cmFuc2FjdGlvbnNSb3dzID0gYXdhaXQgcGFnZUV2YWxBbGw8VHJhbnNhY3Rpb25zVHJbXT4ocGFnZSwgYCR7dGFibGVMb2NhdG9yfSB0Ym9keSB0cmAsIFtdLCB0cnMgPT4ge1xuICAgIHJldHVybiB0cnMubWFwKHRyID0+ICh7XG4gICAgICBpbm5lclRkczogQXJyYXkuZnJvbSh0ci5nZXRFbGVtZW50c0J5VGFnTmFtZSgndGQnKSkubWFwKHRkID0+IHRkLmlubmVyVGV4dCksXG4gICAgfSkpO1xuICB9KTtcblxuICBmb3IgKGNvbnN0IHR4blJvdyBvZiB0cmFuc2FjdGlvbnNSb3dzKSB7XG4gICAgZXh0cmFjdFRyYW5zYWN0aW9uKHR4bnMsIHRyYW5zYWN0aW9uU3RhdHVzLCB0eG5Sb3csIHRyYW5zYWN0aW9uc0NvbHNUeXBlcyk7XG4gIH1cbiAgcmV0dXJuIHR4bnM7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGlzTm9UcmFuc2FjdGlvbkluRGF0ZVJhbmdlRXJyb3IocGFnZTogUGFnZSB8IEZyYW1lKSB7XG4gIGNvbnN0IGhhc0Vycm9ySW5mb0VsZW1lbnQgPSBhd2FpdCBlbGVtZW50UHJlc2VudE9uUGFnZShwYWdlLCBgLiR7RVJST1JfTUVTU0FHRV9DTEFTU31gKTtcbiAgaWYgKGhhc0Vycm9ySW5mb0VsZW1lbnQpIHtcbiAgICBjb25zdCBlcnJvclRleHQgPSBhd2FpdCBwYWdlLiRldmFsKGAuJHtFUlJPUl9NRVNTQUdFX0NMQVNTfWAsIGVycm9yRWxlbWVudCA9PiB7XG4gICAgICByZXR1cm4gKGVycm9yRWxlbWVudCBhcyBIVE1MRWxlbWVudCkuaW5uZXJUZXh0O1xuICAgIH0pO1xuICAgIHJldHVybiBlcnJvclRleHQudHJpbSgpID09PSBOT19UUkFOU0FDVElPTl9JTl9EQVRFX1JBTkdFX1RFWFQ7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzZWFyY2hCeURhdGVzKHBhZ2U6IFBhZ2UgfCBGcmFtZSwgc3RhcnREYXRlOiBNb21lbnQpIHtcbiAgYXdhaXQgY2xpY2tCdXR0b24ocGFnZSwgJ2EjdGFiSGVhZGVyNCcpO1xuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJ2RpdiNmaWJpX2RhdGVzJyk7XG4gIGF3YWl0IGZpbGxJbnB1dChwYWdlLCAnaW5wdXQjZnJvbURhdGUnLCBzdGFydERhdGUuZm9ybWF0KERBVEVfRk9STUFUKSk7XG4gIGF3YWl0IGNsaWNrQnV0dG9uKHBhZ2UsIGBidXR0b25bY2xhc3MqPSR7Q0xPU0VfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9DTEFTU31dYCk7XG4gIGF3YWl0IGNsaWNrQnV0dG9uKHBhZ2UsIGBpbnB1dFt2YWx1ZT0ke1NIT1dfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9WQUxVRX1dYCk7XG4gIGF3YWl0IHdhaXRGb3JOYXZpZ2F0aW9uKHBhZ2UpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRBY2NvdW50TnVtYmVyKHBhZ2U6IFBhZ2UgfCBGcmFtZSk6IFByb21pc2U8c3RyaW5nPiB7XG4gIC8vIFdhaXQgdW50aWwgdGhlIGFjY291bnQgbnVtYmVyIGVsZW1lbnQgaXMgcHJlc2VudCBpbiB0aGUgRE9NXG4gIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCBBQ0NPVU5UU19OVU1CRVIsIHRydWUsIEVMRU1FTlRfUkVOREVSX1RJTUVPVVRfTVMpO1xuXG4gIGNvbnN0IHNlbGVjdGVkU25pZkFjY291bnQgPSBhd2FpdCBwYWdlLiRldmFsKEFDQ09VTlRTX05VTUJFUiwgb3B0aW9uID0+IHtcbiAgICByZXR1cm4gKG9wdGlvbiBhcyBIVE1MRWxlbWVudCkuaW5uZXJUZXh0O1xuICB9KTtcblxuICByZXR1cm4gc2VsZWN0ZWRTbmlmQWNjb3VudC5yZXBsYWNlKCcvJywgJ18nKS50cmltKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNoZWNrSWZIYXNOZXh0UGFnZShwYWdlOiBQYWdlIHwgRnJhbWUpIHtcbiAgcmV0dXJuIGVsZW1lbnRQcmVzZW50T25QYWdlKHBhZ2UsIE5FWFRfUEFHRV9MSU5LKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbmF2aWdhdGVUb05leHRQYWdlKHBhZ2U6IFBhZ2UgfCBGcmFtZSkge1xuICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCBORVhUX1BBR0VfTElOSyk7XG4gIGF3YWl0IHdhaXRGb3JOYXZpZ2F0aW9uKHBhZ2UpO1xufVxuXG4vKiBDb3VsZG4ndCByZXByb2R1Y2Ugc2NlbmFyaW8gd2l0aCBtdWx0aXBsZSBwYWdlcyBvZiBwZW5kaW5nIHRyYW5zYWN0aW9ucyAtIFNob3VsZCBzdXBwb3J0IGlmIGV4aXN0cyBzdWNoIGNhc2UuXG4gICBuZWVkVG9QYWdpbmF0ZSBpcyBmYWxzZSBpZiBzY3JhcGluZyBwZW5kaW5nIHRyYW5zYWN0aW9ucyAqL1xuYXN5bmMgZnVuY3Rpb24gc2NyYXBlVHJhbnNhY3Rpb25zKFxuICBwYWdlOiBQYWdlIHwgRnJhbWUsXG4gIHRhYmxlTG9jYXRvcjogc3RyaW5nLFxuICB0cmFuc2FjdGlvblN0YXR1czogVHJhbnNhY3Rpb25TdGF0dXNlcyxcbiAgbmVlZFRvUGFnaW5hdGU6IGJvb2xlYW4sXG4gIG9wdGlvbnM/OiBTY3JhcGVyT3B0aW9ucyxcbikge1xuICBjb25zdCB0eG5zID0gW107XG4gIGxldCBoYXNOZXh0UGFnZSA9IGZhbHNlO1xuXG4gIGRvIHtcbiAgICBjb25zdCBjdXJyZW50UGFnZVR4bnMgPSBhd2FpdCBleHRyYWN0VHJhbnNhY3Rpb25zKHBhZ2UsIHRhYmxlTG9jYXRvciwgdHJhbnNhY3Rpb25TdGF0dXMpO1xuICAgIHR4bnMucHVzaCguLi5jdXJyZW50UGFnZVR4bnMpO1xuICAgIGlmIChuZWVkVG9QYWdpbmF0ZSkge1xuICAgICAgaGFzTmV4dFBhZ2UgPSBhd2FpdCBjaGVja0lmSGFzTmV4dFBhZ2UocGFnZSk7XG4gICAgICBpZiAoaGFzTmV4dFBhZ2UpIHtcbiAgICAgICAgYXdhaXQgbmF2aWdhdGVUb05leHRQYWdlKHBhZ2UpO1xuICAgICAgfVxuICAgIH1cbiAgfSB3aGlsZSAoaGFzTmV4dFBhZ2UpO1xuXG4gIHJldHVybiBjb252ZXJ0VHJhbnNhY3Rpb25zKHR4bnMsIG9wdGlvbnMpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRBY2NvdW50VHJhbnNhY3Rpb25zKHBhZ2U6IFBhZ2UgfCBGcmFtZSwgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zKSB7XG4gIGF3YWl0IFByb21pc2UucmFjZShbXG4gICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsIFwiZGl2W2lkKj0nZGl2VGFibGUnXVwiLCBmYWxzZSksXG4gICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsIGAuJHtFUlJPUl9NRVNTQUdFX0NMQVNTfWAsIGZhbHNlKSxcbiAgXSk7XG5cbiAgY29uc3Qgbm9UcmFuc2FjdGlvbkluUmFuZ2VFcnJvciA9IGF3YWl0IGlzTm9UcmFuc2FjdGlvbkluRGF0ZVJhbmdlRXJyb3IocGFnZSk7XG4gIGlmIChub1RyYW5zYWN0aW9uSW5SYW5nZUVycm9yKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgY29uc3QgcGVuZGluZ1R4bnMgPSBhd2FpdCBzY3JhcGVUcmFuc2FjdGlvbnMoXG4gICAgcGFnZSxcbiAgICBQRU5ESU5HX1RSQU5TQUNUSU9OU19UQUJMRSxcbiAgICBUcmFuc2FjdGlvblN0YXR1c2VzLlBlbmRpbmcsXG4gICAgZmFsc2UsXG4gICAgb3B0aW9ucyxcbiAgKTtcbiAgY29uc3QgY29tcGxldGVkVHhucyA9IGF3YWl0IHNjcmFwZVRyYW5zYWN0aW9ucyhcbiAgICBwYWdlLFxuICAgIENPTVBMRVRFRF9UUkFOU0FDVElPTlNfVEFCTEUsXG4gICAgVHJhbnNhY3Rpb25TdGF0dXNlcy5Db21wbGV0ZWQsXG4gICAgdHJ1ZSxcbiAgICBvcHRpb25zLFxuICApO1xuICBjb25zdCB0eG5zID0gWy4uLnBlbmRpbmdUeG5zLCAuLi5jb21wbGV0ZWRUeG5zXTtcbiAgcmV0dXJuIHR4bnM7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEN1cnJlbnRCYWxhbmNlKHBhZ2U6IFBhZ2UgfCBGcmFtZSk6IFByb21pc2U8bnVtYmVyPiB7XG4gIC8vIFdhaXQgZm9yIHRoZSBiYWxhbmNlIGVsZW1lbnQgdG8gYXBwZWFyIGFuZCBiZSB2aXNpYmxlXG4gIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCBDVVJSRU5UX0JBTEFOQ0UsIHRydWUsIEVMRU1FTlRfUkVOREVSX1RJTUVPVVRfTVMpO1xuXG4gIC8vIEV4dHJhY3QgdGV4dCBjb250ZW50XG4gIGNvbnN0IGJhbGFuY2VTdHIgPSBhd2FpdCBwYWdlLiRldmFsKENVUlJFTlRfQkFMQU5DRSwgZWwgPT4ge1xuICAgIHJldHVybiAoZWwgYXMgSFRNTEVsZW1lbnQpLmlubmVyVGV4dDtcbiAgfSk7XG5cbiAgcmV0dXJuIGdldEFtb3VudERhdGEoYmFsYW5jZVN0cik7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3YWl0Rm9yUG9zdExvZ2luKHBhZ2U6IFBhZ2UpIHtcbiAgcmV0dXJuIFByb21pc2UucmFjZShbXG4gICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICcjY2FyZC1oZWFkZXInLCBmYWxzZSksIC8vIE5ldyBVSVxuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI2FjY291bnRfbnVtJywgdHJ1ZSksIC8vIE5ldyBVSVxuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI21hdGFmTG9nb3V0TGluaycsIHRydWUpLCAvLyBPbGQgVUlcbiAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyN2YWxpZGF0aW9uTXNnJywgdHJ1ZSksIC8vIE9sZCBVSVxuICBdKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hBY2NvdW50RGF0YShwYWdlOiBQYWdlIHwgRnJhbWUsIHN0YXJ0RGF0ZTogTW9tZW50LCBvcHRpb25zPzogU2NyYXBlck9wdGlvbnMpIHtcbiAgY29uc3QgYWNjb3VudE51bWJlciA9IGF3YWl0IGdldEFjY291bnROdW1iZXIocGFnZSk7XG4gIGNvbnN0IGJhbGFuY2UgPSBhd2FpdCBnZXRDdXJyZW50QmFsYW5jZShwYWdlKTtcbiAgYXdhaXQgc2VhcmNoQnlEYXRlcyhwYWdlLCBzdGFydERhdGUpO1xuICBjb25zdCB0eG5zID0gYXdhaXQgZ2V0QWNjb3VudFRyYW5zYWN0aW9ucyhwYWdlLCBvcHRpb25zKTtcblxuICByZXR1cm4ge1xuICAgIGFjY291bnROdW1iZXIsXG4gICAgdHhucyxcbiAgICBiYWxhbmNlLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRBY2NvdW50SWRzT2xkVUkocGFnZTogUGFnZSk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgcmV0dXJuIHBhZ2UuZXZhbHVhdGUoKCkgPT4ge1xuICAgIGNvbnN0IHNlbGVjdEVsZW1lbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWNjb3VudF9udW1fc2VsZWN0Jyk7XG4gICAgY29uc3Qgb3B0aW9ucyA9IHNlbGVjdEVsZW1lbnQgPyBzZWxlY3RFbGVtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJ29wdGlvbicpIDogW107XG4gICAgaWYgKCFvcHRpb25zKSByZXR1cm4gW107XG4gICAgcmV0dXJuIEFycmF5LmZyb20ob3B0aW9ucywgb3B0aW9uID0+IG9wdGlvbi52YWx1ZSk7XG4gIH0pO1xufVxuXG4vKipcbiAqIEVuc3VyZXMgdGhlIGFjY291bnQgZHJvcGRvd24gaXMgb3BlbiwgdGhlbiByZXR1cm5zIHRoZSBhdmFpbGFibGUgYWNjb3VudCBsYWJlbHMuXG4gKlxuICogVGhpcyBtZXRob2Q6XG4gKiAtIENoZWNrcyBpZiB0aGUgZHJvcGRvd24gaXMgYWxyZWFkeSBvcGVuLlxuICogLSBJZiBub3Qgb3BlbiwgY2xpY2tzIHRoZSBhY2NvdW50IHNlbGVjdG9yIHRvIG9wZW4gaXQuXG4gKiAtIFdhaXRzIGZvciB0aGUgZHJvcGRvd24gdG8gcmVuZGVyLlxuICogLSBFeHRyYWN0cyBhbmQgcmV0dXJucyB0aGUgbGlzdCBvZiBhdmFpbGFibGUgYWNjb3VudCBsYWJlbHMuXG4gKlxuICogR3JhY2VmdWwgaGFuZGxpbmc6XG4gKiAtIElmIGFueSBlcnJvciBvY2N1cnMgKGUuZy4sIHNlbGVjdG9ycyBub3QgZm91bmQsIHRpbWluZyBpc3N1ZXMsIFVJIHZlcnNpb24gY2hhbmdlcyksXG4gKiAgIHRoZSBmdW5jdGlvbiByZXR1cm5zIGFuIGVtcHR5IGxpc3QuXG4gKlxuICogQHBhcmFtIHBhZ2UgUHVwcGV0ZWVyIFBhZ2Ugb2JqZWN0LlxuICogQHJldHVybnMgQW4gYXJyYXkgb2YgYXZhaWxhYmxlIGFjY291bnQgbGFiZWxzIChlLmcuLCBbXCIxMjcgfCBYWFhYMVwiLCBcIjEyNyB8IFhYWFgyXCJdKSxcbiAqICAgICAgICAgIG9yIGFuIGVtcHR5IGFycmF5IGlmIHNvbWV0aGluZyBnb2VzIHdyb25nLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY2xpY2tBY2NvdW50U2VsZWN0b3JHZXRBY2NvdW50SWRzKHBhZ2U6IFBhZ2UpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIHRyeSB7XG4gICAgY29uc3QgYWNjb3VudFNlbGVjdG9yID0gJ2Rpdi5jdXJyZW50LWFjY291bnQnOyAvLyBEaXJlY3Qgc2VsZWN0b3IgdG8gY2xpY2thYmxlIGVsZW1lbnRcbiAgICBjb25zdCBkcm9wZG93blBhbmVsU2VsZWN0b3IgPSAnZGl2Lm1hdC1tZGMtYXV0b2NvbXBsZXRlLXBhbmVsLmFjY291bnQtc2VsZWN0LWRkJzsgLy8gVGhlIGRyb3Bkb3duIGxpc3QgYm94XG4gICAgY29uc3Qgb3B0aW9uU2VsZWN0b3IgPSAnbWF0LW9wdGlvbiAubWRjLWxpc3QtaXRlbV9fcHJpbWFyeS10ZXh0JzsgLy8gQWNjb3VudCBvcHRpb24gbGFiZWxzXG5cbiAgICAvLyBDaGVjayBpZiBkcm9wZG93biBpcyBhbHJlYWR5IG9wZW5cbiAgICBjb25zdCBkcm9wZG93blZpc2libGUgPSBhd2FpdCBwYWdlXG4gICAgICAuJGV2YWwoZHJvcGRvd25QYW5lbFNlbGVjdG9yLCBlbCA9PiB7XG4gICAgICAgIHJldHVybiBlbCAmJiB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShlbCkuZGlzcGxheSAhPT0gJ25vbmUnICYmIGVsLm9mZnNldFBhcmVudCAhPT0gbnVsbDtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goKCkgPT4gZmFsc2UpOyAvLyBjYXRjaCBpZiBkcm9wZG93biBpcyBub3QgaW4gdGhlIERPTSB5ZXRcblxuICAgIGlmICghZHJvcGRvd25WaXNpYmxlKSB7XG4gICAgICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgYWNjb3VudFNlbGVjdG9yLCB0cnVlLCBFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TKTtcblxuICAgICAgLy8gQ2xpY2sgdGhlIGFjY291bnQgc2VsZWN0b3IgdG8gb3BlbiB0aGUgZHJvcGRvd25cbiAgICAgIGF3YWl0IGNsaWNrQnV0dG9uKHBhZ2UsIGFjY291bnRTZWxlY3Rvcik7XG5cbiAgICAgIC8vIFdhaXQgZm9yIHRoZSBkcm9wZG93biB0byBvcGVuXG4gICAgICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgZHJvcGRvd25QYW5lbFNlbGVjdG9yLCB0cnVlLCBFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TKTtcbiAgICB9XG5cbiAgICAvLyBFeHRyYWN0IGFjY291bnQgbGFiZWxzIGZyb20gdGhlIGRyb3Bkb3duIG9wdGlvbnNcbiAgICBjb25zdCBhY2NvdW50TGFiZWxzID0gYXdhaXQgcGFnZS4kJGV2YWwob3B0aW9uU2VsZWN0b3IsIG9wdGlvbnMgPT4ge1xuICAgICAgcmV0dXJuIG9wdGlvbnMubWFwKG9wdGlvbiA9PiBvcHRpb24udGV4dENvbnRlbnQ/LnRyaW0oKSB8fCAnJykuZmlsdGVyKGxhYmVsID0+IGxhYmVsICE9PSAnJyk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gYWNjb3VudExhYmVscztcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZXR1cm4gW107IC8vIEdyYWNlZnVsIGZhbGxiYWNrXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0QWNjb3VudElkc0JvdGhVSXMocGFnZTogUGFnZSk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgbGV0IGFjY291bnRzSWRzOiBzdHJpbmdbXSA9IGF3YWl0IGNsaWNrQWNjb3VudFNlbGVjdG9yR2V0QWNjb3VudElkcyhwYWdlKTtcbiAgaWYgKGFjY291bnRzSWRzLmxlbmd0aCA9PT0gMCkge1xuICAgIGFjY291bnRzSWRzID0gYXdhaXQgZ2V0QWNjb3VudElkc09sZFVJKHBhZ2UpO1xuICB9XG4gIHJldHVybiBhY2NvdW50c0lkcztcbn1cblxuLyoqXG4gKiBTZWxlY3RzIGFuIGFjY291bnQgZnJvbSB0aGUgZHJvcGRvd24gYmFzZWQgb24gdGhlIHByb3ZpZGVkIGFjY291bnQgbGFiZWwuXG4gKlxuICogVGhpcyBtZXRob2Q6XG4gKiAtIENsaWNrcyB0aGUgYWNjb3VudCBzZWxlY3RvciBidXR0b24gdG8gb3BlbiB0aGUgZHJvcGRvd24uXG4gKiAtIFJldHJpZXZlcyB0aGUgbGlzdCBvZiBhdmFpbGFibGUgYWNjb3VudCBsYWJlbHMuXG4gKiAtIENoZWNrcyBpZiB0aGUgcHJvdmlkZWQgYWNjb3VudCBsYWJlbCBleGlzdHMgaW4gdGhlIGxpc3QuXG4gKiAtIEZpbmRzIGFuZCBjbGlja3MgdGhlIG1hdGNoaW5nIGFjY291bnQgb3B0aW9uIGlmIGZvdW5kLlxuICpcbiAqIEBwYXJhbSBwYWdlIFB1cHBldGVlciBQYWdlIG9iamVjdC5cbiAqIEBwYXJhbSBhY2NvdW50TGFiZWwgVGhlIHRleHQgb2YgdGhlIGFjY291bnQgdG8gc2VsZWN0IChlLmcuLCBcIjEyNyB8IFhYWFhYXCIpLlxuICogQHJldHVybnMgVHJ1ZSBpZiB0aGUgYWNjb3VudCBvcHRpb24gd2FzIGZvdW5kIGFuZCBjbGlja2VkOyBmYWxzZSBvdGhlcndpc2UuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzZWxlY3RBY2NvdW50RnJvbURyb3Bkb3duKHBhZ2U6IFBhZ2UsIGFjY291bnRMYWJlbDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIC8vIENhbGwgY2xpY2tBY2NvdW50U2VsZWN0b3IgdG8gZ2V0IHRoZSBhdmFpbGFibGUgYWNjb3VudHMgYW5kIG9wZW4gdGhlIGRyb3Bkb3duXG4gIGNvbnN0IGF2YWlsYWJsZUFjY291bnRzID0gYXdhaXQgY2xpY2tBY2NvdW50U2VsZWN0b3JHZXRBY2NvdW50SWRzKHBhZ2UpO1xuXG4gIC8vIENoZWNrIGlmIHRoZSBhY2NvdW50IGxhYmVsIGV4aXN0cyBpbiB0aGUgYXZhaWxhYmxlIGFjY291bnRzXG4gIGlmICghYXZhaWxhYmxlQWNjb3VudHMuaW5jbHVkZXMoYWNjb3VudExhYmVsKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8vIFdhaXQgZm9yIHRoZSBkcm9wZG93biBvcHRpb25zIHRvIGJlIHJlbmRlcmVkXG4gIGNvbnN0IG9wdGlvblNlbGVjdG9yID0gJ21hdC1vcHRpb24gLm1kYy1saXN0LWl0ZW1fX3ByaW1hcnktdGV4dCc7XG4gIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCBvcHRpb25TZWxlY3RvciwgdHJ1ZSwgRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyk7XG5cbiAgLy8gUXVlcnkgYWxsIG1hdGNoaW5nIG9wdGlvbnNcbiAgY29uc3QgYWNjb3VudE9wdGlvbnMgPSBhd2FpdCBwYWdlLiQkKG9wdGlvblNlbGVjdG9yKTtcblxuICAvLyBGaW5kIGFuZCBjbGljayB0aGUgb3B0aW9uIG1hdGNoaW5nIHRoZSBhY2NvdW50TGFiZWxcbiAgZm9yIChjb25zdCBvcHRpb24gb2YgYWNjb3VudE9wdGlvbnMpIHtcbiAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcGFnZS5ldmFsdWF0ZShlbCA9PiBlbC50ZXh0Q29udGVudD8udHJpbSgpLCBvcHRpb24pO1xuXG4gICAgaWYgKHRleHQgPT09IGFjY291bnRMYWJlbCkge1xuICAgICAgY29uc3Qgb3B0aW9uSGFuZGxlID0gYXdhaXQgb3B0aW9uLmV2YWx1YXRlSGFuZGxlKGVsID0+IGVsIGFzIEhUTUxFbGVtZW50KTtcbiAgICAgIGF3YWl0IHBhZ2UuZXZhbHVhdGUoKGVsOiBIVE1MRWxlbWVudCkgPT4gZWwuY2xpY2soKSwgb3B0aW9uSGFuZGxlKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBmYWxzZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25zRnJhbWUocGFnZTogUGFnZSk6IFByb21pc2U8RnJhbWUgfCBudWxsPiB7XG4gIC8vIFRyeSBhIGZldyB0aW1lcyB0byBmaW5kIHRoZSBpZnJhbWUsIGFzIGl0IG1pZ2h0IG5vdCBiZSBpbW1lZGlhdGVseSBhdmFpbGFibGVcbiAgZm9yIChsZXQgYXR0ZW1wdCA9IDA7IGF0dGVtcHQgPCAzOyBhdHRlbXB0KyspIHtcbiAgICBhd2FpdCBzbGVlcCgyMDAwKTtcbiAgICBjb25zdCBmcmFtZXMgPSBwYWdlLmZyYW1lcygpO1xuICAgIGNvbnN0IHRhcmdldEZyYW1lID0gZnJhbWVzLmZpbmQoZiA9PiBmLm5hbWUoKSA9PT0gSUZSQU1FX05BTUUpO1xuXG4gICAgaWYgKHRhcmdldEZyYW1lKSB7XG4gICAgICByZXR1cm4gdGFyZ2V0RnJhbWU7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG51bGw7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNlbGVjdEFjY291bnRCb3RoVUlzKHBhZ2U6IFBhZ2UsIGFjY291bnRJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGFjY291bnRTZWxlY3RlZCA9IGF3YWl0IHNlbGVjdEFjY291bnRGcm9tRHJvcGRvd24ocGFnZSwgYWNjb3VudElkKTtcbiAgaWYgKCFhY2NvdW50U2VsZWN0ZWQpIHtcbiAgICAvLyBPbGQgVUkgZm9ybWF0XG4gICAgYXdhaXQgcGFnZS5zZWxlY3QoJyNhY2NvdW50X251bV9zZWxlY3QnLCBhY2NvdW50SWQpO1xuICAgIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI2FjY291bnRfbnVtX3NlbGVjdCcsIHRydWUpO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoQWNjb3VudERhdGFCb3RoVUlzKFxuICBwYWdlOiBQYWdlLFxuICBzdGFydERhdGU6IE1vbWVudCxcbiAgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zLFxuKTogUHJvbWlzZTxUcmFuc2FjdGlvbnNBY2NvdW50PiB7XG4gIC8vIFRyeSB0byBnZXQgdGhlIGlmcmFtZSBmb3IgdGhlIG5ldyBVSVxuICBjb25zdCBmcmFtZSA9IGF3YWl0IGdldFRyYW5zYWN0aW9uc0ZyYW1lKHBhZ2UpO1xuXG4gIC8vIFVzZSB0aGUgZnJhbWUgaWYgYXZhaWxhYmxlIChuZXcgVUkpLCBvdGhlcndpc2UgdXNlIHRoZSBwYWdlIGRpcmVjdGx5IChvbGQgVUkpXG4gIGNvbnN0IHRhcmdldFBhZ2UgPSBmcmFtZSB8fCBwYWdlO1xuICByZXR1cm4gZmV0Y2hBY2NvdW50RGF0YSh0YXJnZXRQYWdlLCBzdGFydERhdGUsIG9wdGlvbnMpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaEFjY291bnRzKHBhZ2U6IFBhZ2UsIHN0YXJ0RGF0ZTogTW9tZW50LCBvcHRpb25zPzogU2NyYXBlck9wdGlvbnMpOiBQcm9taXNlPFRyYW5zYWN0aW9uc0FjY291bnRbXT4ge1xuICBjb25zdCBhY2NvdW50c0lkcyA9IGF3YWl0IGdldEFjY291bnRJZHNCb3RoVUlzKHBhZ2UpO1xuXG4gIGlmIChhY2NvdW50c0lkcy5sZW5ndGggPT09IDApIHtcbiAgICAvLyBJbiBjYXNlIGFjY291bnRzSWRzIGNvdWxkIG5vIGJlIHBhcnNlZCBqdXN0IHJldHVybiB0aGUgdHJhbnNhY3Rpb25zIG9mIHRoZSBjdXJyZW50bHkgc2VsZWN0ZWQgYWNjb3VudFxuICAgIGNvbnN0IGFjY291bnREYXRhID0gYXdhaXQgZmV0Y2hBY2NvdW50RGF0YUJvdGhVSXMocGFnZSwgc3RhcnREYXRlLCBvcHRpb25zKTtcbiAgICByZXR1cm4gW2FjY291bnREYXRhXTtcbiAgfVxuXG4gIGNvbnN0IGFjY291bnRzOiBUcmFuc2FjdGlvbnNBY2NvdW50W10gPSBbXTtcbiAgZm9yIChjb25zdCBhY2NvdW50SWQgb2YgYWNjb3VudHNJZHMpIHtcbiAgICBhd2FpdCBzZWxlY3RBY2NvdW50Qm90aFVJcyhwYWdlLCBhY2NvdW50SWQpO1xuICAgIGNvbnN0IGFjY291bnREYXRhID0gYXdhaXQgZmV0Y2hBY2NvdW50RGF0YUJvdGhVSXMocGFnZSwgc3RhcnREYXRlLCBvcHRpb25zKTtcbiAgICBhY2NvdW50cy5wdXNoKGFjY291bnREYXRhKTtcbiAgfVxuXG4gIHJldHVybiBhY2NvdW50cztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZvcmVpZ25DdXJyZW5jeVRvSXNvKGxhYmVsOiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICByZXR1cm4gRkNfQ1VSUkVOQ1lfQllfSEVCUkVXLmZpbmQoKFtyZV0pID0+IHJlLnRlc3QobGFiZWwpKT8uWzFdO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRGb3JlaWduQ3VycmVuY3lPcHRpb25zKGZyYW1lOiBGcmFtZSk6IFByb21pc2U8QXJyYXk8eyB2YWx1ZTogc3RyaW5nOyBsYWJlbDogc3RyaW5nIH0+PiB7XG4gIHJldHVybiBwYWdlRXZhbEFsbDxBcnJheTx7IHZhbHVlOiBzdHJpbmc7IGxhYmVsOiBzdHJpbmcgfT4+KGZyYW1lLCBgJHtGQ19DVVJSRU5DWV9TRUxFQ1R9IG9wdGlvbmAsIFtdLCBvcHRzID0+XG4gICAgb3B0cy5tYXAobyA9PiAoe1xuICAgICAgdmFsdWU6IChvIGFzIEhUTUxPcHRpb25FbGVtZW50KS52YWx1ZSxcbiAgICAgIGxhYmVsOiAoKG8gYXMgSFRNTEVsZW1lbnQpLnRleHRDb250ZW50IHx8ICcnKS50cmltKCksXG4gICAgfSkpLFxuICApO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRGb3JlaWduQ3VycmVuY3lSb3dzKGZyYW1lOiBGcmFtZSk6IFByb21pc2U8VHJhbnNhY3Rpb25zVHJUZHNbXT4ge1xuICByZXR1cm4gcGFnZUV2YWxBbGw8VHJhbnNhY3Rpb25zVHJUZHNbXT4oZnJhbWUsIGAke0ZDX1RSQU5TQUNUSU9OU19UQUJMRX0gdGJvZHkgdHJgLCBbXSwgdHJzID0+XG4gICAgdHJzLm1hcCh0ciA9PiBBcnJheS5mcm9tKHRyLmdldEVsZW1lbnRzQnlUYWdOYW1lKCd0ZCcpKS5tYXAodGQgPT4gKHRkIGFzIEhUTUxFbGVtZW50KS5pbm5lclRleHQpKSxcbiAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RGb3JlaWduQ3VycmVuY3lUcmFuc2FjdGlvbnMocm93czogVHJhbnNhY3Rpb25zVHJUZHNbXSk6IFNjcmFwZWRUcmFuc2FjdGlvbltdIHtcbiAgY29uc3QgdHhuczogU2NyYXBlZFRyYW5zYWN0aW9uW10gPSBbXTtcbiAgZm9yIChjb25zdCB0ZHMgb2Ygcm93cykge1xuICAgIGNvbnN0IGRhdGUgPSAodGRzW0ZDX0NPTC5kYXRlXSB8fCAnJykudHJpbSgpO1xuICAgIC8vIEFuIGVtcHR5IGRhdGUgY2VsbCBpcyB0aGUgb3BlbmluZy1iYWxhbmNlICjXmdeq16jXqiDXpNeq15nXl9eUKSByb3cg4oCUIHNraXAgaXQsIHNhbWVcbiAgICAvLyBhcyB0aGUgTklTIHBhcnNlciBkcm9wcyByb3dzIHdpdGhvdXQgYSBkYXRlLlxuICAgIGlmIChkYXRlID09PSAnJykgY29udGludWU7XG4gICAgdHhucy5wdXNoKHtcbiAgICAgIHN0YXR1czogVHJhbnNhY3Rpb25TdGF0dXNlcy5Db21wbGV0ZWQsXG4gICAgICBkYXRlLFxuICAgICAgZGVzY3JpcHRpb246ICh0ZHNbRkNfQ09MLmRlc2NyaXB0aW9uXSB8fCAnJykudHJpbSgpLFxuICAgICAgcmVmZXJlbmNlOiAodGRzW0ZDX0NPTC5yZWZlcmVuY2VdIHx8ICcnKS50cmltKCksXG4gICAgICBkZWJpdDogKHRkc1tGQ19DT0wuZGViaXRdIHx8ICcnKS50cmltKCksXG4gICAgICBjcmVkaXQ6ICh0ZHNbRkNfQ09MLmNyZWRpdF0gfHwgJycpLnRyaW0oKSxcbiAgICB9KTtcbiAgfVxuICByZXR1cm4gdHhucztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RGb3JlaWduQ3VycmVuY3lCYWxhbmNlKHJvd3M6IFRyYW5zYWN0aW9uc1RyVGRzW10pOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICBmb3IgKGxldCBpID0gcm93cy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGNvbnN0IGJhbGFuY2VTdHIgPSAocm93c1tpXVtGQ19DT0wuYmFsYW5jZV0gfHwgJycpLnRyaW0oKTtcbiAgICBpZiAoYmFsYW5jZVN0ciAhPT0gJycpIHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IGdldEFtb3VudERhdGEoYmFsYW5jZVN0cik7XG4gICAgICByZXR1cm4gTnVtYmVyLmlzTmFOKHBhcnNlZCkgPyB1bmRlZmluZWQgOiBwYXJzZWQ7XG4gICAgfVxuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjb252ZXJ0Rm9yZWlnbkN1cnJlbmN5VHJhbnNhY3Rpb25zKFxuICB0eG5zOiBTY3JhcGVkVHJhbnNhY3Rpb25bXSxcbiAgY3VycmVuY3k6IHN0cmluZyxcbiAgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zLFxuKTogVHJhbnNhY3Rpb25bXSB7XG4gIHJldHVybiB0eG5zLm1hcCgodHhuKTogVHJhbnNhY3Rpb24gPT4ge1xuICAgIGNvbnN0IGNvbnZlcnRlZERhdGUgPSBtb21lbnQodHhuLmRhdGUsIERBVEVfRk9STUFUKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IGNvbnZlcnRlZEFtb3VudCA9IGdldFR4bkFtb3VudCh0eG4pO1xuICAgIGNvbnN0IHJlc3VsdDogVHJhbnNhY3Rpb24gPSB7XG4gICAgICB0eXBlOiBUcmFuc2FjdGlvblR5cGVzLk5vcm1hbCxcbiAgICAgIGlkZW50aWZpZXI6IHR4bi5yZWZlcmVuY2UgPyBwYXJzZUludCh0eG4ucmVmZXJlbmNlLCAxMCkgOiB1bmRlZmluZWQsXG4gICAgICBkYXRlOiBjb252ZXJ0ZWREYXRlLFxuICAgICAgcHJvY2Vzc2VkRGF0ZTogY29udmVydGVkRGF0ZSxcbiAgICAgIG9yaWdpbmFsQW1vdW50OiBjb252ZXJ0ZWRBbW91bnQsXG4gICAgICAvLyBUaGUgRkMgYWNjb3VudCdzIG93biBjdXJyZW5jeS4gY2hhcmdlZEN1cnJlbmN5IGlzIGludGVudGlvbmFsbHkgbGVmdFxuICAgICAgLy8gdW5zZXQg4oCUIGRvd25zdHJlYW0gY29uc3VtZXJzIGZhbGwgYmFjayB0byBvcmlnaW5hbEN1cnJlbmN5LCBhbmQgdGhlXG4gICAgICAvLyBhbW91bnQgaXMgYWxyZWFkeSBkZW5vbWluYXRlZCBpbiB0aGF0IGN1cnJlbmN5IChsaWtlIHRoZSBNZXJjdXJ5IHNjcmFwZXIpLlxuICAgICAgb3JpZ2luYWxDdXJyZW5jeTogY3VycmVuY3ksXG4gICAgICBjaGFyZ2VkQW1vdW50OiBjb252ZXJ0ZWRBbW91bnQsXG4gICAgICBzdGF0dXM6IHR4bi5zdGF0dXMsXG4gICAgICBkZXNjcmlwdGlvbjogdHhuLmRlc2NyaXB0aW9uLFxuICAgICAgbWVtbzogdHhuLm1lbW8sXG4gICAgfTtcblxuICAgIGlmIChvcHRpb25zPy5pbmNsdWRlUmF3VHJhbnNhY3Rpb24pIHtcbiAgICAgIHJlc3VsdC5yYXdUcmFuc2FjdGlvbiA9IGdldFJhd1RyYW5zYWN0aW9uKHR4bik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJ1bkZvcmVpZ25DdXJyZW5jeVF1ZXJ5KGZyYW1lOiBGcmFtZSwgY3VycmVuY3lPcHRpb25WYWx1ZTogc3RyaW5nLCBzdGFydERhdGU6IE1vbWVudCkge1xuICBhd2FpdCBmcmFtZS5zZWxlY3QoRkNfQ1VSUkVOQ1lfU0VMRUNULCBjdXJyZW5jeU9wdGlvblZhbHVlKTtcbiAgYXdhaXQgZmlsbElucHV0KGZyYW1lLCBGQ19GUk9NX0RBVEVfSU5QVVQsIHN0YXJ0RGF0ZS5mb3JtYXQoREFURV9GT1JNQVQpKTtcbiAgYXdhaXQgZmlsbElucHV0KGZyYW1lLCBGQ19USUxMX0RBVEVfSU5QVVQsIG1vbWVudCgpLmZvcm1hdChEQVRFX0ZPUk1BVCkpO1xuICBhd2FpdCBjbGlja0J1dHRvbihmcmFtZSwgYGlucHV0W3ZhbHVlPSR7U0hPV19TRUFSQ0hfQllfREFURVNfQlVUVE9OX1ZBTFVFfV1gKTtcbiAgYXdhaXQgd2FpdEZvck5hdmlnYXRpb24oZnJhbWUpO1xufVxuXG4vKipcbiAqIFNjcmFwZXMgdGhlIEJlaW5sZXVtaSBmb3JlaWduLWN1cnJlbmN5ICjXnteYXCLXlykgY3VycmVudCBhY2NvdW50LCBvbmVcbiAqIHN1Yi1hY2NvdW50IHBlciBjdXJyZW5jeSBpbiB0aGUgYCNJTi1TQ0gtTVRCYCBkcm9wZG93bi5cbiAqXG4gKiBUaGUgdG9wLWxldmVsIGFjY291bnQgc3dpdGNoZXIgaXMgbmV2ZXIgdG91Y2hlZCDigJQgYSBkaWZmZXJlbnQgc3dpdGNoZXIgYWNjb3VudFxuICogYmVsb25ncyB0byBhIGRpZmZlcmVudCBhcHAgcHJvZmlsZS4gSW5zdGVhZCB3ZSByZWFkIGl0IChgZGl2LmN1cnJlbnQtYWNjb3VudGApXG4gKiBhbmQgYmFpbCBpZiBpdCBkb2Vzbid0IG1hdGNoIGBleHBlY3RlZEFjY291bnRgLCBzbyBhIHdyb25nIGxvZ2luIGNhbid0IHJlY29yZFxuICogRkMgcm93cyBhZ2FpbnN0IHRoZSB3cm9uZyBhY2NvdW50LlxuICovXG5hc3luYyBmdW5jdGlvbiBmZXRjaEZvcmVpZ25DdXJyZW5jeUFjY291bnRzKFxuICBwYWdlOiBQYWdlLFxuICBleHBlY3RlZEFjY291bnQ6IHN0cmluZyxcbiAgc3RhcnREYXRlOiBNb21lbnQsXG4gIG9wdGlvbnM/OiBTY3JhcGVyT3B0aW9ucyxcbik6IFByb21pc2U8VHJhbnNhY3Rpb25zQWNjb3VudFtdPiB7XG4gIGNvbnN0IGZyYW1lID0gYXdhaXQgZ2V0VHJhbnNhY3Rpb25zRnJhbWUocGFnZSk7XG4gIGlmICghZnJhbWUpIHtcbiAgICBkZWJ1ZygnZm9yZWlnbi1jdXJyZW5jeTogdHJhbnNhY3Rpb25zIGlmcmFtZSBub3QgZm91bmQsIHNraXBwaW5nJyk7XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgY29uc3Qgc2VsZWN0ZWRBY2NvdW50ID0gYXdhaXQgcGFnZVxuICAgIC4kZXZhbChDVVJSRU5UX0FDQ09VTlRfTEFCRUwsIGVsID0+IChlbCBhcyBIVE1MRWxlbWVudCkuaW5uZXJUZXh0LnRyaW0oKSlcbiAgICAuY2F0Y2goKCkgPT4gJycpO1xuICBpZiAoIXNlbGVjdGVkQWNjb3VudC5pbmNsdWRlcyhleHBlY3RlZEFjY291bnQpKSB7XG4gICAgZGVidWcoJ2ZvcmVpZ24tY3VycmVuY3k6IHN3aXRjaGVyIHNob3dzIFwiJXNcIiwgZXhwZWN0ZWQgXCIlc1wiIOKAlCBza2lwcGluZyBGQyBwYXNzJywgc2VsZWN0ZWRBY2NvdW50LCBleHBlY3RlZEFjY291bnQpO1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIGNvbnN0IGN1cnJlbmNpZXMgPSBhd2FpdCBnZXRGb3JlaWduQ3VycmVuY3lPcHRpb25zKGZyYW1lKTtcbiAgY29uc3QgYWNjb3VudHM6IFRyYW5zYWN0aW9uc0FjY291bnRbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgeyB2YWx1ZSwgbGFiZWwgfSBvZiBjdXJyZW5jaWVzKSB7XG4gICAgY29uc3QgY3VycmVuY3kgPSBmb3JlaWduQ3VycmVuY3lUb0lzbyhsYWJlbCk7XG4gICAgaWYgKCFjdXJyZW5jeSkge1xuICAgICAgZGVidWcoJ2ZvcmVpZ24tY3VycmVuY3k6IHVubWFwcGVkIGN1cnJlbmN5IGxhYmVsIFwiJXNcIiAodmFsdWUgJXMpIOKAlCBza2lwcGluZycsIGxhYmVsLCB2YWx1ZSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBhd2FpdCBydW5Gb3JlaWduQ3VycmVuY3lRdWVyeShmcmFtZSwgdmFsdWUsIHN0YXJ0RGF0ZSk7XG5cbiAgICBjb25zdCBhY2NvdW50TnVtYmVyID0gYCR7ZXhwZWN0ZWRBY2NvdW50fSAke2N1cnJlbmN5fWA7XG4gICAgaWYgKGF3YWl0IGlzTm9UcmFuc2FjdGlvbkluRGF0ZVJhbmdlRXJyb3IoZnJhbWUpKSB7XG4gICAgICBhY2NvdW50cy5wdXNoKHsgYWNjb3VudE51bWJlciwgdHhuczogW10gfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgZ2V0Rm9yZWlnbkN1cnJlbmN5Um93cyhmcmFtZSk7XG4gICAgYWNjb3VudHMucHVzaCh7XG4gICAgICBhY2NvdW50TnVtYmVyLFxuICAgICAgYmFsYW5jZTogZXh0cmFjdEZvcmVpZ25DdXJyZW5jeUJhbGFuY2Uocm93cyksXG4gICAgICB0eG5zOiBjb252ZXJ0Rm9yZWlnbkN1cnJlbmN5VHJhbnNhY3Rpb25zKGV4dHJhY3RGb3JlaWduQ3VycmVuY3lUcmFuc2FjdGlvbnMocm93cyksIGN1cnJlbmN5LCBvcHRpb25zKSxcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiBhY2NvdW50cztcbn1cblxudHlwZSBTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscyA9IHtcbiAgdXNlcm5hbWU6IHN0cmluZztcbiAgcGFzc3dvcmQ6IHN0cmluZztcbiAgLy8gQ29uZmlnLW9ubHkgZmllbGQgKG1vbmV5bWFuKTogdGhlIGJhc2UgYWNjb3VudCB0aGlzIGxvZ2luIGlzIGV4cGVjdGVkIHRvXG4gIC8vIGxhbmQgb24gKGUuZy4gXCIwMzgtMzI5MTQyXCIpLiBQcmVzZW5jZSBvcHRzIHRoZSBsb2dpbiBpbnRvIHRoZSBGQyBwYXNzIGFuZCBpc1xuICAvLyB2ZXJpZmllZCByZWFkLW9ubHkgYWdhaW5zdCB0aGUgYWNjb3VudCBzd2l0Y2hlci4gSWdub3JlZCBieSBsb2dpbiBpdHNlbGYuXG4gIGV4cGVjdGVkRm9yZWlnbkN1cnJlbmN5QWNjb3VudD86IHN0cmluZztcbn07XG5cbmNsYXNzIEJlaW5sZXVtaUdyb3VwQmFzZVNjcmFwZXIgZXh0ZW5kcyBCYXNlU2NyYXBlcldpdGhCcm93c2VyPFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzPiB7XG4gIEJBU0VfVVJMID0gJyc7XG5cbiAgTE9HSU5fVVJMID0gJyc7XG5cbiAgVFJBTlNBQ1RJT05TX1VSTCA9ICcnO1xuXG4gIC8vIEVtcHR5IGJ5IGRlZmF1bHQg4oaSIHRoZSBGQyBwYXNzIGlzIHNraXBwZWQuIE9ubHkgdGhlIEJlaW5sZXVtaSAoRklCSSkgc3ViY2xhc3NcbiAgLy8gc2V0cyB0aGlzIHRvIHRoZSBmb3JlaWduLWN1cnJlbmN5IG1vdmVtZW50cyBwb3J0YWwgVVJMLlxuICBGQ19UUkFOU0FDVElPTlNfVVJMID0gJyc7XG5cbiAgLy8gQ2FwdHVyZWQgZnJvbSBjcmVkZW50aWFscyBpbiBnZXRMb2dpbk9wdGlvbnM7IGdhdGVzICsgZ3VhcmRzIHRoZSBGQyBwYXNzLlxuICBwcml2YXRlIGV4cGVjdGVkRm9yZWlnbkN1cnJlbmN5QWNjb3VudD86IHN0cmluZztcblxuICBnZXRMb2dpbk9wdGlvbnMoY3JlZGVudGlhbHM6IFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzKSB7XG4gICAgdGhpcy5leHBlY3RlZEZvcmVpZ25DdXJyZW5jeUFjY291bnQgPSBjcmVkZW50aWFscy5leHBlY3RlZEZvcmVpZ25DdXJyZW5jeUFjY291bnQ7XG4gICAgcmV0dXJuIHtcbiAgICAgIGxvZ2luVXJsOiBgJHt0aGlzLkxPR0lOX1VSTH1gLFxuICAgICAgZmllbGRzOiBjcmVhdGVMb2dpbkZpZWxkcyhjcmVkZW50aWFscyksXG4gICAgICBzdWJtaXRCdXR0b25TZWxlY3RvcjogJyNjb250aW51ZUJ0bicsXG4gICAgICBwb3N0QWN0aW9uOiBhc3luYyAoKSA9PiB3YWl0Rm9yUG9zdExvZ2luKHRoaXMucGFnZSksXG4gICAgICBwb3NzaWJsZVJlc3VsdHM6IGdldFBvc3NpYmxlTG9naW5SZXN1bHRzKCksXG4gICAgICAvLyBIQUNLOiBGb3Igc29tZSByZWFzb24sIHRob3VnaCB0aGUgbG9naW4gYnV0dG9uICgjY29udGludWVCdG4pIGlzIHByZXNlbnQgYW5kIHZpc2libGUsIHRoZSBjbGljayBhY3Rpb24gZG9lcyBub3QgcGVyZm9ybS5cbiAgICAgIC8vIEFkZGluZyB0aGlzIGRlbGF5IGZpeGVzIHRoZSBpc3N1ZS5cbiAgICAgIHByZUFjdGlvbjogYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBzbGVlcCgxMDAwKTtcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIGFzeW5jIGZldGNoRGF0YSgpIHtcbiAgICBjb25zdCBkZWZhdWx0U3RhcnRNb21lbnQgPSBtb21lbnQoKS5zdWJ0cmFjdCgxLCAneWVhcnMnKS5hZGQoMSwgJ2RheScpO1xuICAgIGNvbnN0IHN0YXJ0TW9tZW50TGltaXQgPSBtb21lbnQoeyB5ZWFyOiAxNjAwIH0pO1xuICAgIGNvbnN0IHN0YXJ0RGF0ZSA9IHRoaXMub3B0aW9ucy5zdGFydERhdGUgfHwgZGVmYXVsdFN0YXJ0TW9tZW50LnRvRGF0ZSgpO1xuICAgIGNvbnN0IHN0YXJ0TW9tZW50ID0gbW9tZW50Lm1heChzdGFydE1vbWVudExpbWl0LCBtb21lbnQoc3RhcnREYXRlKSk7XG5cbiAgICBhd2FpdCB0aGlzLm5hdmlnYXRlVG8odGhpcy5UUkFOU0FDVElPTlNfVVJMKTtcblxuICAgIGNvbnN0IGFjY291bnRzID0gYXdhaXQgZmV0Y2hBY2NvdW50cyh0aGlzLnBhZ2UsIHN0YXJ0TW9tZW50LCB0aGlzLm9wdGlvbnMpO1xuXG4gICAgLy8gU2Vjb25kIHBhc3Mgb24gdGhlIHNhbWUgbG9naW46IGZvcmVpZ24tY3VycmVuY3kgKNee15hcIteXKSBhY2NvdW50cywgd2hpY2ggbGl2ZVxuICAgIC8vIGluIGEgc2VwYXJhdGUgcG9ydGFsIHNlY3Rpb24gdGhlIE5JUyBmbG93IG5ldmVyIHZpc2l0cy4gT3B0LWluICsgZ3VhcmRlZCBieVxuICAgIC8vIGBleHBlY3RlZEZvcmVpZ25DdXJyZW5jeUFjY291bnRgOyBhIG5vLW9wIHVubGVzcyB0aGUgc3ViY2xhc3Mgc2V0cyBhbiBGQyBVUkwuXG4gICAgaWYgKHRoaXMuRkNfVFJBTlNBQ1RJT05TX1VSTCAmJiB0aGlzLmV4cGVjdGVkRm9yZWlnbkN1cnJlbmN5QWNjb3VudCkge1xuICAgICAgYXdhaXQgdGhpcy5uYXZpZ2F0ZVRvKHRoaXMuRkNfVFJBTlNBQ1RJT05TX1VSTCk7XG4gICAgICBjb25zdCBmY0FjY291bnRzID0gYXdhaXQgZmV0Y2hGb3JlaWduQ3VycmVuY3lBY2NvdW50cyhcbiAgICAgICAgdGhpcy5wYWdlLFxuICAgICAgICB0aGlzLmV4cGVjdGVkRm9yZWlnbkN1cnJlbmN5QWNjb3VudCxcbiAgICAgICAgc3RhcnRNb21lbnQsXG4gICAgICAgIHRoaXMub3B0aW9ucyxcbiAgICAgICk7XG4gICAgICBhY2NvdW50cy5wdXNoKC4uLmZjQWNjb3VudHMpO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgYWNjb3VudHMsXG4gICAgfTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBCZWlubGV1bWlHcm91cEJhc2VTY3JhcGVyO1xuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7QUFBQSxJQUFBQSxPQUFBLEdBQUFDLHNCQUFBLENBQUFDLE9BQUE7QUFFQSxJQUFBQyxVQUFBLEdBQUFELE9BQUE7QUFDQSxJQUFBRSxxQkFBQSxHQUFBRixPQUFBO0FBT0EsSUFBQUcsTUFBQSxHQUFBSCxPQUFBO0FBQ0EsSUFBQUksV0FBQSxHQUFBSixPQUFBO0FBQ0EsSUFBQUssYUFBQSxHQUFBTCxPQUFBO0FBQ0EsSUFBQU0sUUFBQSxHQUFBTixPQUFBO0FBQ0EsSUFBQU8sY0FBQSxHQUFBUCxPQUFBO0FBQ0EsSUFBQVEsdUJBQUEsR0FBQVIsT0FBQTtBQUE4RyxTQUFBRCx1QkFBQVUsQ0FBQSxXQUFBQSxDQUFBLElBQUFBLENBQUEsQ0FBQUMsVUFBQSxHQUFBRCxDQUFBLEtBQUFFLE9BQUEsRUFBQUYsQ0FBQTtBQUc5RyxNQUFNRyxXQUFXLEdBQUcsWUFBWTtBQUNoQyxNQUFNQyxpQ0FBaUMsR0FBRyw4QkFBOEI7QUFDeEUsTUFBTUMsMkJBQTJCLEdBQUcsWUFBWTtBQUNoRCxNQUFNQyx5QkFBeUIsR0FBRyxZQUFZO0FBQzlDLE1BQU1DLGtDQUFrQyxHQUFHLHVCQUF1QjtBQUNsRSxNQUFNQyxnQ0FBZ0MsR0FBRyxxQkFBcUI7QUFDOUQsTUFBTUMsc0JBQXNCLEdBQUcsU0FBUztBQUN4QyxNQUFNQyxrQkFBa0IsR0FBRyxPQUFPO0FBQ2xDLE1BQU1DLG1CQUFtQixHQUFHLFFBQVE7QUFDcEMsTUFBTUMsbUJBQW1CLEdBQUcsU0FBUztBQUNyQyxNQUFNQyxlQUFlLEdBQUcsK0JBQStCO0FBQ3ZELE1BQU1DLGtDQUFrQyxHQUFHLHFCQUFxQjtBQUNoRSxNQUFNQyxpQ0FBaUMsR0FBRyxLQUFLO0FBQy9DLE1BQU1DLDRCQUE0QixHQUFHLG9CQUFvQjtBQUN6RCxNQUFNQywwQkFB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
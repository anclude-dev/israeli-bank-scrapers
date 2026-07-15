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

// --- FC wire-transfer beneficiary lookup ------------------------------------
// The FC table never shows the recipient: a wire row's אסמכתא cell holds a link
// (`javascript:call276('','009110880')`) that pops open the underlying SWIFT
// message. call276 doesn't navigate — it builds a URL and window.open()s it — so
// we skip the popup entirely and fetch that URL from the page context (the
// session cookie rides along). The SWIFT view renders label rows shaped
// `[english, value, hebrew]`; the beneficiary is the value whose Hebrew label is
// `שם מוטב`.
const FC_DETAIL_LINK_SELECTOR = 'a[href*="call276"]';
const FC_DETAIL_REFERENCE_PAD = 9;
const FC_BENEFICIARY_LABEL = 'שם מוטב';
// Only rows that are an actual transfer get the recipient — the paired fee row
// (עמלות מכותבים) links to the same SWIFT message but isn't paid to the beneficiary.
const FC_TRANSFER_DESCRIPTION_MARKER = 'העברה';
const fcDetailUrl = paddedReference => `/MatafServiceServlets/ReadMailServlet?KEY-SUGBAKA=&I-MIS-ISKA=${paddedReference}` + `&SUGBAKA=276&xslKey=POP&passMispar=${paddedReference}`;

/** A `#dataTable040` row: its cell texts, plus whether it links to a SWIFT detail. */

/** An FC transaction, carrying the reference to look a beneficiary up by (transfers only). */

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
  return (0, _elementsInteractions.pageEvalAll)(frame, `${FC_TRANSACTIONS_TABLE} tbody tr`, [], (trs, linkSelector) => {
    return trs.map(tr => ({
      tds: Array.from(tr.getElementsByTagName('td')).map(td => td.innerText),
      hasDetailLink: !!tr.querySelector(linkSelector)
    }));
  }, FC_DETAIL_LINK_SELECTOR);
}
function extractForeignCurrencyTransactions(rows) {
  const txns = [];
  for (const {
    tds,
    hasDetailLink
  } of rows) {
    const date = (tds[FC_COL.date] || '').trim();
    // An empty date cell is the opening-balance (יתרת פתיחה) row — skip it, same
    // as the NIS parser drops rows without a date.
    if (date === '') continue;
    const reference = (tds[FC_COL.reference] || '').trim();
    const description = (tds[FC_COL.description] || '').trim();
    txns.push({
      status: _transactions2.TransactionStatuses.Completed,
      date,
      description,
      reference,
      debit: (tds[FC_COL.debit] || '').trim(),
      credit: (tds[FC_COL.credit] || '').trim(),
      // Only transfers carry a recipient worth showing; the bank links the same
      // SWIFT message from the paired fee row, which we deliberately leave alone.
      detailReference: hasDetailLink && reference !== '' && description.includes(FC_TRANSFER_DESCRIPTION_MARKER) ? reference : undefined
    });
  }
  return txns;
}
function extractForeignCurrencyBalance(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const balanceStr = (rows[i].tds[FC_COL.balance] || '').trim();
    if (balanceStr !== '') {
      const parsed = getAmountData(balanceStr);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
  }
  return undefined;
}

/**
 * Reads the beneficiary (`שם מוטב`) off a wire transfer's SWIFT message by
 * fetching the popup URL that `call276` would have opened, from within the
 * authenticated page context. Returns undefined for anything that isn't a wire
 * with a named beneficiary (e.g. a card settlement), so callers can no-op.
 */
async function fetchBeneficiaryName(frame, reference) {
  const url = fcDetailUrl(reference.padStart(FC_DETAIL_REFERENCE_PAD, '0'));
  try {
    return await frame.evaluate(async (detailUrl, label) => {
      const res = await fetch(detailUrl, {
        credentials: 'include'
      });
      if (!res.ok) return undefined;
      const parsed = new DOMParser().parseFromString(await res.text(), 'text/html');
      for (const tr of Array.from(parsed.querySelectorAll('tr'))) {
        const cells = Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').trim());
        // SWIFT label rows are [english label, value, hebrew label]
        if (cells.length === 3 && cells[2] === label) return cells[1] || undefined;
      }
      return undefined;
    }, url, FC_BENEFICIARY_LABEL);
  } catch {
    return undefined;
  }
}

/**
 * Prefixes each wire transfer's description with its recipient, e.g.
 * `OMNIPAK LIMITED – העברה- יבוא שירותים`. Each reference is fetched once, since
 * a transfer and its fee share one אסמכתא.
 */
async function applyBeneficiaryNames(frame, txns) {
  const cache = new Map();
  for (const txn of txns) {
    const ref = txn.detailReference;
    if (!ref) continue;
    if (!cache.has(ref)) {
      const name = await fetchBeneficiaryName(frame, ref);
      cache.set(ref, name);
      debug('foreign-currency: reference %s → beneficiary %s', ref, name ?? '(none)');
    }
    const beneficiary = cache.get(ref);
    if (beneficiary) {
      txn.description = `${beneficiary} – ${txn.description}`;
    }
  }
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
    const scraped = extractForeignCurrencyTransactions(rows);
    // The table never shows who a wire went to — enrich transfers from their
    // SWIFT message before converting.
    await applyBeneficiaryNames(frame, scraped);
    accounts.push({
      accountNumber,
      balance: extractForeignCurrencyBalance(rows),
      txns: convertForeignCurrencyTransactions(scraped, currency, options)
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbW9tZW50IiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfY29uc3RhbnRzIiwiX2VsZW1lbnRzSW50ZXJhY3Rpb25zIiwiX2RlYnVnIiwiX25hdmlnYXRpb24iLCJfdHJhbnNhY3Rpb25zIiwiX3dhaXRpbmciLCJfdHJhbnNhY3Rpb25zMiIsIl9iYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiREFURV9GT1JNQVQiLCJOT19UUkFOU0FDVElPTl9JTl9EQVRFX1JBTkdFX1RFWFQiLCJEQVRFX0NPTFVNTl9DTEFTU19DT01QTEVURUQiLCJEQVRFX0NPTFVNTl9DTEFTU19QRU5ESU5HIiwiREVTQ1JJUFRJT05fQ09MVU1OX0NMQVNTX0NPTVBMRVRFRCIsIkRFU0NSSVBUSU9OX0NPTFVNTl9DTEFTU19QRU5ESU5HIiwiUkVGRVJFTkNFX0NPTFVNTl9DTEFTUyIsIkRFQklUX0NPTFVNTl9DTEFTUyIsIkNSRURJVF9DT0xVTU5fQ0xBU1MiLCJFUlJPUl9NRVNTQUdFX0NMQVNTIiwiQUNDT1VOVFNfTlVNQkVSIiwiQ0xPU0VfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9DTEFTUyIsIlNIT1dfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9WQUxVRSIsIkNPTVBMRVRFRF9UUkFOU0FDVElPTlNfVEFCTEUiLCJQRU5ESU5HX1RSQU5TQUNUSU9OU19UQUJMRSIsIk5FWFRfUEFHRV9MSU5LIiwiQ1VSUkVOVF9CQUxBTkNFIiwiSUZSQU1FX05BTUUiLCJFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TIiwiZGVidWciLCJnZXREZWJ1ZyIsIkZDX0NVUlJFTkNZX1NFTEVDVCIsIkZDX0ZST01fREFURV9JTlBVVCIsIkZDX1RJTExfREFURV9JTlBVVCIsIkZDX1RSQU5TQUNUSU9OU19UQUJMRSIsIkNVUlJFTlRfQUNDT1VOVF9MQUJFTCIsIkZDX0NPTCIsImJhbGFuY2UiLCJjcmVkaXQiLCJkZWJpdCIsImRlc2NyaXB0aW9uIiwicmVmZXJlbmNlIiwiZGF0ZSIsIkZDX0NVUlJFTkNZX0JZX0hFQlJFVyIsIkZDX0RFVEFJTF9MSU5LX1NFTEVDVE9SIiwiRkNfREVUQUlMX1JFRkVSRU5DRV9QQUQiLCJGQ19CRU5FRklDSUFSWV9MQUJFTCIsIkZDX1RSQU5TRkVSX0RFU0NSSVBUSU9OX01BUktFUiIsImZjRGV0YWlsVXJsIiwicGFkZGVkUmVmZXJlbmNlIiwiZ2V0UG9zc2libGVMb2dpblJlc3VsdHMiLCJ1cmxzIiwiTG9naW5SZXN1bHRzIiwiU3VjY2VzcyIsIkludmFsaWRQYXNzd29yZCIsImNyZWF0ZUxvZ2luRmllbGRzIiwiY3JlZGVudGlhbHMiLCJzZWxlY3RvciIsInZhbHVlIiwidXNlcm5hbWUiLCJwYXNzd29yZCIsImdldEFtb3VudERhdGEiLCJhbW91bnRTdHIiLCJhbW91bnRTdHJDb3B5IiwicmVwbGFjZSIsIlNIRUtFTF9DVVJSRU5DWV9TWU1CT0wiLCJyZXBsYWNlQWxsIiwicGFyc2VGbG9hdCIsImdldFR4bkFtb3VudCIsInR4biIsIk51bWJlciIsImlzTmFOIiwiY29udmVydFRyYW5zYWN0aW9ucyIsInR4bnMiLCJvcHRpb25zIiwibWFwIiwiY29udmVydGVkRGF0ZSIsIm1vbWVudCIsInRvSVNPU3RyaW5nIiwiY29udmVydGVkQW1vdW50IiwicmVzdWx0IiwidHlwZSIsIlRyYW5zYWN0aW9uVHlwZXMiLCJOb3JtYWwiLCJpZGVudGlmaWVyIiwicGFyc2VJbnQiLCJ1bmRlZmluZWQiLCJwcm9jZXNzZWREYXRlIiwib3JpZ2luYWxBbW91bnQiLCJvcmlnaW5hbEN1cnJlbmN5IiwiU0hFS0VMX0NVUlJFTkNZIiwiY2hhcmdlZEFtb3VudCIsInN0YXR1cyIsIm1lbW8iLCJpbmNsdWRlUmF3VHJhbnNhY3Rpb24iLCJyYXdUcmFuc2FjdGlvbiIsImdldFJhd1RyYW5zYWN0aW9uIiwiZ2V0VHJhbnNhY3Rpb25EYXRlIiwidGRzIiwidHJhbnNhY3Rpb25UeXBlIiwidHJhbnNhY3Rpb25zQ29sc1R5cGVzIiwidHJpbSIsImdldFRyYW5zYWN0aW9uRGVzY3JpcHRpb24iLCJnZXRUcmFuc2FjdGlvblJlZmVyZW5jZSIsImdldFRyYW5zYWN0aW9uRGViaXQiLCJnZXRUcmFuc2FjdGlvbkNyZWRpdCIsImV4dHJhY3RUcmFuc2FjdGlvbkRldGFpbHMiLCJ0eG5Sb3ciLCJ0cmFuc2FjdGlvblN0YXR1cyIsImlubmVyVGRzIiwiaXRlbSIsImdldFRyYW5zYWN0aW9uc0NvbHNUeXBlQ2xhc3NlcyIsInBhZ2UiLCJ0YWJsZUxvY2F0b3IiLCJ0eXBlQ2xhc3Nlc09ianMiLCJwYWdlRXZhbEFsbCIsInRkIiwiaW5kZXgiLCJjb2xDbGFzcyIsImdldEF0dHJpYnV0ZSIsInR5cGVDbGFzc09iaiIsImV4dHJhY3RUcmFuc2FjdGlvbiIsInB1c2giLCJleHRyYWN0VHJhbnNhY3Rpb25zIiwidHJhbnNhY3Rpb25zUm93cyIsInRycyIsInRyIiwiQXJyYXkiLCJmcm9tIiwiZ2V0RWxlbWVudHNCeVRhZ05hbWUiLCJpbm5lclRleHQiLCJpc05vVHJhbnNhY3Rpb25JbkRhdGVSYW5nZUVycm9yIiwiaGFzRXJyb3JJbmZvRWxlbWVudCIsImVsZW1lbnRQcmVzZW50T25QYWdlIiwiZXJyb3JUZXh0IiwiJGV2YWwiLCJlcnJvckVsZW1lbnQiLCJzZWFyY2hCeURhdGVzIiwic3RhcnREYXRlIiwiY2xpY2tCdXR0b24iLCJ3YWl0VW50aWxFbGVtZW50Rm91bmQiLCJmaWxsSW5wdXQiLCJmb3JtYXQiLCJ3YWl0Rm9yTmF2aWdhdGlvbiIsImdldEFjY291bnROdW1iZXIiLCJzZWxlY3RlZFNuaWZBY2NvdW50Iiwib3B0aW9uIiwiY2hlY2tJZkhhc05leHRQYWdlIiwibmF2aWdhdGVUb05leHRQYWdlIiwic2NyYXBlVHJhbnNhY3Rpb25zIiwibmVlZFRvUGFnaW5hdGUiLCJoYXNOZXh0UGFnZSIsImN1cnJlbnRQYWdlVHhucyIsImdldEFjY291bnRUcmFuc2FjdGlvbnMiLCJQcm9taXNlIiwicmFjZSIsIm5vVHJhbnNhY3Rpb25JblJhbmdlRXJyb3IiLCJwZW5kaW5nVHhucyIsIlRyYW5zYWN0aW9uU3RhdHVzZXMiLCJQZW5kaW5nIiwiY29tcGxldGVkVHhucyIsIkNvbXBsZXRlZCIsImdldEN1cnJlbnRCYWxhbmNlIiwiYmFsYW5jZVN0ciIsImVsIiwid2FpdEZvclBvc3RMb2dpbiIsImZldGNoQWNjb3VudERhdGEiLCJhY2NvdW50TnVtYmVyIiwiZ2V0QWNjb3VudElkc09sZFVJIiwiZXZhbHVhdGUiLCJzZWxlY3RFbGVtZW50IiwiZG9jdW1lbnQiLCJnZXRFbGVtZW50QnlJZCIsInF1ZXJ5U2VsZWN0b3JBbGwiLCJjbGlja0FjY291bnRTZWxlY3RvckdldEFjY291bnRJZHMiLCJhY2NvdW50U2VsZWN0b3IiLCJkcm9wZG93blBhbmVsU2VsZWN0b3IiLCJvcHRpb25TZWxlY3RvciIsImRyb3Bkb3duVmlzaWJsZSIsIndpbmRvdyIsImdldENvbXB1dGVkU3R5bGUiLCJkaXNwbGF5Iiwib2Zmc2V0UGFyZW50IiwiY2F0Y2giLCJhY2NvdW50TGFiZWxzIiwiJCRldmFsIiwidGV4dENvbnRlbnQiLCJmaWx0ZXIiLCJsYWJlbCIsImVycm9yIiwiZ2V0QWNjb3VudElkc0JvdGhVSXMiLCJhY2NvdW50c0lkcyIsImxlbmd0aCIsInNlbGVjdEFjY291bnRGcm9tRHJvcGRvd24iLCJhY2NvdW50TGFiZWwiLCJhdmFpbGFibGVBY2NvdW50cyIsImluY2x1ZGVzIiwiYWNjb3VudE9wdGlvbnMiLCIkJCIsInRleHQiLCJvcHRpb25IYW5kbGUiLCJldmFsdWF0ZUhhbmRsZSIsImNsaWNrIiwiZ2V0VHJhbnNhY3Rpb25zRnJhbWUiLCJhdHRlbXB0Iiwic2xlZXAiLCJmcmFtZXMiLCJ0YXJnZXRGcmFtZSIsImZpbmQiLCJmIiwibmFtZSIsInNlbGVjdEFjY291bnRCb3RoVUlzIiwiYWNjb3VudElkIiwiYWNjb3VudFNlbGVjdGVkIiwic2VsZWN0IiwiZmV0Y2hBY2NvdW50RGF0YUJvdGhVSXMiLCJmcmFtZSIsInRhcmdldFBhZ2UiLCJmZXRjaEFjY291bnRzIiwiYWNjb3VudERhdGEiLCJhY2NvdW50cyIsImZvcmVpZ25DdXJyZW5jeVRvSXNvIiwicmUiLCJ0ZXN0IiwiZ2V0Rm9yZWlnbkN1cnJlbmN5T3B0aW9ucyIsIm9wdHMiLCJvIiwiZ2V0Rm9yZWlnbkN1cnJlbmN5Um93cyIsImxpbmtTZWxlY3RvciIsImhhc0RldGFpbExpbmsiLCJxdWVyeVNlbGVjdG9yIiwiZXh0cmFjdEZvcmVpZ25DdXJyZW5jeVRyYW5zYWN0aW9ucyIsInJvd3MiLCJkZXRhaWxSZWZlcmVuY2UiLCJleHRyYWN0Rm9yZWlnbkN1cnJlbmN5QmFsYW5jZSIsImkiLCJwYXJzZWQiLCJmZXRjaEJlbmVmaWNpYXJ5TmFtZSIsInVybCIsInBhZFN0YXJ0IiwiZGV0YWlsVXJsIiwicmVzIiwiZmV0Y2giLCJvayIsIkRPTVBhcnNlciIsInBhcnNlRnJvbVN0cmluZyIsImNlbGxzIiwiYXBwbHlCZW5lZmljaWFyeU5hbWVzIiwiY2FjaGUiLCJNYXAiLCJyZWYiLCJoYXMiLCJzZXQiLCJiZW5lZmljaWFyeSIsImdldCIsImNvbnZlcnRGb3JlaWduQ3VycmVuY3lUcmFuc2FjdGlvbnMiLCJjdXJyZW5jeSIsInJ1bkZvcmVpZ25DdXJyZW5jeVF1ZXJ5IiwiY3VycmVuY3lPcHRpb25WYWx1ZSIsImZldGNoRm9yZWlnbkN1cnJlbmN5QWNjb3VudHMiLCJleHBlY3RlZEFjY291bnQiLCJzZWxlY3RlZEFjY291bnQiLCJjdXJyZW5jaWVzIiwic2NyYXBlZCIsIkJlaW5sZXVtaUdyb3VwQmFzZVNjcmFwZXIiLCJCYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiQkFTRV9VUkwiLCJMT0dJTl9VUkwiLCJUUkFOU0FDVElPTlNfVVJMIiwiRkNfVFJBTlNBQ1RJT05TX1VSTCIsImdldExvZ2luT3B0aW9ucyIsImV4cGVjdGVkRm9yZWlnbkN1cnJlbmN5QWNjb3VudCIsImxvZ2luVXJsIiwiZmllbGRzIiwic3VibWl0QnV0dG9uU2VsZWN0b3IiLCJwb3N0QWN0aW9uIiwicG9zc2libGVSZXN1bHRzIiwicHJlQWN0aW9uIiwiZmV0Y2hEYXRhIiwiZGVmYXVsdFN0YXJ0TW9tZW50Iiwic3VidHJhY3QiLCJhZGQiLCJzdGFydE1vbWVudExpbWl0IiwieWVhciIsInRvRGF0ZSIsInN0YXJ0TW9tZW50IiwibWF4IiwibmF2aWdhdGVUbyIsImZjQWNjb3VudHMiLCJzdWNjZXNzIiwiX2RlZmF1bHQiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vc3JjL3NjcmFwZXJzL2Jhc2UtYmVpbmxldW1pLWdyb3VwLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBtb21lbnQsIHsgdHlwZSBNb21lbnQgfSBmcm9tICdtb21lbnQnO1xuaW1wb3J0IHsgdHlwZSBGcmFtZSwgdHlwZSBQYWdlIH0gZnJvbSAncHVwcGV0ZWVyJztcbmltcG9ydCB7IFNIRUtFTF9DVVJSRU5DWSwgU0hFS0VMX0NVUlJFTkNZX1NZTUJPTCB9IGZyb20gJy4uL2NvbnN0YW50cyc7XG5pbXBvcnQge1xuICBjbGlja0J1dHRvbixcbiAgZWxlbWVudFByZXNlbnRPblBhZ2UsXG4gIGZpbGxJbnB1dCxcbiAgcGFnZUV2YWxBbGwsXG4gIHdhaXRVbnRpbEVsZW1lbnRGb3VuZCxcbn0gZnJvbSAnLi4vaGVscGVycy9lbGVtZW50cy1pbnRlcmFjdGlvbnMnO1xuaW1wb3J0IHsgZ2V0RGVidWcgfSBmcm9tICcuLi9oZWxwZXJzL2RlYnVnJztcbmltcG9ydCB7IHdhaXRGb3JOYXZpZ2F0aW9uIH0gZnJvbSAnLi4vaGVscGVycy9uYXZpZ2F0aW9uJztcbmltcG9ydCB7IGdldFJhd1RyYW5zYWN0aW9uIH0gZnJvbSAnLi4vaGVscGVycy90cmFuc2FjdGlvbnMnO1xuaW1wb3J0IHsgc2xlZXAgfSBmcm9tICcuLi9oZWxwZXJzL3dhaXRpbmcnO1xuaW1wb3J0IHsgVHJhbnNhY3Rpb25TdGF0dXNlcywgVHJhbnNhY3Rpb25UeXBlcywgdHlwZSBUcmFuc2FjdGlvbiwgdHlwZSBUcmFuc2FjdGlvbnNBY2NvdW50IH0gZnJvbSAnLi4vdHJhbnNhY3Rpb25zJztcbmltcG9ydCB7IEJhc2VTY3JhcGVyV2l0aEJyb3dzZXIsIExvZ2luUmVzdWx0cywgdHlwZSBQb3NzaWJsZUxvZ2luUmVzdWx0cyB9IGZyb20gJy4vYmFzZS1zY3JhcGVyLXdpdGgtYnJvd3Nlcic7XG5pbXBvcnQgeyB0eXBlIFNjcmFwZXJPcHRpb25zIH0gZnJvbSAnLi9pbnRlcmZhY2UnO1xuXG5jb25zdCBEQVRFX0ZPUk1BVCA9ICdERC9NTS9ZWVlZJztcbmNvbnN0IE5PX1RSQU5TQUNUSU9OX0lOX0RBVEVfUkFOR0VfVEVYVCA9ICfXnNeQINeg157XpteQ15Ug16DXqteV16DXmdedINeR16DXldep15Ag15TXnteR15XXp9epJztcbmNvbnN0IERBVEVfQ09MVU1OX0NMQVNTX0NPTVBMRVRFRCA9ICdkYXRlIGZpcnN0JztcbmNvbnN0IERBVEVfQ09MVU1OX0NMQVNTX1BFTkRJTkcgPSAnZmlyc3QgZGF0ZSc7XG5jb25zdCBERVNDUklQVElPTl9DT0xVTU5fQ0xBU1NfQ09NUExFVEVEID0gJ3JlZmVyZW5jZSB3cmFwX25vcm1hbCc7XG5jb25zdCBERVNDUklQVElPTl9DT0xVTU5fQ0xBU1NfUEVORElORyA9ICdkZXRhaWxzIHdyYXBfbm9ybWFsJztcbmNvbnN0IFJFRkVSRU5DRV9DT0xVTU5fQ0xBU1MgPSAnZGV0YWlscyc7XG5jb25zdCBERUJJVF9DT0xVTU5fQ0xBU1MgPSAnZGViaXQnO1xuY29uc3QgQ1JFRElUX0NPTFVNTl9DTEFTUyA9ICdjcmVkaXQnO1xuY29uc3QgRVJST1JfTUVTU0FHRV9DTEFTUyA9ICdOT19EQVRBJztcbmNvbnN0IEFDQ09VTlRTX05VTUJFUiA9ICdkaXYuZmliaV9hY2NvdW50IHNwYW4uYWNjX251bSc7XG5jb25zdCBDTE9TRV9TRUFSQ0hfQllfREFURVNfQlVUVE9OX0NMQVNTID0gJ3VpLWRhdGVwaWNrZXItY2xvc2UnO1xuY29uc3QgU0hPV19TRUFSQ0hfQllfREFURVNfQlVUVE9OX1ZBTFVFID0gJ9eU16bXkic7XG5jb25zdCBDT01QTEVURURfVFJBTlNBQ1RJT05TX1RBQkxFID0gJ3RhYmxlI2RhdGFUYWJsZTA3Nyc7XG5jb25zdCBQRU5ESU5HX1RSQU5TQUNUSU9OU19UQUJMRSA9ICd0YWJsZSNkYXRhVGFibGUwMjMnO1xuY29uc3QgTkVYVF9QQUdFX0xJTksgPSAnYSNOcGFnZS5wYWdpbmcnO1xuY29uc3QgQ1VSUkVOVF9CQUxBTkNFID0gJy5tYWluX2JhbGFuY2UnO1xuY29uc3QgSUZSQU1FX05BTUUgPSAnaWZyYW1lLW9sZC1wYWdlcyc7XG5jb25zdCBFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TID0gMTAwMDA7XG5cbmNvbnN0IGRlYnVnID0gZ2V0RGVidWcoJ2JlaW5sZXVtaScpO1xuXG4vLyAtLS0gRm9yZWlnbi1jdXJyZW5jeSAo157XmFwi15cpIGFjY291bnQgc2VjdGlvbiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRkMgbW92ZW1lbnRzIGFyZSBzZXJ2ZWQgZnJvbSB0aGUgc2FtZSBgaWZyYW1lLW9sZC1wYWdlc2AsIG9uIGEgc2VwYXJhdGUgcG9ydGFsXG4vLyBwYWdlIChGQ19UUkFOU0FDVElPTlNfVVJMKS4gT25seSB0aGUgQmVpbmxldW1pIChGSUJJKSBzdWJjbGFzcyBzZXRzIHRoYXQgVVJMLFxuLy8gc28gdGhlIHBhc3MgaXMgYSBuby1vcCBmb3IgYW55IGdyb3VwIGJhbmsgdGhhdCBsZWF2ZXMgaXQgZW1wdHkuIFRoZSBwYXNzIGlzXG4vLyBhZGRpdGlvbmFsbHkgZ2F0ZWQgb24gYGV4cGVjdGVkRm9yZWlnbkN1cnJlbmN5QWNjb3VudGAgKGNvbmZpZyksIHdoaWNoIGlzIGJvdGhcbi8vIHRoZSBvcHQtaW4gYW5kIGEgcmVhZC1vbmx5IGd1YXJkOiB3ZSBuZXZlciB0b3VjaCB0aGUgdG9wLWxldmVsIGFjY291bnRcbi8vIHN3aXRjaGVyIChkaWZmZXJlbnQgc3dpdGNoZXIgYWNjb3VudHMgbWFwIHRvIGRpZmZlcmVudCBhcHAgcHJvZmlsZXMpLlxuY29uc3QgRkNfQ1VSUkVOQ1lfU0VMRUNUID0gJ3NlbGVjdCNJTi1TQ0gtTVRCJztcbmNvbnN0IEZDX0ZST01fREFURV9JTlBVVCA9ICdpbnB1dCNmcm9tRGF0ZSc7XG5jb25zdCBGQ19USUxMX0RBVEVfSU5QVVQgPSAnaW5wdXQjdGlsbERhdGUnO1xuY29uc3QgRkNfVFJBTlNBQ1RJT05TX1RBQkxFID0gJ3RhYmxlI2RhdGFUYWJsZTA0MCc7XG5jb25zdCBDVVJSRU5UX0FDQ09VTlRfTEFCRUwgPSAnZGl2LmN1cnJlbnQtYWNjb3VudCc7XG4vLyBgI2RhdGFUYWJsZTA0MGAgaGFzIGZpeGVkIHBvc2l0aW9uYWwgY29sdW1ucyAoc29tZSBjYXJyeSBhIGNsYXNzLCBzb21lIGRvbid0KSxcbi8vIHNvIGl0IGlzIHBhcnNlZCBieSBpbmRleCByYXRoZXIgdGhhbiBieSBjb2x1bW4gY2xhc3MgbGlrZSB0aGUgTklTIHRhYmxlczpcbi8vICAgWzBdIGJhbGFuY2UgIFsxXSB2YWx1ZS1kYXRlICBbMl0gY3JlZGl0ICBbM10gZGViaXRcbi8vICAgWzRdIGRlc2NyaXB0aW9uICBbNV0gYnJhbmNoLWNvZGUgIFs2XSByZWZlcmVuY2UgKGFzbWFjaHRhKSAgWzddIGRhdGVcbmNvbnN0IEZDX0NPTCA9IHsgYmFsYW5jZTogMCwgY3JlZGl0OiAyLCBkZWJpdDogMywgZGVzY3JpcHRpb246IDQsIHJlZmVyZW5jZTogNiwgZGF0ZTogNyB9IGFzIGNvbnN0O1xuLy8gTWFwIHRoZSBGQyBjdXJyZW5jeS1kcm9wZG93biBIZWJyZXcgbGFiZWwg4oaSIElTTyA0MjE3LiBNYXRjaGVkIGJ5IHN1YnN0cmluZ1xuLy8gYmVjYXVzZSBlYWNoIGxhYmVsIGlzIHBhZGRlZCBhbmQgcHJlZml4ZWQgd2l0aCB0aGUgYWNjb3VudC9wcm9kdWN0IG5hbWVcbi8vIChlLmcuIGAxMDYgLSDXpNeeXCLXlyDXqteQ15LXmdeT15nXnSAtINeT15XXnNeoINeQ16jXlFwi15FgKS5cbmNvbnN0IEZDX0NVUlJFTkNZX0JZX0hFQlJFVzogUmVhZG9ubHlBcnJheTxyZWFkb25seSBbUmVnRXhwLCBzdHJpbmddPiA9IFtcbiAgWy/Xk9eV15zXqC8sICdVU0QnXSxcbiAgWy/XkNeZ16jXlXzXmdeV16jXlS8sICdFVVInXSxcbiAgWy/XpNeo16DXpy8sICdDSEYnXSxcbiAgWy/XqdeY16jXnNeZ16DXknzXnNeZ16jXlC8sICdHQlAnXSxcbiAgWy/XmdeZ158vLCAnSlBZJ10sXG4gIFsv16fXoNeTLywgJ0NBRCddLFxuICBbL9eQ15XXodeY16jXnC8sICdBVUQnXSxcbl07XG5cbi8vIC0tLSBGQyB3aXJlLXRyYW5zZmVyIGJlbmVmaWNpYXJ5IGxvb2t1cCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRoZSBGQyB0YWJsZSBuZXZlciBzaG93cyB0aGUgcmVjaXBpZW50OiBhIHdpcmUgcm93J3Mg15DXodee15vXqteQIGNlbGwgaG9sZHMgYSBsaW5rXG4vLyAoYGphdmFzY3JpcHQ6Y2FsbDI3NignJywnMDA5MTEwODgwJylgKSB0aGF0IHBvcHMgb3BlbiB0aGUgdW5kZXJseWluZyBTV0lGVFxuLy8gbWVzc2FnZS4gY2FsbDI3NiBkb2Vzbid0IG5hdmlnYXRlIOKAlCBpdCBidWlsZHMgYSBVUkwgYW5kIHdpbmRvdy5vcGVuKClzIGl0IOKAlCBzb1xuLy8gd2Ugc2tpcCB0aGUgcG9wdXAgZW50aXJlbHkgYW5kIGZldGNoIHRoYXQgVVJMIGZyb20gdGhlIHBhZ2UgY29udGV4dCAodGhlXG4vLyBzZXNzaW9uIGNvb2tpZSByaWRlcyBhbG9uZykuIFRoZSBTV0lGVCB2aWV3IHJlbmRlcnMgbGFiZWwgcm93cyBzaGFwZWRcbi8vIGBbZW5nbGlzaCwgdmFsdWUsIGhlYnJld11gOyB0aGUgYmVuZWZpY2lhcnkgaXMgdGhlIHZhbHVlIHdob3NlIEhlYnJldyBsYWJlbCBpc1xuLy8gYNep150g157XldeY15FgLlxuY29uc3QgRkNfREVUQUlMX0xJTktfU0VMRUNUT1IgPSAnYVtocmVmKj1cImNhbGwyNzZcIl0nO1xuY29uc3QgRkNfREVUQUlMX1JFRkVSRU5DRV9QQUQgPSA5O1xuY29uc3QgRkNfQkVORUZJQ0lBUllfTEFCRUwgPSAn16nXnSDXnteV15jXkSc7XG4vLyBPbmx5IHJvd3MgdGhhdCBhcmUgYW4gYWN0dWFsIHRyYW5zZmVyIGdldCB0aGUgcmVjaXBpZW50IOKAlCB0aGUgcGFpcmVkIGZlZSByb3dcbi8vICjXotee15zXldeqINee15vXldeq15HXmdedKSBsaW5rcyB0byB0aGUgc2FtZSBTV0lGVCBtZXNzYWdlIGJ1dCBpc24ndCBwYWlkIHRvIHRoZSBiZW5lZmljaWFyeS5cbmNvbnN0IEZDX1RSQU5TRkVSX0RFU0NSSVBUSU9OX01BUktFUiA9ICfXlNei15HXqNeUJztcbmNvbnN0IGZjRGV0YWlsVXJsID0gKHBhZGRlZFJlZmVyZW5jZTogc3RyaW5nKSA9PlxuICBgL01hdGFmU2VydmljZVNlcnZsZXRzL1JlYWRNYWlsU2VydmxldD9LRVktU1VHQkFLQT0mSS1NSVMtSVNLQT0ke3BhZGRlZFJlZmVyZW5jZX1gICtcbiAgYCZTVUdCQUtBPTI3NiZ4c2xLZXk9UE9QJnBhc3NNaXNwYXI9JHtwYWRkZWRSZWZlcmVuY2V9YDtcblxudHlwZSBUcmFuc2FjdGlvbnNDb2xzVHlwZXMgPSBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+O1xudHlwZSBUcmFuc2FjdGlvbnNUclRkcyA9IHN0cmluZ1tdO1xudHlwZSBUcmFuc2FjdGlvbnNUciA9IHsgaW5uZXJUZHM6IFRyYW5zYWN0aW9uc1RyVGRzIH07XG5cbmludGVyZmFjZSBTY3JhcGVkVHJhbnNhY3Rpb24ge1xuICByZWZlcmVuY2U6IHN0cmluZztcbiAgZGF0ZTogc3RyaW5nO1xuICBjcmVkaXQ6IHN0cmluZztcbiAgZGViaXQ6IHN0cmluZztcbiAgbWVtbz86IHN0cmluZztcbiAgZGVzY3JpcHRpb246IHN0cmluZztcbiAgc3RhdHVzOiBUcmFuc2FjdGlvblN0YXR1c2VzO1xufVxuXG4vKiogQSBgI2RhdGFUYWJsZTA0MGAgcm93OiBpdHMgY2VsbCB0ZXh0cywgcGx1cyB3aGV0aGVyIGl0IGxpbmtzIHRvIGEgU1dJRlQgZGV0YWlsLiAqL1xudHlwZSBGY1JvdyA9IHsgdGRzOiBUcmFuc2FjdGlvbnNUclRkczsgaGFzRGV0YWlsTGluazogYm9vbGVhbiB9O1xuXG4vKiogQW4gRkMgdHJhbnNhY3Rpb24sIGNhcnJ5aW5nIHRoZSByZWZlcmVuY2UgdG8gbG9vayBhIGJlbmVmaWNpYXJ5IHVwIGJ5ICh0cmFuc2ZlcnMgb25seSkuICovXG50eXBlIFNjcmFwZWRGY1RyYW5zYWN0aW9uID0gU2NyYXBlZFRyYW5zYWN0aW9uICYgeyBkZXRhaWxSZWZlcmVuY2U/OiBzdHJpbmcgfTtcblxuZXhwb3J0IGZ1bmN0aW9uIGdldFBvc3NpYmxlTG9naW5SZXN1bHRzKCk6IFBvc3NpYmxlTG9naW5SZXN1bHRzIHtcbiAgY29uc3QgdXJsczogUG9zc2libGVMb2dpblJlc3VsdHMgPSB7fTtcbiAgdXJsc1tMb2dpblJlc3VsdHMuU3VjY2Vzc10gPSBbXG4gICAgL2ZpYmkuKmFjY291bnRTdW1tYXJ5LywgLy8gTmV3IFVJIHBhdHRlcm5cbiAgICAvUmVzb3VyY2VzXFwvUG9ydGFsTkdcXC9zaGVsbC8sIC8vIE5ldyBVSSBwYXR0ZXJuXG4gICAgL0ZpYmlNZW51XFwvT25saW5lLywgLy8gT2xkIFVJIHBhdHRlcm5cbiAgXTtcbiAgdXJsc1tMb2dpblJlc3VsdHMuSW52YWxpZFBhc3N3b3JkXSA9IFsvRmliaU1lbnVcXC9NYXJrZXRpbmdcXC9Qcml2YXRlXFwvSG9tZS9dO1xuICByZXR1cm4gdXJscztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUxvZ2luRmllbGRzKGNyZWRlbnRpYWxzOiBTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscykge1xuICByZXR1cm4gW1xuICAgIHsgc2VsZWN0b3I6ICcjdXNlcm5hbWUnLCB2YWx1ZTogY3JlZGVudGlhbHMudXNlcm5hbWUgfSxcbiAgICB7IHNlbGVjdG9yOiAnI3Bhc3N3b3JkJywgdmFsdWU6IGNyZWRlbnRpYWxzLnBhc3N3b3JkIH0sXG4gIF07XG59XG5cbmZ1bmN0aW9uIGdldEFtb3VudERhdGEoYW1vdW50U3RyOiBzdHJpbmcpIHtcbiAgbGV0IGFtb3VudFN0ckNvcHkgPSBhbW91bnRTdHIucmVwbGFjZShTSEVLRUxfQ1VSUkVOQ1lfU1lNQk9MLCAnJyk7XG4gIGFtb3VudFN0ckNvcHkgPSBhbW91bnRTdHJDb3B5LnJlcGxhY2VBbGwoJywnLCAnJyk7XG4gIHJldHVybiBwYXJzZUZsb2F0KGFtb3VudFN0ckNvcHkpO1xufVxuXG5mdW5jdGlvbiBnZXRUeG5BbW91bnQodHhuOiBTY3JhcGVkVHJhbnNhY3Rpb24pIHtcbiAgY29uc3QgY3JlZGl0ID0gZ2V0QW1vdW50RGF0YSh0eG4uY3JlZGl0KTtcbiAgY29uc3QgZGViaXQgPSBnZXRBbW91bnREYXRhKHR4bi5kZWJpdCk7XG4gIHJldHVybiAoTnVtYmVyLmlzTmFOKGNyZWRpdCkgPyAwIDogY3JlZGl0KSAtIChOdW1iZXIuaXNOYU4oZGViaXQpID8gMCA6IGRlYml0KTtcbn1cblxuZnVuY3Rpb24gY29udmVydFRyYW5zYWN0aW9ucyh0eG5zOiBTY3JhcGVkVHJhbnNhY3Rpb25bXSwgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zKTogVHJhbnNhY3Rpb25bXSB7XG4gIHJldHVybiB0eG5zLm1hcCgodHhuKTogVHJhbnNhY3Rpb24gPT4ge1xuICAgIGNvbnN0IGNvbnZlcnRlZERhdGUgPSBtb21lbnQodHhuLmRhdGUsIERBVEVfRk9STUFUKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IGNvbnZlcnRlZEFtb3VudCA9IGdldFR4bkFtb3VudCh0eG4pO1xuICAgIGNvbnN0IHJlc3VsdDogVHJhbnNhY3Rpb24gPSB7XG4gICAgICB0eXBlOiBUcmFuc2FjdGlvblR5cGVzLk5vcm1hbCxcbiAgICAgIGlkZW50aWZpZXI6IHR4bi5yZWZlcmVuY2UgPyBwYXJzZUludCh0eG4ucmVmZXJlbmNlLCAxMCkgOiB1bmRlZmluZWQsXG4gICAgICBkYXRlOiBjb252ZXJ0ZWREYXRlLFxuICAgICAgcHJvY2Vzc2VkRGF0ZTogY29udmVydGVkRGF0ZSxcbiAgICAgIG9yaWdpbmFsQW1vdW50OiBjb252ZXJ0ZWRBbW91bnQsXG4gICAgICBvcmlnaW5hbEN1cnJlbmN5OiBTSEVLRUxfQ1VSUkVOQ1ksXG4gICAgICBjaGFyZ2VkQW1vdW50OiBjb252ZXJ0ZWRBbW91bnQsXG4gICAgICBzdGF0dXM6IHR4bi5zdGF0dXMsXG4gICAgICBkZXNjcmlwdGlvbjogdHhuLmRlc2NyaXB0aW9uLFxuICAgICAgbWVtbzogdHhuLm1lbW8sXG4gICAgfTtcblxuICAgIGlmIChvcHRpb25zPy5pbmNsdWRlUmF3VHJhbnNhY3Rpb24pIHtcbiAgICAgIHJlc3VsdC5yYXdUcmFuc2FjdGlvbiA9IGdldFJhd1RyYW5zYWN0aW9uKHR4bik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uRGF0ZShcbiAgdGRzOiBUcmFuc2FjdGlvbnNUclRkcyxcbiAgdHJhbnNhY3Rpb25UeXBlOiBzdHJpbmcsXG4gIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzLFxuKSB7XG4gIGlmICh0cmFuc2FjdGlvblR5cGUgPT09ICdjb21wbGV0ZWQnKSB7XG4gICAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW0RBVEVfQ09MVU1OX0NMQVNTX0NPTVBMRVRFRF1dIHx8ICcnKS50cmltKCk7XG4gIH1cbiAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW0RBVEVfQ09MVU1OX0NMQVNTX1BFTkRJTkddXSB8fCAnJykudHJpbSgpO1xufVxuXG5mdW5jdGlvbiBnZXRUcmFuc2FjdGlvbkRlc2NyaXB0aW9uKFxuICB0ZHM6IFRyYW5zYWN0aW9uc1RyVGRzLFxuICB0cmFuc2FjdGlvblR5cGU6IHN0cmluZyxcbiAgdHJhbnNhY3Rpb25zQ29sc1R5cGVzOiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMsXG4pIHtcbiAgaWYgKHRyYW5zYWN0aW9uVHlwZSA9PT0gJ2NvbXBsZXRlZCcpIHtcbiAgICByZXR1cm4gKHRkc1t0cmFuc2FjdGlvbnNDb2xzVHlwZXNbREVTQ1JJUFRJT05fQ09MVU1OX0NMQVNTX0NPTVBMRVRFRF1dIHx8ICcnKS50cmltKCk7XG4gIH1cbiAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW0RFU0NSSVBUSU9OX0NPTFVNTl9DTEFTU19QRU5ESU5HXV0gfHwgJycpLnRyaW0oKTtcbn1cblxuZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25SZWZlcmVuY2UodGRzOiBUcmFuc2FjdGlvbnNUclRkcywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzOiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMpIHtcbiAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW1JFRkVSRU5DRV9DT0xVTU5fQ0xBU1NdXSB8fCAnJykudHJpbSgpO1xufVxuXG5mdW5jdGlvbiBnZXRUcmFuc2FjdGlvbkRlYml0KHRkczogVHJhbnNhY3Rpb25zVHJUZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzKSB7XG4gIHJldHVybiAodGRzW3RyYW5zYWN0aW9uc0NvbHNUeXBlc1tERUJJVF9DT0xVTU5fQ0xBU1NdXSB8fCAnJykudHJpbSgpO1xufVxuXG5mdW5jdGlvbiBnZXRUcmFuc2FjdGlvbkNyZWRpdCh0ZHM6IFRyYW5zYWN0aW9uc1RyVGRzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXM6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcykge1xuICByZXR1cm4gKHRkc1t0cmFuc2FjdGlvbnNDb2xzVHlwZXNbQ1JFRElUX0NPTFVNTl9DTEFTU11dIHx8ICcnKS50cmltKCk7XG59XG5cbmZ1bmN0aW9uIGV4dHJhY3RUcmFuc2FjdGlvbkRldGFpbHMoXG4gIHR4blJvdzogVHJhbnNhY3Rpb25zVHIsXG4gIHRyYW5zYWN0aW9uU3RhdHVzOiBUcmFuc2FjdGlvblN0YXR1c2VzLFxuICB0cmFuc2FjdGlvbnNDb2xzVHlwZXM6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcyxcbik6IFNjcmFwZWRUcmFuc2FjdGlvbiB7XG4gIGNvbnN0IHRkcyA9IHR4blJvdy5pbm5lclRkcztcbiAgY29uc3QgaXRlbSA9IHtcbiAgICBzdGF0dXM6IHRyYW5zYWN0aW9uU3RhdHVzLFxuICAgIGRhdGU6IGdldFRyYW5zYWN0aW9uRGF0ZSh0ZHMsIHRyYW5zYWN0aW9uU3RhdHVzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpLFxuICAgIGRlc2NyaXB0aW9uOiBnZXRUcmFuc2FjdGlvbkRlc2NyaXB0aW9uKHRkcywgdHJhbnNhY3Rpb25TdGF0dXMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlcyksXG4gICAgcmVmZXJlbmNlOiBnZXRUcmFuc2FjdGlvblJlZmVyZW5jZSh0ZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlcyksXG4gICAgZGViaXQ6IGdldFRyYW5zYWN0aW9uRGViaXQodGRzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpLFxuICAgIGNyZWRpdDogZ2V0VHJhbnNhY3Rpb25DcmVkaXQodGRzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpLFxuICB9O1xuXG4gIHJldHVybiBpdGVtO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRUcmFuc2FjdGlvbnNDb2xzVHlwZUNsYXNzZXMoXG4gIHBhZ2U6IFBhZ2UgfCBGcmFtZSxcbiAgdGFibGVMb2NhdG9yOiBzdHJpbmcsXG4pOiBQcm9taXNlPFRyYW5zYWN0aW9uc0NvbHNUeXBlcz4ge1xuICBjb25zdCByZXN1bHQ6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcyA9IHt9O1xuICBjb25zdCB0eXBlQ2xhc3Nlc09ianMgPSBhd2FpdCBwYWdlRXZhbEFsbChwYWdlLCBgJHt0YWJsZUxvY2F0b3J9IHRib2R5IHRyOmZpcnN0LW9mLXR5cGUgdGRgLCBudWxsLCB0ZHMgPT4ge1xuICAgIHJldHVybiB0ZHMubWFwKCh0ZCwgaW5kZXgpID0+ICh7XG4gICAgICBjb2xDbGFzczogdGQuZ2V0QXR0cmlidXRlKCdjbGFzcycpLFxuICAgICAgaW5kZXgsXG4gICAgfSkpO1xuICB9KTtcblxuICBmb3IgKGNvbnN0IHR5cGVDbGFzc09iaiBvZiB0eXBlQ2xhc3Nlc09ianMpIHtcbiAgICBpZiAodHlwZUNsYXNzT2JqLmNvbENsYXNzKSB7XG4gICAgICByZXN1bHRbdHlwZUNsYXNzT2JqLmNvbENsYXNzXSA9IHR5cGVDbGFzc09iai5pbmRleDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZnVuY3Rpb24gZXh0cmFjdFRyYW5zYWN0aW9uKFxuICB0eG5zOiBTY3JhcGVkVHJhbnNhY3Rpb25bXSxcbiAgdHJhbnNhY3Rpb25TdGF0dXM6IFRyYW5zYWN0aW9uU3RhdHVzZXMsXG4gIHR4blJvdzogVHJhbnNhY3Rpb25zVHIsXG4gIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzLFxuKSB7XG4gIGNvbnN0IHR4biA9IGV4dHJhY3RUcmFuc2FjdGlvbkRldGFpbHModHhuUm93LCB0cmFuc2FjdGlvblN0YXR1cywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzKTtcbiAgaWYgKHR4bi5kYXRlICE9PSAnJykge1xuICAgIHR4bnMucHVzaCh0eG4pO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4dHJhY3RUcmFuc2FjdGlvbnMocGFnZTogUGFnZSB8IEZyYW1lLCB0YWJsZUxvY2F0b3I6IHN0cmluZywgdHJhbnNhY3Rpb25TdGF0dXM6IFRyYW5zYWN0aW9uU3RhdHVzZXMpIHtcbiAgY29uc3QgdHhuczogU2NyYXBlZFRyYW5zYWN0aW9uW10gPSBbXTtcbiAgY29uc3QgdHJhbnNhY3Rpb25zQ29sc1R5cGVzID0gYXdhaXQgZ2V0VHJhbnNhY3Rpb25zQ29sc1R5cGVDbGFzc2VzKHBhZ2UsIHRhYmxlTG9jYXRvcik7XG5cbiAgY29uc3QgdHJhbnNhY3Rpb25zUm93cyA9IGF3YWl0IHBhZ2VFdmFsQWxsPFRyYW5zYWN0aW9uc1RyW10+KHBhZ2UsIGAke3RhYmxlTG9jYXRvcn0gdGJvZHkgdHJgLCBbXSwgdHJzID0+IHtcbiAgICByZXR1cm4gdHJzLm1hcCh0ciA9PiAoe1xuICAgICAgaW5uZXJUZHM6IEFycmF5LmZyb20odHIuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ3RkJykpLm1hcCh0ZCA9PiB0ZC5pbm5lclRleHQpLFxuICAgIH0pKTtcbiAgfSk7XG5cbiAgZm9yIChjb25zdCB0eG5Sb3cgb2YgdHJhbnNhY3Rpb25zUm93cykge1xuICAgIGV4dHJhY3RUcmFuc2FjdGlvbih0eG5zLCB0cmFuc2FjdGlvblN0YXR1cywgdHhuUm93LCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpO1xuICB9XG4gIHJldHVybiB0eG5zO1xufVxuXG5hc3luYyBmdW5jdGlvbiBpc05vVHJhbnNhY3Rpb25JbkRhdGVSYW5nZUVycm9yKHBhZ2U6IFBhZ2UgfCBGcmFtZSkge1xuICBjb25zdCBoYXNFcnJvckluZm9FbGVtZW50ID0gYXdhaXQgZWxlbWVudFByZXNlbnRPblBhZ2UocGFnZSwgYC4ke0VSUk9SX01FU1NBR0VfQ0xBU1N9YCk7XG4gIGlmIChoYXNFcnJvckluZm9FbGVtZW50KSB7XG4gICAgY29uc3QgZXJyb3JUZXh0ID0gYXdhaXQgcGFnZS4kZXZhbChgLiR7RVJST1JfTUVTU0FHRV9DTEFTU31gLCBlcnJvckVsZW1lbnQgPT4ge1xuICAgICAgcmV0dXJuIChlcnJvckVsZW1lbnQgYXMgSFRNTEVsZW1lbnQpLmlubmVyVGV4dDtcbiAgICB9KTtcbiAgICByZXR1cm4gZXJyb3JUZXh0LnRyaW0oKSA9PT0gTk9fVFJBTlNBQ1RJT05fSU5fREFURV9SQU5HRV9URVhUO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2VhcmNoQnlEYXRlcyhwYWdlOiBQYWdlIHwgRnJhbWUsIHN0YXJ0RGF0ZTogTW9tZW50KSB7XG4gIGF3YWl0IGNsaWNrQnV0dG9uKHBhZ2UsICdhI3RhYkhlYWRlcjQnKTtcbiAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICdkaXYjZmliaV9kYXRlcycpO1xuICBhd2FpdCBmaWxsSW5wdXQocGFnZSwgJ2lucHV0I2Zyb21EYXRlJywgc3RhcnREYXRlLmZvcm1hdChEQVRFX0ZPUk1BVCkpO1xuICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCBgYnV0dG9uW2NsYXNzKj0ke0NMT1NFX1NFQVJDSF9CWV9EQVRFU19CVVRUT05fQ0xBU1N9XWApO1xuICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCBgaW5wdXRbdmFsdWU9JHtTSE9XX1NFQVJDSF9CWV9EQVRFU19CVVRUT05fVkFMVUV9XWApO1xuICBhd2FpdCB3YWl0Rm9yTmF2aWdhdGlvbihwYWdlKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0QWNjb3VudE51bWJlcihwYWdlOiBQYWdlIHwgRnJhbWUpOiBQcm9taXNlPHN0cmluZz4ge1xuICAvLyBXYWl0IHVudGlsIHRoZSBhY2NvdW50IG51bWJlciBlbGVtZW50IGlzIHByZXNlbnQgaW4gdGhlIERPTVxuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgQUNDT1VOVFNfTlVNQkVSLCB0cnVlLCBFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TKTtcblxuICBjb25zdCBzZWxlY3RlZFNuaWZBY2NvdW50ID0gYXdhaXQgcGFnZS4kZXZhbChBQ0NPVU5UU19OVU1CRVIsIG9wdGlvbiA9PiB7XG4gICAgcmV0dXJuIChvcHRpb24gYXMgSFRNTEVsZW1lbnQpLmlubmVyVGV4dDtcbiAgfSk7XG5cbiAgcmV0dXJuIHNlbGVjdGVkU25pZkFjY291bnQucmVwbGFjZSgnLycsICdfJykudHJpbSgpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBjaGVja0lmSGFzTmV4dFBhZ2UocGFnZTogUGFnZSB8IEZyYW1lKSB7XG4gIHJldHVybiBlbGVtZW50UHJlc2VudE9uUGFnZShwYWdlLCBORVhUX1BBR0VfTElOSyk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIG5hdmlnYXRlVG9OZXh0UGFnZShwYWdlOiBQYWdlIHwgRnJhbWUpIHtcbiAgYXdhaXQgY2xpY2tCdXR0b24ocGFnZSwgTkVYVF9QQUdFX0xJTkspO1xuICBhd2FpdCB3YWl0Rm9yTmF2aWdhdGlvbihwYWdlKTtcbn1cblxuLyogQ291bGRuJ3QgcmVwcm9kdWNlIHNjZW5hcmlvIHdpdGggbXVsdGlwbGUgcGFnZXMgb2YgcGVuZGluZyB0cmFuc2FjdGlvbnMgLSBTaG91bGQgc3VwcG9ydCBpZiBleGlzdHMgc3VjaCBjYXNlLlxuICAgbmVlZFRvUGFnaW5hdGUgaXMgZmFsc2UgaWYgc2NyYXBpbmcgcGVuZGluZyB0cmFuc2FjdGlvbnMgKi9cbmFzeW5jIGZ1bmN0aW9uIHNjcmFwZVRyYW5zYWN0aW9ucyhcbiAgcGFnZTogUGFnZSB8IEZyYW1lLFxuICB0YWJsZUxvY2F0b3I6IHN0cmluZyxcbiAgdHJhbnNhY3Rpb25TdGF0dXM6IFRyYW5zYWN0aW9uU3RhdHVzZXMsXG4gIG5lZWRUb1BhZ2luYXRlOiBib29sZWFuLFxuICBvcHRpb25zPzogU2NyYXBlck9wdGlvbnMsXG4pIHtcbiAgY29uc3QgdHhucyA9IFtdO1xuICBsZXQgaGFzTmV4dFBhZ2UgPSBmYWxzZTtcblxuICBkbyB7XG4gICAgY29uc3QgY3VycmVudFBhZ2VUeG5zID0gYXdhaXQgZXh0cmFjdFRyYW5zYWN0aW9ucyhwYWdlLCB0YWJsZUxvY2F0b3IsIHRyYW5zYWN0aW9uU3RhdHVzKTtcbiAgICB0eG5zLnB1c2goLi4uY3VycmVudFBhZ2VUeG5zKTtcbiAgICBpZiAobmVlZFRvUGFnaW5hdGUpIHtcbiAgICAgIGhhc05leHRQYWdlID0gYXdhaXQgY2hlY2tJZkhhc05leHRQYWdlKHBhZ2UpO1xuICAgICAgaWYgKGhhc05leHRQYWdlKSB7XG4gICAgICAgIGF3YWl0IG5hdmlnYXRlVG9OZXh0UGFnZShwYWdlKTtcbiAgICAgIH1cbiAgICB9XG4gIH0gd2hpbGUgKGhhc05leHRQYWdlKTtcblxuICByZXR1cm4gY29udmVydFRyYW5zYWN0aW9ucyh0eG5zLCBvcHRpb25zKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0QWNjb3VudFRyYW5zYWN0aW9ucyhwYWdlOiBQYWdlIHwgRnJhbWUsIG9wdGlvbnM/OiBTY3JhcGVyT3B0aW9ucykge1xuICBhd2FpdCBQcm9taXNlLnJhY2UoW1xuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCBcImRpdltpZCo9J2RpdlRhYmxlJ11cIiwgZmFsc2UpLFxuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCBgLiR7RVJST1JfTUVTU0FHRV9DTEFTU31gLCBmYWxzZSksXG4gIF0pO1xuXG4gIGNvbnN0IG5vVHJhbnNhY3Rpb25JblJhbmdlRXJyb3IgPSBhd2FpdCBpc05vVHJhbnNhY3Rpb25JbkRhdGVSYW5nZUVycm9yKHBhZ2UpO1xuICBpZiAobm9UcmFuc2FjdGlvbkluUmFuZ2VFcnJvcikge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIGNvbnN0IHBlbmRpbmdUeG5zID0gYXdhaXQgc2NyYXBlVHJhbnNhY3Rpb25zKFxuICAgIHBhZ2UsXG4gICAgUEVORElOR19UUkFOU0FDVElPTlNfVEFCTEUsXG4gICAgVHJhbnNhY3Rpb25TdGF0dXNlcy5QZW5kaW5nLFxuICAgIGZhbHNlLFxuICAgIG9wdGlvbnMsXG4gICk7XG4gIGNvbnN0IGNvbXBsZXRlZFR4bnMgPSBhd2FpdCBzY3JhcGVUcmFuc2FjdGlvbnMoXG4gICAgcGFnZSxcbiAgICBDT01QTEVURURfVFJBTlNBQ1RJT05TX1RBQkxFLFxuICAgIFRyYW5zYWN0aW9uU3RhdHVzZXMuQ29tcGxldGVkLFxuICAgIHRydWUsXG4gICAgb3B0aW9ucyxcbiAgKTtcbiAgY29uc3QgdHhucyA9IFsuLi5wZW5kaW5nVHhucywgLi4uY29tcGxldGVkVHhuc107XG4gIHJldHVybiB0eG5zO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRDdXJyZW50QmFsYW5jZShwYWdlOiBQYWdlIHwgRnJhbWUpOiBQcm9taXNlPG51bWJlcj4ge1xuICAvLyBXYWl0IGZvciB0aGUgYmFsYW5jZSBlbGVtZW50IHRvIGFwcGVhciBhbmQgYmUgdmlzaWJsZVxuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgQ1VSUkVOVF9CQUxBTkNFLCB0cnVlLCBFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TKTtcblxuICAvLyBFeHRyYWN0IHRleHQgY29udGVudFxuICBjb25zdCBiYWxhbmNlU3RyID0gYXdhaXQgcGFnZS4kZXZhbChDVVJSRU5UX0JBTEFOQ0UsIGVsID0+IHtcbiAgICByZXR1cm4gKGVsIGFzIEhUTUxFbGVtZW50KS5pbm5lclRleHQ7XG4gIH0pO1xuXG4gIHJldHVybiBnZXRBbW91bnREYXRhKGJhbGFuY2VTdHIpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2FpdEZvclBvc3RMb2dpbihwYWdlOiBQYWdlKSB7XG4gIHJldHVybiBQcm9taXNlLnJhY2UoW1xuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI2NhcmQtaGVhZGVyJywgZmFsc2UpLCAvLyBOZXcgVUlcbiAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyNhY2NvdW50X251bScsIHRydWUpLCAvLyBOZXcgVUlcbiAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyNtYXRhZkxvZ291dExpbmsnLCB0cnVlKSwgLy8gT2xkIFVJXG4gICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICcjdmFsaWRhdGlvbk1zZycsIHRydWUpLCAvLyBPbGQgVUlcbiAgXSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoQWNjb3VudERhdGEocGFnZTogUGFnZSB8IEZyYW1lLCBzdGFydERhdGU6IE1vbWVudCwgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zKSB7XG4gIGNvbnN0IGFjY291bnROdW1iZXIgPSBhd2FpdCBnZXRBY2NvdW50TnVtYmVyKHBhZ2UpO1xuICBjb25zdCBiYWxhbmNlID0gYXdhaXQgZ2V0Q3VycmVudEJhbGFuY2UocGFnZSk7XG4gIGF3YWl0IHNlYXJjaEJ5RGF0ZXMocGFnZSwgc3RhcnREYXRlKTtcbiAgY29uc3QgdHhucyA9IGF3YWl0IGdldEFjY291bnRUcmFuc2FjdGlvbnMocGFnZSwgb3B0aW9ucyk7XG5cbiAgcmV0dXJuIHtcbiAgICBhY2NvdW50TnVtYmVyLFxuICAgIHR4bnMsXG4gICAgYmFsYW5jZSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0QWNjb3VudElkc09sZFVJKHBhZ2U6IFBhZ2UpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIHJldHVybiBwYWdlLmV2YWx1YXRlKCgpID0+IHtcbiAgICBjb25zdCBzZWxlY3RFbGVtZW50ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FjY291bnRfbnVtX3NlbGVjdCcpO1xuICAgIGNvbnN0IG9wdGlvbnMgPSBzZWxlY3RFbGVtZW50ID8gc2VsZWN0RWxlbWVudC5xdWVyeVNlbGVjdG9yQWxsKCdvcHRpb24nKSA6IFtdO1xuICAgIGlmICghb3B0aW9ucykgcmV0dXJuIFtdO1xuICAgIHJldHVybiBBcnJheS5mcm9tKG9wdGlvbnMsIG9wdGlvbiA9PiBvcHRpb24udmFsdWUpO1xuICB9KTtcbn1cblxuLyoqXG4gKiBFbnN1cmVzIHRoZSBhY2NvdW50IGRyb3Bkb3duIGlzIG9wZW4sIHRoZW4gcmV0dXJucyB0aGUgYXZhaWxhYmxlIGFjY291bnQgbGFiZWxzLlxuICpcbiAqIFRoaXMgbWV0aG9kOlxuICogLSBDaGVja3MgaWYgdGhlIGRyb3Bkb3duIGlzIGFscmVhZHkgb3Blbi5cbiAqIC0gSWYgbm90IG9wZW4sIGNsaWNrcyB0aGUgYWNjb3VudCBzZWxlY3RvciB0byBvcGVuIGl0LlxuICogLSBXYWl0cyBmb3IgdGhlIGRyb3Bkb3duIHRvIHJlbmRlci5cbiAqIC0gRXh0cmFjdHMgYW5kIHJldHVybnMgdGhlIGxpc3Qgb2YgYXZhaWxhYmxlIGFjY291bnQgbGFiZWxzLlxuICpcbiAqIEdyYWNlZnVsIGhhbmRsaW5nOlxuICogLSBJZiBhbnkgZXJyb3Igb2NjdXJzIChlLmcuLCBzZWxlY3RvcnMgbm90IGZvdW5kLCB0aW1pbmcgaXNzdWVzLCBVSSB2ZXJzaW9uIGNoYW5nZXMpLFxuICogICB0aGUgZnVuY3Rpb24gcmV0dXJucyBhbiBlbXB0eSBsaXN0LlxuICpcbiAqIEBwYXJhbSBwYWdlIFB1cHBldGVlciBQYWdlIG9iamVjdC5cbiAqIEByZXR1cm5zIEFuIGFycmF5IG9mIGF2YWlsYWJsZSBhY2NvdW50IGxhYmVscyAoZS5nLiwgW1wiMTI3IHwgWFhYWDFcIiwgXCIxMjcgfCBYWFhYMlwiXSksXG4gKiAgICAgICAgICBvciBhbiBlbXB0eSBhcnJheSBpZiBzb21ldGhpbmcgZ29lcyB3cm9uZy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNsaWNrQWNjb3VudFNlbGVjdG9yR2V0QWNjb3VudElkcyhwYWdlOiBQYWdlKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICB0cnkge1xuICAgIGNvbnN0IGFjY291bnRTZWxlY3RvciA9ICdkaXYuY3VycmVudC1hY2NvdW50JzsgLy8gRGlyZWN0IHNlbGVjdG9yIHRvIGNsaWNrYWJsZSBlbGVtZW50XG4gICAgY29uc3QgZHJvcGRvd25QYW5lbFNlbGVjdG9yID0gJ2Rpdi5tYXQtbWRjLWF1dG9jb21wbGV0ZS1wYW5lbC5hY2NvdW50LXNlbGVjdC1kZCc7IC8vIFRoZSBkcm9wZG93biBsaXN0IGJveFxuICAgIGNvbnN0IG9wdGlvblNlbGVjdG9yID0gJ21hdC1vcHRpb24gLm1kYy1saXN0LWl0ZW1fX3ByaW1hcnktdGV4dCc7IC8vIEFjY291bnQgb3B0aW9uIGxhYmVsc1xuXG4gICAgLy8gQ2hlY2sgaWYgZHJvcGRvd24gaXMgYWxyZWFkeSBvcGVuXG4gICAgY29uc3QgZHJvcGRvd25WaXNpYmxlID0gYXdhaXQgcGFnZVxuICAgICAgLiRldmFsKGRyb3Bkb3duUGFuZWxTZWxlY3RvciwgZWwgPT4ge1xuICAgICAgICByZXR1cm4gZWwgJiYgd2luZG93LmdldENvbXB1dGVkU3R5bGUoZWwpLmRpc3BsYXkgIT09ICdub25lJyAmJiBlbC5vZmZzZXRQYXJlbnQgIT09IG51bGw7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKCgpID0+IGZhbHNlKTsgLy8gY2F0Y2ggaWYgZHJvcGRvd24gaXMgbm90IGluIHRoZSBET00geWV0XG5cbiAgICBpZiAoIWRyb3Bkb3duVmlzaWJsZSkge1xuICAgICAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsIGFjY291bnRTZWxlY3RvciwgdHJ1ZSwgRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyk7XG5cbiAgICAgIC8vIENsaWNrIHRoZSBhY2NvdW50IHNlbGVjdG9yIHRvIG9wZW4gdGhlIGRyb3Bkb3duXG4gICAgICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCBhY2NvdW50U2VsZWN0b3IpO1xuXG4gICAgICAvLyBXYWl0IGZvciB0aGUgZHJvcGRvd24gdG8gb3BlblxuICAgICAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsIGRyb3Bkb3duUGFuZWxTZWxlY3RvciwgdHJ1ZSwgRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyk7XG4gICAgfVxuXG4gICAgLy8gRXh0cmFjdCBhY2NvdW50IGxhYmVscyBmcm9tIHRoZSBkcm9wZG93biBvcHRpb25zXG4gICAgY29uc3QgYWNjb3VudExhYmVscyA9IGF3YWl0IHBhZ2UuJCRldmFsKG9wdGlvblNlbGVjdG9yLCBvcHRpb25zID0+IHtcbiAgICAgIHJldHVybiBvcHRpb25zLm1hcChvcHRpb24gPT4gb3B0aW9uLnRleHRDb250ZW50Py50cmltKCkgfHwgJycpLmZpbHRlcihsYWJlbCA9PiBsYWJlbCAhPT0gJycpO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIGFjY291bnRMYWJlbHM7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIFtdOyAvLyBHcmFjZWZ1bCBmYWxsYmFja1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEFjY291bnRJZHNCb3RoVUlzKHBhZ2U6IFBhZ2UpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIGxldCBhY2NvdW50c0lkczogc3RyaW5nW10gPSBhd2FpdCBjbGlja0FjY291bnRTZWxlY3RvckdldEFjY291bnRJZHMocGFnZSk7XG4gIGlmIChhY2NvdW50c0lkcy5sZW5ndGggPT09IDApIHtcbiAgICBhY2NvdW50c0lkcyA9IGF3YWl0IGdldEFjY291bnRJZHNPbGRVSShwYWdlKTtcbiAgfVxuICByZXR1cm4gYWNjb3VudHNJZHM7XG59XG5cbi8qKlxuICogU2VsZWN0cyBhbiBhY2NvdW50IGZyb20gdGhlIGRyb3Bkb3duIGJhc2VkIG9uIHRoZSBwcm92aWRlZCBhY2NvdW50IGxhYmVsLlxuICpcbiAqIFRoaXMgbWV0aG9kOlxuICogLSBDbGlja3MgdGhlIGFjY291bnQgc2VsZWN0b3IgYnV0dG9uIHRvIG9wZW4gdGhlIGRyb3Bkb3duLlxuICogLSBSZXRyaWV2ZXMgdGhlIGxpc3Qgb2YgYXZhaWxhYmxlIGFjY291bnQgbGFiZWxzLlxuICogLSBDaGVja3MgaWYgdGhlIHByb3ZpZGVkIGFjY291bnQgbGFiZWwgZXhpc3RzIGluIHRoZSBsaXN0LlxuICogLSBGaW5kcyBhbmQgY2xpY2tzIHRoZSBtYXRjaGluZyBhY2NvdW50IG9wdGlvbiBpZiBmb3VuZC5cbiAqXG4gKiBAcGFyYW0gcGFnZSBQdXBwZXRlZXIgUGFnZSBvYmplY3QuXG4gKiBAcGFyYW0gYWNjb3VudExhYmVsIFRoZSB0ZXh0IG9mIHRoZSBhY2NvdW50IHRvIHNlbGVjdCAoZS5nLiwgXCIxMjcgfCBYWFhYWFwiKS5cbiAqIEByZXR1cm5zIFRydWUgaWYgdGhlIGFjY291bnQgb3B0aW9uIHdhcyBmb3VuZCBhbmQgY2xpY2tlZDsgZmFsc2Ugb3RoZXJ3aXNlLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2VsZWN0QWNjb3VudEZyb21Ecm9wZG93bihwYWdlOiBQYWdlLCBhY2NvdW50TGFiZWw6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAvLyBDYWxsIGNsaWNrQWNjb3VudFNlbGVjdG9yIHRvIGdldCB0aGUgYXZhaWxhYmxlIGFjY291bnRzIGFuZCBvcGVuIHRoZSBkcm9wZG93blxuICBjb25zdCBhdmFpbGFibGVBY2NvdW50cyA9IGF3YWl0IGNsaWNrQWNjb3VudFNlbGVjdG9yR2V0QWNjb3VudElkcyhwYWdlKTtcblxuICAvLyBDaGVjayBpZiB0aGUgYWNjb3VudCBsYWJlbCBleGlzdHMgaW4gdGhlIGF2YWlsYWJsZSBhY2NvdW50c1xuICBpZiAoIWF2YWlsYWJsZUFjY291bnRzLmluY2x1ZGVzKGFjY291bnRMYWJlbCkpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvLyBXYWl0IGZvciB0aGUgZHJvcGRvd24gb3B0aW9ucyB0byBiZSByZW5kZXJlZFxuICBjb25zdCBvcHRpb25TZWxlY3RvciA9ICdtYXQtb3B0aW9uIC5tZGMtbGlzdC1pdGVtX19wcmltYXJ5LXRleHQnO1xuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgb3B0aW9uU2VsZWN0b3IsIHRydWUsIEVMRU1FTlRfUkVOREVSX1RJTUVPVVRfTVMpO1xuXG4gIC8vIFF1ZXJ5IGFsbCBtYXRjaGluZyBvcHRpb25zXG4gIGNvbnN0IGFjY291bnRPcHRpb25zID0gYXdhaXQgcGFnZS4kJChvcHRpb25TZWxlY3Rvcik7XG5cbiAgLy8gRmluZCBhbmQgY2xpY2sgdGhlIG9wdGlvbiBtYXRjaGluZyB0aGUgYWNjb3VudExhYmVsXG4gIGZvciAoY29uc3Qgb3B0aW9uIG9mIGFjY291bnRPcHRpb25zKSB7XG4gICAgY29uc3QgdGV4dCA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoZWwgPT4gZWwudGV4dENvbnRlbnQ/LnRyaW0oKSwgb3B0aW9uKTtcblxuICAgIGlmICh0ZXh0ID09PSBhY2NvdW50TGFiZWwpIHtcbiAgICAgIGNvbnN0IG9wdGlvbkhhbmRsZSA9IGF3YWl0IG9wdGlvbi5ldmFsdWF0ZUhhbmRsZShlbCA9PiBlbCBhcyBIVE1MRWxlbWVudCk7XG4gICAgICBhd2FpdCBwYWdlLmV2YWx1YXRlKChlbDogSFRNTEVsZW1lbnQpID0+IGVsLmNsaWNrKCksIG9wdGlvbkhhbmRsZSk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZmFsc2U7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uc0ZyYW1lKHBhZ2U6IFBhZ2UpOiBQcm9taXNlPEZyYW1lIHwgbnVsbD4ge1xuICAvLyBUcnkgYSBmZXcgdGltZXMgdG8gZmluZCB0aGUgaWZyYW1lLCBhcyBpdCBtaWdodCBub3QgYmUgaW1tZWRpYXRlbHkgYXZhaWxhYmxlXG4gIGZvciAobGV0IGF0dGVtcHQgPSAwOyBhdHRlbXB0IDwgMzsgYXR0ZW1wdCsrKSB7XG4gICAgYXdhaXQgc2xlZXAoMjAwMCk7XG4gICAgY29uc3QgZnJhbWVzID0gcGFnZS5mcmFtZXMoKTtcbiAgICBjb25zdCB0YXJnZXRGcmFtZSA9IGZyYW1lcy5maW5kKGYgPT4gZi5uYW1lKCkgPT09IElGUkFNRV9OQU1FKTtcblxuICAgIGlmICh0YXJnZXRGcmFtZSkge1xuICAgICAgcmV0dXJuIHRhcmdldEZyYW1lO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBudWxsO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzZWxlY3RBY2NvdW50Qm90aFVJcyhwYWdlOiBQYWdlLCBhY2NvdW50SWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBhY2NvdW50U2VsZWN0ZWQgPSBhd2FpdCBzZWxlY3RBY2NvdW50RnJvbURyb3Bkb3duKHBhZ2UsIGFjY291bnRJZCk7XG4gIGlmICghYWNjb3VudFNlbGVjdGVkKSB7XG4gICAgLy8gT2xkIFVJIGZvcm1hdFxuICAgIGF3YWl0IHBhZ2Uuc2VsZWN0KCcjYWNjb3VudF9udW1fc2VsZWN0JywgYWNjb3VudElkKTtcbiAgICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyNhY2NvdW50X251bV9zZWxlY3QnLCB0cnVlKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaEFjY291bnREYXRhQm90aFVJcyhcbiAgcGFnZTogUGFnZSxcbiAgc3RhcnREYXRlOiBNb21lbnQsXG4gIG9wdGlvbnM/OiBTY3JhcGVyT3B0aW9ucyxcbik6IFByb21pc2U8VHJhbnNhY3Rpb25zQWNjb3VudD4ge1xuICAvLyBUcnkgdG8gZ2V0IHRoZSBpZnJhbWUgZm9yIHRoZSBuZXcgVUlcbiAgY29uc3QgZnJhbWUgPSBhd2FpdCBnZXRUcmFuc2FjdGlvbnNGcmFtZShwYWdlKTtcblxuICAvLyBVc2UgdGhlIGZyYW1lIGlmIGF2YWlsYWJsZSAobmV3IFVJKSwgb3RoZXJ3aXNlIHVzZSB0aGUgcGFnZSBkaXJlY3RseSAob2xkIFVJKVxuICBjb25zdCB0YXJnZXRQYWdlID0gZnJhbWUgfHwgcGFnZTtcbiAgcmV0dXJuIGZldGNoQWNjb3VudERhdGEodGFyZ2V0UGFnZSwgc3RhcnREYXRlLCBvcHRpb25zKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hBY2NvdW50cyhwYWdlOiBQYWdlLCBzdGFydERhdGU6IE1vbWVudCwgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zKTogUHJvbWlzZTxUcmFuc2FjdGlvbnNBY2NvdW50W10+IHtcbiAgY29uc3QgYWNjb3VudHNJZHMgPSBhd2FpdCBnZXRBY2NvdW50SWRzQm90aFVJcyhwYWdlKTtcblxuICBpZiAoYWNjb3VudHNJZHMubGVuZ3RoID09PSAwKSB7XG4gICAgLy8gSW4gY2FzZSBhY2NvdW50c0lkcyBjb3VsZCBubyBiZSBwYXJzZWQganVzdCByZXR1cm4gdGhlIHRyYW5zYWN0aW9ucyBvZiB0aGUgY3VycmVudGx5IHNlbGVjdGVkIGFjY291bnRcbiAgICBjb25zdCBhY2NvdW50RGF0YSA9IGF3YWl0IGZldGNoQWNjb3VudERhdGFCb3RoVUlzKHBhZ2UsIHN0YXJ0RGF0ZSwgb3B0aW9ucyk7XG4gICAgcmV0dXJuIFthY2NvdW50RGF0YV07XG4gIH1cblxuICBjb25zdCBhY2NvdW50czogVHJhbnNhY3Rpb25zQWNjb3VudFtdID0gW107XG4gIGZvciAoY29uc3QgYWNjb3VudElkIG9mIGFjY291bnRzSWRzKSB7XG4gICAgYXdhaXQgc2VsZWN0QWNjb3VudEJvdGhVSXMocGFnZSwgYWNjb3VudElkKTtcbiAgICBjb25zdCBhY2NvdW50RGF0YSA9IGF3YWl0IGZldGNoQWNjb3VudERhdGFCb3RoVUlzKHBhZ2UsIHN0YXJ0RGF0ZSwgb3B0aW9ucyk7XG4gICAgYWNjb3VudHMucHVzaChhY2NvdW50RGF0YSk7XG4gIH1cblxuICByZXR1cm4gYWNjb3VudHM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JlaWduQ3VycmVuY3lUb0lzbyhsYWJlbDogc3RyaW5nKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIEZDX0NVUlJFTkNZX0JZX0hFQlJFVy5maW5kKChbcmVdKSA9PiByZS50ZXN0KGxhYmVsKSk/LlsxXTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0Rm9yZWlnbkN1cnJlbmN5T3B0aW9ucyhmcmFtZTogRnJhbWUpOiBQcm9taXNlPEFycmF5PHsgdmFsdWU6IHN0cmluZzsgbGFiZWw6IHN0cmluZyB9Pj4ge1xuICByZXR1cm4gcGFnZUV2YWxBbGw8QXJyYXk8eyB2YWx1ZTogc3RyaW5nOyBsYWJlbDogc3RyaW5nIH0+PihmcmFtZSwgYCR7RkNfQ1VSUkVOQ1lfU0VMRUNUfSBvcHRpb25gLCBbXSwgb3B0cyA9PlxuICAgIG9wdHMubWFwKG8gPT4gKHtcbiAgICAgIHZhbHVlOiAobyBhcyBIVE1MT3B0aW9uRWxlbWVudCkudmFsdWUsXG4gICAgICBsYWJlbDogKChvIGFzIEhUTUxFbGVtZW50KS50ZXh0Q29udGVudCB8fCAnJykudHJpbSgpLFxuICAgIH0pKSxcbiAgKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0Rm9yZWlnbkN1cnJlbmN5Um93cyhmcmFtZTogRnJhbWUpOiBQcm9taXNlPEZjUm93W10+IHtcbiAgcmV0dXJuIHBhZ2VFdmFsQWxsPEZjUm93W10+KFxuICAgIGZyYW1lLFxuICAgIGAke0ZDX1RSQU5TQUNUSU9OU19UQUJMRX0gdGJvZHkgdHJgLFxuICAgIFtdLFxuICAgICh0cnMsIGxpbmtTZWxlY3RvcikgPT4ge1xuICAgICAgcmV0dXJuIHRycy5tYXAodHIgPT4gKHtcbiAgICAgICAgdGRzOiBBcnJheS5mcm9tKHRyLmdldEVsZW1lbnRzQnlUYWdOYW1lKCd0ZCcpKS5tYXAodGQgPT4gKHRkIGFzIEhUTUxFbGVtZW50KS5pbm5lclRleHQpLFxuICAgICAgICBoYXNEZXRhaWxMaW5rOiAhIXRyLnF1ZXJ5U2VsZWN0b3IobGlua1NlbGVjdG9yIGFzIHN0cmluZyksXG4gICAgICB9KSk7XG4gICAgfSxcbiAgICBGQ19ERVRBSUxfTElOS19TRUxFQ1RPUixcbiAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RGb3JlaWduQ3VycmVuY3lUcmFuc2FjdGlvbnMocm93czogRmNSb3dbXSk6IFNjcmFwZWRGY1RyYW5zYWN0aW9uW10ge1xuICBjb25zdCB0eG5zOiBTY3JhcGVkRmNUcmFuc2FjdGlvbltdID0gW107XG4gIGZvciAoY29uc3QgeyB0ZHMsIGhhc0RldGFpbExpbmsgfSBvZiByb3dzKSB7XG4gICAgY29uc3QgZGF0ZSA9ICh0ZHNbRkNfQ09MLmRhdGVdIHx8ICcnKS50cmltKCk7XG4gICAgLy8gQW4gZW1wdHkgZGF0ZSBjZWxsIGlzIHRoZSBvcGVuaW5nLWJhbGFuY2UgKNeZ16rXqNeqINek16rXmdeX15QpIHJvdyDigJQgc2tpcCBpdCwgc2FtZVxuICAgIC8vIGFzIHRoZSBOSVMgcGFyc2VyIGRyb3BzIHJvd3Mgd2l0aG91dCBhIGRhdGUuXG4gICAgaWYgKGRhdGUgPT09ICcnKSBjb250aW51ZTtcbiAgICBjb25zdCByZWZlcmVuY2UgPSAodGRzW0ZDX0NPTC5yZWZlcmVuY2VdIHx8ICcnKS50cmltKCk7XG4gICAgY29uc3QgZGVzY3JpcHRpb24gPSAodGRzW0ZDX0NPTC5kZXNjcmlwdGlvbl0gfHwgJycpLnRyaW0oKTtcbiAgICB0eG5zLnB1c2goe1xuICAgICAgc3RhdHVzOiBUcmFuc2FjdGlvblN0YXR1c2VzLkNvbXBsZXRlZCxcbiAgICAgIGRhdGUsXG4gICAgICBkZXNjcmlwdGlvbixcbiAgICAgIHJlZmVyZW5jZSxcbiAgICAgIGRlYml0OiAodGRzW0ZDX0NPTC5kZWJpdF0gfHwgJycpLnRyaW0oKSxcbiAgICAgIGNyZWRpdDogKHRkc1tGQ19DT0wuY3JlZGl0XSB8fCAnJykudHJpbSgpLFxuICAgICAgLy8gT25seSB0cmFuc2ZlcnMgY2FycnkgYSByZWNpcGllbnQgd29ydGggc2hvd2luZzsgdGhlIGJhbmsgbGlua3MgdGhlIHNhbWVcbiAgICAgIC8vIFNXSUZUIG1lc3NhZ2UgZnJvbSB0aGUgcGFpcmVkIGZlZSByb3csIHdoaWNoIHdlIGRlbGliZXJhdGVseSBsZWF2ZSBhbG9uZS5cbiAgICAgIGRldGFpbFJlZmVyZW5jZTpcbiAgICAgICAgaGFzRGV0YWlsTGluayAmJiByZWZlcmVuY2UgIT09ICcnICYmIGRlc2NyaXB0aW9uLmluY2x1ZGVzKEZDX1RSQU5TRkVSX0RFU0NSSVBUSU9OX01BUktFUilcbiAgICAgICAgICA/IHJlZmVyZW5jZVxuICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgIH0pO1xuICB9XG4gIHJldHVybiB0eG5zO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdEZvcmVpZ25DdXJyZW5jeUJhbGFuY2Uocm93czogRmNSb3dbXSk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGZvciAobGV0IGkgPSByb3dzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgY29uc3QgYmFsYW5jZVN0ciA9IChyb3dzW2ldLnRkc1tGQ19DT0wuYmFsYW5jZV0gfHwgJycpLnRyaW0oKTtcbiAgICBpZiAoYmFsYW5jZVN0ciAhPT0gJycpIHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IGdldEFtb3VudERhdGEoYmFsYW5jZVN0cik7XG4gICAgICByZXR1cm4gTnVtYmVyLmlzTmFOKHBhcnNlZCkgPyB1bmRlZmluZWQgOiBwYXJzZWQ7XG4gICAgfVxuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogUmVhZHMgdGhlIGJlbmVmaWNpYXJ5IChg16nXnSDXnteV15jXkWApIG9mZiBhIHdpcmUgdHJhbnNmZXIncyBTV0lGVCBtZXNzYWdlIGJ5XG4gKiBmZXRjaGluZyB0aGUgcG9wdXAgVVJMIHRoYXQgYGNhbGwyNzZgIHdvdWxkIGhhdmUgb3BlbmVkLCBmcm9tIHdpdGhpbiB0aGVcbiAqIGF1dGhlbnRpY2F0ZWQgcGFnZSBjb250ZXh0LiBSZXR1cm5zIHVuZGVmaW5lZCBmb3IgYW55dGhpbmcgdGhhdCBpc24ndCBhIHdpcmVcbiAqIHdpdGggYSBuYW1lZCBiZW5lZmljaWFyeSAoZS5nLiBhIGNhcmQgc2V0dGxlbWVudCksIHNvIGNhbGxlcnMgY2FuIG5vLW9wLlxuICovXG5hc3luYyBmdW5jdGlvbiBmZXRjaEJlbmVmaWNpYXJ5TmFtZShmcmFtZTogRnJhbWUsIHJlZmVyZW5jZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgY29uc3QgdXJsID0gZmNEZXRhaWxVcmwocmVmZXJlbmNlLnBhZFN0YXJ0KEZDX0RFVEFJTF9SRUZFUkVOQ0VfUEFELCAnMCcpKTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gYXdhaXQgZnJhbWUuZXZhbHVhdGUoXG4gICAgICBhc3luYyAoZGV0YWlsVXJsOiBzdHJpbmcsIGxhYmVsOiBzdHJpbmcpID0+IHtcbiAgICAgICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goZGV0YWlsVXJsLCB7IGNyZWRlbnRpYWxzOiAnaW5jbHVkZScgfSk7XG4gICAgICAgIGlmICghcmVzLm9rKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICBjb25zdCBwYXJzZWQgPSBuZXcgRE9NUGFyc2VyKCkucGFyc2VGcm9tU3RyaW5nKGF3YWl0IHJlcy50ZXh0KCksICd0ZXh0L2h0bWwnKTtcbiAgICAgICAgZm9yIChjb25zdCB0ciBvZiBBcnJheS5mcm9tKHBhcnNlZC5xdWVyeVNlbGVjdG9yQWxsKCd0cicpKSkge1xuICAgICAgICAgIGNvbnN0IGNlbGxzID0gQXJyYXkuZnJvbSh0ci5xdWVyeVNlbGVjdG9yQWxsKCd0ZCcpKS5tYXAodGQgPT4gKHRkLnRleHRDb250ZW50IHx8ICcnKS50cmltKCkpO1xuICAgICAgICAgIC8vIFNXSUZUIGxhYmVsIHJvd3MgYXJlIFtlbmdsaXNoIGxhYmVsLCB2YWx1ZSwgaGVicmV3IGxhYmVsXVxuICAgICAgICAgIGlmIChjZWxscy5sZW5ndGggPT09IDMgJiYgY2VsbHNbMl0gPT09IGxhYmVsKSByZXR1cm4gY2VsbHNbMV0gfHwgdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9LFxuICAgICAgdXJsLFxuICAgICAgRkNfQkVORUZJQ0lBUllfTEFCRUwsXG4gICAgKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxufVxuXG4vKipcbiAqIFByZWZpeGVzIGVhY2ggd2lyZSB0cmFuc2ZlcidzIGRlc2NyaXB0aW9uIHdpdGggaXRzIHJlY2lwaWVudCwgZS5nLlxuICogYE9NTklQQUsgTElNSVRFRCDigJMg15TXoteR16jXlC0g15nXkdeV15Ag16nXmdeo15XXqteZ151gLiBFYWNoIHJlZmVyZW5jZSBpcyBmZXRjaGVkIG9uY2UsIHNpbmNlXG4gKiBhIHRyYW5zZmVyIGFuZCBpdHMgZmVlIHNoYXJlIG9uZSDXkNeh157Xm9eq15AuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGFwcGx5QmVuZWZpY2lhcnlOYW1lcyhmcmFtZTogRnJhbWUsIHR4bnM6IFNjcmFwZWRGY1RyYW5zYWN0aW9uW10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgY2FjaGUgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPigpO1xuICBmb3IgKGNvbnN0IHR4biBvZiB0eG5zKSB7XG4gICAgY29uc3QgcmVmID0gdHhuLmRldGFpbFJlZmVyZW5jZTtcbiAgICBpZiAoIXJlZikgY29udGludWU7XG4gICAgaWYgKCFjYWNoZS5oYXMocmVmKSkge1xuICAgICAgY29uc3QgbmFtZSA9IGF3YWl0IGZldGNoQmVuZWZpY2lhcnlOYW1lKGZyYW1lLCByZWYpO1xuICAgICAgY2FjaGUuc2V0KHJlZiwgbmFtZSk7XG4gICAgICBkZWJ1ZygnZm9yZWlnbi1jdXJyZW5jeTogcmVmZXJlbmNlICVzIOKGkiBiZW5lZmljaWFyeSAlcycsIHJlZiwgbmFtZSA/PyAnKG5vbmUpJyk7XG4gICAgfVxuICAgIGNvbnN0IGJlbmVmaWNpYXJ5ID0gY2FjaGUuZ2V0KHJlZik7XG4gICAgaWYgKGJlbmVmaWNpYXJ5KSB7XG4gICAgICB0eG4uZGVzY3JpcHRpb24gPSBgJHtiZW5lZmljaWFyeX0g4oCTICR7dHhuLmRlc2NyaXB0aW9ufWA7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjb252ZXJ0Rm9yZWlnbkN1cnJlbmN5VHJhbnNhY3Rpb25zKFxuICB0eG5zOiBTY3JhcGVkVHJhbnNhY3Rpb25bXSxcbiAgY3VycmVuY3k6IHN0cmluZyxcbiAgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zLFxuKTogVHJhbnNhY3Rpb25bXSB7XG4gIHJldHVybiB0eG5zLm1hcCgodHhuKTogVHJhbnNhY3Rpb24gPT4ge1xuICAgIGNvbnN0IGNvbnZlcnRlZERhdGUgPSBtb21lbnQodHhuLmRhdGUsIERBVEVfRk9STUFUKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IGNvbnZlcnRlZEFtb3VudCA9IGdldFR4bkFtb3VudCh0eG4pO1xuICAgIGNvbnN0IHJlc3VsdDogVHJhbnNhY3Rpb24gPSB7XG4gICAgICB0eXBlOiBUcmFuc2FjdGlvblR5cGVzLk5vcm1hbCxcbiAgICAgIGlkZW50aWZpZXI6IHR4bi5yZWZlcmVuY2UgPyBwYXJzZUludCh0eG4ucmVmZXJlbmNlLCAxMCkgOiB1bmRlZmluZWQsXG4gICAgICBkYXRlOiBjb252ZXJ0ZWREYXRlLFxuICAgICAgcHJvY2Vzc2VkRGF0ZTogY29udmVydGVkRGF0ZSxcbiAgICAgIG9yaWdpbmFsQW1vdW50OiBjb252ZXJ0ZWRBbW91bnQsXG4gICAgICAvLyBUaGUgRkMgYWNjb3VudCdzIG93biBjdXJyZW5jeS4gY2hhcmdlZEN1cnJlbmN5IGlzIGludGVudGlvbmFsbHkgbGVmdFxuICAgICAgLy8gdW5zZXQg4oCUIGRvd25zdHJlYW0gY29uc3VtZXJzIGZhbGwgYmFjayB0byBvcmlnaW5hbEN1cnJlbmN5LCBhbmQgdGhlXG4gICAgICAvLyBhbW91bnQgaXMgYWxyZWFkeSBkZW5vbWluYXRlZCBpbiB0aGF0IGN1cnJlbmN5IChsaWtlIHRoZSBNZXJjdXJ5IHNjcmFwZXIpLlxuICAgICAgb3JpZ2luYWxDdXJyZW5jeTogY3VycmVuY3ksXG4gICAgICBjaGFyZ2VkQW1vdW50OiBjb252ZXJ0ZWRBbW91bnQsXG4gICAgICBzdGF0dXM6IHR4bi5zdGF0dXMsXG4gICAgICBkZXNjcmlwdGlvbjogdHhuLmRlc2NyaXB0aW9uLFxuICAgICAgbWVtbzogdHhuLm1lbW8sXG4gICAgfTtcblxuICAgIGlmIChvcHRpb25zPy5pbmNsdWRlUmF3VHJhbnNhY3Rpb24pIHtcbiAgICAgIHJlc3VsdC5yYXdUcmFuc2FjdGlvbiA9IGdldFJhd1RyYW5zYWN0aW9uKHR4bik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJ1bkZvcmVpZ25DdXJyZW5jeVF1ZXJ5KGZyYW1lOiBGcmFtZSwgY3VycmVuY3lPcHRpb25WYWx1ZTogc3RyaW5nLCBzdGFydERhdGU6IE1vbWVudCkge1xuICBhd2FpdCBmcmFtZS5zZWxlY3QoRkNfQ1VSUkVOQ1lfU0VMRUNULCBjdXJyZW5jeU9wdGlvblZhbHVlKTtcbiAgYXdhaXQgZmlsbElucHV0KGZyYW1lLCBGQ19GUk9NX0RBVEVfSU5QVVQsIHN0YXJ0RGF0ZS5mb3JtYXQoREFURV9GT1JNQVQpKTtcbiAgYXdhaXQgZmlsbElucHV0KGZyYW1lLCBGQ19USUxMX0RBVEVfSU5QVVQsIG1vbWVudCgpLmZvcm1hdChEQVRFX0ZPUk1BVCkpO1xuICBhd2FpdCBjbGlja0J1dHRvbihmcmFtZSwgYGlucHV0W3ZhbHVlPSR7U0hPV19TRUFSQ0hfQllfREFURVNfQlVUVE9OX1ZBTFVFfV1gKTtcbiAgYXdhaXQgd2FpdEZvck5hdmlnYXRpb24oZnJhbWUpO1xufVxuXG4vKipcbiAqIFNjcmFwZXMgdGhlIEJlaW5sZXVtaSBmb3JlaWduLWN1cnJlbmN5ICjXnteYXCLXlykgY3VycmVudCBhY2NvdW50LCBvbmVcbiAqIHN1Yi1hY2NvdW50IHBlciBjdXJyZW5jeSBpbiB0aGUgYCNJTi1TQ0gtTVRCYCBkcm9wZG93bi5cbiAqXG4gKiBUaGUgdG9wLWxldmVsIGFjY291bnQgc3dpdGNoZXIgaXMgbmV2ZXIgdG91Y2hlZCDigJQgYSBkaWZmZXJlbnQgc3dpdGNoZXIgYWNjb3VudFxuICogYmVsb25ncyB0byBhIGRpZmZlcmVudCBhcHAgcHJvZmlsZS4gSW5zdGVhZCB3ZSByZWFkIGl0IChgZGl2LmN1cnJlbnQtYWNjb3VudGApXG4gKiBhbmQgYmFpbCBpZiBpdCBkb2Vzbid0IG1hdGNoIGBleHBlY3RlZEFjY291bnRgLCBzbyBhIHdyb25nIGxvZ2luIGNhbid0IHJlY29yZFxuICogRkMgcm93cyBhZ2FpbnN0IHRoZSB3cm9uZyBhY2NvdW50LlxuICovXG5hc3luYyBmdW5jdGlvbiBmZXRjaEZvcmVpZ25DdXJyZW5jeUFjY291bnRzKFxuICBwYWdlOiBQYWdlLFxuICBleHBlY3RlZEFjY291bnQ6IHN0cmluZyxcbiAgc3RhcnREYXRlOiBNb21lbnQsXG4gIG9wdGlvbnM/OiBTY3JhcGVyT3B0aW9ucyxcbik6IFByb21pc2U8VHJhbnNhY3Rpb25zQWNjb3VudFtdPiB7XG4gIGNvbnN0IGZyYW1lID0gYXdhaXQgZ2V0VHJhbnNhY3Rpb25zRnJhbWUocGFnZSk7XG4gIGlmICghZnJhbWUpIHtcbiAgICBkZWJ1ZygnZm9yZWlnbi1jdXJyZW5jeTogdHJhbnNhY3Rpb25zIGlmcmFtZSBub3QgZm91bmQsIHNraXBwaW5nJyk7XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgY29uc3Qgc2VsZWN0ZWRBY2NvdW50ID0gYXdhaXQgcGFnZVxuICAgIC4kZXZhbChDVVJSRU5UX0FDQ09VTlRfTEFCRUwsIGVsID0+IChlbCBhcyBIVE1MRWxlbWVudCkuaW5uZXJUZXh0LnRyaW0oKSlcbiAgICAuY2F0Y2goKCkgPT4gJycpO1xuICBpZiAoIXNlbGVjdGVkQWNjb3VudC5pbmNsdWRlcyhleHBlY3RlZEFjY291bnQpKSB7XG4gICAgZGVidWcoJ2ZvcmVpZ24tY3VycmVuY3k6IHN3aXRjaGVyIHNob3dzIFwiJXNcIiwgZXhwZWN0ZWQgXCIlc1wiIOKAlCBza2lwcGluZyBGQyBwYXNzJywgc2VsZWN0ZWRBY2NvdW50LCBleHBlY3RlZEFjY291bnQpO1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIGNvbnN0IGN1cnJlbmNpZXMgPSBhd2FpdCBnZXRGb3JlaWduQ3VycmVuY3lPcHRpb25zKGZyYW1lKTtcbiAgY29uc3QgYWNjb3VudHM6IFRyYW5zYWN0aW9uc0FjY291bnRbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgeyB2YWx1ZSwgbGFiZWwgfSBvZiBjdXJyZW5jaWVzKSB7XG4gICAgY29uc3QgY3VycmVuY3kgPSBmb3JlaWduQ3VycmVuY3lUb0lzbyhsYWJlbCk7XG4gICAgaWYgKCFjdXJyZW5jeSkge1xuICAgICAgZGVidWcoJ2ZvcmVpZ24tY3VycmVuY3k6IHVubWFwcGVkIGN1cnJlbmN5IGxhYmVsIFwiJXNcIiAodmFsdWUgJXMpIOKAlCBza2lwcGluZycsIGxhYmVsLCB2YWx1ZSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBhd2FpdCBydW5Gb3JlaWduQ3VycmVuY3lRdWVyeShmcmFtZSwgdmFsdWUsIHN0YXJ0RGF0ZSk7XG5cbiAgICBjb25zdCBhY2NvdW50TnVtYmVyID0gYCR7ZXhwZWN0ZWRBY2NvdW50fSAke2N1cnJlbmN5fWA7XG4gICAgaWYgKGF3YWl0IGlzTm9UcmFuc2FjdGlvbkluRGF0ZVJhbmdlRXJyb3IoZnJhbWUpKSB7XG4gICAgICBhY2NvdW50cy5wdXNoKHsgYWNjb3VudE51bWJlciwgdHhuczogW10gfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgZ2V0Rm9yZWlnbkN1cnJlbmN5Um93cyhmcmFtZSk7XG4gICAgY29uc3Qgc2NyYXBlZCA9IGV4dHJhY3RGb3JlaWduQ3VycmVuY3lUcmFuc2FjdGlvbnMocm93cyk7XG4gICAgLy8gVGhlIHRhYmxlIG5ldmVyIHNob3dzIHdobyBhIHdpcmUgd2VudCB0byDigJQgZW5yaWNoIHRyYW5zZmVycyBmcm9tIHRoZWlyXG4gICAgLy8gU1dJRlQgbWVzc2FnZSBiZWZvcmUgY29udmVydGluZy5cbiAgICBhd2FpdCBhcHBseUJlbmVmaWNpYXJ5TmFtZXMoZnJhbWUsIHNjcmFwZWQpO1xuICAgIGFjY291bnRzLnB1c2goe1xuICAgICAgYWNjb3VudE51bWJlcixcbiAgICAgIGJhbGFuY2U6IGV4dHJhY3RGb3JlaWduQ3VycmVuY3lCYWxhbmNlKHJvd3MpLFxuICAgICAgdHhuczogY29udmVydEZvcmVpZ25DdXJyZW5jeVRyYW5zYWN0aW9ucyhzY3JhcGVkLCBjdXJyZW5jeSwgb3B0aW9ucyksXG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gYWNjb3VudHM7XG59XG5cbnR5cGUgU2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHMgPSB7XG4gIHVzZXJuYW1lOiBzdHJpbmc7XG4gIHBhc3N3b3JkOiBzdHJpbmc7XG4gIC8vIENvbmZpZy1vbmx5IGZpZWxkIChtb25leW1hbik6IHRoZSBiYXNlIGFjY291bnQgdGhpcyBsb2dpbiBpcyBleHBlY3RlZCB0b1xuICAvLyBsYW5kIG9uIChlLmcuIFwiMDM4LTMyOTE0MlwiKS4gUHJlc2VuY2Ugb3B0cyB0aGUgbG9naW4gaW50byB0aGUgRkMgcGFzcyBhbmQgaXNcbiAgLy8gdmVyaWZpZWQgcmVhZC1vbmx5IGFnYWluc3QgdGhlIGFjY291bnQgc3dpdGNoZXIuIElnbm9yZWQgYnkgbG9naW4gaXRzZWxmLlxuICBleHBlY3RlZEZvcmVpZ25DdXJyZW5jeUFjY291bnQ/OiBzdHJpbmc7XG59O1xuXG5jbGFzcyBCZWlubGV1bWlHcm91cEJhc2VTY3JhcGVyIGV4dGVuZHMgQmFzZVNjcmFwZXJXaXRoQnJvd3NlcjxTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscz4ge1xuICBCQVNFX1VSTCA9ICcnO1xuXG4gIExPR0lOX1VSTCA9ICcnO1xuXG4gIFRSQU5TQUNUSU9OU19VUkwgPSAnJztcblxuICAvLyBFbXB0eSBieSBkZWZhdWx0IOKGkiB0aGUgRkMgcGFzcyBpcyBza2lwcGVkLiBPbmx5IHRoZSBCZWlubGV1bWkgKEZJQkkpIHN1YmNsYXNzXG4gIC8vIHNldHMgdGhpcyB0byB0aGUgZm9yZWlnbi1jdXJyZW5jeSBtb3ZlbWVudHMgcG9ydGFsIFVSTC5cbiAgRkNfVFJBTlNBQ1RJT05TX1VSTCA9ICcnO1xuXG4gIC8vIENhcHR1cmVkIGZyb20gY3JlZGVudGlhbHMgaW4gZ2V0TG9naW5PcHRpb25zOyBnYXRlcyArIGd1YXJkcyB0aGUgRkMgcGFzcy5cbiAgcHJpdmF0ZSBleHBlY3RlZEZvcmVpZ25DdXJyZW5jeUFjY291bnQ/OiBzdHJpbmc7XG5cbiAgZ2V0TG9naW5PcHRpb25zKGNyZWRlbnRpYWxzOiBTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscykge1xuICAgIHRoaXMuZXhwZWN0ZWRGb3JlaWduQ3VycmVuY3lBY2NvdW50ID0gY3JlZGVudGlhbHMuZXhwZWN0ZWRGb3JlaWduQ3VycmVuY3lBY2NvdW50O1xuICAgIHJldHVybiB7XG4gICAgICBsb2dpblVybDogYCR7dGhpcy5MT0dJTl9VUkx9YCxcbiAgICAgIGZpZWxkczogY3JlYXRlTG9naW5GaWVsZHMoY3JlZGVudGlhbHMpLFxuICAgICAgc3VibWl0QnV0dG9uU2VsZWN0b3I6ICcjY29udGludWVCdG4nLFxuICAgICAgcG9zdEFjdGlvbjogYXN5bmMgKCkgPT4gd2FpdEZvclBvc3RMb2dpbih0aGlzLnBhZ2UpLFxuICAgICAgcG9zc2libGVSZXN1bHRzOiBnZXRQb3NzaWJsZUxvZ2luUmVzdWx0cygpLFxuICAgICAgLy8gSEFDSzogRm9yIHNvbWUgcmVhc29uLCB0aG91Z2ggdGhlIGxvZ2luIGJ1dHRvbiAoI2NvbnRpbnVlQnRuKSBpcyBwcmVzZW50IGFuZCB2aXNpYmxlLCB0aGUgY2xpY2sgYWN0aW9uIGRvZXMgbm90IHBlcmZvcm0uXG4gICAgICAvLyBBZGRpbmcgdGhpcyBkZWxheSBmaXhlcyB0aGUgaXNzdWUuXG4gICAgICBwcmVBY3Rpb246IGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgc2xlZXAoMTAwMCk7XG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBhc3luYyBmZXRjaERhdGEoKSB7XG4gICAgY29uc3QgZGVmYXVsdFN0YXJ0TW9tZW50ID0gbW9tZW50KCkuc3VidHJhY3QoMSwgJ3llYXJzJykuYWRkKDEsICdkYXknKTtcbiAgICBjb25zdCBzdGFydE1vbWVudExpbWl0ID0gbW9tZW50KHsgeWVhcjogMTYwMCB9KTtcbiAgICBjb25zdCBzdGFydERhdGUgPSB0aGlzLm9wdGlvbnMuc3RhcnREYXRlIHx8IGRlZmF1bHRTdGFydE1vbWVudC50b0RhdGUoKTtcbiAgICBjb25zdCBzdGFydE1vbWVudCA9IG1vbWVudC5tYXgoc3RhcnRNb21lbnRMaW1pdCwgbW9tZW50KHN0YXJ0RGF0ZSkpO1xuXG4gICAgYXdhaXQgdGhpcy5uYXZpZ2F0ZVRvKHRoaXMuVFJBTlNBQ1RJT05TX1VSTCk7XG5cbiAgICBjb25zdCBhY2NvdW50cyA9IGF3YWl0IGZldGNoQWNjb3VudHModGhpcy5wYWdlLCBzdGFydE1vbWVudCwgdGhpcy5vcHRpb25zKTtcblxuICAgIC8vIFNlY29uZCBwYXNzIG9uIHRoZSBzYW1lIGxvZ2luOiBmb3JlaWduLWN1cnJlbmN5ICjXnteYXCLXlykgYWNjb3VudHMsIHdoaWNoIGxpdmVcbiAgICAvLyBpbiBhIHNlcGFyYXRlIHBvcnRhbCBzZWN0aW9uIHRoZSBOSVMgZmxvdyBuZXZlciB2aXNpdHMuIE9wdC1pbiArIGd1YXJkZWQgYnlcbiAgICAvLyBgZXhwZWN0ZWRGb3JlaWduQ3VycmVuY3lBY2NvdW50YDsgYSBuby1vcCB1bmxlc3MgdGhlIHN1YmNsYXNzIHNldHMgYW4gRkMgVVJMLlxuICAgIGlmICh0aGlzLkZDX1RSQU5TQUNUSU9OU19VUkwgJiYgdGhpcy5leHBlY3RlZEZvcmVpZ25DdXJyZW5jeUFjY291bnQpIHtcbiAgICAgIGF3YWl0IHRoaXMubmF2aWdhdGVUbyh0aGlzLkZDX1RSQU5TQUNUSU9OU19VUkwpO1xuICAgICAgY29uc3QgZmNBY2NvdW50cyA9IGF3YWl0IGZldGNoRm9yZWlnbkN1cnJlbmN5QWNjb3VudHMoXG4gICAgICAgIHRoaXMucGFnZSxcbiAgICAgICAgdGhpcy5leHBlY3RlZEZvcmVpZ25DdXJyZW5jeUFjY291bnQsXG4gICAgICAgIHN0YXJ0TW9tZW50LFxuICAgICAgICB0aGlzLm9wdGlvbnMsXG4gICAgICApO1xuICAgICAgYWNjb3VudHMucHVzaCguLi5mY0FjY291bnRzKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGFjY291bnRzLFxuICAgIH07XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgQmVpbmxldW1pR3JvdXBCYXNlU2NyYXBlcjtcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsSUFBQUEsT0FBQSxHQUFBQyxzQkFBQSxDQUFBQyxPQUFBO0FBRUEsSUFBQUMsVUFBQSxHQUFBRCxPQUFBO0FBQ0EsSUFBQUUscUJBQUEsR0FBQUYsT0FBQTtBQU9BLElBQUFHLE1BQUEsR0FBQUgsT0FBQTtBQUNBLElBQUFJLFdBQUEsR0FBQUosT0FBQTtBQUNBLElBQUFLLGFBQUEsR0FBQUwsT0FBQTtBQUNBLElBQUFNLFFBQUEsR0FBQU4sT0FBQTtBQUNBLElBQUFPLGNBQUEsR0FBQVAsT0FBQTtBQUNBLElBQUFRLHVCQUFBLEdBQUFSLE9BQUE7QUFBOEcsU0FBQUQsdUJBQUFVLENBQUEsV0FBQUEsQ0FBQSxJQUFBQSxDQUFBLENBQUFDLFVBQUEsR0FBQUQsQ0FBQSxLQUFBRSxPQUFBLEVBQUFGLENBQUE7QUFHOUcsTUFBTUcsV0FBVyxHQUFHLFlBQVk7QUFDaEMsTUFBTUMsaUNBQWlDLEdBQUcsOEJBQThCO0FBQ3hFLE1BQU1DLDJCQUEyQixHQUFHLFlBQVk7QUFDaEQsTUFBTUMseUJBQXlCLEdBQUcsWUFBWTtBQUM5QyxNQUFNQyxrQ0FBa0MsR0FBRyx1QkFBdUI7QUFDbEUsTUFBTUMs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
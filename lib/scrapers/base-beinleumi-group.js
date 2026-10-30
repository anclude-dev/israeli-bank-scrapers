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
var _beinleumiTransferDetails = require("./beinleumi-transfer-details");
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
      memo: txn.memo,
      ...(txn.transferDetails ? {
        transferDetails: txn.transferDetails
      } : {})
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
  if (transactionStatus === _transactions2.TransactionStatuses.Completed && item.description === 'העברה מהחשבון') {
    item.transferLookup = txnRow.transferLookup;
  }
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
    return trs.map(tr => {
      const link = tr.querySelector('a.PW1[sugbakasha="523"]');
      return {
        innerTds: Array.from(tr.getElementsByTagName('td')).map(td => td.innerText),
        ...(link ? {
          transferLookup: {
            date: link.getAttribute('actdate') ?? '',
            processingStage: link.getAttribute('shlavibud') ?? ''
          }
        } : {})
      };
    });
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
  if (options?.additionalTransactionInformation && transactionStatus === _transactions2.TransactionStatuses.Completed) {
    await (0, _beinleumiTransferDetails.enrichShekelTransfers)(page, txns);
  }
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbW9tZW50IiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfY29uc3RhbnRzIiwiX2VsZW1lbnRzSW50ZXJhY3Rpb25zIiwiX2RlYnVnIiwiX25hdmlnYXRpb24iLCJfdHJhbnNhY3Rpb25zIiwiX3dhaXRpbmciLCJfdHJhbnNhY3Rpb25zMiIsIl9iYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiX2JlaW5sZXVtaVRyYW5zZmVyRGV0YWlscyIsImUiLCJfX2VzTW9kdWxlIiwiZGVmYXVsdCIsIkRBVEVfRk9STUFUIiwiTk9fVFJBTlNBQ1RJT05fSU5fREFURV9SQU5HRV9URVhUIiwiREFURV9DT0xVTU5fQ0xBU1NfQ09NUExFVEVEIiwiREFURV9DT0xVTU5fQ0xBU1NfUEVORElORyIsIkRFU0NSSVBUSU9OX0NPTFVNTl9DTEFTU19DT01QTEVURUQiLCJERVNDUklQVElPTl9DT0xVTU5fQ0xBU1NfUEVORElORyIsIlJFRkVSRU5DRV9DT0xVTU5fQ0xBU1MiLCJERUJJVF9DT0xVTU5fQ0xBU1MiLCJDUkVESVRfQ09MVU1OX0NMQVNTIiwiRVJST1JfTUVTU0FHRV9DTEFTUyIsIkFDQ09VTlRTX05VTUJFUiIsIkNMT1NFX1NFQVJDSF9CWV9EQVRFU19CVVRUT05fQ0xBU1MiLCJTSE9XX1NFQVJDSF9CWV9EQVRFU19CVVRUT05fVkFMVUUiLCJDT01QTEVURURfVFJBTlNBQ1RJT05TX1RBQkxFIiwiUEVORElOR19UUkFOU0FDVElPTlNfVEFCTEUiLCJORVhUX1BBR0VfTElOSyIsIkNVUlJFTlRfQkFMQU5DRSIsIklGUkFNRV9OQU1FIiwiRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyIsImRlYnVnIiwiZ2V0RGVidWciLCJGQ19DVVJSRU5DWV9TRUxFQ1QiLCJGQ19GUk9NX0RBVEVfSU5QVVQiLCJGQ19USUxMX0RBVEVfSU5QVVQiLCJGQ19UUkFOU0FDVElPTlNfVEFCTEUiLCJDVVJSRU5UX0FDQ09VTlRfTEFCRUwiLCJGQ19DT0wiLCJiYWxhbmNlIiwiY3JlZGl0IiwiZGViaXQiLCJkZXNjcmlwdGlvbiIsInJlZmVyZW5jZSIsImRhdGUiLCJGQ19DVVJSRU5DWV9CWV9IRUJSRVciLCJGQ19ERVRBSUxfTElOS19TRUxFQ1RPUiIsIkZDX0RFVEFJTF9SRUZFUkVOQ0VfUEFEIiwiRkNfQkVORUZJQ0lBUllfTEFCRUwiLCJGQ19UUkFOU0ZFUl9ERVNDUklQVElPTl9NQVJLRVIiLCJmY0RldGFpbFVybCIsInBhZGRlZFJlZmVyZW5jZSIsImdldFBvc3NpYmxlTG9naW5SZXN1bHRzIiwidXJscyIsIkxvZ2luUmVzdWx0cyIsIlN1Y2Nlc3MiLCJJbnZhbGlkUGFzc3dvcmQiLCJjcmVhdGVMb2dpbkZpZWxkcyIsImNyZWRlbnRpYWxzIiwic2VsZWN0b3IiLCJ2YWx1ZSIsInVzZXJuYW1lIiwicGFzc3dvcmQiLCJnZXRBbW91bnREYXRhIiwiYW1vdW50U3RyIiwiYW1vdW50U3RyQ29weSIsInJlcGxhY2UiLCJTSEVLRUxfQ1VSUkVOQ1lfU1lNQk9MIiwicmVwbGFjZUFsbCIsInBhcnNlRmxvYXQiLCJnZXRUeG5BbW91bnQiLCJ0eG4iLCJOdW1iZXIiLCJpc05hTiIsImNvbnZlcnRUcmFuc2FjdGlvbnMiLCJ0eG5zIiwib3B0aW9ucyIsIm1hcCIsImNvbnZlcnRlZERhdGUiLCJtb21lbnQiLCJ0b0lTT1N0cmluZyIsImNvbnZlcnRlZEFtb3VudCIsInJlc3VsdCIsInR5cGUiLCJUcmFuc2FjdGlvblR5cGVzIiwiTm9ybWFsIiwiaWRlbnRpZmllciIsInBhcnNlSW50IiwidW5kZWZpbmVkIiwicHJvY2Vzc2VkRGF0ZSIsIm9yaWdpbmFsQW1vdW50Iiwib3JpZ2luYWxDdXJyZW5jeSIsIlNIRUtFTF9DVVJSRU5DWSIsImNoYXJnZWRBbW91bnQiLCJzdGF0dXMiLCJtZW1vIiwidHJhbnNmZXJEZXRhaWxzIiwiaW5jbHVkZVJhd1RyYW5zYWN0aW9uIiwicmF3VHJhbnNhY3Rpb24iLCJnZXRSYXdUcmFuc2FjdGlvbiIsImdldFRyYW5zYWN0aW9uRGF0ZSIsInRkcyIsInRyYW5zYWN0aW9uVHlwZSIsInRyYW5zYWN0aW9uc0NvbHNUeXBlcyIsInRyaW0iLCJnZXRUcmFuc2FjdGlvbkRlc2NyaXB0aW9uIiwiZ2V0VHJhbnNhY3Rpb25SZWZlcmVuY2UiLCJnZXRUcmFuc2FjdGlvbkRlYml0IiwiZ2V0VHJhbnNhY3Rpb25DcmVkaXQiLCJleHRyYWN0VHJhbnNhY3Rpb25EZXRhaWxzIiwidHhuUm93IiwidHJhbnNhY3Rpb25TdGF0dXMiLCJpbm5lclRkcyIsIml0ZW0iLCJUcmFuc2FjdGlvblN0YXR1c2VzIiwiQ29tcGxldGVkIiwidHJhbnNmZXJMb29rdXAiLCJnZXRUcmFuc2FjdGlvbnNDb2xzVHlwZUNsYXNzZXMiLCJwYWdlIiwidGFibGVMb2NhdG9yIiwidHlwZUNsYXNzZXNPYmpzIiwicGFnZUV2YWxBbGwiLCJ0ZCIsImluZGV4IiwiY29sQ2xhc3MiLCJnZXRBdHRyaWJ1dGUiLCJ0eXBlQ2xhc3NPYmoiLCJleHRyYWN0VHJhbnNhY3Rpb24iLCJwdXNoIiwiZXh0cmFjdFRyYW5zYWN0aW9ucyIsInRyYW5zYWN0aW9uc1Jvd3MiLCJ0cnMiLCJ0ciIsImxpbmsiLCJxdWVyeVNlbGVjdG9yIiwiQXJyYXkiLCJmcm9tIiwiZ2V0RWxlbWVudHNCeVRhZ05hbWUiLCJpbm5lclRleHQiLCJwcm9jZXNzaW5nU3RhZ2UiLCJpc05vVHJhbnNhY3Rpb25JbkRhdGVSYW5nZUVycm9yIiwiaGFzRXJyb3JJbmZvRWxlbWVudCIsImVsZW1lbnRQcmVzZW50T25QYWdlIiwiZXJyb3JUZXh0IiwiJGV2YWwiLCJlcnJvckVsZW1lbnQiLCJzZWFyY2hCeURhdGVzIiwic3RhcnREYXRlIiwiY2xpY2tCdXR0b24iLCJ3YWl0VW50aWxFbGVtZW50Rm91bmQiLCJmaWxsSW5wdXQiLCJmb3JtYXQiLCJ3YWl0Rm9yTmF2aWdhdGlvbiIsImdldEFjY291bnROdW1iZXIiLCJzZWxlY3RlZFNuaWZBY2NvdW50Iiwib3B0aW9uIiwiY2hlY2tJZkhhc05leHRQYWdlIiwibmF2aWdhdGVUb05leHRQYWdlIiwic2NyYXBlVHJhbnNhY3Rpb25zIiwibmVlZFRvUGFnaW5hdGUiLCJoYXNOZXh0UGFnZSIsImN1cnJlbnRQYWdlVHhucyIsImFkZGl0aW9uYWxUcmFuc2FjdGlvbkluZm9ybWF0aW9uIiwiZW5yaWNoU2hla2VsVHJhbnNmZXJzIiwiZ2V0QWNjb3VudFRyYW5zYWN0aW9ucyIsIlByb21pc2UiLCJyYWNlIiwibm9UcmFuc2FjdGlvbkluUmFuZ2VFcnJvciIsInBlbmRpbmdUeG5zIiwiUGVuZGluZyIsImNvbXBsZXRlZFR4bnMiLCJnZXRDdXJyZW50QmFsYW5jZSIsImJhbGFuY2VTdHIiLCJlbCIsIndhaXRGb3JQb3N0TG9naW4iLCJmZXRjaEFjY291bnREYXRhIiwiYWNjb3VudE51bWJlciIsImdldEFjY291bnRJZHNPbGRVSSIsImV2YWx1YXRlIiwic2VsZWN0RWxlbWVudCIsImRvY3VtZW50IiwiZ2V0RWxlbWVudEJ5SWQiLCJxdWVyeVNlbGVjdG9yQWxsIiwiY2xpY2tBY2NvdW50U2VsZWN0b3JHZXRBY2NvdW50SWRzIiwiYWNjb3VudFNlbGVjdG9yIiwiZHJvcGRvd25QYW5lbFNlbGVjdG9yIiwib3B0aW9uU2VsZWN0b3IiLCJkcm9wZG93blZpc2libGUiLCJ3aW5kb3ciLCJnZXRDb21wdXRlZFN0eWxlIiwiZGlzcGxheSIsIm9mZnNldFBhcmVudCIsImNhdGNoIiwiYWNjb3VudExhYmVscyIsIiQkZXZhbCIsInRleHRDb250ZW50IiwiZmlsdGVyIiwibGFiZWwiLCJlcnJvciIsImdldEFjY291bnRJZHNCb3RoVUlzIiwiYWNjb3VudHNJZHMiLCJsZW5ndGgiLCJzZWxlY3RBY2NvdW50RnJvbURyb3Bkb3duIiwiYWNjb3VudExhYmVsIiwiYXZhaWxhYmxlQWNjb3VudHMiLCJpbmNsdWRlcyIsImFjY291bnRPcHRpb25zIiwiJCQiLCJ0ZXh0Iiwib3B0aW9uSGFuZGxlIiwiZXZhbHVhdGVIYW5kbGUiLCJjbGljayIsImdldFRyYW5zYWN0aW9uc0ZyYW1lIiwiYXR0ZW1wdCIsInNsZWVwIiwiZnJhbWVzIiwidGFyZ2V0RnJhbWUiLCJmaW5kIiwiZiIsIm5hbWUiLCJzZWxlY3RBY2NvdW50Qm90aFVJcyIsImFjY291bnRJZCIsImFjY291bnRTZWxlY3RlZCIsInNlbGVjdCIsImZldGNoQWNjb3VudERhdGFCb3RoVUlzIiwiZnJhbWUiLCJ0YXJnZXRQYWdlIiwiZmV0Y2hBY2NvdW50cyIsImFjY291bnREYXRhIiwiYWNjb3VudHMiLCJmb3JlaWduQ3VycmVuY3lUb0lzbyIsInJlIiwidGVzdCIsImdldEZvcmVpZ25DdXJyZW5jeU9wdGlvbnMiLCJvcHRzIiwibyIsImdldEZvcmVpZ25DdXJyZW5jeVJvd3MiLCJsaW5rU2VsZWN0b3IiLCJoYXNEZXRhaWxMaW5rIiwiZXh0cmFjdEZvcmVpZ25DdXJyZW5jeVRyYW5zYWN0aW9ucyIsInJvd3MiLCJkZXRhaWxSZWZlcmVuY2UiLCJleHRyYWN0Rm9yZWlnbkN1cnJlbmN5QmFsYW5jZSIsImkiLCJwYXJzZWQiLCJmZXRjaEJlbmVmaWNpYXJ5TmFtZSIsInVybCIsInBhZFN0YXJ0IiwiZGV0YWlsVXJsIiwicmVzIiwiZmV0Y2giLCJvayIsIkRPTVBhcnNlciIsInBhcnNlRnJvbVN0cmluZyIsImNlbGxzIiwiYXBwbHlCZW5lZmljaWFyeU5hbWVzIiwiY2FjaGUiLCJNYXAiLCJyZWYiLCJoYXMiLCJzZXQiLCJiZW5lZmljaWFyeSIsImdldCIsImNvbnZlcnRGb3JlaWduQ3VycmVuY3lUcmFuc2FjdGlvbnMiLCJjdXJyZW5jeSIsInJ1bkZvcmVpZ25DdXJyZW5jeVF1ZXJ5IiwiY3VycmVuY3lPcHRpb25WYWx1ZSIsImZldGNoRm9yZWlnbkN1cnJlbmN5QWNjb3VudHMiLCJleHBlY3RlZEFjY291bnQiLCJzZWxlY3RlZEFjY291bnQiLCJjdXJyZW5jaWVzIiwic2NyYXBlZCIsIkJlaW5sZXVtaUdyb3VwQmFzZVNjcmFwZXIiLCJCYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiQkFTRV9VUkwiLCJMT0dJTl9VUkwiLCJUUkFOU0FDVElPTlNfVVJMIiwiRkNfVFJBTlNBQ1RJT05TX1VSTCIsImdldExvZ2luT3B0aW9ucyIsImV4cGVjdGVkRm9yZWlnbkN1cnJlbmN5QWNjb3VudCIsImxvZ2luVXJsIiwiZmllbGRzIiwic3VibWl0QnV0dG9uU2VsZWN0b3IiLCJwb3N0QWN0aW9uIiwicG9zc2libGVSZXN1bHRzIiwicHJlQWN0aW9uIiwiZmV0Y2hEYXRhIiwiZGVmYXVsdFN0YXJ0TW9tZW50Iiwic3VidHJhY3QiLCJhZGQiLCJzdGFydE1vbWVudExpbWl0IiwieWVhciIsInRvRGF0ZSIsInN0YXJ0TW9tZW50IiwibWF4IiwibmF2aWdhdGVUbyIsImZjQWNjb3VudHMiLCJzdWNjZXNzIiwiX2RlZmF1bHQiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vc3JjL3NjcmFwZXJzL2Jhc2UtYmVpbmxldW1pLWdyb3VwLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBtb21lbnQsIHsgdHlwZSBNb21lbnQgfSBmcm9tICdtb21lbnQnO1xuaW1wb3J0IHsgdHlwZSBGcmFtZSwgdHlwZSBQYWdlIH0gZnJvbSAncHVwcGV0ZWVyJztcbmltcG9ydCB7IFNIRUtFTF9DVVJSRU5DWSwgU0hFS0VMX0NVUlJFTkNZX1NZTUJPTCB9IGZyb20gJy4uL2NvbnN0YW50cyc7XG5pbXBvcnQge1xuICBjbGlja0J1dHRvbixcbiAgZWxlbWVudFByZXNlbnRPblBhZ2UsXG4gIGZpbGxJbnB1dCxcbiAgcGFnZUV2YWxBbGwsXG4gIHdhaXRVbnRpbEVsZW1lbnRGb3VuZCxcbn0gZnJvbSAnLi4vaGVscGVycy9lbGVtZW50cy1pbnRlcmFjdGlvbnMnO1xuaW1wb3J0IHsgZ2V0RGVidWcgfSBmcm9tICcuLi9oZWxwZXJzL2RlYnVnJztcbmltcG9ydCB7IHdhaXRGb3JOYXZpZ2F0aW9uIH0gZnJvbSAnLi4vaGVscGVycy9uYXZpZ2F0aW9uJztcbmltcG9ydCB7IGdldFJhd1RyYW5zYWN0aW9uIH0gZnJvbSAnLi4vaGVscGVycy90cmFuc2FjdGlvbnMnO1xuaW1wb3J0IHsgc2xlZXAgfSBmcm9tICcuLi9oZWxwZXJzL3dhaXRpbmcnO1xuaW1wb3J0IHsgVHJhbnNhY3Rpb25TdGF0dXNlcywgVHJhbnNhY3Rpb25UeXBlcywgdHlwZSBUcmFuc2FjdGlvbiwgdHlwZSBUcmFuc2FjdGlvbnNBY2NvdW50IH0gZnJvbSAnLi4vdHJhbnNhY3Rpb25zJztcbmltcG9ydCB7IEJhc2VTY3JhcGVyV2l0aEJyb3dzZXIsIExvZ2luUmVzdWx0cywgdHlwZSBQb3NzaWJsZUxvZ2luUmVzdWx0cyB9IGZyb20gJy4vYmFzZS1zY3JhcGVyLXdpdGgtYnJvd3Nlcic7XG5pbXBvcnQgeyB0eXBlIFNjcmFwZXJPcHRpb25zIH0gZnJvbSAnLi9pbnRlcmZhY2UnO1xuaW1wb3J0IHsgZW5yaWNoU2hla2VsVHJhbnNmZXJzLCB0eXBlIFRyYW5zZmVyTG9va3VwIH0gZnJvbSAnLi9iZWlubGV1bWktdHJhbnNmZXItZGV0YWlscyc7XG5pbXBvcnQgeyB0eXBlIFRyYW5zZmVyRGV0YWlscyB9IGZyb20gJy4uL3RyYW5zYWN0aW9ucyc7XG5cbmNvbnN0IERBVEVfRk9STUFUID0gJ0REL01NL1lZWVknO1xuY29uc3QgTk9fVFJBTlNBQ1RJT05fSU5fREFURV9SQU5HRV9URVhUID0gJ9ec15Ag16DXntem15DXlSDXoNeq15XXoNeZ150g15HXoNeV16nXkCDXlNee15HXlden16knO1xuY29uc3QgREFURV9DT0xVTU5fQ0xBU1NfQ09NUExFVEVEID0gJ2RhdGUgZmlyc3QnO1xuY29uc3QgREFURV9DT0xVTU5fQ0xBU1NfUEVORElORyA9ICdmaXJzdCBkYXRlJztcbmNvbnN0IERFU0NSSVBUSU9OX0NPTFVNTl9DTEFTU19DT01QTEVURUQgPSAncmVmZXJlbmNlIHdyYXBfbm9ybWFsJztcbmNvbnN0IERFU0NSSVBUSU9OX0NPTFVNTl9DTEFTU19QRU5ESU5HID0gJ2RldGFpbHMgd3JhcF9ub3JtYWwnO1xuY29uc3QgUkVGRVJFTkNFX0NPTFVNTl9DTEFTUyA9ICdkZXRhaWxzJztcbmNvbnN0IERFQklUX0NPTFVNTl9DTEFTUyA9ICdkZWJpdCc7XG5jb25zdCBDUkVESVRfQ09MVU1OX0NMQVNTID0gJ2NyZWRpdCc7XG5jb25zdCBFUlJPUl9NRVNTQUdFX0NMQVNTID0gJ05PX0RBVEEnO1xuY29uc3QgQUNDT1VOVFNfTlVNQkVSID0gJ2Rpdi5maWJpX2FjY291bnQgc3Bhbi5hY2NfbnVtJztcbmNvbnN0IENMT1NFX1NFQVJDSF9CWV9EQVRFU19CVVRUT05fQ0xBU1MgPSAndWktZGF0ZXBpY2tlci1jbG9zZSc7XG5jb25zdCBTSE9XX1NFQVJDSF9CWV9EQVRFU19CVVRUT05fVkFMVUUgPSAn15TXpteSJztcbmNvbnN0IENPTVBMRVRFRF9UUkFOU0FDVElPTlNfVEFCTEUgPSAndGFibGUjZGF0YVRhYmxlMDc3JztcbmNvbnN0IFBFTkRJTkdfVFJBTlNBQ1RJT05TX1RBQkxFID0gJ3RhYmxlI2RhdGFUYWJsZTAyMyc7XG5jb25zdCBORVhUX1BBR0VfTElOSyA9ICdhI05wYWdlLnBhZ2luZyc7XG5jb25zdCBDVVJSRU5UX0JBTEFOQ0UgPSAnLm1haW5fYmFsYW5jZSc7XG5jb25zdCBJRlJBTUVfTkFNRSA9ICdpZnJhbWUtb2xkLXBhZ2VzJztcbmNvbnN0IEVMRU1FTlRfUkVOREVSX1RJTUVPVVRfTVMgPSAxMDAwMDtcblxuY29uc3QgZGVidWcgPSBnZXREZWJ1ZygnYmVpbmxldW1pJyk7XG5cbi8vIC0tLSBGb3JlaWduLWN1cnJlbmN5ICjXnteYXCLXlykgYWNjb3VudCBzZWN0aW9uIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBGQyBtb3ZlbWVudHMgYXJlIHNlcnZlZCBmcm9tIHRoZSBzYW1lIGBpZnJhbWUtb2xkLXBhZ2VzYCwgb24gYSBzZXBhcmF0ZSBwb3J0YWxcbi8vIHBhZ2UgKEZDX1RSQU5TQUNUSU9OU19VUkwpLiBPbmx5IHRoZSBCZWlubGV1bWkgKEZJQkkpIHN1YmNsYXNzIHNldHMgdGhhdCBVUkwsXG4vLyBzbyB0aGUgcGFzcyBpcyBhIG5vLW9wIGZvciBhbnkgZ3JvdXAgYmFuayB0aGF0IGxlYXZlcyBpdCBlbXB0eS4gVGhlIHBhc3MgaXNcbi8vIGFkZGl0aW9uYWxseSBnYXRlZCBvbiBgZXhwZWN0ZWRGb3JlaWduQ3VycmVuY3lBY2NvdW50YCAoY29uZmlnKSwgd2hpY2ggaXMgYm90aFxuLy8gdGhlIG9wdC1pbiBhbmQgYSByZWFkLW9ubHkgZ3VhcmQ6IHdlIG5ldmVyIHRvdWNoIHRoZSB0b3AtbGV2ZWwgYWNjb3VudFxuLy8gc3dpdGNoZXIgKGRpZmZlcmVudCBzd2l0Y2hlciBhY2NvdW50cyBtYXAgdG8gZGlmZmVyZW50IGFwcCBwcm9maWxlcykuXG5jb25zdCBGQ19DVVJSRU5DWV9TRUxFQ1QgPSAnc2VsZWN0I0lOLVNDSC1NVEInO1xuY29uc3QgRkNfRlJPTV9EQVRFX0lOUFVUID0gJ2lucHV0I2Zyb21EYXRlJztcbmNvbnN0IEZDX1RJTExfREFURV9JTlBVVCA9ICdpbnB1dCN0aWxsRGF0ZSc7XG5jb25zdCBGQ19UUkFOU0FDVElPTlNfVEFCTEUgPSAndGFibGUjZGF0YVRhYmxlMDQwJztcbmNvbnN0IENVUlJFTlRfQUNDT1VOVF9MQUJFTCA9ICdkaXYuY3VycmVudC1hY2NvdW50Jztcbi8vIGAjZGF0YVRhYmxlMDQwYCBoYXMgZml4ZWQgcG9zaXRpb25hbCBjb2x1bW5zIChzb21lIGNhcnJ5IGEgY2xhc3MsIHNvbWUgZG9uJ3QpLFxuLy8gc28gaXQgaXMgcGFyc2VkIGJ5IGluZGV4IHJhdGhlciB0aGFuIGJ5IGNvbHVtbiBjbGFzcyBsaWtlIHRoZSBOSVMgdGFibGVzOlxuLy8gICBbMF0gYmFsYW5jZSAgWzFdIHZhbHVlLWRhdGUgIFsyXSBjcmVkaXQgIFszXSBkZWJpdFxuLy8gICBbNF0gZGVzY3JpcHRpb24gIFs1XSBicmFuY2gtY29kZSAgWzZdIHJlZmVyZW5jZSAoYXNtYWNodGEpICBbN10gZGF0ZVxuY29uc3QgRkNfQ09MID0geyBiYWxhbmNlOiAwLCBjcmVkaXQ6IDIsIGRlYml0OiAzLCBkZXNjcmlwdGlvbjogNCwgcmVmZXJlbmNlOiA2LCBkYXRlOiA3IH0gYXMgY29uc3Q7XG4vLyBNYXAgdGhlIEZDIGN1cnJlbmN5LWRyb3Bkb3duIEhlYnJldyBsYWJlbCDihpIgSVNPIDQyMTcuIE1hdGNoZWQgYnkgc3Vic3RyaW5nXG4vLyBiZWNhdXNlIGVhY2ggbGFiZWwgaXMgcGFkZGVkIGFuZCBwcmVmaXhlZCB3aXRoIHRoZSBhY2NvdW50L3Byb2R1Y3QgbmFtZVxuLy8gKGUuZy4gYDEwNiAtINek155cIteXINeq15DXkteZ15PXmdedIC0g15PXldec16gg15DXqNeUXCLXkWApLlxuY29uc3QgRkNfQ1VSUkVOQ1lfQllfSEVCUkVXOiBSZWFkb25seUFycmF5PHJlYWRvbmx5IFtSZWdFeHAsIHN0cmluZ10+ID0gW1xuICBbL9eT15XXnNeoLywgJ1VTRCddLFxuICBbL9eQ15nXqNeVfNeZ15XXqNeVLywgJ0VVUiddLFxuICBbL9ek16jXoNenLywgJ0NIRiddLFxuICBbL9ep15jXqNec15nXoNeSfNec15nXqNeULywgJ0dCUCddLFxuICBbL9eZ15nXny8sICdKUFknXSxcbiAgWy/Xp9eg15MvLCAnQ0FEJ10sXG4gIFsv15DXldeh15jXqNecLywgJ0FVRCddLFxuXTtcblxuLy8gLS0tIEZDIHdpcmUtdHJhbnNmZXIgYmVuZWZpY2lhcnkgbG9va3VwIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVGhlIEZDIHRhYmxlIG5ldmVyIHNob3dzIHRoZSByZWNpcGllbnQ6IGEgd2lyZSByb3cncyDXkNeh157Xm9eq15AgY2VsbCBob2xkcyBhIGxpbmtcbi8vIChgamF2YXNjcmlwdDpjYWxsMjc2KCcnLCcwMDkxMTA4ODAnKWApIHRoYXQgcG9wcyBvcGVuIHRoZSB1bmRlcmx5aW5nIFNXSUZUXG4vLyBtZXNzYWdlLiBjYWxsMjc2IGRvZXNuJ3QgbmF2aWdhdGUg4oCUIGl0IGJ1aWxkcyBhIFVSTCBhbmQgd2luZG93Lm9wZW4oKXMgaXQg4oCUIHNvXG4vLyB3ZSBza2lwIHRoZSBwb3B1cCBlbnRpcmVseSBhbmQgZmV0Y2ggdGhhdCBVUkwgZnJvbSB0aGUgcGFnZSBjb250ZXh0ICh0aGVcbi8vIHNlc3Npb24gY29va2llIHJpZGVzIGFsb25nKS4gVGhlIFNXSUZUIHZpZXcgcmVuZGVycyBsYWJlbCByb3dzIHNoYXBlZFxuLy8gYFtlbmdsaXNoLCB2YWx1ZSwgaGVicmV3XWA7IHRoZSBiZW5lZmljaWFyeSBpcyB0aGUgdmFsdWUgd2hvc2UgSGVicmV3IGxhYmVsIGlzXG4vLyBg16nXnSDXnteV15jXkWAuXG5jb25zdCBGQ19ERVRBSUxfTElOS19TRUxFQ1RPUiA9ICdhW2hyZWYqPVwiY2FsbDI3NlwiXSc7XG5jb25zdCBGQ19ERVRBSUxfUkVGRVJFTkNFX1BBRCA9IDk7XG5jb25zdCBGQ19CRU5FRklDSUFSWV9MQUJFTCA9ICfXqdedINee15XXmNeRJztcbi8vIE9ubHkgcm93cyB0aGF0IGFyZSBhbiBhY3R1YWwgdHJhbnNmZXIgZ2V0IHRoZSByZWNpcGllbnQg4oCUIHRoZSBwYWlyZWQgZmVlIHJvd1xuLy8gKNei157XnNeV16og157Xm9eV16rXkdeZ150pIGxpbmtzIHRvIHRoZSBzYW1lIFNXSUZUIG1lc3NhZ2UgYnV0IGlzbid0IHBhaWQgdG8gdGhlIGJlbmVmaWNpYXJ5LlxuY29uc3QgRkNfVFJBTlNGRVJfREVTQ1JJUFRJT05fTUFSS0VSID0gJ9eU16LXkdeo15QnO1xuY29uc3QgZmNEZXRhaWxVcmwgPSAocGFkZGVkUmVmZXJlbmNlOiBzdHJpbmcpID0+XG4gIGAvTWF0YWZTZXJ2aWNlU2VydmxldHMvUmVhZE1haWxTZXJ2bGV0P0tFWS1TVUdCQUtBPSZJLU1JUy1JU0tBPSR7cGFkZGVkUmVmZXJlbmNlfWAgK1xuICBgJlNVR0JBS0E9Mjc2JnhzbEtleT1QT1AmcGFzc01pc3Bhcj0ke3BhZGRlZFJlZmVyZW5jZX1gO1xuXG50eXBlIFRyYW5zYWN0aW9uc0NvbHNUeXBlcyA9IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XG50eXBlIFRyYW5zYWN0aW9uc1RyVGRzID0gc3RyaW5nW107XG50eXBlIFRyYW5zYWN0aW9uc1RyID0geyBpbm5lclRkczogVHJhbnNhY3Rpb25zVHJUZHM7IHRyYW5zZmVyTG9va3VwPzogVHJhbnNmZXJMb29rdXAgfTtcblxuaW50ZXJmYWNlIFNjcmFwZWRUcmFuc2FjdGlvbiB7XG4gIHJlZmVyZW5jZTogc3RyaW5nO1xuICBkYXRlOiBzdHJpbmc7XG4gIGNyZWRpdDogc3RyaW5nO1xuICBkZWJpdDogc3RyaW5nO1xuICBtZW1vPzogc3RyaW5nO1xuICB0cmFuc2Zlckxvb2t1cD86IFRyYW5zZmVyTG9va3VwO1xuICB0cmFuc2ZlckRldGFpbHM/OiBUcmFuc2ZlckRldGFpbHM7XG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG4gIHN0YXR1czogVHJhbnNhY3Rpb25TdGF0dXNlcztcbn1cblxuLyoqIEEgYCNkYXRhVGFibGUwNDBgIHJvdzogaXRzIGNlbGwgdGV4dHMsIHBsdXMgd2hldGhlciBpdCBsaW5rcyB0byBhIFNXSUZUIGRldGFpbC4gKi9cbnR5cGUgRmNSb3cgPSB7IHRkczogVHJhbnNhY3Rpb25zVHJUZHM7IGhhc0RldGFpbExpbms6IGJvb2xlYW4gfTtcblxuLyoqIEFuIEZDIHRyYW5zYWN0aW9uLCBjYXJyeWluZyB0aGUgcmVmZXJlbmNlIHRvIGxvb2sgYSBiZW5lZmljaWFyeSB1cCBieSAodHJhbnNmZXJzIG9ubHkpLiAqL1xudHlwZSBTY3JhcGVkRmNUcmFuc2FjdGlvbiA9IFNjcmFwZWRUcmFuc2FjdGlvbiAmIHsgZGV0YWlsUmVmZXJlbmNlPzogc3RyaW5nIH07XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRQb3NzaWJsZUxvZ2luUmVzdWx0cygpOiBQb3NzaWJsZUxvZ2luUmVzdWx0cyB7XG4gIGNvbnN0IHVybHM6IFBvc3NpYmxlTG9naW5SZXN1bHRzID0ge307XG4gIHVybHNbTG9naW5SZXN1bHRzLlN1Y2Nlc3NdID0gW1xuICAgIC9maWJpLiphY2NvdW50U3VtbWFyeS8sIC8vIE5ldyBVSSBwYXR0ZXJuXG4gICAgL1Jlc291cmNlc1xcL1BvcnRhbE5HXFwvc2hlbGwvLCAvLyBOZXcgVUkgcGF0dGVyblxuICAgIC9GaWJpTWVudVxcL09ubGluZS8sIC8vIE9sZCBVSSBwYXR0ZXJuXG4gIF07XG4gIHVybHNbTG9naW5SZXN1bHRzLkludmFsaWRQYXNzd29yZF0gPSBbL0ZpYmlNZW51XFwvTWFya2V0aW5nXFwvUHJpdmF0ZVxcL0hvbWUvXTtcbiAgcmV0dXJuIHVybHM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVMb2dpbkZpZWxkcyhjcmVkZW50aWFsczogU2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHMpIHtcbiAgcmV0dXJuIFtcbiAgICB7IHNlbGVjdG9yOiAnI3VzZXJuYW1lJywgdmFsdWU6IGNyZWRlbnRpYWxzLnVzZXJuYW1lIH0sXG4gICAgeyBzZWxlY3RvcjogJyNwYXNzd29yZCcsIHZhbHVlOiBjcmVkZW50aWFscy5wYXNzd29yZCB9LFxuICBdO1xufVxuXG5mdW5jdGlvbiBnZXRBbW91bnREYXRhKGFtb3VudFN0cjogc3RyaW5nKSB7XG4gIGxldCBhbW91bnRTdHJDb3B5ID0gYW1vdW50U3RyLnJlcGxhY2UoU0hFS0VMX0NVUlJFTkNZX1NZTUJPTCwgJycpO1xuICBhbW91bnRTdHJDb3B5ID0gYW1vdW50U3RyQ29weS5yZXBsYWNlQWxsKCcsJywgJycpO1xuICByZXR1cm4gcGFyc2VGbG9hdChhbW91bnRTdHJDb3B5KTtcbn1cblxuZnVuY3Rpb24gZ2V0VHhuQW1vdW50KHR4bjogU2NyYXBlZFRyYW5zYWN0aW9uKSB7XG4gIGNvbnN0IGNyZWRpdCA9IGdldEFtb3VudERhdGEodHhuLmNyZWRpdCk7XG4gIGNvbnN0IGRlYml0ID0gZ2V0QW1vdW50RGF0YSh0eG4uZGViaXQpO1xuICByZXR1cm4gKE51bWJlci5pc05hTihjcmVkaXQpID8gMCA6IGNyZWRpdCkgLSAoTnVtYmVyLmlzTmFOKGRlYml0KSA/IDAgOiBkZWJpdCk7XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRUcmFuc2FjdGlvbnModHhuczogU2NyYXBlZFRyYW5zYWN0aW9uW10sIG9wdGlvbnM/OiBTY3JhcGVyT3B0aW9ucyk6IFRyYW5zYWN0aW9uW10ge1xuICByZXR1cm4gdHhucy5tYXAoKHR4bik6IFRyYW5zYWN0aW9uID0+IHtcbiAgICBjb25zdCBjb252ZXJ0ZWREYXRlID0gbW9tZW50KHR4bi5kYXRlLCBEQVRFX0ZPUk1BVCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCBjb252ZXJ0ZWRBbW91bnQgPSBnZXRUeG5BbW91bnQodHhuKTtcbiAgICBjb25zdCByZXN1bHQ6IFRyYW5zYWN0aW9uID0ge1xuICAgICAgdHlwZTogVHJhbnNhY3Rpb25UeXBlcy5Ob3JtYWwsXG4gICAgICBpZGVudGlmaWVyOiB0eG4ucmVmZXJlbmNlID8gcGFyc2VJbnQodHhuLnJlZmVyZW5jZSwgMTApIDogdW5kZWZpbmVkLFxuICAgICAgZGF0ZTogY29udmVydGVkRGF0ZSxcbiAgICAgIHByb2Nlc3NlZERhdGU6IGNvbnZlcnRlZERhdGUsXG4gICAgICBvcmlnaW5hbEFtb3VudDogY29udmVydGVkQW1vdW50LFxuICAgICAgb3JpZ2luYWxDdXJyZW5jeTogU0hFS0VMX0NVUlJFTkNZLFxuICAgICAgY2hhcmdlZEFtb3VudDogY29udmVydGVkQW1vdW50LFxuICAgICAgc3RhdHVzOiB0eG4uc3RhdHVzLFxuICAgICAgZGVzY3JpcHRpb246IHR4bi5kZXNjcmlwdGlvbixcbiAgICAgIG1lbW86IHR4bi5tZW1vLFxuICAgICAgLi4uKHR4bi50cmFuc2ZlckRldGFpbHMgPyB7IHRyYW5zZmVyRGV0YWlsczogdHhuLnRyYW5zZmVyRGV0YWlscyB9IDoge30pLFxuICAgIH07XG5cbiAgICBpZiAob3B0aW9ucz8uaW5jbHVkZVJhd1RyYW5zYWN0aW9uKSB7XG4gICAgICByZXN1bHQucmF3VHJhbnNhY3Rpb24gPSBnZXRSYXdUcmFuc2FjdGlvbih0eG4pO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBnZXRUcmFuc2FjdGlvbkRhdGUoXG4gIHRkczogVHJhbnNhY3Rpb25zVHJUZHMsXG4gIHRyYW5zYWN0aW9uVHlwZTogc3RyaW5nLFxuICB0cmFuc2FjdGlvbnNDb2xzVHlwZXM6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcyxcbikge1xuICBpZiAodHJhbnNhY3Rpb25UeXBlID09PSAnY29tcGxldGVkJykge1xuICAgIHJldHVybiAodGRzW3RyYW5zYWN0aW9uc0NvbHNUeXBlc1tEQVRFX0NPTFVNTl9DTEFTU19DT01QTEVURURdXSB8fCAnJykudHJpbSgpO1xuICB9XG4gIHJldHVybiAodGRzW3RyYW5zYWN0aW9uc0NvbHNUeXBlc1tEQVRFX0NPTFVNTl9DTEFTU19QRU5ESU5HXV0gfHwgJycpLnRyaW0oKTtcbn1cblxuZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25EZXNjcmlwdGlvbihcbiAgdGRzOiBUcmFuc2FjdGlvbnNUclRkcyxcbiAgdHJhbnNhY3Rpb25UeXBlOiBzdHJpbmcsXG4gIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzLFxuKSB7XG4gIGlmICh0cmFuc2FjdGlvblR5cGUgPT09ICdjb21wbGV0ZWQnKSB7XG4gICAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW0RFU0NSSVBUSU9OX0NPTFVNTl9DTEFTU19DT01QTEVURURdXSB8fCAnJykudHJpbSgpO1xuICB9XG4gIHJldHVybiAodGRzW3RyYW5zYWN0aW9uc0NvbHNUeXBlc1tERVNDUklQVElPTl9DT0xVTU5fQ0xBU1NfUEVORElOR11dIHx8ICcnKS50cmltKCk7XG59XG5cbmZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uUmVmZXJlbmNlKHRkczogVHJhbnNhY3Rpb25zVHJUZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzKSB7XG4gIHJldHVybiAodGRzW3RyYW5zYWN0aW9uc0NvbHNUeXBlc1tSRUZFUkVOQ0VfQ09MVU1OX0NMQVNTXV0gfHwgJycpLnRyaW0oKTtcbn1cblxuZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25EZWJpdCh0ZHM6IFRyYW5zYWN0aW9uc1RyVGRzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXM6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcykge1xuICByZXR1cm4gKHRkc1t0cmFuc2FjdGlvbnNDb2xzVHlwZXNbREVCSVRfQ09MVU1OX0NMQVNTXV0gfHwgJycpLnRyaW0oKTtcbn1cblxuZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25DcmVkaXQodGRzOiBUcmFuc2FjdGlvbnNUclRkcywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzOiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMpIHtcbiAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW0NSRURJVF9DT0xVTU5fQ0xBU1NdXSB8fCAnJykudHJpbSgpO1xufVxuXG5mdW5jdGlvbiBleHRyYWN0VHJhbnNhY3Rpb25EZXRhaWxzKFxuICB0eG5Sb3c6IFRyYW5zYWN0aW9uc1RyLFxuICB0cmFuc2FjdGlvblN0YXR1czogVHJhbnNhY3Rpb25TdGF0dXNlcyxcbiAgdHJhbnNhY3Rpb25zQ29sc1R5cGVzOiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMsXG4pOiBTY3JhcGVkVHJhbnNhY3Rpb24ge1xuICBjb25zdCB0ZHMgPSB0eG5Sb3cuaW5uZXJUZHM7XG4gIGNvbnN0IGl0ZW06IFNjcmFwZWRUcmFuc2FjdGlvbiA9IHtcbiAgICBzdGF0dXM6IHRyYW5zYWN0aW9uU3RhdHVzLFxuICAgIGRhdGU6IGdldFRyYW5zYWN0aW9uRGF0ZSh0ZHMsIHRyYW5zYWN0aW9uU3RhdHVzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpLFxuICAgIGRlc2NyaXB0aW9uOiBnZXRUcmFuc2FjdGlvbkRlc2NyaXB0aW9uKHRkcywgdHJhbnNhY3Rpb25TdGF0dXMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlcyksXG4gICAgcmVmZXJlbmNlOiBnZXRUcmFuc2FjdGlvblJlZmVyZW5jZSh0ZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlcyksXG4gICAgZGViaXQ6IGdldFRyYW5zYWN0aW9uRGViaXQodGRzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpLFxuICAgIGNyZWRpdDogZ2V0VHJhbnNhY3Rpb25DcmVkaXQodGRzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpLFxuICB9O1xuXG4gIGlmICh0cmFuc2FjdGlvblN0YXR1cyA9PT0gVHJhbnNhY3Rpb25TdGF0dXNlcy5Db21wbGV0ZWQgJiYgaXRlbS5kZXNjcmlwdGlvbiA9PT0gJ9eU16LXkdeo15Qg157XlNeX16nXkdeV158nKSB7XG4gICAgaXRlbS50cmFuc2Zlckxvb2t1cCA9IHR4blJvdy50cmFuc2Zlckxvb2t1cDtcbiAgfVxuXG4gIHJldHVybiBpdGVtO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRUcmFuc2FjdGlvbnNDb2xzVHlwZUNsYXNzZXMoXG4gIHBhZ2U6IFBhZ2UgfCBGcmFtZSxcbiAgdGFibGVMb2NhdG9yOiBzdHJpbmcsXG4pOiBQcm9taXNlPFRyYW5zYWN0aW9uc0NvbHNUeXBlcz4ge1xuICBjb25zdCByZXN1bHQ6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcyA9IHt9O1xuICBjb25zdCB0eXBlQ2xhc3Nlc09ianMgPSBhd2FpdCBwYWdlRXZhbEFsbChwYWdlLCBgJHt0YWJsZUxvY2F0b3J9IHRib2R5IHRyOmZpcnN0LW9mLXR5cGUgdGRgLCBudWxsLCB0ZHMgPT4ge1xuICAgIHJldHVybiB0ZHMubWFwKCh0ZCwgaW5kZXgpID0+ICh7XG4gICAgICBjb2xDbGFzczogdGQuZ2V0QXR0cmlidXRlKCdjbGFzcycpLFxuICAgICAgaW5kZXgsXG4gICAgfSkpO1xuICB9KTtcblxuICBmb3IgKGNvbnN0IHR5cGVDbGFzc09iaiBvZiB0eXBlQ2xhc3Nlc09ianMpIHtcbiAgICBpZiAodHlwZUNsYXNzT2JqLmNvbENsYXNzKSB7XG4gICAgICByZXN1bHRbdHlwZUNsYXNzT2JqLmNvbENsYXNzXSA9IHR5cGVDbGFzc09iai5pbmRleDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZnVuY3Rpb24gZXh0cmFjdFRyYW5zYWN0aW9uKFxuICB0eG5zOiBTY3JhcGVkVHJhbnNhY3Rpb25bXSxcbiAgdHJhbnNhY3Rpb25TdGF0dXM6IFRyYW5zYWN0aW9uU3RhdHVzZXMsXG4gIHR4blJvdzogVHJhbnNhY3Rpb25zVHIsXG4gIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzLFxuKSB7XG4gIGNvbnN0IHR4biA9IGV4dHJhY3RUcmFuc2FjdGlvbkRldGFpbHModHhuUm93LCB0cmFuc2FjdGlvblN0YXR1cywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzKTtcbiAgaWYgKHR4bi5kYXRlICE9PSAnJykge1xuICAgIHR4bnMucHVzaCh0eG4pO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4dHJhY3RUcmFuc2FjdGlvbnMocGFnZTogUGFnZSB8IEZyYW1lLCB0YWJsZUxvY2F0b3I6IHN0cmluZywgdHJhbnNhY3Rpb25TdGF0dXM6IFRyYW5zYWN0aW9uU3RhdHVzZXMpIHtcbiAgY29uc3QgdHhuczogU2NyYXBlZFRyYW5zYWN0aW9uW10gPSBbXTtcbiAgY29uc3QgdHJhbnNhY3Rpb25zQ29sc1R5cGVzID0gYXdhaXQgZ2V0VHJhbnNhY3Rpb25zQ29sc1R5cGVDbGFzc2VzKHBhZ2UsIHRhYmxlTG9jYXRvcik7XG5cbiAgY29uc3QgdHJhbnNhY3Rpb25zUm93cyA9IGF3YWl0IHBhZ2VFdmFsQWxsPFRyYW5zYWN0aW9uc1RyW10+KHBhZ2UsIGAke3RhYmxlTG9jYXRvcn0gdGJvZHkgdHJgLCBbXSwgdHJzID0+IHtcbiAgICByZXR1cm4gdHJzLm1hcCh0ciA9PiB7XG4gICAgICBjb25zdCBsaW5rID0gdHIucXVlcnlTZWxlY3RvcignYS5QVzFbc3VnYmFrYXNoYT1cIjUyM1wiXScpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaW5uZXJUZHM6IEFycmF5LmZyb20odHIuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ3RkJykpLm1hcCh0ZCA9PiB0ZC5pbm5lclRleHQpLFxuICAgICAgICAuLi4obGlua1xuICAgICAgICAgID8ge1xuICAgICAgICAgICAgICB0cmFuc2Zlckxvb2t1cDoge1xuICAgICAgICAgICAgICAgIGRhdGU6IGxpbmsuZ2V0QXR0cmlidXRlKCdhY3RkYXRlJykgPz8gJycsXG4gICAgICAgICAgICAgICAgcHJvY2Vzc2luZ1N0YWdlOiBsaW5rLmdldEF0dHJpYnV0ZSgnc2hsYXZpYnVkJykgPz8gJycsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9XG4gICAgICAgICAgOiB7fSksXG4gICAgICB9O1xuICAgIH0pO1xuICB9KTtcblxuICBmb3IgKGNvbnN0IHR4blJvdyBvZiB0cmFuc2FjdGlvbnNSb3dzKSB7XG4gICAgZXh0cmFjdFRyYW5zYWN0aW9uKHR4bnMsIHRyYW5zYWN0aW9uU3RhdHVzLCB0eG5Sb3csIHRyYW5zYWN0aW9uc0NvbHNUeXBlcyk7XG4gIH1cbiAgcmV0dXJuIHR4bnM7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGlzTm9UcmFuc2FjdGlvbkluRGF0ZVJhbmdlRXJyb3IocGFnZTogUGFnZSB8IEZyYW1lKSB7XG4gIGNvbnN0IGhhc0Vycm9ySW5mb0VsZW1lbnQgPSBhd2FpdCBlbGVtZW50UHJlc2VudE9uUGFnZShwYWdlLCBgLiR7RVJST1JfTUVTU0FHRV9DTEFTU31gKTtcbiAgaWYgKGhhc0Vycm9ySW5mb0VsZW1lbnQpIHtcbiAgICBjb25zdCBlcnJvclRleHQgPSBhd2FpdCBwYWdlLiRldmFsKGAuJHtFUlJPUl9NRVNTQUdFX0NMQVNTfWAsIGVycm9yRWxlbWVudCA9PiB7XG4gICAgICByZXR1cm4gKGVycm9yRWxlbWVudCBhcyBIVE1MRWxlbWVudCkuaW5uZXJUZXh0O1xuICAgIH0pO1xuICAgIHJldHVybiBlcnJvclRleHQudHJpbSgpID09PSBOT19UUkFOU0FDVElPTl9JTl9EQVRFX1JBTkdFX1RFWFQ7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzZWFyY2hCeURhdGVzKHBhZ2U6IFBhZ2UgfCBGcmFtZSwgc3RhcnREYXRlOiBNb21lbnQpIHtcbiAgYXdhaXQgY2xpY2tCdXR0b24ocGFnZSwgJ2EjdGFiSGVhZGVyNCcpO1xuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJ2RpdiNmaWJpX2RhdGVzJyk7XG4gIGF3YWl0IGZpbGxJbnB1dChwYWdlLCAnaW5wdXQjZnJvbURhdGUnLCBzdGFydERhdGUuZm9ybWF0KERBVEVfRk9STUFUKSk7XG4gIGF3YWl0IGNsaWNrQnV0dG9uKHBhZ2UsIGBidXR0b25bY2xhc3MqPSR7Q0xPU0VfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9DTEFTU31dYCk7XG4gIGF3YWl0IGNsaWNrQnV0dG9uKHBhZ2UsIGBpbnB1dFt2YWx1ZT0ke1NIT1dfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9WQUxVRX1dYCk7XG4gIGF3YWl0IHdhaXRGb3JOYXZpZ2F0aW9uKHBhZ2UpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRBY2NvdW50TnVtYmVyKHBhZ2U6IFBhZ2UgfCBGcmFtZSk6IFByb21pc2U8c3RyaW5nPiB7XG4gIC8vIFdhaXQgdW50aWwgdGhlIGFjY291bnQgbnVtYmVyIGVsZW1lbnQgaXMgcHJlc2VudCBpbiB0aGUgRE9NXG4gIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCBBQ0NPVU5UU19OVU1CRVIsIHRydWUsIEVMRU1FTlRfUkVOREVSX1RJTUVPVVRfTVMpO1xuXG4gIGNvbnN0IHNlbGVjdGVkU25pZkFjY291bnQgPSBhd2FpdCBwYWdlLiRldmFsKEFDQ09VTlRTX05VTUJFUiwgb3B0aW9uID0+IHtcbiAgICByZXR1cm4gKG9wdGlvbiBhcyBIVE1MRWxlbWVudCkuaW5uZXJUZXh0O1xuICB9KTtcblxuICByZXR1cm4gc2VsZWN0ZWRTbmlmQWNjb3VudC5yZXBsYWNlKCcvJywgJ18nKS50cmltKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNoZWNrSWZIYXNOZXh0UGFnZShwYWdlOiBQYWdlIHwgRnJhbWUpIHtcbiAgcmV0dXJuIGVsZW1lbnRQcmVzZW50T25QYWdlKHBhZ2UsIE5FWFRfUEFHRV9MSU5LKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbmF2aWdhdGVUb05leHRQYWdlKHBhZ2U6IFBhZ2UgfCBGcmFtZSkge1xuICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCBORVhUX1BBR0VfTElOSyk7XG4gIGF3YWl0IHdhaXRGb3JOYXZpZ2F0aW9uKHBhZ2UpO1xufVxuXG4vKiBDb3VsZG4ndCByZXByb2R1Y2Ugc2NlbmFyaW8gd2l0aCBtdWx0aXBsZSBwYWdlcyBvZiBwZW5kaW5nIHRyYW5zYWN0aW9ucyAtIFNob3VsZCBzdXBwb3J0IGlmIGV4aXN0cyBzdWNoIGNhc2UuXG4gICBuZWVkVG9QYWdpbmF0ZSBpcyBmYWxzZSBpZiBzY3JhcGluZyBwZW5kaW5nIHRyYW5zYWN0aW9ucyAqL1xuYXN5bmMgZnVuY3Rpb24gc2NyYXBlVHJhbnNhY3Rpb25zKFxuICBwYWdlOiBQYWdlIHwgRnJhbWUsXG4gIHRhYmxlTG9jYXRvcjogc3RyaW5nLFxuICB0cmFuc2FjdGlvblN0YXR1czogVHJhbnNhY3Rpb25TdGF0dXNlcyxcbiAgbmVlZFRvUGFnaW5hdGU6IGJvb2xlYW4sXG4gIG9wdGlvbnM/OiBTY3JhcGVyT3B0aW9ucyxcbikge1xuICBjb25zdCB0eG5zID0gW107XG4gIGxldCBoYXNOZXh0UGFnZSA9IGZhbHNlO1xuXG4gIGRvIHtcbiAgICBjb25zdCBjdXJyZW50UGFnZVR4bnMgPSBhd2FpdCBleHRyYWN0VHJhbnNhY3Rpb25zKHBhZ2UsIHRhYmxlTG9jYXRvciwgdHJhbnNhY3Rpb25TdGF0dXMpO1xuICAgIHR4bnMucHVzaCguLi5jdXJyZW50UGFnZVR4bnMpO1xuICAgIGlmIChuZWVkVG9QYWdpbmF0ZSkge1xuICAgICAgaGFzTmV4dFBhZ2UgPSBhd2FpdCBjaGVja0lmSGFzTmV4dFBhZ2UocGFnZSk7XG4gICAgICBpZiAoaGFzTmV4dFBhZ2UpIHtcbiAgICAgICAgYXdhaXQgbmF2aWdhdGVUb05leHRQYWdlKHBhZ2UpO1xuICAgICAgfVxuICAgIH1cbiAgfSB3aGlsZSAoaGFzTmV4dFBhZ2UpO1xuXG4gIGlmIChvcHRpb25zPy5hZGRpdGlvbmFsVHJhbnNhY3Rpb25JbmZvcm1hdGlvbiAmJiB0cmFuc2FjdGlvblN0YXR1cyA9PT0gVHJhbnNhY3Rpb25TdGF0dXNlcy5Db21wbGV0ZWQpIHtcbiAgICBhd2FpdCBlbnJpY2hTaGVrZWxUcmFuc2ZlcnMocGFnZSwgdHhucyk7XG4gIH1cblxuICByZXR1cm4gY29udmVydFRyYW5zYWN0aW9ucyh0eG5zLCBvcHRpb25zKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0QWNjb3VudFRyYW5zYWN0aW9ucyhwYWdlOiBQYWdlIHwgRnJhbWUsIG9wdGlvbnM/OiBTY3JhcGVyT3B0aW9ucykge1xuICBhd2FpdCBQcm9taXNlLnJhY2UoW1xuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCBcImRpdltpZCo9J2RpdlRhYmxlJ11cIiwgZmFsc2UpLFxuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCBgLiR7RVJST1JfTUVTU0FHRV9DTEFTU31gLCBmYWxzZSksXG4gIF0pO1xuXG4gIGNvbnN0IG5vVHJhbnNhY3Rpb25JblJhbmdlRXJyb3IgPSBhd2FpdCBpc05vVHJhbnNhY3Rpb25JbkRhdGVSYW5nZUVycm9yKHBhZ2UpO1xuICBpZiAobm9UcmFuc2FjdGlvbkluUmFuZ2VFcnJvcikge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIGNvbnN0IHBlbmRpbmdUeG5zID0gYXdhaXQgc2NyYXBlVHJhbnNhY3Rpb25zKFxuICAgIHBhZ2UsXG4gICAgUEVORElOR19UUkFOU0FDVElPTlNfVEFCTEUsXG4gICAgVHJhbnNhY3Rpb25TdGF0dXNlcy5QZW5kaW5nLFxuICAgIGZhbHNlLFxuICAgIG9wdGlvbnMsXG4gICk7XG4gIGNvbnN0IGNvbXBsZXRlZFR4bnMgPSBhd2FpdCBzY3JhcGVUcmFuc2FjdGlvbnMoXG4gICAgcGFnZSxcbiAgICBDT01QTEVURURfVFJBTlNBQ1RJT05TX1RBQkxFLFxuICAgIFRyYW5zYWN0aW9uU3RhdHVzZXMuQ29tcGxldGVkLFxuICAgIHRydWUsXG4gICAgb3B0aW9ucyxcbiAgKTtcbiAgY29uc3QgdHhucyA9IFsuLi5wZW5kaW5nVHhucywgLi4uY29tcGxldGVkVHhuc107XG4gIHJldHVybiB0eG5zO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRDdXJyZW50QmFsYW5jZShwYWdlOiBQYWdlIHwgRnJhbWUpOiBQcm9taXNlPG51bWJlcj4ge1xuICAvLyBXYWl0IGZvciB0aGUgYmFsYW5jZSBlbGVtZW50IHRvIGFwcGVhciBhbmQgYmUgdmlzaWJsZVxuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgQ1VSUkVOVF9CQUxBTkNFLCB0cnVlLCBFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TKTtcblxuICAvLyBFeHRyYWN0IHRleHQgY29udGVudFxuICBjb25zdCBiYWxhbmNlU3RyID0gYXdhaXQgcGFnZS4kZXZhbChDVVJSRU5UX0JBTEFOQ0UsIGVsID0+IHtcbiAgICByZXR1cm4gKGVsIGFzIEhUTUxFbGVtZW50KS5pbm5lclRleHQ7XG4gIH0pO1xuXG4gIHJldHVybiBnZXRBbW91bnREYXRhKGJhbGFuY2VTdHIpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2FpdEZvclBvc3RMb2dpbihwYWdlOiBQYWdlKSB7XG4gIHJldHVybiBQcm9taXNlLnJhY2UoW1xuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI2NhcmQtaGVhZGVyJywgZmFsc2UpLCAvLyBOZXcgVUlcbiAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyNhY2NvdW50X251bScsIHRydWUpLCAvLyBOZXcgVUlcbiAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyNtYXRhZkxvZ291dExpbmsnLCB0cnVlKSwgLy8gT2xkIFVJXG4gICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICcjdmFsaWRhdGlvbk1zZycsIHRydWUpLCAvLyBPbGQgVUlcbiAgXSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoQWNjb3VudERhdGEocGFnZTogUGFnZSB8IEZyYW1lLCBzdGFydERhdGU6IE1vbWVudCwgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zKSB7XG4gIGNvbnN0IGFjY291bnROdW1iZXIgPSBhd2FpdCBnZXRBY2NvdW50TnVtYmVyKHBhZ2UpO1xuICBjb25zdCBiYWxhbmNlID0gYXdhaXQgZ2V0Q3VycmVudEJhbGFuY2UocGFnZSk7XG4gIGF3YWl0IHNlYXJjaEJ5RGF0ZXMocGFnZSwgc3RhcnREYXRlKTtcbiAgY29uc3QgdHhucyA9IGF3YWl0IGdldEFjY291bnRUcmFuc2FjdGlvbnMocGFnZSwgb3B0aW9ucyk7XG5cbiAgcmV0dXJuIHtcbiAgICBhY2NvdW50TnVtYmVyLFxuICAgIHR4bnMsXG4gICAgYmFsYW5jZSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0QWNjb3VudElkc09sZFVJKHBhZ2U6IFBhZ2UpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIHJldHVybiBwYWdlLmV2YWx1YXRlKCgpID0+IHtcbiAgICBjb25zdCBzZWxlY3RFbGVtZW50ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FjY291bnRfbnVtX3NlbGVjdCcpO1xuICAgIGNvbnN0IG9wdGlvbnMgPSBzZWxlY3RFbGVtZW50ID8gc2VsZWN0RWxlbWVudC5xdWVyeVNlbGVjdG9yQWxsKCdvcHRpb24nKSA6IFtdO1xuICAgIGlmICghb3B0aW9ucykgcmV0dXJuIFtdO1xuICAgIHJldHVybiBBcnJheS5mcm9tKG9wdGlvbnMsIG9wdGlvbiA9PiBvcHRpb24udmFsdWUpO1xuICB9KTtcbn1cblxuLyoqXG4gKiBFbnN1cmVzIHRoZSBhY2NvdW50IGRyb3Bkb3duIGlzIG9wZW4sIHRoZW4gcmV0dXJucyB0aGUgYXZhaWxhYmxlIGFjY291bnQgbGFiZWxzLlxuICpcbiAqIFRoaXMgbWV0aG9kOlxuICogLSBDaGVja3MgaWYgdGhlIGRyb3Bkb3duIGlzIGFscmVhZHkgb3Blbi5cbiAqIC0gSWYgbm90IG9wZW4sIGNsaWNrcyB0aGUgYWNjb3VudCBzZWxlY3RvciB0byBvcGVuIGl0LlxuICogLSBXYWl0cyBmb3IgdGhlIGRyb3Bkb3duIHRvIHJlbmRlci5cbiAqIC0gRXh0cmFjdHMgYW5kIHJldHVybnMgdGhlIGxpc3Qgb2YgYXZhaWxhYmxlIGFjY291bnQgbGFiZWxzLlxuICpcbiAqIEdyYWNlZnVsIGhhbmRsaW5nOlxuICogLSBJZiBhbnkgZXJyb3Igb2NjdXJzIChlLmcuLCBzZWxlY3RvcnMgbm90IGZvdW5kLCB0aW1pbmcgaXNzdWVzLCBVSSB2ZXJzaW9uIGNoYW5nZXMpLFxuICogICB0aGUgZnVuY3Rpb24gcmV0dXJucyBhbiBlbXB0eSBsaXN0LlxuICpcbiAqIEBwYXJhbSBwYWdlIFB1cHBldGVlciBQYWdlIG9iamVjdC5cbiAqIEByZXR1cm5zIEFuIGFycmF5IG9mIGF2YWlsYWJsZSBhY2NvdW50IGxhYmVscyAoZS5nLiwgW1wiMTI3IHwgWFhYWDFcIiwgXCIxMjcgfCBYWFhYMlwiXSksXG4gKiAgICAgICAgICBvciBhbiBlbXB0eSBhcnJheSBpZiBzb21ldGhpbmcgZ29lcyB3cm9uZy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNsaWNrQWNjb3VudFNlbGVjdG9yR2V0QWNjb3VudElkcyhwYWdlOiBQYWdlKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICB0cnkge1xuICAgIGNvbnN0IGFjY291bnRTZWxlY3RvciA9ICdkaXYuY3VycmVudC1hY2NvdW50JzsgLy8gRGlyZWN0IHNlbGVjdG9yIHRvIGNsaWNrYWJsZSBlbGVtZW50XG4gICAgY29uc3QgZHJvcGRvd25QYW5lbFNlbGVjdG9yID0gJ2Rpdi5tYXQtbWRjLWF1dG9jb21wbGV0ZS1wYW5lbC5hY2NvdW50LXNlbGVjdC1kZCc7IC8vIFRoZSBkcm9wZG93biBsaXN0IGJveFxuICAgIGNvbnN0IG9wdGlvblNlbGVjdG9yID0gJ21hdC1vcHRpb24gLm1kYy1saXN0LWl0ZW1fX3ByaW1hcnktdGV4dCc7IC8vIEFjY291bnQgb3B0aW9uIGxhYmVsc1xuXG4gICAgLy8gQ2hlY2sgaWYgZHJvcGRvd24gaXMgYWxyZWFkeSBvcGVuXG4gICAgY29uc3QgZHJvcGRvd25WaXNpYmxlID0gYXdhaXQgcGFnZVxuICAgICAgLiRldmFsKGRyb3Bkb3duUGFuZWxTZWxlY3RvciwgZWwgPT4ge1xuICAgICAgICByZXR1cm4gZWwgJiYgd2luZG93LmdldENvbXB1dGVkU3R5bGUoZWwpLmRpc3BsYXkgIT09ICdub25lJyAmJiBlbC5vZmZzZXRQYXJlbnQgIT09IG51bGw7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKCgpID0+IGZhbHNlKTsgLy8gY2F0Y2ggaWYgZHJvcGRvd24gaXMgbm90IGluIHRoZSBET00geWV0XG5cbiAgICBpZiAoIWRyb3Bkb3duVmlzaWJsZSkge1xuICAgICAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsIGFjY291bnRTZWxlY3RvciwgdHJ1ZSwgRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyk7XG5cbiAgICAgIC8vIENsaWNrIHRoZSBhY2NvdW50IHNlbGVjdG9yIHRvIG9wZW4gdGhlIGRyb3Bkb3duXG4gICAgICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCBhY2NvdW50U2VsZWN0b3IpO1xuXG4gICAgICAvLyBXYWl0IGZvciB0aGUgZHJvcGRvd24gdG8gb3BlblxuICAgICAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsIGRyb3Bkb3duUGFuZWxTZWxlY3RvciwgdHJ1ZSwgRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyk7XG4gICAgfVxuXG4gICAgLy8gRXh0cmFjdCBhY2NvdW50IGxhYmVscyBmcm9tIHRoZSBkcm9wZG93biBvcHRpb25zXG4gICAgY29uc3QgYWNjb3VudExhYmVscyA9IGF3YWl0IHBhZ2UuJCRldmFsKG9wdGlvblNlbGVjdG9yLCBvcHRpb25zID0+IHtcbiAgICAgIHJldHVybiBvcHRpb25zLm1hcChvcHRpb24gPT4gb3B0aW9uLnRleHRDb250ZW50Py50cmltKCkgfHwgJycpLmZpbHRlcihsYWJlbCA9PiBsYWJlbCAhPT0gJycpO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIGFjY291bnRMYWJlbHM7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIFtdOyAvLyBHcmFjZWZ1bCBmYWxsYmFja1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEFjY291bnRJZHNCb3RoVUlzKHBhZ2U6IFBhZ2UpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIGxldCBhY2NvdW50c0lkczogc3RyaW5nW10gPSBhd2FpdCBjbGlja0FjY291bnRTZWxlY3RvckdldEFjY291bnRJZHMocGFnZSk7XG4gIGlmIChhY2NvdW50c0lkcy5sZW5ndGggPT09IDApIHtcbiAgICBhY2NvdW50c0lkcyA9IGF3YWl0IGdldEFjY291bnRJZHNPbGRVSShwYWdlKTtcbiAgfVxuICByZXR1cm4gYWNjb3VudHNJZHM7XG59XG5cbi8qKlxuICogU2VsZWN0cyBhbiBhY2NvdW50IGZyb20gdGhlIGRyb3Bkb3duIGJhc2VkIG9uIHRoZSBwcm92aWRlZCBhY2NvdW50IGxhYmVsLlxuICpcbiAqIFRoaXMgbWV0aG9kOlxuICogLSBDbGlja3MgdGhlIGFjY291bnQgc2VsZWN0b3IgYnV0dG9uIHRvIG9wZW4gdGhlIGRyb3Bkb3duLlxuICogLSBSZXRyaWV2ZXMgdGhlIGxpc3Qgb2YgYXZhaWxhYmxlIGFjY291bnQgbGFiZWxzLlxuICogLSBDaGVja3MgaWYgdGhlIHByb3ZpZGVkIGFjY291bnQgbGFiZWwgZXhpc3RzIGluIHRoZSBsaXN0LlxuICogLSBGaW5kcyBhbmQgY2xpY2tzIHRoZSBtYXRjaGluZyBhY2NvdW50IG9wdGlvbiBpZiBmb3VuZC5cbiAqXG4gKiBAcGFyYW0gcGFnZSBQdXBwZXRlZXIgUGFnZSBvYmplY3QuXG4gKiBAcGFyYW0gYWNjb3VudExhYmVsIFRoZSB0ZXh0IG9mIHRoZSBhY2NvdW50IHRvIHNlbGVjdCAoZS5nLiwgXCIxMjcgfCBYWFhYWFwiKS5cbiAqIEByZXR1cm5zIFRydWUgaWYgdGhlIGFjY291bnQgb3B0aW9uIHdhcyBmb3VuZCBhbmQgY2xpY2tlZDsgZmFsc2Ugb3RoZXJ3aXNlLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2VsZWN0QWNjb3VudEZyb21Ecm9wZG93bihwYWdlOiBQYWdlLCBhY2NvdW50TGFiZWw6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAvLyBDYWxsIGNsaWNrQWNjb3VudFNlbGVjdG9yIHRvIGdldCB0aGUgYXZhaWxhYmxlIGFjY291bnRzIGFuZCBvcGVuIHRoZSBkcm9wZG93blxuICBjb25zdCBhdmFpbGFibGVBY2NvdW50cyA9IGF3YWl0IGNsaWNrQWNjb3VudFNlbGVjdG9yR2V0QWNjb3VudElkcyhwYWdlKTtcblxuICAvLyBDaGVjayBpZiB0aGUgYWNjb3VudCBsYWJlbCBleGlzdHMgaW4gdGhlIGF2YWlsYWJsZSBhY2NvdW50c1xuICBpZiAoIWF2YWlsYWJsZUFjY291bnRzLmluY2x1ZGVzKGFjY291bnRMYWJlbCkpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvLyBXYWl0IGZvciB0aGUgZHJvcGRvd24gb3B0aW9ucyB0byBiZSByZW5kZXJlZFxuICBjb25zdCBvcHRpb25TZWxlY3RvciA9ICdtYXQtb3B0aW9uIC5tZGMtbGlzdC1pdGVtX19wcmltYXJ5LXRleHQnO1xuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgb3B0aW9uU2VsZWN0b3IsIHRydWUsIEVMRU1FTlRfUkVOREVSX1RJTUVPVVRfTVMpO1xuXG4gIC8vIFF1ZXJ5IGFsbCBtYXRjaGluZyBvcHRpb25zXG4gIGNvbnN0IGFjY291bnRPcHRpb25zID0gYXdhaXQgcGFnZS4kJChvcHRpb25TZWxlY3Rvcik7XG5cbiAgLy8gRmluZCBhbmQgY2xpY2sgdGhlIG9wdGlvbiBtYXRjaGluZyB0aGUgYWNjb3VudExhYmVsXG4gIGZvciAoY29uc3Qgb3B0aW9uIG9mIGFjY291bnRPcHRpb25zKSB7XG4gICAgY29uc3QgdGV4dCA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoZWwgPT4gZWwudGV4dENvbnRlbnQ/LnRyaW0oKSwgb3B0aW9uKTtcblxuICAgIGlmICh0ZXh0ID09PSBhY2NvdW50TGFiZWwpIHtcbiAgICAgIGNvbnN0IG9wdGlvbkhhbmRsZSA9IGF3YWl0IG9wdGlvbi5ldmFsdWF0ZUhhbmRsZShlbCA9PiBlbCBhcyBIVE1MRWxlbWVudCk7XG4gICAgICBhd2FpdCBwYWdlLmV2YWx1YXRlKChlbDogSFRNTEVsZW1lbnQpID0+IGVsLmNsaWNrKCksIG9wdGlvbkhhbmRsZSk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZmFsc2U7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uc0ZyYW1lKHBhZ2U6IFBhZ2UpOiBQcm9taXNlPEZyYW1lIHwgbnVsbD4ge1xuICAvLyBUcnkgYSBmZXcgdGltZXMgdG8gZmluZCB0aGUgaWZyYW1lLCBhcyBpdCBtaWdodCBub3QgYmUgaW1tZWRpYXRlbHkgYXZhaWxhYmxlXG4gIGZvciAobGV0IGF0dGVtcHQgPSAwOyBhdHRlbXB0IDwgMzsgYXR0ZW1wdCsrKSB7XG4gICAgYXdhaXQgc2xlZXAoMjAwMCk7XG4gICAgY29uc3QgZnJhbWVzID0gcGFnZS5mcmFtZXMoKTtcbiAgICBjb25zdCB0YXJnZXRGcmFtZSA9IGZyYW1lcy5maW5kKGYgPT4gZi5uYW1lKCkgPT09IElGUkFNRV9OQU1FKTtcblxuICAgIGlmICh0YXJnZXRGcmFtZSkge1xuICAgICAgcmV0dXJuIHRhcmdldEZyYW1lO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBudWxsO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzZWxlY3RBY2NvdW50Qm90aFVJcyhwYWdlOiBQYWdlLCBhY2NvdW50SWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBhY2NvdW50U2VsZWN0ZWQgPSBhd2FpdCBzZWxlY3RBY2NvdW50RnJvbURyb3Bkb3duKHBhZ2UsIGFjY291bnRJZCk7XG4gIGlmICghYWNjb3VudFNlbGVjdGVkKSB7XG4gICAgLy8gT2xkIFVJIGZvcm1hdFxuICAgIGF3YWl0IHBhZ2Uuc2VsZWN0KCcjYWNjb3VudF9udW1fc2VsZWN0JywgYWNjb3VudElkKTtcbiAgICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyNhY2NvdW50X251bV9zZWxlY3QnLCB0cnVlKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaEFjY291bnREYXRhQm90aFVJcyhcbiAgcGFnZTogUGFnZSxcbiAgc3RhcnREYXRlOiBNb21lbnQsXG4gIG9wdGlvbnM/OiBTY3JhcGVyT3B0aW9ucyxcbik6IFByb21pc2U8VHJhbnNhY3Rpb25zQWNjb3VudD4ge1xuICAvLyBUcnkgdG8gZ2V0IHRoZSBpZnJhbWUgZm9yIHRoZSBuZXcgVUlcbiAgY29uc3QgZnJhbWUgPSBhd2FpdCBnZXRUcmFuc2FjdGlvbnNGcmFtZShwYWdlKTtcblxuICAvLyBVc2UgdGhlIGZyYW1lIGlmIGF2YWlsYWJsZSAobmV3IFVJKSwgb3RoZXJ3aXNlIHVzZSB0aGUgcGFnZSBkaXJlY3RseSAob2xkIFVJKVxuICBjb25zdCB0YXJnZXRQYWdlID0gZnJhbWUgfHwgcGFnZTtcbiAgcmV0dXJuIGZldGNoQWNjb3VudERhdGEodGFyZ2V0UGFnZSwgc3RhcnREYXRlLCBvcHRpb25zKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hBY2NvdW50cyhwYWdlOiBQYWdlLCBzdGFydERhdGU6IE1vbWVudCwgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zKTogUHJvbWlzZTxUcmFuc2FjdGlvbnNBY2NvdW50W10+IHtcbiAgY29uc3QgYWNjb3VudHNJZHMgPSBhd2FpdCBnZXRBY2NvdW50SWRzQm90aFVJcyhwYWdlKTtcblxuICBpZiAoYWNjb3VudHNJZHMubGVuZ3RoID09PSAwKSB7XG4gICAgLy8gSW4gY2FzZSBhY2NvdW50c0lkcyBjb3VsZCBubyBiZSBwYXJzZWQganVzdCByZXR1cm4gdGhlIHRyYW5zYWN0aW9ucyBvZiB0aGUgY3VycmVudGx5IHNlbGVjdGVkIGFjY291bnRcbiAgICBjb25zdCBhY2NvdW50RGF0YSA9IGF3YWl0IGZldGNoQWNjb3VudERhdGFCb3RoVUlzKHBhZ2UsIHN0YXJ0RGF0ZSwgb3B0aW9ucyk7XG4gICAgcmV0dXJuIFthY2NvdW50RGF0YV07XG4gIH1cblxuICBjb25zdCBhY2NvdW50czogVHJhbnNhY3Rpb25zQWNjb3VudFtdID0gW107XG4gIGZvciAoY29uc3QgYWNjb3VudElkIG9mIGFjY291bnRzSWRzKSB7XG4gICAgYXdhaXQgc2VsZWN0QWNjb3VudEJvdGhVSXMocGFnZSwgYWNjb3VudElkKTtcbiAgICBjb25zdCBhY2NvdW50RGF0YSA9IGF3YWl0IGZldGNoQWNjb3VudERhdGFCb3RoVUlzKHBhZ2UsIHN0YXJ0RGF0ZSwgb3B0aW9ucyk7XG4gICAgYWNjb3VudHMucHVzaChhY2NvdW50RGF0YSk7XG4gIH1cblxuICByZXR1cm4gYWNjb3VudHM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JlaWduQ3VycmVuY3lUb0lzbyhsYWJlbDogc3RyaW5nKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIEZDX0NVUlJFTkNZX0JZX0hFQlJFVy5maW5kKChbcmVdKSA9PiByZS50ZXN0KGxhYmVsKSk/LlsxXTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0Rm9yZWlnbkN1cnJlbmN5T3B0aW9ucyhmcmFtZTogRnJhbWUpOiBQcm9taXNlPEFycmF5PHsgdmFsdWU6IHN0cmluZzsgbGFiZWw6IHN0cmluZyB9Pj4ge1xuICByZXR1cm4gcGFnZUV2YWxBbGw8QXJyYXk8eyB2YWx1ZTogc3RyaW5nOyBsYWJlbDogc3RyaW5nIH0+PihmcmFtZSwgYCR7RkNfQ1VSUkVOQ1lfU0VMRUNUfSBvcHRpb25gLCBbXSwgb3B0cyA9PlxuICAgIG9wdHMubWFwKG8gPT4gKHtcbiAgICAgIHZhbHVlOiAobyBhcyBIVE1MT3B0aW9uRWxlbWVudCkudmFsdWUsXG4gICAgICBsYWJlbDogKChvIGFzIEhUTUxFbGVtZW50KS50ZXh0Q29udGVudCB8fCAnJykudHJpbSgpLFxuICAgIH0pKSxcbiAgKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0Rm9yZWlnbkN1cnJlbmN5Um93cyhmcmFtZTogRnJhbWUpOiBQcm9taXNlPEZjUm93W10+IHtcbiAgcmV0dXJuIHBhZ2VFdmFsQWxsPEZjUm93W10+KFxuICAgIGZyYW1lLFxuICAgIGAke0ZDX1RSQU5TQUNUSU9OU19UQUJMRX0gdGJvZHkgdHJgLFxuICAgIFtdLFxuICAgICh0cnMsIGxpbmtTZWxlY3RvcikgPT4ge1xuICAgICAgcmV0dXJuIHRycy5tYXAodHIgPT4gKHtcbiAgICAgICAgdGRzOiBBcnJheS5mcm9tKHRyLmdldEVsZW1lbnRzQnlUYWdOYW1lKCd0ZCcpKS5tYXAodGQgPT4gKHRkIGFzIEhUTUxFbGVtZW50KS5pbm5lclRleHQpLFxuICAgICAgICBoYXNEZXRhaWxMaW5rOiAhIXRyLnF1ZXJ5U2VsZWN0b3IobGlua1NlbGVjdG9yIGFzIHN0cmluZyksXG4gICAgICB9KSk7XG4gICAgfSxcbiAgICBGQ19ERVRBSUxfTElOS19TRUxFQ1RPUixcbiAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RGb3JlaWduQ3VycmVuY3lUcmFuc2FjdGlvbnMocm93czogRmNSb3dbXSk6IFNjcmFwZWRGY1RyYW5zYWN0aW9uW10ge1xuICBjb25zdCB0eG5zOiBTY3JhcGVkRmNUcmFuc2FjdGlvbltdID0gW107XG4gIGZvciAoY29uc3QgeyB0ZHMsIGhhc0RldGFpbExpbmsgfSBvZiByb3dzKSB7XG4gICAgY29uc3QgZGF0ZSA9ICh0ZHNbRkNfQ09MLmRhdGVdIHx8ICcnKS50cmltKCk7XG4gICAgLy8gQW4gZW1wdHkgZGF0ZSBjZWxsIGlzIHRoZSBvcGVuaW5nLWJhbGFuY2UgKNeZ16rXqNeqINek16rXmdeX15QpIHJvdyDigJQgc2tpcCBpdCwgc2FtZVxuICAgIC8vIGFzIHRoZSBOSVMgcGFyc2VyIGRyb3BzIHJvd3Mgd2l0aG91dCBhIGRhdGUuXG4gICAgaWYgKGRhdGUgPT09ICcnKSBjb250aW51ZTtcbiAgICBjb25zdCByZWZlcmVuY2UgPSAodGRzW0ZDX0NPTC5yZWZlcmVuY2VdIHx8ICcnKS50cmltKCk7XG4gICAgY29uc3QgZGVzY3JpcHRpb24gPSAodGRzW0ZDX0NPTC5kZXNjcmlwdGlvbl0gfHwgJycpLnRyaW0oKTtcbiAgICB0eG5zLnB1c2goe1xuICAgICAgc3RhdHVzOiBUcmFuc2FjdGlvblN0YXR1c2VzLkNvbXBsZXRlZCxcbiAgICAgIGRhdGUsXG4gICAgICBkZXNjcmlwdGlvbixcbiAgICAgIHJlZmVyZW5jZSxcbiAgICAgIGRlYml0OiAodGRzW0ZDX0NPTC5kZWJpdF0gfHwgJycpLnRyaW0oKSxcbiAgICAgIGNyZWRpdDogKHRkc1tGQ19DT0wuY3JlZGl0XSB8fCAnJykudHJpbSgpLFxuICAgICAgLy8gT25seSB0cmFuc2ZlcnMgY2FycnkgYSByZWNpcGllbnQgd29ydGggc2hvd2luZzsgdGhlIGJhbmsgbGlua3MgdGhlIHNhbWVcbiAgICAgIC8vIFNXSUZUIG1lc3NhZ2UgZnJvbSB0aGUgcGFpcmVkIGZlZSByb3csIHdoaWNoIHdlIGRlbGliZXJhdGVseSBsZWF2ZSBhbG9uZS5cbiAgICAgIGRldGFpbFJlZmVyZW5jZTpcbiAgICAgICAgaGFzRGV0YWlsTGluayAmJiByZWZlcmVuY2UgIT09ICcnICYmIGRlc2NyaXB0aW9uLmluY2x1ZGVzKEZDX1RSQU5TRkVSX0RFU0NSSVBUSU9OX01BUktFUilcbiAgICAgICAgICA/IHJlZmVyZW5jZVxuICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgIH0pO1xuICB9XG4gIHJldHVybiB0eG5zO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdEZvcmVpZ25DdXJyZW5jeUJhbGFuY2Uocm93czogRmNSb3dbXSk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGZvciAobGV0IGkgPSByb3dzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgY29uc3QgYmFsYW5jZVN0ciA9IChyb3dzW2ldLnRkc1tGQ19DT0wuYmFsYW5jZV0gfHwgJycpLnRyaW0oKTtcbiAgICBpZiAoYmFsYW5jZVN0ciAhPT0gJycpIHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IGdldEFtb3VudERhdGEoYmFsYW5jZVN0cik7XG4gICAgICByZXR1cm4gTnVtYmVyLmlzTmFOKHBhcnNlZCkgPyB1bmRlZmluZWQgOiBwYXJzZWQ7XG4gICAgfVxuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogUmVhZHMgdGhlIGJlbmVmaWNpYXJ5IChg16nXnSDXnteV15jXkWApIG9mZiBhIHdpcmUgdHJhbnNmZXIncyBTV0lGVCBtZXNzYWdlIGJ5XG4gKiBmZXRjaGluZyB0aGUgcG9wdXAgVVJMIHRoYXQgYGNhbGwyNzZgIHdvdWxkIGhhdmUgb3BlbmVkLCBmcm9tIHdpdGhpbiB0aGVcbiAqIGF1dGhlbnRpY2F0ZWQgcGFnZSBjb250ZXh0LiBSZXR1cm5zIHVuZGVmaW5lZCBmb3IgYW55dGhpbmcgdGhhdCBpc24ndCBhIHdpcmVcbiAqIHdpdGggYSBuYW1lZCBiZW5lZmljaWFyeSAoZS5nLiBhIGNhcmQgc2V0dGxlbWVudCksIHNvIGNhbGxlcnMgY2FuIG5vLW9wLlxuICovXG5hc3luYyBmdW5jdGlvbiBmZXRjaEJlbmVmaWNpYXJ5TmFtZShmcmFtZTogRnJhbWUsIHJlZmVyZW5jZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgY29uc3QgdXJsID0gZmNEZXRhaWxVcmwocmVmZXJlbmNlLnBhZFN0YXJ0KEZDX0RFVEFJTF9SRUZFUkVOQ0VfUEFELCAnMCcpKTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gYXdhaXQgZnJhbWUuZXZhbHVhdGUoXG4gICAgICBhc3luYyAoZGV0YWlsVXJsOiBzdHJpbmcsIGxhYmVsOiBzdHJpbmcpID0+IHtcbiAgICAgICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goZGV0YWlsVXJsLCB7IGNyZWRlbnRpYWxzOiAnaW5jbHVkZScgfSk7XG4gICAgICAgIGlmICghcmVzLm9rKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICBjb25zdCBwYXJzZWQgPSBuZXcgRE9NUGFyc2VyKCkucGFyc2VGcm9tU3RyaW5nKGF3YWl0IHJlcy50ZXh0KCksICd0ZXh0L2h0bWwnKTtcbiAgICAgICAgZm9yIChjb25zdCB0ciBvZiBBcnJheS5mcm9tKHBhcnNlZC5xdWVyeVNlbGVjdG9yQWxsKCd0cicpKSkge1xuICAgICAgICAgIGNvbnN0IGNlbGxzID0gQXJyYXkuZnJvbSh0ci5xdWVyeVNlbGVjdG9yQWxsKCd0ZCcpKS5tYXAodGQgPT4gKHRkLnRleHRDb250ZW50IHx8ICcnKS50cmltKCkpO1xuICAgICAgICAgIC8vIFNXSUZUIGxhYmVsIHJvd3MgYXJlIFtlbmdsaXNoIGxhYmVsLCB2YWx1ZSwgaGVicmV3IGxhYmVsXVxuICAgICAgICAgIGlmIChjZWxscy5sZW5ndGggPT09IDMgJiYgY2VsbHNbMl0gPT09IGxhYmVsKSByZXR1cm4gY2VsbHNbMV0gfHwgdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9LFxuICAgICAgdXJsLFxuICAgICAgRkNfQkVORUZJQ0lBUllfTEFCRUwsXG4gICAgKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxufVxuXG4vKipcbiAqIFByZWZpeGVzIGVhY2ggd2lyZSB0cmFuc2ZlcidzIGRlc2NyaXB0aW9uIHdpdGggaXRzIHJlY2lwaWVudCwgZS5nLlxuICogYE9NTklQQUsgTElNSVRFRCDigJMg15TXoteR16jXlC0g15nXkdeV15Ag16nXmdeo15XXqteZ151gLiBFYWNoIHJlZmVyZW5jZSBpcyBmZXRjaGVkIG9uY2UsIHNpbmNlXG4gKiBhIHRyYW5zZmVyIGFuZCBpdHMgZmVlIHNoYXJlIG9uZSDXkNeh157Xm9eq15AuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGFwcGx5QmVuZWZpY2lhcnlOYW1lcyhmcmFtZTogRnJhbWUsIHR4bnM6IFNjcmFwZWRGY1RyYW5zYWN0aW9uW10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgY2FjaGUgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPigpO1xuICBmb3IgKGNvbnN0IHR4biBvZiB0eG5zKSB7XG4gICAgY29uc3QgcmVmID0gdHhuLmRldGFpbFJlZmVyZW5jZTtcbiAgICBpZiAoIXJlZikgY29udGludWU7XG4gICAgaWYgKCFjYWNoZS5oYXMocmVmKSkge1xuICAgICAgY29uc3QgbmFtZSA9IGF3YWl0IGZldGNoQmVuZWZpY2lhcnlOYW1lKGZyYW1lLCByZWYpO1xuICAgICAgY2FjaGUuc2V0KHJlZiwgbmFtZSk7XG4gICAgICBkZWJ1ZygnZm9yZWlnbi1jdXJyZW5jeTogcmVmZXJlbmNlICVzIOKGkiBiZW5lZmljaWFyeSAlcycsIHJlZiwgbmFtZSA/PyAnKG5vbmUpJyk7XG4gICAgfVxuICAgIGNvbnN0IGJlbmVmaWNpYXJ5ID0gY2FjaGUuZ2V0KHJlZik7XG4gICAgaWYgKGJlbmVmaWNpYXJ5KSB7XG4gICAgICB0eG4uZGVzY3JpcHRpb24gPSBgJHtiZW5lZmljaWFyeX0g4oCTICR7dHhuLmRlc2NyaXB0aW9ufWA7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjb252ZXJ0Rm9yZWlnbkN1cnJlbmN5VHJhbnNhY3Rpb25zKFxuICB0eG5zOiBTY3JhcGVkVHJhbnNhY3Rpb25bXSxcbiAgY3VycmVuY3k6IHN0cmluZyxcbiAgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zLFxuKTogVHJhbnNhY3Rpb25bXSB7XG4gIHJldHVybiB0eG5zLm1hcCgodHhuKTogVHJhbnNhY3Rpb24gPT4ge1xuICAgIGNvbnN0IGNvbnZlcnRlZERhdGUgPSBtb21lbnQodHhuLmRhdGUsIERBVEVfRk9STUFUKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IGNvbnZlcnRlZEFtb3VudCA9IGdldFR4bkFtb3VudCh0eG4pO1xuICAgIGNvbnN0IHJlc3VsdDogVHJhbnNhY3Rpb24gPSB7XG4gICAgICB0eXBlOiBUcmFuc2FjdGlvblR5cGVzLk5vcm1hbCxcbiAgICAgIGlkZW50aWZpZXI6IHR4bi5yZWZlcmVuY2UgPyBwYXJzZUludCh0eG4ucmVmZXJlbmNlLCAxMCkgOiB1bmRlZmluZWQsXG4gICAgICBkYXRlOiBjb252ZXJ0ZWREYXRlLFxuICAgICAgcHJvY2Vzc2VkRGF0ZTogY29udmVydGVkRGF0ZSxcbiAgICAgIG9yaWdpbmFsQW1vdW50OiBjb252ZXJ0ZWRBbW91bnQsXG4gICAgICAvLyBUaGUgRkMgYWNjb3VudCdzIG93biBjdXJyZW5jeS4gY2hhcmdlZEN1cnJlbmN5IGlzIGludGVudGlvbmFsbHkgbGVmdFxuICAgICAgLy8gdW5zZXQg4oCUIGRvd25zdHJlYW0gY29uc3VtZXJzIGZhbGwgYmFjayB0byBvcmlnaW5hbEN1cnJlbmN5LCBhbmQgdGhlXG4gICAgICAvLyBhbW91bnQgaXMgYWxyZWFkeSBkZW5vbWluYXRlZCBpbiB0aGF0IGN1cnJlbmN5IChsaWtlIHRoZSBNZXJjdXJ5IHNjcmFwZXIpLlxuICAgICAgb3JpZ2luYWxDdXJyZW5jeTogY3VycmVuY3ksXG4gICAgICBjaGFyZ2VkQW1vdW50OiBjb252ZXJ0ZWRBbW91bnQsXG4gICAgICBzdGF0dXM6IHR4bi5zdGF0dXMsXG4gICAgICBkZXNjcmlwdGlvbjogdHhuLmRlc2NyaXB0aW9uLFxuICAgICAgbWVtbzogdHhuLm1lbW8sXG4gICAgfTtcblxuICAgIGlmIChvcHRpb25zPy5pbmNsdWRlUmF3VHJhbnNhY3Rpb24pIHtcbiAgICAgIHJlc3VsdC5yYXdUcmFuc2FjdGlvbiA9IGdldFJhd1RyYW5zYWN0aW9uKHR4bik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJ1bkZvcmVpZ25DdXJyZW5jeVF1ZXJ5KGZyYW1lOiBGcmFtZSwgY3VycmVuY3lPcHRpb25WYWx1ZTogc3RyaW5nLCBzdGFydERhdGU6IE1vbWVudCkge1xuICBhd2FpdCBmcmFtZS5zZWxlY3QoRkNfQ1VSUkVOQ1lfU0VMRUNULCBjdXJyZW5jeU9wdGlvblZhbHVlKTtcbiAgYXdhaXQgZmlsbElucHV0KGZyYW1lLCBGQ19GUk9NX0RBVEVfSU5QVVQsIHN0YXJ0RGF0ZS5mb3JtYXQoREFURV9GT1JNQVQpKTtcbiAgYXdhaXQgZmlsbElucHV0KGZyYW1lLCBGQ19USUxMX0RBVEVfSU5QVVQsIG1vbWVudCgpLmZvcm1hdChEQVRFX0ZPUk1BVCkpO1xuICBhd2FpdCBjbGlja0J1dHRvbihmcmFtZSwgYGlucHV0W3ZhbHVlPSR7U0hPV19TRUFSQ0hfQllfREFURVNfQlVUVE9OX1ZBTFVFfV1gKTtcbiAgYXdhaXQgd2FpdEZvck5hdmlnYXRpb24oZnJhbWUpO1xufVxuXG4vKipcbiAqIFNjcmFwZXMgdGhlIEJlaW5sZXVtaSBmb3JlaWduLWN1cnJlbmN5ICjXnteYXCLXlykgY3VycmVudCBhY2NvdW50LCBvbmVcbiAqIHN1Yi1hY2NvdW50IHBlciBjdXJyZW5jeSBpbiB0aGUgYCNJTi1TQ0gtTVRCYCBkcm9wZG93bi5cbiAqXG4gKiBUaGUgdG9wLWxldmVsIGFjY291bnQgc3dpdGNoZXIgaXMgbmV2ZXIgdG91Y2hlZCDigJQgYSBkaWZmZXJlbnQgc3dpdGNoZXIgYWNjb3VudFxuICogYmVsb25ncyB0byBhIGRpZmZlcmVudCBhcHAgcHJvZmlsZS4gSW5zdGVhZCB3ZSByZWFkIGl0IChgZGl2LmN1cnJlbnQtYWNjb3VudGApXG4gKiBhbmQgYmFpbCBpZiBpdCBkb2Vzbid0IG1hdGNoIGBleHBlY3RlZEFjY291bnRgLCBzbyBhIHdyb25nIGxvZ2luIGNhbid0IHJlY29yZFxuICogRkMgcm93cyBhZ2FpbnN0IHRoZSB3cm9uZyBhY2NvdW50LlxuICovXG5hc3luYyBmdW5jdGlvbiBmZXRjaEZvcmVpZ25DdXJyZW5jeUFjY291bnRzKFxuICBwYWdlOiBQYWdlLFxuICBleHBlY3RlZEFjY291bnQ6IHN0cmluZyxcbiAgc3RhcnREYXRlOiBNb21lbnQsXG4gIG9wdGlvbnM/OiBTY3JhcGVyT3B0aW9ucyxcbik6IFByb21pc2U8VHJhbnNhY3Rpb25zQWNjb3VudFtdPiB7XG4gIGNvbnN0IGZyYW1lID0gYXdhaXQgZ2V0VHJhbnNhY3Rpb25zRnJhbWUocGFnZSk7XG4gIGlmICghZnJhbWUpIHtcbiAgICBkZWJ1ZygnZm9yZWlnbi1jdXJyZW5jeTogdHJhbnNhY3Rpb25zIGlmcmFtZSBub3QgZm91bmQsIHNraXBwaW5nJyk7XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgY29uc3Qgc2VsZWN0ZWRBY2NvdW50ID0gYXdhaXQgcGFnZVxuICAgIC4kZXZhbChDVVJSRU5UX0FDQ09VTlRfTEFCRUwsIGVsID0+IChlbCBhcyBIVE1MRWxlbWVudCkuaW5uZXJUZXh0LnRyaW0oKSlcbiAgICAuY2F0Y2goKCkgPT4gJycpO1xuICBpZiAoIXNlbGVjdGVkQWNjb3VudC5pbmNsdWRlcyhleHBlY3RlZEFjY291bnQpKSB7XG4gICAgZGVidWcoJ2ZvcmVpZ24tY3VycmVuY3k6IHN3aXRjaGVyIHNob3dzIFwiJXNcIiwgZXhwZWN0ZWQgXCIlc1wiIOKAlCBza2lwcGluZyBGQyBwYXNzJywgc2VsZWN0ZWRBY2NvdW50LCBleHBlY3RlZEFjY291bnQpO1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIGNvbnN0IGN1cnJlbmNpZXMgPSBhd2FpdCBnZXRGb3JlaWduQ3VycmVuY3lPcHRpb25zKGZyYW1lKTtcbiAgY29uc3QgYWNjb3VudHM6IFRyYW5zYWN0aW9uc0FjY291bnRbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgeyB2YWx1ZSwgbGFiZWwgfSBvZiBjdXJyZW5jaWVzKSB7XG4gICAgY29uc3QgY3VycmVuY3kgPSBmb3JlaWduQ3VycmVuY3lUb0lzbyhsYWJlbCk7XG4gICAgaWYgKCFjdXJyZW5jeSkge1xuICAgICAgZGVidWcoJ2ZvcmVpZ24tY3VycmVuY3k6IHVubWFwcGVkIGN1cnJlbmN5IGxhYmVsIFwiJXNcIiAodmFsdWUgJXMpIOKAlCBza2lwcGluZycsIGxhYmVsLCB2YWx1ZSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBhd2FpdCBydW5Gb3JlaWduQ3VycmVuY3lRdWVyeShmcmFtZSwgdmFsdWUsIHN0YXJ0RGF0ZSk7XG5cbiAgICBjb25zdCBhY2NvdW50TnVtYmVyID0gYCR7ZXhwZWN0ZWRBY2NvdW50fSAke2N1cnJlbmN5fWA7XG4gICAgaWYgKGF3YWl0IGlzTm9UcmFuc2FjdGlvbkluRGF0ZVJhbmdlRXJyb3IoZnJhbWUpKSB7XG4gICAgICBhY2NvdW50cy5wdXNoKHsgYWNjb3VudE51bWJlciwgdHhuczogW10gfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgZ2V0Rm9yZWlnbkN1cnJlbmN5Um93cyhmcmFtZSk7XG4gICAgY29uc3Qgc2NyYXBlZCA9IGV4dHJhY3RGb3JlaWduQ3VycmVuY3lUcmFuc2FjdGlvbnMocm93cyk7XG4gICAgLy8gVGhlIHRhYmxlIG5ldmVyIHNob3dzIHdobyBhIHdpcmUgd2VudCB0byDigJQgZW5yaWNoIHRyYW5zZmVycyBmcm9tIHRoZWlyXG4gICAgLy8gU1dJRlQgbWVzc2FnZSBiZWZvcmUgY29udmVydGluZy5cbiAgICBhd2FpdCBhcHBseUJlbmVmaWNpYXJ5TmFtZXMoZnJhbWUsIHNjcmFwZWQpO1xuICAgIGFjY291bnRzLnB1c2goe1xuICAgICAgYWNjb3VudE51bWJlcixcbiAgICAgIGJhbGFuY2U6IGV4dHJhY3RGb3JlaWduQ3VycmVuY3lCYWxhbmNlKHJvd3MpLFxuICAgICAgdHhuczogY29udmVydEZvcmVpZ25DdXJyZW5jeVRyYW5zYWN0aW9ucyhzY3JhcGVkLCBjdXJyZW5jeSwgb3B0aW9ucyksXG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gYWNjb3VudHM7XG59XG5cbnR5cGUgU2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHMgPSB7XG4gIHVzZXJuYW1lOiBzdHJpbmc7XG4gIHBhc3N3b3JkOiBzdHJpbmc7XG4gIC8vIENvbmZpZy1vbmx5IGZpZWxkIChtb25leW1hbik6IHRoZSBiYXNlIGFjY291bnQgdGhpcyBsb2dpbiBpcyBleHBlY3RlZCB0b1xuICAvLyBsYW5kIG9uIChlLmcuIFwiMDM4LTMyOTE0MlwiKS4gUHJlc2VuY2Ugb3B0cyB0aGUgbG9naW4gaW50byB0aGUgRkMgcGFzcyBhbmQgaXNcbiAgLy8gdmVyaWZpZWQgcmVhZC1vbmx5IGFnYWluc3QgdGhlIGFjY291bnQgc3dpdGNoZXIuIElnbm9yZWQgYnkgbG9naW4gaXRzZWxmLlxuICBleHBlY3RlZEZvcmVpZ25DdXJyZW5jeUFjY291bnQ/OiBzdHJpbmc7XG59O1xuXG5jbGFzcyBCZWlubGV1bWlHcm91cEJhc2VTY3JhcGVyIGV4dGVuZHMgQmFzZVNjcmFwZXJXaXRoQnJvd3NlcjxTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscz4ge1xuICBCQVNFX1VSTCA9ICcnO1xuXG4gIExPR0lOX1VSTCA9ICcnO1xuXG4gIFRSQU5TQUNUSU9OU19VUkwgPSAnJztcblxuICAvLyBFbXB0eSBieSBkZWZhdWx0IOKGkiB0aGUgRkMgcGFzcyBpcyBza2lwcGVkLiBPbmx5IHRoZSBCZWlubGV1bWkgKEZJQkkpIHN1YmNsYXNzXG4gIC8vIHNldHMgdGhpcyB0byB0aGUgZm9yZWlnbi1jdXJyZW5jeSBtb3ZlbWVudHMgcG9ydGFsIFVSTC5cbiAgRkNfVFJBTlNBQ1RJT05TX1VSTCA9ICcnO1xuXG4gIC8vIENhcHR1cmVkIGZyb20gY3JlZGVudGlhbHMgaW4gZ2V0TG9naW5PcHRpb25zOyBnYXRlcyArIGd1YXJkcyB0aGUgRkMgcGFzcy5cbiAgcHJpdmF0ZSBleHBlY3RlZEZvcmVpZ25DdXJyZW5jeUFjY291bnQ/OiBzdHJpbmc7XG5cbiAgZ2V0TG9naW5PcHRpb25zKGNyZWRlbnRpYWxzOiBTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscykge1xuICAgIHRoaXMuZXhwZWN0ZWRGb3JlaWduQ3VycmVuY3lBY2NvdW50ID0gY3JlZGVudGlhbHMuZXhwZWN0ZWRGb3JlaWduQ3VycmVuY3lBY2NvdW50O1xuICAgIHJldHVybiB7XG4gICAgICBsb2dpblVybDogYCR7dGhpcy5MT0dJTl9VUkx9YCxcbiAgICAgIGZpZWxkczogY3JlYXRlTG9naW5GaWVsZHMoY3JlZGVudGlhbHMpLFxuICAgICAgc3VibWl0QnV0dG9uU2VsZWN0b3I6ICcjY29udGludWVCdG4nLFxuICAgICAgcG9zdEFjdGlvbjogYXN5bmMgKCkgPT4gd2FpdEZvclBvc3RMb2dpbih0aGlzLnBhZ2UpLFxuICAgICAgcG9zc2libGVSZXN1bHRzOiBnZXRQb3NzaWJsZUxvZ2luUmVzdWx0cygpLFxuICAgICAgLy8gSEFDSzogRm9yIHNvbWUgcmVhc29uLCB0aG91Z2ggdGhlIGxvZ2luIGJ1dHRvbiAoI2NvbnRpbnVlQnRuKSBpcyBwcmVzZW50IGFuZCB2aXNpYmxlLCB0aGUgY2xpY2sgYWN0aW9uIGRvZXMgbm90IHBlcmZvcm0uXG4gICAgICAvLyBBZGRpbmcgdGhpcyBkZWxheSBmaXhlcyB0aGUgaXNzdWUuXG4gICAgICBwcmVBY3Rpb246IGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgc2xlZXAoMTAwMCk7XG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBhc3luYyBmZXRjaERhdGEoKSB7XG4gICAgY29uc3QgZGVmYXVsdFN0YXJ0TW9tZW50ID0gbW9tZW50KCkuc3VidHJhY3QoMSwgJ3llYXJzJykuYWRkKDEsICdkYXknKTtcbiAgICBjb25zdCBzdGFydE1vbWVudExpbWl0ID0gbW9tZW50KHsgeWVhcjogMTYwMCB9KTtcbiAgICBjb25zdCBzdGFydERhdGUgPSB0aGlzLm9wdGlvbnMuc3RhcnREYXRlIHx8IGRlZmF1bHRTdGFydE1vbWVudC50b0RhdGUoKTtcbiAgICBjb25zdCBzdGFydE1vbWVudCA9IG1vbWVudC5tYXgoc3RhcnRNb21lbnRMaW1pdCwgbW9tZW50KHN0YXJ0RGF0ZSkpO1xuXG4gICAgYXdhaXQgdGhpcy5uYXZpZ2F0ZVRvKHRoaXMuVFJBTlNBQ1RJT05TX1VSTCk7XG5cbiAgICBjb25zdCBhY2NvdW50cyA9IGF3YWl0IGZldGNoQWNjb3VudHModGhpcy5wYWdlLCBzdGFydE1vbWVudCwgdGhpcy5vcHRpb25zKTtcblxuICAgIC8vIFNlY29uZCBwYXNzIG9uIHRoZSBzYW1lIGxvZ2luOiBmb3JlaWduLWN1cnJlbmN5ICjXnteYXCLXlykgYWNjb3VudHMsIHdoaWNoIGxpdmVcbiAgICAvLyBpbiBhIHNlcGFyYXRlIHBvcnRhbCBzZWN0aW9uIHRoZSBOSVMgZmxvdyBuZXZlciB2aXNpdHMuIE9wdC1pbiArIGd1YXJkZWQgYnlcbiAgICAvLyBgZXhwZWN0ZWRGb3JlaWduQ3VycmVuY3lBY2NvdW50YDsgYSBuby1vcCB1bmxlc3MgdGhlIHN1YmNsYXNzIHNldHMgYW4gRkMgVVJMLlxuICAgIGlmICh0aGlzLkZDX1RSQU5TQUNUSU9OU19VUkwgJiYgdGhpcy5leHBlY3RlZEZvcmVpZ25DdXJyZW5jeUFjY291bnQpIHtcbiAgICAgIGF3YWl0IHRoaXMubmF2aWdhdGVUbyh0aGlzLkZDX1RSQU5TQUNUSU9OU19VUkwpO1xuICAgICAgY29uc3QgZmNBY2NvdW50cyA9IGF3YWl0IGZldGNoRm9yZWlnbkN1cnJlbmN5QWNjb3VudHMoXG4gICAgICAgIHRoaXMucGFnZSxcbiAgICAgICAgdGhpcy5leHBlY3RlZEZvcmVpZ25DdXJyZW5jeUFjY291bnQsXG4gICAgICAgIHN0YXJ0TW9tZW50LFxuICAgICAgICB0aGlzLm9wdGlvbnMsXG4gICAgICApO1xuICAgICAgYWNjb3VudHMucHVzaCguLi5mY0FjY291bnRzKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGFjY291bnRzLFxuICAgIH07XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgQmVpbmxldW1pR3JvdXBCYXNlU2NyYXBlcjtcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsSUFBQUEsT0FBQSxHQUFBQyxzQkFBQSxDQUFBQyxPQUFBO0FBRUEsSUFBQUMsVUFBQSxHQUFBRCxPQUFBO0FBQ0EsSUFBQUUscUJBQUEsR0FBQUYsT0FBQTtBQU9BLElBQUFHLE1BQUEsR0FBQUgsT0FBQTtBQUNBLElBQUFJLFdBQUEsR0FBQUosT0FBQTtBQUNBLElBQUFLLGFBQUEsR0FBQUwsT0FBQTtBQUNBLElBQUFNLFFBQUEsR0FBQU4sT0FBQTtBQUNBLElBQUFPLGNBQUEsR0FBQVAsT0FBQTtB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
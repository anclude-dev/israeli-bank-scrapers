"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _moment = _interopRequireDefault(require("moment"));
var _constants = require("../constants");
var _definitions = require("../definitions");
var _browser = require("../helpers/browser");
var _dates = _interopRequireDefault(require("../helpers/dates"));
var _debug = require("../helpers/debug");
var _fetch = require("../helpers/fetch");
var _arrays = require("../helpers/arrays");
var _transactions = require("../helpers/transactions");
var _waiting = require("../helpers/waiting");
var _transactions2 = require("../transactions");
var _baseScraperWithBrowser = require("./base-scraper-with-browser");
var _errors = require("./errors");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const RATE_LIMIT = {
  SLEEP_BETWEEN: 2500,
  // Sweet spot: 2.5s base delay (randomized up to 3s)
  TRANSACTIONS_BATCH_SIZE: 10
};
const COUNTRY_CODE = '212';
const ID_TYPE = '1';
const INSTALLMENTS_KEYWORD = 'תשלום';
const DATE_FORMAT = 'DD/MM/YYYY';
const debug = (0, _debug.getDebug)('base-isracard-amex');
function getAccountsUrl(servicesUrl, monthMoment) {
  const billingDate = monthMoment.format('YYYY-MM-DD');
  const url = new URL(servicesUrl);
  url.searchParams.set('reqName', 'DashboardMonth');
  url.searchParams.set('actionCode', '0');
  url.searchParams.set('billingDate', billingDate);
  url.searchParams.set('format', 'Json');
  return url.toString();
}
async function fetchAccounts(page, servicesUrl, monthMoment) {
  const startTime = performance.now();
  const dataUrl = getAccountsUrl(servicesUrl, monthMoment);
  debug(`fetching accounts for ${monthMoment.format('YYYY-MM')} from ${dataUrl}`);
  await (0, _waiting.randomDelay)(RATE_LIMIT.SLEEP_BETWEEN, RATE_LIMIT.SLEEP_BETWEEN + 500);
  const dataResult = await (0, _fetch.fetchGetWithinPage)(page, dataUrl);
  debug(`Fetch for ${monthMoment.format('YYYY-MM')} completed in ${performance.now() - startTime}ms`);
  if (dataResult && dataResult.Header?.Status === '1' && dataResult.DashboardMonthBean) {
    const {
      cardsCharges
    } = dataResult.DashboardMonthBean;
    if (cardsCharges) {
      return cardsCharges.map(cardCharge => {
        return {
          index: parseInt(cardCharge.cardIndex, 10),
          accountNumber: cardCharge.cardNumber,
          processedDate: (0, _moment.default)(cardCharge.billingDate, DATE_FORMAT).toISOString()
        };
      });
    }
  }
  return [];
}
function getTransactionsUrl(servicesUrl, monthMoment) {
  const month = monthMoment.month() + 1;
  const year = monthMoment.year();
  const monthStr = month < 10 ? `0${month}` : month.toString();
  const url = new URL(servicesUrl);
  url.searchParams.set('reqName', 'CardsTransactionsList');
  url.searchParams.set('month', monthStr);
  url.searchParams.set('year', `${year}`);
  url.searchParams.set('requiredDate', 'N');
  return url.toString();
}
function convertCurrency(currencyStr) {
  if (currencyStr === _constants.SHEKEL_CURRENCY_KEYWORD || currencyStr === _constants.ALT_SHEKEL_CURRENCY) {
    return _constants.SHEKEL_CURRENCY;
  }
  return currencyStr;
}
function getInstallmentsInfo(txn) {
  if (!txn.moreInfo || !txn.moreInfo.includes(INSTALLMENTS_KEYWORD)) {
    return undefined;
  }
  const matches = txn.moreInfo.match(/\d+/g);
  if (!matches || matches.length < 2) {
    return undefined;
  }
  return {
    number: parseInt(matches[0], 10),
    total: parseInt(matches[1], 10)
  };
}
function getTransactionType(txn) {
  return getInstallmentsInfo(txn) ? _transactions2.TransactionTypes.Installments : _transactions2.TransactionTypes.Normal;
}
function convertTransactions(txns, processedDate, options) {
  const filteredTxns = txns.filter(txn => txn.dealSumType !== '1' && txn.voucherNumberRatz !== '000000000' && txn.voucherNumberRatzOutbound !== '000000000');
  return filteredTxns.map(txn => {
    const isOutbound = txn.dealSumOutbound;
    const txnDateStr = isOutbound ? txn.fullPurchaseDateOutbound : txn.fullPurchaseDate;
    const txnMoment = (0, _moment.default)(txnDateStr, DATE_FORMAT);
    const currentProcessedDate = txn.fullPaymentDate ? (0, _moment.default)(txn.fullPaymentDate, DATE_FORMAT).toISOString() : processedDate;
    const result = {
      type: getTransactionType(txn),
      identifier: parseInt(isOutbound ? txn.voucherNumberRatzOutbound : txn.voucherNumberRatz, 10),
      date: txnMoment.toISOString(),
      processedDate: currentProcessedDate,
      originalAmount: isOutbound ? -txn.dealSumOutbound : -txn.dealSum,
      originalCurrency: convertCurrency(txn.currentPaymentCurrency ?? txn.currencyId),
      chargedAmount: isOutbound ? -txn.paymentSumOutbound : -txn.paymentSum,
      chargedCurrency: convertCurrency(txn.currencyId),
      description: isOutbound ? txn.fullSupplierNameOutbound : txn.fullSupplierNameHeb,
      memo: txn.moreInfo || '',
      installments: getInstallmentsInfo(txn) || undefined,
      status: _transactions2.TransactionStatuses.Completed
    };
    if (options?.includeRawTransaction) {
      result.rawTransaction = (0, _transactions.getRawTransaction)(txn);
    }
    return result;
  });
}
async function fetchTransactions(page, options, companyServiceOptions, startMoment, monthMoment) {
  const startTime = performance.now();
  const accounts = await fetchAccounts(page, companyServiceOptions.servicesUrl, monthMoment);
  const dataUrl = getTransactionsUrl(companyServiceOptions.servicesUrl, monthMoment);
  debug(`fetching transactions for ${monthMoment.format('YYYY-MM')} from ${dataUrl}`);
  await (0, _waiting.randomDelay)(RATE_LIMIT.SLEEP_BETWEEN, RATE_LIMIT.SLEEP_BETWEEN + 500);
  const dataResult = await (0, _fetch.fetchGetWithinPage)(page, dataUrl);
  debug(`Fetch for ${monthMoment.format('YYYY-MM')} completed in ${performance.now() - startTime}ms`);
  if (dataResult && dataResult.Header?.Status === '1' && dataResult.CardsTransactionsListBean) {
    const accountTxns = {};
    accounts.forEach(account => {
      const txnGroups = dataResult.CardsTransactionsListBean?.[`Index${account.index}`]?.CurrentCardTransactions;
      if (txnGroups) {
        let allTxns = [];
        txnGroups.forEach(txnGroup => {
          if (txnGroup.txnIsrael) {
            const txns = convertTransactions(txnGroup.txnIsrael, account.processedDate, options);
            allTxns.push(...txns);
          }
          if (txnGroup.txnAbroad) {
            const txns = convertTransactions(txnGroup.txnAbroad, account.processedDate, options);
            allTxns.push(...txns);
          }
        });
        if (!options.combineInstallments) {
          allTxns = (0, _transactions.fixInstallments)(allTxns);
        }
        if (options.outputData?.enableTransactionsFilterByDate ?? true) {
          allTxns = (0, _transactions.filterOldTransactions)(allTxns, startMoment, options.combineInstallments || false);
        }
        accountTxns[account.accountNumber] = {
          accountNumber: account.accountNumber,
          index: account.index,
          txns: allTxns
        };
      }
    });
    return accountTxns;
  }
  return {};
}
async function getExtraScrapTransaction(page, options, month, accountIndex, transaction) {
  const url = new URL(options.servicesUrl);
  url.searchParams.set('reqName', 'PirteyIska_204');
  url.searchParams.set('CardIndex', accountIndex.toString());
  url.searchParams.set('shovarRatz', transaction.identifier.toString());
  url.searchParams.set('moedChiuv', month.format('MMYYYY'));
  debug(`fetching extra scrap for transaction ${transaction.identifier} for month ${month.format('YYYY-MM')}`);
  const data = await (0, _fetch.fetchGetWithinPage)(page, url.toString());
  if (!data) {
    return transaction;
  }
  const rawCategory = data.PirteyIska_204Bean?.sector ?? '';
  return {
    ...transaction,
    category: rawCategory.trim(),
    rawTransaction: (0, _transactions.getRawTransaction)(data, transaction)
  };
}
async function getExtraScrapAccount(page, options, accountMap, month) {
  const accounts = [];
  for (const account of Object.values(accountMap)) {
    debug(`get extra scrap for ${account.accountNumber} with ${account.txns.length} transactions`, month.format('YYYY-MM'));
    const txns = [];
    for (const txnsChunk of (0, _arrays.chunk)(account.txns, RATE_LIMIT.TRANSACTIONS_BATCH_SIZE)) {
      debug(`processing chunk of ${txnsChunk.length} transactions for account ${account.accountNumber}`);
      const updatedTxns = await Promise.all(txnsChunk.map(t => getExtraScrapTransaction(page, options, month, account.index, t)));
      await (0, _waiting.sleep)(RATE_LIMIT.SLEEP_BETWEEN);
      txns.push(...updatedTxns);
    }
    accounts.push({
      ...account,
      txns
    });
  }
  return accounts.reduce((m, x) => ({
    ...m,
    [x.accountNumber]: x
  }), {});
}
async function getAdditionalTransactionInformation(scraperOptions, accountsWithIndex, page, options, allMonths) {
  if (!scraperOptions.additionalTransactionInformation || scraperOptions.optInFeatures?.includes('isracard-amex:skipAdditionalTransactionInformation')) {
    return accountsWithIndex;
  }
  return (0, _waiting.runSerial)(accountsWithIndex.map((a, i) => () => getExtraScrapAccount(page, options, a, allMonths[i])));
}
async function fetchAllTransactions(page, options, companyServiceOptions, startMoment) {
  const fetchStartTime = performance.now();
  const futureMonthsToScrape = options.futureMonthsToScrape ?? 1;
  const allMonths = (0, _dates.default)(startMoment, futureMonthsToScrape);
  debug(`Fetching transactions for ${allMonths.length} months`);
  const results = await (0, _waiting.runSerial)(allMonths.map(monthMoment => () => {
    return fetchTransactions(page, options, companyServiceOptions, startMoment, monthMoment);
  }));
  const finalResult = await getAdditionalTransactionInformation(options, results, page, companyServiceOptions, allMonths);
  const combinedTxns = {};
  finalResult.forEach(result => {
    Object.keys(result).forEach(accountNumber => {
      let txnsForAccount = combinedTxns[accountNumber];
      if (!txnsForAccount) {
        txnsForAccount = [];
        combinedTxns[accountNumber] = txnsForAccount;
      }
      const toBeAddedTxns = result[accountNumber].txns;
      combinedTxns[accountNumber].push(...toBeAddedTxns);
    });
  });
  const accounts = Object.keys(combinedTxns).map(accountNumber => {
    return {
      accountNumber,
      txns: combinedTxns[accountNumber]
    };
  });
  debug(`fetchAllTransactions completed in ${performance.now() - fetchStartTime}ms`);
  return {
    success: true,
    accounts
  };
}
class IsracardAmexBaseScraper extends _baseScraperWithBrowser.BaseScraperWithBrowser {
  constructor(options, baseUrl, companyCode) {
    super(options);
    this.baseUrl = baseUrl;
    this.companyCode = companyCode;
    this.servicesUrl = `${baseUrl}/services/ProxyRequestHandler.ashx`;
  }
  async login(credentials) {
    const loginStartTime = performance.now();
    await this.page.setRequestInterception(true);
    this.page.on('request', request => {
      if (request.url().includes('detector-dom.min.js')) {
        debug('force abort for request do download detector-dom.min.js resource');
        void request.abort(undefined, _browser.interceptionPriorities.abort);
      } else {
        void request.continue(undefined, _browser.interceptionPriorities.continue);
      }
    });
    await (0, _browser.maskHeadlessUserAgent)(this.page);
    await this.navigateTo(`${this.baseUrl}/personalarea/Login`);
    this.emitProgress(_definitions.ScraperProgressTypes.LoggingIn);
    const validateUrl = `${this.servicesUrl}?reqName=ValidateIdData`;
    const validateRequest = {
      id: credentials.id,
      cardSuffix: credentials.card6Digits,
      countryCode: COUNTRY_CODE,
      idType: ID_TYPE,
      checkLevel: '1',
      companyCode: this.companyCode
    };
    debug('logging in with validate request');
    const validateResult = await (0, _fetch.fetchPostWithinPage)(this.page, validateUrl, validateRequest);
    if (!validateResult || !validateResult.Header || validateResult.Header.Status !== '1' || !validateResult.ValidateIdDataBean) {
      throw new Error('unknown error during login');
    }
    const validateReturnCode = validateResult.ValidateIdDataBean.returnCode;
    debug(`user validate with return code '${validateReturnCode}'`);
    if (validateReturnCode === '1') {
      const {
        userName
      } = validateResult.ValidateIdDataBean;
      const loginUrl = `${this.servicesUrl}?reqName=performLogonI`;
      const request = {
        KodMishtamesh: userName,
        MisparZihuy: credentials.id,
        Sisma: credentials.password,
        cardSuffix: credentials.card6Digits,
        countryCode: COUNTRY_CODE,
        idType: ID_TYPE
      };
      debug('user login started');
      const loginResult = await (0, _fetch.fetchPostWithinPage)(this.page, loginUrl, request);
      debug(`user login with status '${loginResult?.status}'`, loginResult);
      if (loginResult && loginResult.status === '1') {
        this.emitProgress(_definitions.ScraperProgressTypes.LoginSuccess);
        debug(`Login completed in ${performance.now() - loginStartTime}ms`);
        return {
          success: true
        };
      }
      if (loginResult && loginResult.status === '3') {
        this.emitProgress(_definitions.ScraperProgressTypes.ChangePassword);
        return {
          success: false,
          errorType: _errors.ScraperErrorTypes.ChangePassword
        };
      }
      this.emitProgress(_definitions.ScraperProgressTypes.LoginFailed);
      return {
        success: false,
        errorType: _errors.ScraperErrorTypes.InvalidPassword
      };
    }
    if (validateReturnCode === '4') {
      this.emitProgress(_definitions.ScraperProgressTypes.ChangePassword);
      return {
        success: false,
        errorType: _errors.ScraperErrorTypes.ChangePassword
      };
    }
    this.emitProgress(_definitions.ScraperProgressTypes.LoginFailed);
    return {
      success: false,
      errorType: _errors.ScraperErrorTypes.InvalidPassword
    };
  }
  async fetchData() {
    const defaultStartMoment = (0, _moment.default)().subtract(1, 'years');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = _moment.default.max(defaultStartMoment, (0, _moment.default)(startDate));
    return fetchAllTransactions(this.page, this.options, {
      servicesUrl: this.servicesUrl,
      companyCode: this.companyCode
    }, startMoment);
  }
}
var _default = exports.default = IsracardAmexBaseScraper;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbW9tZW50IiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfY29uc3RhbnRzIiwiX2RlZmluaXRpb25zIiwiX2Jyb3dzZXIiLCJfZGF0ZXMiLCJfZGVidWciLCJfZmV0Y2giLCJfYXJyYXlzIiwiX3RyYW5zYWN0aW9ucyIsIl93YWl0aW5nIiwiX3RyYW5zYWN0aW9uczIiLCJfYmFzZVNjcmFwZXJXaXRoQnJvd3NlciIsIl9lcnJvcnMiLCJlIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJSQVRFX0xJTUlUIiwiU0xFRVBfQkVUV0VFTiIsIlRSQU5TQUNUSU9OU19CQVRDSF9TSVpFIiwiQ09VTlRSWV9DT0RFIiwiSURfVFlQRSIsIklOU1RBTExNRU5UU19LRVlXT1JEIiwiREFURV9GT1JNQVQiLCJkZWJ1ZyIsImdldERlYnVnIiwiZ2V0QWNjb3VudHNVcmwiLCJzZXJ2aWNlc1VybCIsIm1vbnRoTW9tZW50IiwiYmlsbGluZ0RhdGUiLCJmb3JtYXQiLCJ1cmwiLCJVUkwiLCJzZWFyY2hQYXJhbXMiLCJzZXQiLCJ0b1N0cmluZyIsImZldGNoQWNjb3VudHMiLCJwYWdlIiwic3RhcnRUaW1lIiwicGVyZm9ybWFuY2UiLCJub3ciLCJkYXRhVXJsIiwicmFuZG9tRGVsYXkiLCJkYXRhUmVzdWx0IiwiZmV0Y2hHZXRXaXRoaW5QYWdlIiwiSGVhZGVyIiwiU3RhdHVzIiwiRGFzaGJvYXJkTW9udGhCZWFuIiwiY2FyZHNDaGFyZ2VzIiwibWFwIiwiY2FyZENoYXJnZSIsImluZGV4IiwicGFyc2VJbnQiLCJjYXJkSW5kZXgiLCJhY2NvdW50TnVtYmVyIiwiY2FyZE51bWJlciIsInByb2Nlc3NlZERhdGUiLCJtb21lbnQiLCJ0b0lTT1N0cmluZyIsImdldFRyYW5zYWN0aW9uc1VybCIsIm1vbnRoIiwieWVhciIsIm1vbnRoU3RyIiwiY29udmVydEN1cnJlbmN5IiwiY3VycmVuY3lTdHIiLCJTSEVLRUxfQ1VSUkVOQ1lfS0VZV09SRCIsIkFMVF9TSEVLRUxfQ1VSUkVOQ1kiLCJTSEVLRUxfQ1VSUkVOQ1kiLCJnZXRJbnN0YWxsbWVudHNJbmZvIiwidHhuIiwibW9yZUluZm8iLCJpbmNsdWRlcyIsInVuZGVmaW5lZCIsIm1hdGNoZXMiLCJtYXRjaCIsImxlbmd0aCIsIm51bWJlciIsInRvdGFsIiwiZ2V0VHJhbnNhY3Rpb25UeXBlIiwiVHJhbnNhY3Rpb25UeXBlcyIsIkluc3RhbGxtZW50cyIsIk5vcm1hbCIsImNvbnZlcnRUcmFuc2FjdGlvbnMiLCJ0eG5zIiwib3B0aW9ucyIsImZpbHRlcmVkVHhucyIsImZpbHRlciIsImRlYWxTdW1UeXBlIiwidm91Y2hlck51bWJlclJhdHoiLCJ2b3VjaGVyTnVtYmVyUmF0ek91dGJvdW5kIiwiaXNPdXRib3VuZCIsImRlYWxTdW1PdXRib3VuZCIsInR4bkRhdGVTdHIiLCJmdWxsUHVyY2hhc2VEYXRlT3V0Ym91bmQiLCJmdWxsUHVyY2hhc2VEYXRlIiwidHhuTW9tZW50IiwiY3VycmVudFByb2Nlc3NlZERhdGUiLCJmdWxsUGF5bWVudERhdGUiLCJyZXN1bHQiLCJ0eXBlIiwiaWRlbnRpZmllciIsImRhdGUiLCJvcmlnaW5hbEFtb3VudCIsImRlYWxTdW0iLCJvcmlnaW5hbEN1cnJlbmN5IiwiY3VycmVudFBheW1lbnRDdXJyZW5jeSIsImN1cnJlbmN5SWQiLCJjaGFyZ2VkQW1vdW50IiwicGF5bWVudFN1bU91dGJvdW5kIiwicGF5bWVudFN1bSIsImNoYXJnZWRDdXJyZW5jeSIsImRlc2NyaXB0aW9uIiwiZnVsbFN1cHBsaWVyTmFtZU91dGJvdW5kIiwiZnVsbFN1cHBsaWVyTmFtZUhlYiIsIm1lbW8iLCJpbnN0YWxsbWVudHMiLCJzdGF0dXMiLCJUcmFuc2FjdGlvblN0YXR1c2VzIiwiQ29tcGxldGVkIiwiaW5jbHVkZVJhd1RyYW5zYWN0aW9uIiwicmF3VHJhbnNhY3Rpb24iLCJnZXRSYXdUcmFuc2FjdGlvbiIsImZldGNoVHJhbnNhY3Rpb25zIiwiY29tcGFueVNlcnZpY2VPcHRpb25zIiwic3RhcnRNb21lbnQiLCJhY2NvdW50cyIsIkNhcmRzVHJhbnNhY3Rpb25zTGlzdEJlYW4iLCJhY2NvdW50VHhucyIsImZvckVhY2giLCJhY2NvdW50IiwidHhuR3JvdXBzIiwiQ3VycmVudENhcmRUcmFuc2FjdGlvbnMiLCJhbGxUeG5zIiwidHhuR3JvdXAiLCJ0eG5Jc3JhZWwiLCJwdXNoIiwidHhuQWJyb2FkIiwiY29tYmluZUluc3RhbGxtZW50cyIsImZpeEluc3RhbGxtZW50cyIsIm91dHB1dERhdGEiLCJlbmFibGVUcmFuc2FjdGlvbnNGaWx0ZXJCeURhdGUiLCJmaWx0ZXJPbGRUcmFuc2FjdGlvbnMiLCJnZXRFeHRyYVNjcmFwVHJhbnNhY3Rpb24iLCJhY2NvdW50SW5kZXgiLCJ0cmFuc2FjdGlvbiIsImRhdGEiLCJyYXdDYXRlZ29yeSIsIlBpcnRleUlza2FfMjA0QmVhbiIsInNlY3RvciIsImNhdGVnb3J5IiwidHJpbSIsImdldEV4dHJhU2NyYXBBY2NvdW50IiwiYWNjb3VudE1hcCIsIk9iamVjdCIsInZhbHVlcyIsInR4bnNDaHVuayIsImNodW5rIiwidXBkYXRlZFR4bnMiLCJQcm9taXNlIiwiYWxsIiwidCIsInNsZWVwIiwicmVkdWNlIiwibSIsIngiLCJnZXRBZGRpdGlvbmFsVHJhbnNhY3Rpb25JbmZvcm1hdGlvbiIsInNjcmFwZXJPcHRpb25zIiwiYWNjb3VudHNXaXRoSW5kZXgiLCJhbGxNb250aHMiLCJhZGRpdGlvbmFsVHJhbnNhY3Rpb25JbmZvcm1hdGlvbiIsIm9wdEluRmVhdHVyZXMiLCJydW5TZXJpYWwiLCJhIiwiaSIsImZldGNoQWxsVHJhbnNhY3Rpb25zIiwiZmV0Y2hTdGFydFRpbWUiLCJmdXR1cmVNb250aHNUb1NjcmFwZSIsImdldEFsbE1vbnRoTW9tZW50cyIsInJlc3VsdHMiLCJmaW5hbFJlc3VsdCIsImNvbWJpbmVkVHhucyIsImtleXMiLCJ0eG5zRm9yQWNjb3VudCIsInRvQmVBZGRlZFR4bnMiLCJzdWNjZXNzIiwiSXNyYWNhcmRBbWV4QmFzZVNjcmFwZXIiLCJCYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiY29uc3RydWN0b3IiLCJiYXNlVXJsIiwiY29tcGFueUNvZGUiLCJsb2dpbiIsImNyZWRlbnRpYWxzIiwibG9naW5TdGFydFRpbWUiLCJzZXRSZXF1ZXN0SW50ZXJjZXB0aW9uIiwib24iLCJyZXF1ZXN0IiwiYWJvcnQiLCJpbnRlcmNlcHRpb25Qcmlvcml0aWVzIiwiY29udGludWUiLCJtYXNrSGVhZGxlc3NVc2VyQWdlbnQiLCJuYXZpZ2F0ZVRvIiwiZW1pdFByb2dyZXNzIiwiU2NyYXBlclByb2dyZXNzVHlwZXMiLCJMb2dnaW5nSW4iLCJ2YWxpZGF0ZVVybCIsInZhbGlkYXRlUmVxdWVzdCIsImlkIiwiY2FyZFN1ZmZpeCIsImNhcmQ2RGlnaXRzIiwiY291bnRyeUNvZGUiLCJpZFR5cGUiLCJjaGVja0xldmVsIiwidmFsaWRhdGVSZXN1bHQiLCJmZXRjaFBvc3RXaXRoaW5QYWdlIiwiVmFsaWRhdGVJZERhdGFCZWFuIiwiRXJyb3IiLCJ2YWxpZGF0ZVJldHVybkNvZGUiLCJyZXR1cm5Db2RlIiwidXNlck5hbWUiLCJsb2dpblVybCIsIktvZE1pc2h0YW1lc2giLCJNaXNwYXJaaWh1eSIsIlNpc21hIiwicGFzc3dvcmQiLCJsb2dpblJlc3VsdCIsIkxvZ2luU3VjY2VzcyIsIkNoYW5nZVBhc3N3b3JkIiwiZXJyb3JUeXBlIiwiU2NyYXBlckVycm9yVHlwZXMiLCJMb2dpbkZhaWxlZCIsIkludmFsaWRQYXNzd29yZCIsImZldGNoRGF0YSIsImRlZmF1bHRTdGFydE1vbWVudCIsInN1YnRyYWN0Iiwic3RhcnREYXRlIiwidG9EYXRlIiwibWF4IiwiX2RlZmF1bHQiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vc3JjL3NjcmFwZXJzL2Jhc2UtaXNyYWNhcmQtYW1leC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgbW9tZW50LCB7IHR5cGUgTW9tZW50IH0gZnJvbSAnbW9tZW50JztcbmltcG9ydCB7IHR5cGUgUGFnZSB9IGZyb20gJ3B1cHBldGVlcic7XG5pbXBvcnQgeyBBTFRfU0hFS0VMX0NVUlJFTkNZLCBTSEVLRUxfQ1VSUkVOQ1ksIFNIRUtFTF9DVVJSRU5DWV9LRVlXT1JEIH0gZnJvbSAnLi4vY29uc3RhbnRzJztcbmltcG9ydCB7IFNjcmFwZXJQcm9ncmVzc1R5cGVzIH0gZnJvbSAnLi4vZGVmaW5pdGlvbnMnO1xuaW1wb3J0IHsgaW50ZXJjZXB0aW9uUHJpb3JpdGllcywgbWFza0hlYWRsZXNzVXNlckFnZW50IH0gZnJvbSAnLi4vaGVscGVycy9icm93c2VyJztcbmltcG9ydCBnZXRBbGxNb250aE1vbWVudHMgZnJvbSAnLi4vaGVscGVycy9kYXRlcyc7XG5pbXBvcnQgeyBnZXREZWJ1ZyB9IGZyb20gJy4uL2hlbHBlcnMvZGVidWcnO1xuaW1wb3J0IHsgZmV0Y2hHZXRXaXRoaW5QYWdlLCBmZXRjaFBvc3RXaXRoaW5QYWdlIH0gZnJvbSAnLi4vaGVscGVycy9mZXRjaCc7XG5pbXBvcnQgeyBjaHVuayB9IGZyb20gJy4uL2hlbHBlcnMvYXJyYXlzJztcbmltcG9ydCB7IGZpbHRlck9sZFRyYW5zYWN0aW9ucywgZml4SW5zdGFsbG1lbnRzLCBnZXRSYXdUcmFuc2FjdGlvbiB9IGZyb20gJy4uL2hlbHBlcnMvdHJhbnNhY3Rpb25zJztcbmltcG9ydCB7IHJhbmRvbURlbGF5LCBydW5TZXJpYWwsIHNsZWVwIH0gZnJvbSAnLi4vaGVscGVycy93YWl0aW5nJztcbmltcG9ydCB7XG4gIFRyYW5zYWN0aW9uU3RhdHVzZXMsXG4gIFRyYW5zYWN0aW9uVHlwZXMsXG4gIHR5cGUgVHJhbnNhY3Rpb24sXG4gIHR5cGUgVHJhbnNhY3Rpb25JbnN0YWxsbWVudHMsXG4gIHR5cGUgVHJhbnNhY3Rpb25zQWNjb3VudCxcbn0gZnJvbSAnLi4vdHJhbnNhY3Rpb25zJztcbmltcG9ydCB7IEJhc2VTY3JhcGVyV2l0aEJyb3dzZXIgfSBmcm9tICcuL2Jhc2Utc2NyYXBlci13aXRoLWJyb3dzZXInO1xuaW1wb3J0IHsgU2NyYXBlckVycm9yVHlwZXMgfSBmcm9tICcuL2Vycm9ycyc7XG5pbXBvcnQgeyB0eXBlIFNjcmFwZXJPcHRpb25zLCB0eXBlIFNjcmFwZXJTY3JhcGluZ1Jlc3VsdCB9IGZyb20gJy4vaW50ZXJmYWNlJztcblxuY29uc3QgUkFURV9MSU1JVCA9IHtcbiAgU0xFRVBfQkVUV0VFTjogMjUwMCwgLy8gU3dlZXQgc3BvdDogMi41cyBiYXNlIGRlbGF5IChyYW5kb21pemVkIHVwIHRvIDNzKVxuICBUUkFOU0FDVElPTlNfQkFUQ0hfU0laRTogMTAsXG59IGFzIGNvbnN0O1xuXG5jb25zdCBDT1VOVFJZX0NPREUgPSAnMjEyJztcbmNvbnN0IElEX1RZUEUgPSAnMSc7XG5jb25zdCBJTlNUQUxMTUVOVFNfS0VZV09SRCA9ICfXqtep15zXldedJztcblxuY29uc3QgREFURV9GT1JNQVQgPSAnREQvTU0vWVlZWSc7XG5cbmNvbnN0IGRlYnVnID0gZ2V0RGVidWcoJ2Jhc2UtaXNyYWNhcmQtYW1leCcpO1xuXG50eXBlIENvbXBhbnlTZXJ2aWNlT3B0aW9ucyA9IHtcbiAgc2VydmljZXNVcmw6IHN0cmluZztcbiAgY29tcGFueUNvZGU6IHN0cmluZztcbn07XG5cbnR5cGUgU2NyYXBlZEFjY291bnRzV2l0aEluZGV4ID0gUmVjb3JkPHN0cmluZywgVHJhbnNhY3Rpb25zQWNjb3VudCAmIHsgaW5kZXg6IG51bWJlciB9PjtcblxuaW50ZXJmYWNlIFNjcmFwZWRUcmFuc2FjdGlvbiB7XG4gIGRlYWxTdW1UeXBlOiBzdHJpbmc7XG4gIHZvdWNoZXJOdW1iZXJSYXR6T3V0Ym91bmQ6IHN0cmluZztcbiAgdm91Y2hlck51bWJlclJhdHo6IHN0cmluZztcbiAgbW9yZUluZm8/OiBzdHJpbmc7XG4gIGRlYWxTdW1PdXRib3VuZDogYm9vbGVhbjtcbiAgY3VycmVuY3lJZDogc3RyaW5nO1xuICBjdXJyZW50UGF5bWVudEN1cnJlbmN5OiBzdHJpbmc7XG4gIGRlYWxTdW06IG51bWJlcjtcbiAgZnVsbFBheW1lbnREYXRlPzogc3RyaW5nO1xuICBmdWxsUHVyY2hhc2VEYXRlPzogc3RyaW5nO1xuICBmdWxsUHVyY2hhc2VEYXRlT3V0Ym91bmQ/OiBzdHJpbmc7XG4gIGZ1bGxTdXBwbGllck5hbWVIZWI6IHN0cmluZztcbiAgZnVsbFN1cHBsaWVyTmFtZU91dGJvdW5kOiBzdHJpbmc7XG4gIHBheW1lbnRTdW06IG51bWJlcjtcbiAgcGF5bWVudFN1bU91dGJvdW5kOiBudW1iZXI7XG59XG5cbmludGVyZmFjZSBTY3JhcGVkQWNjb3VudCB7XG4gIGluZGV4OiBudW1iZXI7XG4gIGFjY291bnROdW1iZXI6IHN0cmluZztcbiAgcHJvY2Vzc2VkRGF0ZTogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgU2NyYXBlZExvZ2luVmFsaWRhdGlvbiB7XG4gIEhlYWRlcjoge1xuICAgIFN0YXR1czogc3RyaW5nO1xuICB9O1xuICBWYWxpZGF0ZUlkRGF0YUJlYW4/OiB7XG4gICAgdXNlck5hbWU/OiBzdHJpbmc7XG4gICAgcmV0dXJuQ29kZTogc3RyaW5nO1xuICB9O1xufVxuXG5pbnRlcmZhY2UgU2NyYXBlZEFjY291bnRzV2l0aGluUGFnZVJlc3BvbnNlIHtcbiAgSGVhZGVyOiB7XG4gICAgU3RhdHVzOiBzdHJpbmc7XG4gIH07XG4gIERhc2hib2FyZE1vbnRoQmVhbj86IHtcbiAgICBjYXJkc0NoYXJnZXM6IHtcbiAgICAgIGNhcmRJbmRleDogc3RyaW5nO1xuICAgICAgY2FyZE51bWJlcjogc3RyaW5nO1xuICAgICAgYmlsbGluZ0RhdGU6IHN0cmluZztcbiAgICB9W107XG4gIH07XG59XG5cbmludGVyZmFjZSBTY3JhcGVkQ3VycmVudENhcmRUcmFuc2FjdGlvbnMge1xuICB0eG5Jc3JhZWw/OiBTY3JhcGVkVHJhbnNhY3Rpb25bXTtcbiAgdHhuQWJyb2FkPzogU2NyYXBlZFRyYW5zYWN0aW9uW107XG59XG5cbmludGVyZmFjZSBTY3JhcGVkVHJhbnNhY3Rpb25EYXRhIHtcbiAgSGVhZGVyPzoge1xuICAgIFN0YXR1czogc3RyaW5nO1xuICB9O1xuICBQaXJ0ZXlJc2thXzIwNEJlYW4/OiB7XG4gICAgc2VjdG9yOiBzdHJpbmc7XG4gIH07XG5cbiAgQ2FyZHNUcmFuc2FjdGlvbnNMaXN0QmVhbj86IFJlY29yZDxcbiAgICBzdHJpbmcsXG4gICAge1xuICAgICAgQ3VycmVudENhcmRUcmFuc2FjdGlvbnM6IFNjcmFwZWRDdXJyZW50Q2FyZFRyYW5zYWN0aW9uc1tdO1xuICAgIH1cbiAgPjtcbn1cblxuZnVuY3Rpb24gZ2V0QWNjb3VudHNVcmwoc2VydmljZXNVcmw6IHN0cmluZywgbW9udGhNb21lbnQ6IE1vbWVudCkge1xuICBjb25zdCBiaWxsaW5nRGF0ZSA9IG1vbnRoTW9tZW50LmZvcm1hdCgnWVlZWS1NTS1ERCcpO1xuICBjb25zdCB1cmwgPSBuZXcgVVJMKHNlcnZpY2VzVXJsKTtcbiAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ3JlcU5hbWUnLCAnRGFzaGJvYXJkTW9udGgnKTtcbiAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ2FjdGlvbkNvZGUnLCAnMCcpO1xuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnYmlsbGluZ0RhdGUnLCBiaWxsaW5nRGF0ZSk7XG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCdmb3JtYXQnLCAnSnNvbicpO1xuICByZXR1cm4gdXJsLnRvU3RyaW5nKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoQWNjb3VudHMocGFnZTogUGFnZSwgc2VydmljZXNVcmw6IHN0cmluZywgbW9udGhNb21lbnQ6IE1vbWVudCk6IFByb21pc2U8U2NyYXBlZEFjY291bnRbXT4ge1xuICBjb25zdCBzdGFydFRpbWUgPSBwZXJmb3JtYW5jZS5ub3coKTtcbiAgY29uc3QgZGF0YVVybCA9IGdldEFjY291bnRzVXJsKHNlcnZpY2VzVXJsLCBtb250aE1vbWVudCk7XG5cbiAgZGVidWcoYGZldGNoaW5nIGFjY291bnRzIGZvciAke21vbnRoTW9tZW50LmZvcm1hdCgnWVlZWS1NTScpfSBmcm9tICR7ZGF0YVVybH1gKTtcbiAgYXdhaXQgcmFuZG9tRGVsYXkoUkFURV9MSU1JVC5TTEVFUF9CRVRXRUVOLCBSQVRFX0xJTUlULlNMRUVQX0JFVFdFRU4gKyA1MDApO1xuICBjb25zdCBkYXRhUmVzdWx0ID0gYXdhaXQgZmV0Y2hHZXRXaXRoaW5QYWdlPFNjcmFwZWRBY2NvdW50c1dpdGhpblBhZ2VSZXNwb25zZT4ocGFnZSwgZGF0YVVybCk7XG4gIGRlYnVnKGBGZXRjaCBmb3IgJHttb250aE1vbWVudC5mb3JtYXQoJ1lZWVktTU0nKX0gY29tcGxldGVkIGluICR7cGVyZm9ybWFuY2Uubm93KCkgLSBzdGFydFRpbWV9bXNgKTtcblxuICBpZiAoZGF0YVJlc3VsdCAmJiBkYXRhUmVzdWx0LkhlYWRlcj8uU3RhdHVzID09PSAnMScgJiYgZGF0YVJlc3VsdC5EYXNoYm9hcmRNb250aEJlYW4pIHtcbiAgICBjb25zdCB7IGNhcmRzQ2hhcmdlcyB9ID0gZGF0YVJlc3VsdC5EYXNoYm9hcmRNb250aEJlYW47XG4gICAgaWYgKGNhcmRzQ2hhcmdlcykge1xuICAgICAgcmV0dXJuIGNhcmRzQ2hhcmdlcy5tYXAoY2FyZENoYXJnZSA9PiB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgaW5kZXg6IHBhcnNlSW50KGNhcmRDaGFyZ2UuY2FyZEluZGV4LCAxMCksXG4gICAgICAgICAgYWNjb3VudE51bWJlcjogY2FyZENoYXJnZS5jYXJkTnVtYmVyLFxuICAgICAgICAgIHByb2Nlc3NlZERhdGU6IG1vbWVudChjYXJkQ2hhcmdlLmJpbGxpbmdEYXRlLCBEQVRFX0ZPUk1BVCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICByZXR1cm4gW107XG59XG5cbmZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uc1VybChzZXJ2aWNlc1VybDogc3RyaW5nLCBtb250aE1vbWVudDogTW9tZW50KSB7XG4gIGNvbnN0IG1vbnRoID0gbW9udGhNb21lbnQubW9udGgoKSArIDE7XG4gIGNvbnN0IHllYXIgPSBtb250aE1vbWVudC55ZWFyKCk7XG4gIGNvbnN0IG1vbnRoU3RyID0gbW9udGggPCAxMCA/IGAwJHttb250aH1gIDogbW9udGgudG9TdHJpbmcoKTtcbiAgY29uc3QgdXJsID0gbmV3IFVSTChzZXJ2aWNlc1VybCk7XG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCdyZXFOYW1lJywgJ0NhcmRzVHJhbnNhY3Rpb25zTGlzdCcpO1xuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnbW9udGgnLCBtb250aFN0cik7XG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCd5ZWFyJywgYCR7eWVhcn1gKTtcbiAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ3JlcXVpcmVkRGF0ZScsICdOJyk7XG4gIHJldHVybiB1cmwudG9TdHJpbmcoKTtcbn1cblxuZnVuY3Rpb24gY29udmVydEN1cnJlbmN5KGN1cnJlbmN5U3RyOiBzdHJpbmcpIHtcbiAgaWYgKGN1cnJlbmN5U3RyID09PSBTSEVLRUxfQ1VSUkVOQ1lfS0VZV09SRCB8fCBjdXJyZW5jeVN0ciA9PT0gQUxUX1NIRUtFTF9DVVJSRU5DWSkge1xuICAgIHJldHVybiBTSEVLRUxfQ1VSUkVOQ1k7XG4gIH1cbiAgcmV0dXJuIGN1cnJlbmN5U3RyO1xufVxuXG5mdW5jdGlvbiBnZXRJbnN0YWxsbWVudHNJbmZvKHR4bjogU2NyYXBlZFRyYW5zYWN0aW9uKTogVHJhbnNhY3Rpb25JbnN0YWxsbWVudHMgfCB1bmRlZmluZWQge1xuICBpZiAoIXR4bi5tb3JlSW5mbyB8fCAhdHhuLm1vcmVJbmZvLmluY2x1ZGVzKElOU1RBTExNRU5UU19LRVlXT1JEKSkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgY29uc3QgbWF0Y2hlcyA9IHR4bi5tb3JlSW5mby5tYXRjaCgvXFxkKy9nKTtcbiAgaWYgKCFtYXRjaGVzIHx8IG1hdGNoZXMubGVuZ3RoIDwgMikge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIG51bWJlcjogcGFyc2VJbnQobWF0Y2hlc1swXSwgMTApLFxuICAgIHRvdGFsOiBwYXJzZUludChtYXRjaGVzWzFdLCAxMCksXG4gIH07XG59XG5cbmZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uVHlwZSh0eG46IFNjcmFwZWRUcmFuc2FjdGlvbikge1xuICByZXR1cm4gZ2V0SW5zdGFsbG1lbnRzSW5mbyh0eG4pID8gVHJhbnNhY3Rpb25UeXBlcy5JbnN0YWxsbWVudHMgOiBUcmFuc2FjdGlvblR5cGVzLk5vcm1hbDtcbn1cblxuZnVuY3Rpb24gY29udmVydFRyYW5zYWN0aW9ucyhcbiAgdHhuczogU2NyYXBlZFRyYW5zYWN0aW9uW10sXG4gIHByb2Nlc3NlZERhdGU6IHN0cmluZyxcbiAgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zLFxuKTogVHJhbnNhY3Rpb25bXSB7XG4gIGNvbnN0IGZpbHRlcmVkVHhucyA9IHR4bnMuZmlsdGVyKFxuICAgIHR4biA9PlxuICAgICAgdHhuLmRlYWxTdW1UeXBlICE9PSAnMScgJiYgdHhuLnZvdWNoZXJOdW1iZXJSYXR6ICE9PSAnMDAwMDAwMDAwJyAmJiB0eG4udm91Y2hlck51bWJlclJhdHpPdXRib3VuZCAhPT0gJzAwMDAwMDAwMCcsXG4gICk7XG5cbiAgcmV0dXJuIGZpbHRlcmVkVHhucy5tYXAodHhuID0+IHtcbiAgICBjb25zdCBpc091dGJvdW5kID0gdHhuLmRlYWxTdW1PdXRib3VuZDtcbiAgICBjb25zdCB0eG5EYXRlU3RyID0gaXNPdXRib3VuZCA/IHR4bi5mdWxsUHVyY2hhc2VEYXRlT3V0Ym91bmQgOiB0eG4uZnVsbFB1cmNoYXNlRGF0ZTtcbiAgICBjb25zdCB0eG5Nb21lbnQgPSBtb21lbnQodHhuRGF0ZVN0ciwgREFURV9GT1JNQVQpO1xuXG4gICAgY29uc3QgY3VycmVudFByb2Nlc3NlZERhdGUgPSB0eG4uZnVsbFBheW1lbnREYXRlXG4gICAgICA/IG1vbWVudCh0eG4uZnVsbFBheW1lbnREYXRlLCBEQVRFX0ZPUk1BVCkudG9JU09TdHJpbmcoKVxuICAgICAgOiBwcm9jZXNzZWREYXRlO1xuICAgIGNvbnN0IHJlc3VsdDogVHJhbnNhY3Rpb24gPSB7XG4gICAgICB0eXBlOiBnZXRUcmFuc2FjdGlvblR5cGUodHhuKSxcbiAgICAgIGlkZW50aWZpZXI6IHBhcnNlSW50KGlzT3V0Ym91bmQgPyB0eG4udm91Y2hlck51bWJlclJhdHpPdXRib3VuZCA6IHR4bi52b3VjaGVyTnVtYmVyUmF0eiwgMTApLFxuICAgICAgZGF0ZTogdHhuTW9tZW50LnRvSVNPU3RyaW5nKCksXG4gICAgICBwcm9jZXNzZWREYXRlOiBjdXJyZW50UHJvY2Vzc2VkRGF0ZSxcbiAgICAgIG9yaWdpbmFsQW1vdW50OiBpc091dGJvdW5kID8gLXR4bi5kZWFsU3VtT3V0Ym91bmQgOiAtdHhuLmRlYWxTdW0sXG4gICAgICBvcmlnaW5hbEN1cnJlbmN5OiBjb252ZXJ0Q3VycmVuY3kodHhuLmN1cnJlbnRQYXltZW50Q3VycmVuY3kgPz8gdHhuLmN1cnJlbmN5SWQpLFxuICAgICAgY2hhcmdlZEFtb3VudDogaXNPdXRib3VuZCA/IC10eG4ucGF5bWVudFN1bU91dGJvdW5kIDogLXR4bi5wYXltZW50U3VtLFxuICAgICAgY2hhcmdlZEN1cnJlbmN5OiBjb252ZXJ0Q3VycmVuY3kodHhuLmN1cnJlbmN5SWQpLFxuICAgICAgZGVzY3JpcHRpb246IGlzT3V0Ym91bmQgPyB0eG4uZnVsbFN1cHBsaWVyTmFtZU91dGJvdW5kIDogdHhuLmZ1bGxTdXBwbGllck5hbWVIZWIsXG4gICAgICBtZW1vOiB0eG4ubW9yZUluZm8gfHwgJycsXG4gICAgICBpbnN0YWxsbWVudHM6IGdldEluc3RhbGxtZW50c0luZm8odHhuKSB8fCB1bmRlZmluZWQsXG4gICAgICBzdGF0dXM6IFRyYW5zYWN0aW9uU3RhdHVzZXMuQ29tcGxldGVkLFxuICAgIH07XG5cbiAgICBpZiAob3B0aW9ucz8uaW5jbHVkZVJhd1RyYW5zYWN0aW9uKSB7XG4gICAgICByZXN1bHQucmF3VHJhbnNhY3Rpb24gPSBnZXRSYXdUcmFuc2FjdGlvbih0eG4pO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaFRyYW5zYWN0aW9ucyhcbiAgcGFnZTogUGFnZSxcbiAgb3B0aW9uczogU2NyYXBlck9wdGlvbnMsXG4gIGNvbXBhbnlTZXJ2aWNlT3B0aW9uczogQ29tcGFueVNlcnZpY2VPcHRpb25zLFxuICBzdGFydE1vbWVudDogTW9tZW50LFxuICBtb250aE1vbWVudDogTW9tZW50LFxuKTogUHJvbWlzZTxTY3JhcGVkQWNjb3VudHNXaXRoSW5kZXg+IHtcbiAgY29uc3Qgc3RhcnRUaW1lID0gcGVyZm9ybWFuY2Uubm93KCk7XG4gIGNvbnN0IGFjY291bnRzID0gYXdhaXQgZmV0Y2hBY2NvdW50cyhwYWdlLCBjb21wYW55U2VydmljZU9wdGlvbnMuc2VydmljZXNVcmwsIG1vbnRoTW9tZW50KTtcbiAgY29uc3QgZGF0YVVybCA9IGdldFRyYW5zYWN0aW9uc1VybChjb21wYW55U2VydmljZU9wdGlvbnMuc2VydmljZXNVcmwsIG1vbnRoTW9tZW50KTtcblxuICBkZWJ1ZyhgZmV0Y2hpbmcgdHJhbnNhY3Rpb25zIGZvciAke21vbnRoTW9tZW50LmZvcm1hdCgnWVlZWS1NTScpfSBmcm9tICR7ZGF0YVVybH1gKTtcbiAgYXdhaXQgcmFuZG9tRGVsYXkoUkFURV9MSU1JVC5TTEVFUF9CRVRXRUVOLCBSQVRFX0xJTUlULlNMRUVQX0JFVFdFRU4gKyA1MDApO1xuICBjb25zdCBkYXRhUmVzdWx0ID0gYXdhaXQgZmV0Y2hHZXRXaXRoaW5QYWdlPFNjcmFwZWRUcmFuc2FjdGlvbkRhdGE+KHBhZ2UsIGRhdGFVcmwpO1xuICBkZWJ1ZyhgRmV0Y2ggZm9yICR7bW9udGhNb21lbnQuZm9ybWF0KCdZWVlZLU1NJyl9IGNvbXBsZXRlZCBpbiAke3BlcmZvcm1hbmNlLm5vdygpIC0gc3RhcnRUaW1lfW1zYCk7XG5cbiAgaWYgKGRhdGFSZXN1bHQgJiYgZGF0YVJlc3VsdC5IZWFkZXI/LlN0YXR1cyA9PT0gJzEnICYmIGRhdGFSZXN1bHQuQ2FyZHNUcmFuc2FjdGlvbnNMaXN0QmVhbikge1xuICAgIGNvbnN0IGFjY291bnRUeG5zOiBTY3JhcGVkQWNjb3VudHNXaXRoSW5kZXggPSB7fTtcbiAgICBhY2NvdW50cy5mb3JFYWNoKGFjY291bnQgPT4ge1xuICAgICAgY29uc3QgdHhuR3JvdXBzOiBTY3JhcGVkQ3VycmVudENhcmRUcmFuc2FjdGlvbnNbXSB8IHVuZGVmaW5lZCA9XG4gICAgICAgIGRhdGFSZXN1bHQuQ2FyZHNUcmFuc2FjdGlvbnNMaXN0QmVhbj8uW2BJbmRleCR7YWNjb3VudC5pbmRleH1gXT8uQ3VycmVudENhcmRUcmFuc2FjdGlvbnM7XG4gICAgICBpZiAodHhuR3JvdXBzKSB7XG4gICAgICAgIGxldCBhbGxUeG5zOiBUcmFuc2FjdGlvbltdID0gW107XG4gICAgICAgIHR4bkdyb3Vwcy5mb3JFYWNoKHR4bkdyb3VwID0+IHtcbiAgICAgICAgICBpZiAodHhuR3JvdXAudHhuSXNyYWVsKSB7XG4gICAgICAgICAgICBjb25zdCB0eG5zID0gY29udmVydFRyYW5zYWN0aW9ucyh0eG5Hcm91cC50eG5Jc3JhZWwsIGFjY291bnQucHJvY2Vzc2VkRGF0ZSwgb3B0aW9ucyk7XG4gICAgICAgICAgICBhbGxUeG5zLnB1c2goLi4udHhucyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh0eG5Hcm91cC50eG5BYnJvYWQpIHtcbiAgICAgICAgICAgIGNvbnN0IHR4bnMgPSBjb252ZXJ0VHJhbnNhY3Rpb25zKHR4bkdyb3VwLnR4bkFicm9hZCwgYWNjb3VudC5wcm9jZXNzZWREYXRlLCBvcHRpb25zKTtcbiAgICAgICAgICAgIGFsbFR4bnMucHVzaCguLi50eG5zKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmICghb3B0aW9ucy5jb21iaW5lSW5zdGFsbG1lbnRzKSB7XG4gICAgICAgICAgYWxsVHhucyA9IGZpeEluc3RhbGxtZW50cyhhbGxUeG5zKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAob3B0aW9ucy5vdXRwdXREYXRhPy5lbmFibGVUcmFuc2FjdGlvbnNGaWx0ZXJCeURhdGUgPz8gdHJ1ZSkge1xuICAgICAgICAgIGFsbFR4bnMgPSBmaWx0ZXJPbGRUcmFuc2FjdGlvbnMoYWxsVHhucywgc3RhcnRNb21lbnQsIG9wdGlvbnMuY29tYmluZUluc3RhbGxtZW50cyB8fCBmYWxzZSk7XG4gICAgICAgIH1cbiAgICAgICAgYWNjb3VudFR4bnNbYWNjb3VudC5hY2NvdW50TnVtYmVyXSA9IHtcbiAgICAgICAgICBhY2NvdW50TnVtYmVyOiBhY2NvdW50LmFjY291bnROdW1iZXIsXG4gICAgICAgICAgaW5kZXg6IGFjY291bnQuaW5kZXgsXG4gICAgICAgICAgdHhuczogYWxsVHhucyxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gYWNjb3VudFR4bnM7XG4gIH1cblxuICByZXR1cm4ge307XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEV4dHJhU2NyYXBUcmFuc2FjdGlvbihcbiAgcGFnZTogUGFnZSxcbiAgb3B0aW9uczogQ29tcGFueVNlcnZpY2VPcHRpb25zLFxuICBtb250aDogTW9tZW50LFxuICBhY2NvdW50SW5kZXg6IG51bWJlcixcbiAgdHJhbnNhY3Rpb246IFRyYW5zYWN0aW9uLFxuKTogUHJvbWlzZTxUcmFuc2FjdGlvbj4ge1xuICBjb25zdCB1cmwgPSBuZXcgVVJMKG9wdGlvbnMuc2VydmljZXNVcmwpO1xuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgncmVxTmFtZScsICdQaXJ0ZXlJc2thXzIwNCcpO1xuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnQ2FyZEluZGV4JywgYWNjb3VudEluZGV4LnRvU3RyaW5nKCkpO1xuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnc2hvdmFyUmF0eicsIHRyYW5zYWN0aW9uLmlkZW50aWZpZXIhLnRvU3RyaW5nKCkpO1xuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnbW9lZENoaXV2JywgbW9udGguZm9ybWF0KCdNTVlZWVknKSk7XG5cbiAgZGVidWcoYGZldGNoaW5nIGV4dHJhIHNjcmFwIGZvciB0cmFuc2FjdGlvbiAke3RyYW5zYWN0aW9uLmlkZW50aWZpZXJ9IGZvciBtb250aCAke21vbnRoLmZvcm1hdCgnWVlZWS1NTScpfWApO1xuICBjb25zdCBkYXRhID0gYXdhaXQgZmV0Y2hHZXRXaXRoaW5QYWdlPFNjcmFwZWRUcmFuc2FjdGlvbkRhdGE+KHBhZ2UsIHVybC50b1N0cmluZygpKTtcbiAgaWYgKCFkYXRhKSB7XG4gICAgcmV0dXJuIHRyYW5zYWN0aW9uO1xuICB9XG5cbiAgY29uc3QgcmF3Q2F0ZWdvcnkgPSBkYXRhLlBpcnRleUlza2FfMjA0QmVhbj8uc2VjdG9yID8/ICcnO1xuICByZXR1cm4ge1xuICAgIC4uLnRyYW5zYWN0aW9uLFxuICAgIGNhdGVnb3J5OiByYXdDYXRlZ29yeS50cmltKCksXG4gICAgcmF3VHJhbnNhY3Rpb246IGdldFJhd1RyYW5zYWN0aW9uKGRhdGEsIHRyYW5zYWN0aW9uKSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0RXh0cmFTY3JhcEFjY291bnQoXG4gIHBhZ2U6IFBhZ2UsXG4gIG9wdGlvbnM6IENvbXBhbnlTZXJ2aWNlT3B0aW9ucyxcbiAgYWNjb3VudE1hcDogU2NyYXBlZEFjY291bnRzV2l0aEluZGV4LFxuICBtb250aDogbW9tZW50Lk1vbWVudCxcbik6IFByb21pc2U8U2NyYXBlZEFjY291bnRzV2l0aEluZGV4PiB7XG4gIGNvbnN0IGFjY291bnRzOiBTY3JhcGVkQWNjb3VudHNXaXRoSW5kZXhbc3RyaW5nXVtdID0gW107XG4gIGZvciAoY29uc3QgYWNjb3VudCBvZiBPYmplY3QudmFsdWVzKGFjY291bnRNYXApKSB7XG4gICAgZGVidWcoXG4gICAgICBgZ2V0IGV4dHJhIHNjcmFwIGZvciAke2FjY291bnQuYWNjb3VudE51bWJlcn0gd2l0aCAke2FjY291bnQudHhucy5sZW5ndGh9IHRyYW5zYWN0aW9uc2AsXG4gICAgICBtb250aC5mb3JtYXQoJ1lZWVktTU0nKSxcbiAgICApO1xuICAgIGNvbnN0IHR4bnM6IFRyYW5zYWN0aW9uW10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHR4bnNDaHVuayBvZiBjaHVuayhhY2NvdW50LnR4bnMsIFJBVEVfTElNSVQuVFJBTlNBQ1RJT05TX0JBVENIX1NJWkUpKSB7XG4gICAgICBkZWJ1ZyhgcHJvY2Vzc2luZyBjaHVuayBvZiAke3R4bnNDaHVuay5sZW5ndGh9IHRyYW5zYWN0aW9ucyBmb3IgYWNjb3VudCAke2FjY291bnQuYWNjb3VudE51bWJlcn1gKTtcbiAgICAgIGNvbnN0IHVwZGF0ZWRUeG5zID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgIHR4bnNDaHVuay5tYXAodCA9PiBnZXRFeHRyYVNjcmFwVHJhbnNhY3Rpb24ocGFnZSwgb3B0aW9ucywgbW9udGgsIGFjY291bnQuaW5kZXgsIHQpKSxcbiAgICAgICk7XG4gICAgICBhd2FpdCBzbGVlcChSQVRFX0xJTUlULlNMRUVQX0JFVFdFRU4pO1xuICAgICAgdHhucy5wdXNoKC4uLnVwZGF0ZWRUeG5zKTtcbiAgICB9XG4gICAgYWNjb3VudHMucHVzaCh7IC4uLmFjY291bnQsIHR4bnMgfSk7XG4gIH1cblxuICByZXR1cm4gYWNjb3VudHMucmVkdWNlKChtLCB4KSA9PiAoeyAuLi5tLCBbeC5hY2NvdW50TnVtYmVyXTogeCB9KSwge30pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRBZGRpdGlvbmFsVHJhbnNhY3Rpb25JbmZvcm1hdGlvbihcbiAgc2NyYXBlck9wdGlvbnM6IFNjcmFwZXJPcHRpb25zLFxuICBhY2NvdW50c1dpdGhJbmRleDogU2NyYXBlZEFjY291bnRzV2l0aEluZGV4W10sXG4gIHBhZ2U6IFBhZ2UsXG4gIG9wdGlvbnM6IENvbXBhbnlTZXJ2aWNlT3B0aW9ucyxcbiAgYWxsTW9udGhzOiBtb21lbnQuTW9tZW50W10sXG4pOiBQcm9taXNlPFNjcmFwZWRBY2NvdW50c1dpdGhJbmRleFtdPiB7XG4gIGlmIChcbiAgICAhc2NyYXBlck9wdGlvbnMuYWRkaXRpb25hbFRyYW5zYWN0aW9uSW5mb3JtYXRpb24gfHxcbiAgICBzY3JhcGVyT3B0aW9ucy5vcHRJbkZlYXR1cmVzPy5pbmNsdWRlcygnaXNyYWNhcmQtYW1leDpza2lwQWRkaXRpb25hbFRyYW5zYWN0aW9uSW5mb3JtYXRpb24nKVxuICApIHtcbiAgICByZXR1cm4gYWNjb3VudHNXaXRoSW5kZXg7XG4gIH1cbiAgcmV0dXJuIHJ1blNlcmlhbChhY2NvdW50c1dpdGhJbmRleC5tYXAoKGEsIGkpID0+ICgpID0+IGdldEV4dHJhU2NyYXBBY2NvdW50KHBhZ2UsIG9wdGlvbnMsIGEsIGFsbE1vbnRoc1tpXSkpKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hBbGxUcmFuc2FjdGlvbnMoXG4gIHBhZ2U6IFBhZ2UsXG4gIG9wdGlvbnM6IFNjcmFwZXJPcHRpb25zLFxuICBjb21wYW55U2VydmljZU9wdGlvbnM6IENvbXBhbnlTZXJ2aWNlT3B0aW9ucyxcbiAgc3RhcnRNb21lbnQ6IE1vbWVudCxcbikge1xuICBjb25zdCBmZXRjaFN0YXJ0VGltZSA9IHBlcmZvcm1hbmNlLm5vdygpO1xuICBjb25zdCBmdXR1cmVNb250aHNUb1NjcmFwZSA9IG9wdGlvbnMuZnV0dXJlTW9udGhzVG9TY3JhcGUgPz8gMTtcbiAgY29uc3QgYWxsTW9udGhzID0gZ2V0QWxsTW9udGhNb21lbnRzKHN0YXJ0TW9tZW50LCBmdXR1cmVNb250aHNUb1NjcmFwZSk7XG4gIGRlYnVnKGBGZXRjaGluZyB0cmFuc2FjdGlvbnMgZm9yICR7YWxsTW9udGhzLmxlbmd0aH0gbW9udGhzYCk7XG5cbiAgY29uc3QgcmVzdWx0czogU2NyYXBlZEFjY291bnRzV2l0aEluZGV4W10gPSBhd2FpdCBydW5TZXJpYWwoXG4gICAgYWxsTW9udGhzLm1hcChtb250aE1vbWVudCA9PiAoKSA9PiB7XG4gICAgICByZXR1cm4gZmV0Y2hUcmFuc2FjdGlvbnMocGFnZSwgb3B0aW9ucywgY29tcGFueVNlcnZpY2VPcHRpb25zLCBzdGFydE1vbWVudCwgbW9udGhNb21lbnQpO1xuICAgIH0pLFxuICApO1xuXG4gIGNvbnN0IGZpbmFsUmVzdWx0ID0gYXdhaXQgZ2V0QWRkaXRpb25hbFRyYW5zYWN0aW9uSW5mb3JtYXRpb24oXG4gICAgb3B0aW9ucyxcbiAgICByZXN1bHRzLFxuICAgIHBhZ2UsXG4gICAgY29tcGFueVNlcnZpY2VPcHRpb25zLFxuICAgIGFsbE1vbnRocyxcbiAgKTtcbiAgY29uc3QgY29tYmluZWRUeG5zOiBSZWNvcmQ8c3RyaW5nLCBUcmFuc2FjdGlvbltdPiA9IHt9O1xuXG4gIGZpbmFsUmVzdWx0LmZvckVhY2gocmVzdWx0ID0+IHtcbiAgICBPYmplY3Qua2V5cyhyZXN1bHQpLmZvckVhY2goYWNjb3VudE51bWJlciA9PiB7XG4gICAgICBsZXQgdHhuc0ZvckFjY291bnQgPSBjb21iaW5lZFR4bnNbYWNjb3VudE51bWJlcl07XG4gICAgICBpZiAoIXR4bnNGb3JBY2NvdW50KSB7XG4gICAgICAgIHR4bnNGb3JBY2NvdW50ID0gW107XG4gICAgICAgIGNvbWJpbmVkVHhuc1thY2NvdW50TnVtYmVyXSA9IHR4bnNGb3JBY2NvdW50O1xuICAgICAgfVxuICAgICAgY29uc3QgdG9CZUFkZGVkVHhucyA9IHJlc3VsdFthY2NvdW50TnVtYmVyXS50eG5zO1xuICAgICAgY29tYmluZWRUeG5zW2FjY291bnROdW1iZXJdLnB1c2goLi4udG9CZUFkZGVkVHhucyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGNvbnN0IGFjY291bnRzID0gT2JqZWN0LmtleXMoY29tYmluZWRUeG5zKS5tYXAoYWNjb3VudE51bWJlciA9PiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFjY291bnROdW1iZXIsXG4gICAgICB0eG5zOiBjb21iaW5lZFR4bnNbYWNjb3VudE51bWJlcl0sXG4gICAgfTtcbiAgfSk7XG5cbiAgZGVidWcoYGZldGNoQWxsVHJhbnNhY3Rpb25zIGNvbXBsZXRlZCBpbiAke3BlcmZvcm1hbmNlLm5vdygpIC0gZmV0Y2hTdGFydFRpbWV9bXNgKTtcblxuICByZXR1cm4ge1xuICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgYWNjb3VudHMsXG4gIH07XG59XG5cbnR5cGUgU2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHMgPSB7IGlkOiBzdHJpbmc7IHBhc3N3b3JkOiBzdHJpbmc7IGNhcmQ2RGlnaXRzOiBzdHJpbmcgfTtcbmNsYXNzIElzcmFjYXJkQW1leEJhc2VTY3JhcGVyIGV4dGVuZHMgQmFzZVNjcmFwZXJXaXRoQnJvd3NlcjxTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscz4ge1xuICBwcml2YXRlIGJhc2VVcmw6IHN0cmluZztcblxuICBwcml2YXRlIGNvbXBhbnlDb2RlOiBzdHJpbmc7XG5cbiAgcHJpdmF0ZSBzZXJ2aWNlc1VybDogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IFNjcmFwZXJPcHRpb25zLCBiYXNlVXJsOiBzdHJpbmcsIGNvbXBhbnlDb2RlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihvcHRpb25zKTtcblxuICAgIHRoaXMuYmFzZVVybCA9IGJhc2VVcmw7XG4gICAgdGhpcy5jb21wYW55Q29kZSA9IGNvbXBhbnlDb2RlO1xuICAgIHRoaXMuc2VydmljZXNVcmwgPSBgJHtiYXNlVXJsfS9zZXJ2aWNlcy9Qcm94eVJlcXVlc3RIYW5kbGVyLmFzaHhgO1xuICB9XG5cbiAgYXN5bmMgbG9naW4oY3JlZGVudGlhbHM6IFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzKTogUHJvbWlzZTxTY3JhcGVyU2NyYXBpbmdSZXN1bHQ+IHtcbiAgICBjb25zdCBsb2dpblN0YXJ0VGltZSA9IHBlcmZvcm1hbmNlLm5vdygpO1xuICAgIGF3YWl0IHRoaXMucGFnZS5zZXRSZXF1ZXN0SW50ZXJjZXB0aW9uKHRydWUpO1xuICAgIHRoaXMucGFnZS5vbigncmVxdWVzdCcsIHJlcXVlc3QgPT4ge1xuICAgICAgaWYgKHJlcXVlc3QudXJsKCkuaW5jbHVkZXMoJ2RldGVjdG9yLWRvbS5taW4uanMnKSkge1xuICAgICAgICBkZWJ1ZygnZm9yY2UgYWJvcnQgZm9yIHJlcXVlc3QgZG8gZG93bmxvYWQgZGV0ZWN0b3ItZG9tLm1pbi5qcyByZXNvdXJjZScpO1xuICAgICAgICB2b2lkIHJlcXVlc3QuYWJvcnQodW5kZWZpbmVkLCBpbnRlcmNlcHRpb25Qcmlvcml0aWVzLmFib3J0KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZvaWQgcmVxdWVzdC5jb250aW51ZSh1bmRlZmluZWQsIGludGVyY2VwdGlvblByaW9yaXRpZXMuY29udGludWUpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgYXdhaXQgbWFza0hlYWRsZXNzVXNlckFnZW50KHRoaXMucGFnZSk7XG5cbiAgICBhd2FpdCB0aGlzLm5hdmlnYXRlVG8oYCR7dGhpcy5iYXNlVXJsfS9wZXJzb25hbGFyZWEvTG9naW5gKTtcblxuICAgIHRoaXMuZW1pdFByb2dyZXNzKFNjcmFwZXJQcm9ncmVzc1R5cGVzLkxvZ2dpbmdJbik7XG5cbiAgICBjb25zdCB2YWxpZGF0ZVVybCA9IGAke3RoaXMuc2VydmljZXNVcmx9P3JlcU5hbWU9VmFsaWRhdGVJZERhdGFgO1xuICAgIGNvbnN0IHZhbGlkYXRlUmVxdWVzdCA9IHtcbiAgICAgIGlkOiBjcmVkZW50aWFscy5pZCxcbiAgICAgIGNhcmRTdWZmaXg6IGNyZWRlbnRpYWxzLmNhcmQ2RGlnaXRzLFxuICAgICAgY291bnRyeUNvZGU6IENPVU5UUllfQ09ERSxcbiAgICAgIGlkVHlwZTogSURfVFlQRSxcbiAgICAgIGNoZWNrTGV2ZWw6ICcxJyxcbiAgICAgIGNvbXBhbnlDb2RlOiB0aGlzLmNvbXBhbnlDb2RlLFxuICAgIH07XG4gICAgZGVidWcoJ2xvZ2dpbmcgaW4gd2l0aCB2YWxpZGF0ZSByZXF1ZXN0Jyk7XG4gICAgY29uc3QgdmFsaWRhdGVSZXN1bHQgPSBhd2FpdCBmZXRjaFBvc3RXaXRoaW5QYWdlPFNjcmFwZWRMb2dpblZhbGlkYXRpb24+KHRoaXMucGFnZSwgdmFsaWRhdGVVcmwsIHZhbGlkYXRlUmVxdWVzdCk7XG4gICAgaWYgKFxuICAgICAgIXZhbGlkYXRlUmVzdWx0IHx8XG4gICAgICAhdmFsaWRhdGVSZXN1bHQuSGVhZGVyIHx8XG4gICAgICB2YWxpZGF0ZVJlc3VsdC5IZWFkZXIuU3RhdHVzICE9PSAnMScgfHxcbiAgICAgICF2YWxpZGF0ZVJlc3VsdC5WYWxpZGF0ZUlkRGF0YUJlYW5cbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcigndW5rbm93biBlcnJvciBkdXJpbmcgbG9naW4nKTtcbiAgICB9XG5cbiAgICBjb25zdCB2YWxpZGF0ZVJldHVybkNvZGUgPSB2YWxpZGF0ZVJlc3VsdC5WYWxpZGF0ZUlkRGF0YUJlYW4ucmV0dXJuQ29kZTtcbiAgICBkZWJ1ZyhgdXNlciB2YWxpZGF0ZSB3aXRoIHJldHVybiBjb2RlICcke3ZhbGlkYXRlUmV0dXJuQ29kZX0nYCk7XG4gICAgaWYgKHZhbGlkYXRlUmV0dXJuQ29kZSA9PT0gJzEnKSB7XG4gICAgICBjb25zdCB7IHVzZXJOYW1lIH0gPSB2YWxpZGF0ZVJlc3VsdC5WYWxpZGF0ZUlkRGF0YUJlYW47XG5cbiAgICAgIGNvbnN0IGxvZ2luVXJsID0gYCR7dGhpcy5zZXJ2aWNlc1VybH0/cmVxTmFtZT1wZXJmb3JtTG9nb25JYDtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSB7XG4gICAgICAgIEtvZE1pc2h0YW1lc2g6IHVzZXJOYW1lLFxuICAgICAgICBNaXNwYXJaaWh1eTogY3JlZGVudGlhbHMuaWQsXG4gICAgICAgIFNpc21hOiBjcmVkZW50aWFscy5wYXNzd29yZCxcbiAgICAgICAgY2FyZFN1ZmZpeDogY3JlZGVudGlhbHMuY2FyZDZEaWdpdHMsXG4gICAgICAgIGNvdW50cnlDb2RlOiBDT1VOVFJZX0NPREUsXG4gICAgICAgIGlkVHlwZTogSURfVFlQRSxcbiAgICAgIH07XG4gICAgICBkZWJ1ZygndXNlciBsb2dpbiBzdGFydGVkJyk7XG4gICAgICBjb25zdCBsb2dpblJlc3VsdCA9IGF3YWl0IGZldGNoUG9zdFdpdGhpblBhZ2U8eyBzdGF0dXM6IHN0cmluZyB9Pih0aGlzLnBhZ2UsIGxvZ2luVXJsLCByZXF1ZXN0KTtcbiAgICAgIGRlYnVnKGB1c2VyIGxvZ2luIHdpdGggc3RhdHVzICcke2xvZ2luUmVzdWx0Py5zdGF0dXN9J2AsIGxvZ2luUmVzdWx0KTtcblxuICAgICAgaWYgKGxvZ2luUmVzdWx0ICYmIGxvZ2luUmVzdWx0LnN0YXR1cyA9PT0gJzEnKSB7XG4gICAgICAgIHRoaXMuZW1pdFByb2dyZXNzKFNjcmFwZXJQcm9ncmVzc1R5cGVzLkxvZ2luU3VjY2Vzcyk7XG4gICAgICAgIGRlYnVnKGBMb2dpbiBjb21wbGV0ZWQgaW4gJHtwZXJmb3JtYW5jZS5ub3coKSAtIGxvZ2luU3RhcnRUaW1lfW1zYCk7XG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcbiAgICAgIH1cblxuICAgICAgaWYgKGxvZ2luUmVzdWx0ICYmIGxvZ2luUmVzdWx0LnN0YXR1cyA9PT0gJzMnKSB7XG4gICAgICAgIHRoaXMuZW1pdFByb2dyZXNzKFNjcmFwZXJQcm9ncmVzc1R5cGVzLkNoYW5nZVBhc3N3b3JkKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICBlcnJvclR5cGU6IFNjcmFwZXJFcnJvclR5cGVzLkNoYW5nZVBhc3N3b3JkLFxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICB0aGlzLmVtaXRQcm9ncmVzcyhTY3JhcGVyUHJvZ3Jlc3NUeXBlcy5Mb2dpbkZhaWxlZCk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgZXJyb3JUeXBlOiBTY3JhcGVyRXJyb3JUeXBlcy5JbnZhbGlkUGFzc3dvcmQsXG4gICAgICB9O1xuICAgIH1cblxuICAgIGlmICh2YWxpZGF0ZVJldHVybkNvZGUgPT09ICc0Jykge1xuICAgICAgdGhpcy5lbWl0UHJvZ3Jlc3MoU2NyYXBlclByb2dyZXNzVHlwZXMuQ2hhbmdlUGFzc3dvcmQpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGVycm9yVHlwZTogU2NyYXBlckVycm9yVHlwZXMuQ2hhbmdlUGFzc3dvcmQsXG4gICAgICB9O1xuICAgIH1cblxuICAgIHRoaXMuZW1pdFByb2dyZXNzKFNjcmFwZXJQcm9ncmVzc1R5cGVzLkxvZ2luRmFpbGVkKTtcbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICBlcnJvclR5cGU6IFNjcmFwZXJFcnJvclR5cGVzLkludmFsaWRQYXNzd29yZCxcbiAgICB9O1xuICB9XG5cbiAgYXN5bmMgZmV0Y2hEYXRhKCkge1xuICAgIGNvbnN0IGRlZmF1bHRTdGFydE1vbWVudCA9IG1vbWVudCgpLnN1YnRyYWN0KDEsICd5ZWFycycpO1xuICAgIGNvbnN0IHN0YXJ0RGF0ZSA9IHRoaXMub3B0aW9ucy5zdGFydERhdGUgfHwgZGVmYXVsdFN0YXJ0TW9tZW50LnRvRGF0ZSgpO1xuICAgIGNvbnN0IHN0YXJ0TW9tZW50ID0gbW9tZW50Lm1heChkZWZhdWx0U3RhcnRNb21lbnQsIG1vbWVudChzdGFydERhdGUpKTtcblxuICAgIHJldHVybiBmZXRjaEFsbFRyYW5zYWN0aW9ucyhcbiAgICAgIHRoaXMucGFnZSxcbiAgICAgIHRoaXMub3B0aW9ucyxcbiAgICAgIHtcbiAgICAgICAgc2VydmljZXNVcmw6IHRoaXMuc2VydmljZXNVcmwsXG4gICAgICAgIGNvbXBhbnlDb2RlOiB0aGlzLmNvbXBhbnlDb2RlLFxuICAgICAgfSxcbiAgICAgIHN0YXJ0TW9tZW50LFxuICAgICk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgSXNyYWNhcmRBbWV4QmFzZVNjcmFwZXI7XG4iXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBLElBQUFBLE9BQUEsR0FBQUMsc0JBQUEsQ0FBQUMsT0FBQTtBQUVBLElBQUFDLFVBQUEsR0FBQUQsT0FBQTtBQUNBLElBQUFFLFlBQUEsR0FBQUYsT0FBQTtBQUNBLElBQUFHLFFBQUEsR0FBQUgsT0FBQTtBQUNBLElBQUFJLE1BQUEsR0FBQUwsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFLLE1BQUEs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
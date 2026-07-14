"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _moment = _interopRequireDefault(require("moment"));
var _debug = require("../helpers/debug");
var _elementsInteractions = require("../helpers/elements-interactions");
var _fetch = require("../helpers/fetch");
var _navigation = require("../helpers/navigation");
var _storage = require("../helpers/storage");
var _transactions = require("../helpers/transactions");
var _waiting = require("../helpers/waiting");
var _transactions2 = require("../transactions");
var _baseScraperWithBrowser = require("./base-scraper-with-browser");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const apiHeaders = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  Origin: 'https://digital-web.cal-online.co.il',
  Referer: 'https://digital-web.cal-online.co.il',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty'
};
const LOGIN_URL = 'https://www.cal-online.co.il/';
const TRANSACTIONS_REQUEST_ENDPOINT = 'https://api.cal-online.co.il/Transactions/api/transactionsDetails/getCardTransactionsDetails';
const FRAMES_REQUEST_ENDPOINT = 'https://api.cal-online.co.il/Frames/api/Frames/GetFrameStatus';
const PENDING_TRANSACTIONS_REQUEST_ENDPOINT = 'https://api.cal-online.co.il/Transactions/api/approvals/getClearanceRequests';
const SSO_AUTHORIZATION_REQUEST_ENDPOINT = 'https://connect.cal-online.co.il/col-rest/calconnect/authentication/SSO';
const InvalidPasswordMessage = 'שם המשתמש או הסיסמה שהוזנו שגויים';
const ChangePasswordMessage = 'להחליף סיסמה';
const ChangePasswordSubtitle = 'הגיע הזמן לסיסמה חדשה';
const ChangePasswordUrl = '/change-password';
const debug = (0, _debug.getDebug)('visa-cal');
var TrnTypeCode = /*#__PURE__*/function (TrnTypeCode) {
  TrnTypeCode["regular"] = "5";
  TrnTypeCode["credit"] = "6";
  TrnTypeCode["installments"] = "8";
  TrnTypeCode["standingOrder"] = "9";
  return TrnTypeCode;
}(TrnTypeCode || {});
function isAuthModule(result) {
  return Boolean(result?.auth?.calConnectToken && String(result.auth.calConnectToken).trim());
}
function authModuleOrUndefined(result) {
  return isAuthModule(result) ? result : undefined;
}
function isPending(transaction) {
  return transaction.debCrdDate === undefined; // an arbitrary field that only appears in a completed transaction
}
function isCardTransactionDetails(result) {
  return result.result !== undefined;
}
function isCardPendingTransactionDetails(result) {
  return result.result !== undefined;
}
async function getLoginFrame(page) {
  let frame = null;
  debug('wait until login frame found');
  await (0, _waiting.waitUntil)(() => {
    frame = page.frames().find(f => f.url().includes('connect')) || null;
    return Promise.resolve(!!frame);
  }, 'wait for iframe with login form', 10000, 1000);
  if (!frame) {
    debug('failed to find login frame for 10 seconds');
    throw new Error('failed to extract login iframe');
  }
  return frame;
}
async function hasInvalidPasswordError(page) {
  const frame = await getLoginFrame(page);
  const errorFound = await (0, _elementsInteractions.elementPresentOnPage)(frame, 'div.general-error > div');
  const errorMessage = errorFound ? await (0, _elementsInteractions.pageEval)(frame, 'div.general-error > div', '', item => {
    return item.innerText;
  }) : '';
  return errorMessage === InvalidPasswordMessage;
}
async function hasChangePasswordForm(page) {
  // Check if any frame navigated to the change-password route
  const changePasswordFrame = page.frames().find(f => {
    const url = f.url();
    return url.includes('connect.cal-online.co.il') && url.includes(ChangePasswordUrl);
  });
  if (changePasswordFrame) {
    return true;
  }
  try {
    const frame = await getLoginFrame(page);

    // Check for the change-password Angular component
    if (await (0, _elementsInteractions.elementPresentOnPage)(frame, 'change-password')) {
      return true;
    }

    // Check for the change password title element
    if (await (0, _elementsInteractions.elementPresentOnPage)(frame, '.change-password-title')) {
      return true;
    }

    // Check for the change password subtitle text
    if (await (0, _elementsInteractions.elementPresentOnPage)(frame, '.change-password-subtitle')) {
      const subtitleText = await (0, _elementsInteractions.pageEval)(frame, '.change-password-subtitle', '', item => {
        return item.innerText.trim();
      });
      if (subtitleText.includes(ChangePasswordSubtitle)) {
        return true;
      }
    }

    // Legacy: check for the old .err-desc based change password message
    const errorFound = await (0, _elementsInteractions.elementPresentOnPage)(frame, '.err-desc');
    if (errorFound) {
      const errText = await (0, _elementsInteractions.pageEval)(frame, '.err-desc', '', item => {
        return item.innerText.trim();
      });
      return errText.includes(ChangePasswordMessage);
    }
  } catch (e) {
    debug('failed to check change password form in login frame: %s', e.message);
  }
  return false;
}
function getPossibleLoginResults() {
  debug('return possible login results');
  const urls = {
    [_baseScraperWithBrowser.LoginResults.Success]: [/dashboard/i],
    [_baseScraperWithBrowser.LoginResults.InvalidPassword]: [async options => {
      const page = options?.page;
      if (!page) {
        return false;
      }
      return hasInvalidPasswordError(page);
    }],
    // [LoginResults.AccountBlocked]: [], // TODO add when reaching this scenario
    [_baseScraperWithBrowser.LoginResults.ChangePassword]: [async options => {
      const page = options?.page;
      if (!page) {
        return false;
      }
      return hasChangePasswordForm(page);
    }]
  };
  return urls;
}
function createLoginFields(credentials) {
  debug('create login fields for username and password');
  return [{
    selector: '[formcontrolname="userName"]',
    value: credentials.username
  }, {
    selector: '[formcontrolname="password"]',
    value: credentials.password
  }];
}
function convertParsedDataToTransactions(data, pendingData, options) {
  const pendingTransactions = pendingData?.result ? pendingData.result.cardsList.flatMap(card => card.authDetalisList) : [];
  const bankAccounts = data.flatMap(monthData => monthData.result.bankAccounts);
  const regularDebitDays = bankAccounts.flatMap(accounts => accounts.debitDates);
  const immediateDebitDays = bankAccounts.flatMap(accounts => accounts.immidiateDebits.debitDays);
  const completedTransactions = [...regularDebitDays, ...immediateDebitDays].flatMap(debitDate => debitDate.transactions);
  const all = [...pendingTransactions, ...completedTransactions];
  return all.map(transaction => {
    const numOfPayments = isPending(transaction) ? transaction.numberOfPayments : transaction.numOfPayments;
    const installments = numOfPayments ? {
      number: isPending(transaction) ? 1 : transaction.curPaymentNum,
      total: numOfPayments
    } : undefined;
    const date = (0, _moment.default)(transaction.trnPurchaseDate);
    const chargedAmount = (isPending(transaction) ? transaction.trnAmt : transaction.amtBeforeConvAndIndex) * -1;
    const originalAmount = transaction.trnAmt * (transaction.trnTypeCode === TrnTypeCode.credit ? 1 : -1);
    const result = {
      identifier: !isPending(transaction) ? transaction.trnIntId : undefined,
      type: [TrnTypeCode.regular, TrnTypeCode.standingOrder].includes(transaction.trnTypeCode) ? _transactions2.TransactionTypes.Normal : _transactions2.TransactionTypes.Installments,
      status: isPending(transaction) ? _transactions2.TransactionStatuses.Pending : _transactions2.TransactionStatuses.Completed,
      date: installments ? date.add(installments.number - 1, 'month').toISOString() : date.toISOString(),
      processedDate: isPending(transaction) ? date.toISOString() : new Date(transaction.debCrdDate).toISOString(),
      originalAmount,
      originalCurrency: transaction.trnCurrencySymbol,
      chargedAmount,
      chargedCurrency: !isPending(transaction) ? transaction.debCrdCurrencySymbol : undefined,
      description: transaction.merchantName,
      memo: transaction.transTypeCommentDetails.toString(),
      category: transaction.branchCodeDesc
    };
    if (installments) {
      result.installments = installments;
    }
    if (options?.includeRawTransaction) {
      result.rawTransaction = (0, _transactions.getRawTransaction)(transaction);
    }
    return result;
  });
}
class VisaCalScraper extends _baseScraperWithBrowser.BaseScraperWithBrowser {
  authorization = undefined;
  openLoginPopup = async () => {
    debug('open login popup, wait until login button available');
    await (0, _elementsInteractions.waitUntilElementFound)(this.page, '#ccLoginDesktopBtn', true);
    debug('click on the login button');
    await (0, _elementsInteractions.clickButton)(this.page, '#ccLoginDesktopBtn');
    debug('get the frame that holds the login');
    const frame = await getLoginFrame(this.page);
    debug('wait until the password login tab header is available');
    await (0, _elementsInteractions.waitUntilElementFound)(frame, '#regular-login');
    debug('navigate to the password login tab');
    await (0, _elementsInteractions.clickButton)(frame, '#regular-login');
    debug('wait until the password login tab is active');
    await (0, _elementsInteractions.waitUntilElementFound)(frame, 'regular-login');
    return frame;
  };
  async getCards() {
    const initData = await (0, _waiting.waitUntil)(() => (0, _storage.getFromSessionStorage)(this.page, 'init'), 'get init data in session storage', 10000, 1000);
    if (!initData) {
      throw new Error('could not find "init" data in session storage');
    }
    return initData?.result.cards.map(({
      cardUniqueId,
      last4Digits
    }) => ({
      cardUniqueId,
      last4Digits
    }));
  }
  async getAuthorizationHeader() {
    if (!this.authorization) {
      debug('fetching authorization header');
      const authModule = await (0, _waiting.waitUntil)(async () => authModuleOrUndefined(await (0, _storage.getFromSessionStorage)(this.page, 'auth-module')), 'get authorization header with valid token in session storage', 10_000, 50);
      return `CALAuthScheme ${authModule.auth.calConnectToken}`;
    }
    return this.authorization;
  }
  async getXSiteId() {
    /*
      I don't know if the constant below will change in the feature.
      If so, use the next code:
       return this.page.evaluate(() => new Ut().xSiteId);
       To get the classname search for 'xSiteId' in the page source
      class Ut {
        constructor(_e, on, yn) {
            this.store = _e,
            this.config = on,
            this.eventBusService = yn,
            this.xSiteId = "09031987-273E-2311-906C-8AF85B17C8D9",
    */
    return Promise.resolve('09031987-273E-2311-906C-8AF85B17C8D9');
  }
  getLoginOptions(credentials) {
    this.authRequestPromise = this.page.waitForRequest(SSO_AUTHORIZATION_REQUEST_ENDPOINT, {
      timeout: 10_000
    }).catch(e => {
      debug('error while waiting for the token request', e);
      return undefined;
    });
    return {
      loginUrl: `${LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: 'button[type="submit"]',
      possibleResults: getPossibleLoginResults(),
      checkReadiness: async () => (0, _elementsInteractions.waitUntilElementFound)(this.page, '#ccLoginDesktopBtn'),
      preAction: this.openLoginPopup,
      postAction: async () => {
        try {
          await (0, _navigation.waitForNavigation)(this.page);
          const currentUrl = await (0, _navigation.getCurrentUrl)(this.page);
          if (currentUrl.endsWith('site-tutorial')) {
            await (0, _elementsInteractions.clickButton)(this.page, 'button.btn-close');
          }
          const request = await this.authRequestPromise;
          this.authorization = String(request?.headers().authorization || '').trim();
        } catch (e) {
          const currentUrl = await (0, _navigation.getCurrentUrl)(this.page);
          if (currentUrl.endsWith('dashboard')) return;
          const requiresChangePassword = await hasChangePasswordForm(this.page);
          if (requiresChangePassword) return;
          throw e;
        }
      },
      userAgent: apiHeaders['User-Agent']
    };
  }
  async fetchCardData(card, startMoment, startDate, futureMonthsToScrape, Authorization, xSiteId) {
    debug('fetch frames (misgarot) for card %s', card.cardUniqueId);
    const frames = await (0, _fetch.fetchPost)(FRAMES_REQUEST_ENDPOINT, {
      cardsForFrameData: [{
        cardUniqueId: card.cardUniqueId
      }]
    }, {
      Authorization,
      'X-Site-Id': xSiteId,
      'Content-Type': 'application/json',
      ...apiHeaders
    });
    debug('frames response for card %s: %O', card.cardUniqueId, frames);

    // Look for card-level frame in both calIssuedCards and bankIssuedCards
    const bankIssuedFrame = frames.result?.bankIssuedCards?.cardLevelFrames?.find(f => f.cardUniqueId === card.cardUniqueId);
    const calIssuedFrame = frames.result?.calIssuedCards?.cardLevelFrames?.find(f => f.cardUniqueId === card.cardUniqueId);
    let frame;
    let cardType;
    let accountGroup;
    if (bankIssuedFrame) {
      frame = bankIssuedFrame;
      cardType = _transactions2.CardType.BankIssued;
      accountGroup = frames.result?.bankIssuedCards;
    } else {
      frame = calIssuedFrame;
      cardType = _transactions2.CardType.CompanyIssued;
      accountGroup = frames.result?.calIssuedCards;
    }
    debug('searching for frame for card %s, found: %O', card.cardUniqueId, frame);
    debug('card type for card %s: %s', card.cardUniqueId, cardType);
    const balanceDate = frame?.nextDebitDate ?? accountGroup?.nextTotalDebitDateForAccount;
    const finalMonthToFetchMoment = (0, _moment.default)().add(futureMonthsToScrape, 'month');
    const months = finalMonthToFetchMoment.diff(startMoment, 'months');
    const allMonthsData = [];
    debug(`fetch pending transactions for card ${card.cardUniqueId}`);
    let pendingData = await (0, _fetch.fetchPost)(PENDING_TRANSACTIONS_REQUEST_ENDPOINT, {
      cardUniqueIDArray: [card.cardUniqueId]
    }, {
      Authorization,
      'X-Site-Id': xSiteId,
      'Content-Type': 'application/json',
      ...apiHeaders
    });
    debug(`fetch completed transactions for card ${card.cardUniqueId}`);
    for (let i = 0; i <= months; i++) {
      const month = finalMonthToFetchMoment.clone().subtract(i, 'months');
      const monthData = await (0, _fetch.fetchPost)(TRANSACTIONS_REQUEST_ENDPOINT, {
        cardUniqueId: card.cardUniqueId,
        month: month.format('M'),
        year: month.format('YYYY')
      }, {
        Authorization,
        'X-Site-Id': xSiteId,
        'Content-Type': 'application/json',
        ...apiHeaders
      });
      if (monthData?.statusCode !== 1) throw new Error(`failed to fetch transactions for card ${card.last4Digits}. Message: ${monthData?.title || ''}`);
      if (!isCardTransactionDetails(monthData)) {
        throw new Error('monthData is not of type CardTransactionDetails');
      }
      allMonthsData.push(monthData);
    }
    if (pendingData?.statusCode !== 1 && pendingData?.statusCode !== 96) {
      debug(`failed to fetch pending transactions for card ${card.last4Digits}. Message: ${pendingData?.title || ''}`);
      pendingData = null;
    } else if (!isCardPendingTransactionDetails(pendingData)) {
      debug('pendingData is not of type CardTransactionDetails');
      pendingData = null;
    }
    const transactions = convertParsedDataToTransactions(allMonthsData, pendingData, this.options);
    debug('filter out old transactions');
    const txns = this.options.outputData?.enableTransactionsFilterByDate ?? true ? (0, _transactions.filterOldTransactions)(transactions, (0, _moment.default)(startDate), this.options.combineInstallments || false) : transactions;

    // Use card-level balance if available, otherwise fall back to account-level balance
    const balanceAmount = frame?.nextTotalDebit ?? accountGroup?.nextTotalDebitForAccount;
    const result = {
      txns,
      balance: balanceAmount != null ? -balanceAmount : undefined,
      balanceDate: balanceDate != null ? balanceDate : undefined,
      accountNumber: card.last4Digits,
      cardType,
      cardFrame: accountGroup?.frameLimitForCardAmount
    };
    return result;
  }
  async fetchData() {
    const defaultStartMoment = (0, _moment.default)().subtract(1, 'years').subtract(6, 'months').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = _moment.default.max(defaultStartMoment, (0, _moment.default)(startDate));
    debug(`fetch transactions starting ${startMoment.format()}`);
    const [cards, xSiteId, Authorization] = await Promise.all([this.getCards(), this.getXSiteId(), this.getAuthorizationHeader()]);
    const futureMonthsToScrape = this.options.futureMonthsToScrape ?? 1;
    const accounts = await Promise.all(cards.map(card => this.fetchCardData(card, startMoment, startDate, futureMonthsToScrape, Authorization, xSiteId)));
    debug('return the scraped accounts');
    debug(JSON.stringify(accounts, null, 2));
    return {
      success: true,
      accounts
    };
  }
}
var _default = exports.default = VisaCalScraper;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbW9tZW50IiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfZGVidWciLCJfZWxlbWVudHNJbnRlcmFjdGlvbnMiLCJfZmV0Y2giLCJfbmF2aWdhdGlvbiIsIl9zdG9yYWdlIiwiX3RyYW5zYWN0aW9ucyIsIl93YWl0aW5nIiwiX3RyYW5zYWN0aW9uczIiLCJfYmFzZVNjcmFwZXJXaXRoQnJvd3NlciIsImUiLCJfX2VzTW9kdWxlIiwiZGVmYXVsdCIsImFwaUhlYWRlcnMiLCJPcmlnaW4iLCJSZWZlcmVyIiwiTE9HSU5fVVJMIiwiVFJBTlNBQ1RJT05TX1JFUVVFU1RfRU5EUE9JTlQiLCJGUkFNRVNfUkVRVUVTVF9FTkRQT0lOVCIsIlBFTkRJTkdfVFJBTlNBQ1RJT05TX1JFUVVFU1RfRU5EUE9JTlQiLCJTU09fQVVUSE9SSVpBVElPTl9SRVFVRVNUX0VORFBPSU5UIiwiSW52YWxpZFBhc3N3b3JkTWVzc2FnZSIsIkNoYW5nZVBhc3N3b3JkTWVzc2FnZSIsIkNoYW5nZVBhc3N3b3JkU3VidGl0bGUiLCJDaGFuZ2VQYXNzd29yZFVybCIsImRlYnVnIiwiZ2V0RGVidWciLCJUcm5UeXBlQ29kZSIsImlzQXV0aE1vZHVsZSIsInJlc3VsdCIsIkJvb2xlYW4iLCJhdXRoIiwiY2FsQ29ubmVjdFRva2VuIiwiU3RyaW5nIiwidHJpbSIsImF1dGhNb2R1bGVPclVuZGVmaW5lZCIsInVuZGVmaW5lZCIsImlzUGVuZGluZyIsInRyYW5zYWN0aW9uIiwiZGViQ3JkRGF0ZSIsImlzQ2FyZFRyYW5zYWN0aW9uRGV0YWlscyIsImlzQ2FyZFBlbmRpbmdUcmFuc2FjdGlvbkRldGFpbHMiLCJnZXRMb2dpbkZyYW1lIiwicGFnZSIsImZyYW1lIiwid2FpdFVudGlsIiwiZnJhbWVzIiwiZmluZCIsImYiLCJ1cmwiLCJpbmNsdWRlcyIsIlByb21pc2UiLCJyZXNvbHZlIiwiRXJyb3IiLCJoYXNJbnZhbGlkUGFzc3dvcmRFcnJvciIsImVycm9yRm91bmQiLCJlbGVtZW50UHJlc2VudE9uUGFnZSIsImVycm9yTWVzc2FnZSIsInBhZ2VFdmFsIiwiaXRlbSIsImlubmVyVGV4dCIsImhhc0NoYW5nZVBhc3N3b3JkRm9ybSIsImNoYW5nZVBhc3N3b3JkRnJhbWUiLCJzdWJ0aXRsZVRleHQiLCJlcnJUZXh0IiwibWVzc2FnZSIsImdldFBvc3NpYmxlTG9naW5SZXN1bHRzIiwidXJscyIsIkxvZ2luUmVzdWx0cyIsIlN1Y2Nlc3MiLCJJbnZhbGlkUGFzc3dvcmQiLCJvcHRpb25zIiwiQ2hhbmdlUGFzc3dvcmQiLCJjcmVhdGVMb2dpbkZpZWxkcyIsImNyZWRlbnRpYWxzIiwic2VsZWN0b3IiLCJ2YWx1ZSIsInVzZXJuYW1lIiwicGFzc3dvcmQiLCJjb252ZXJ0UGFyc2VkRGF0YVRvVHJhbnNhY3Rpb25zIiwiZGF0YSIsInBlbmRpbmdEYXRhIiwicGVuZGluZ1RyYW5zYWN0aW9ucyIsImNhcmRzTGlzdCIsImZsYXRNYXAiLCJjYXJkIiwiYXV0aERldGFsaXNMaXN0IiwiYmFua0FjY291bnRzIiwibW9udGhEYXRhIiwicmVndWxhckRlYml0RGF5cyIsImFjY291bnRzIiwiZGViaXREYXRlcyIsImltbWVkaWF0ZURlYml0RGF5cyIsImltbWlkaWF0ZURlYml0cyIsImRlYml0RGF5cyIsImNvbXBsZXRlZFRyYW5zYWN0aW9ucyIsImRlYml0RGF0ZSIsInRyYW5zYWN0aW9ucyIsImFsbCIsIm1hcCIsIm51bU9mUGF5bWVudHMiLCJudW1iZXJPZlBheW1lbnRzIiwiaW5zdGFsbG1lbnRzIiwibnVtYmVyIiwiY3VyUGF5bWVudE51bSIsInRvdGFsIiwiZGF0ZSIsIm1vbWVudCIsInRyblB1cmNoYXNlRGF0ZSIsImNoYXJnZWRBbW91bnQiLCJ0cm5BbXQiLCJhbXRCZWZvcmVDb252QW5kSW5kZXgiLCJvcmlnaW5hbEFtb3VudCIsInRyblR5cGVDb2RlIiwiY3JlZGl0IiwiaWRlbnRpZmllciIsInRybkludElkIiwidHlwZSIsInJlZ3VsYXIiLCJzdGFuZGluZ09yZGVyIiwiVHJhbnNhY3Rpb25UeXBlcyIsIk5vcm1hbCIsIkluc3RhbGxtZW50cyIsInN0YXR1cyIsIlRyYW5zYWN0aW9uU3RhdHVzZXMiLCJQZW5kaW5nIiwiQ29tcGxldGVkIiwiYWRkIiwidG9JU09TdHJpbmciLCJwcm9jZXNzZWREYXRlIiwiRGF0ZSIsIm9yaWdpbmFsQ3VycmVuY3kiLCJ0cm5DdXJyZW5jeVN5bWJvbCIsImNoYXJnZWRDdXJyZW5jeSIsImRlYkNyZEN1cnJlbmN5U3ltYm9sIiwiZGVzY3JpcHRpb24iLCJtZXJjaGFudE5hbWUiLCJtZW1vIiwidHJhbnNUeXBlQ29tbWVudERldGFpbHMiLCJ0b1N0cmluZyIsImNhdGVnb3J5IiwiYnJhbmNoQ29kZURlc2MiLCJpbmNsdWRlUmF3VHJhbnNhY3Rpb24iLCJyYXdUcmFuc2FjdGlvbiIsImdldFJhd1RyYW5zYWN0aW9uIiwiVmlzYUNhbFNjcmFwZXIiLCJCYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiYXV0aG9yaXphdGlvbiIsIm9wZW5Mb2dpblBvcHVwIiwid2FpdFVudGlsRWxlbWVudEZvdW5kIiwiY2xpY2tCdXR0b24iLCJnZXRDYXJkcyIsImluaXREYXRhIiwiZ2V0RnJvbVNlc3Npb25TdG9yYWdlIiwiY2FyZHMiLCJjYXJkVW5pcXVlSWQiLCJsYXN0NERpZ2l0cyIsImdldEF1dGhvcml6YXRpb25IZWFkZXIiLCJhdXRoTW9kdWxlIiwiZ2V0WFNpdGVJZCIsImdldExvZ2luT3B0aW9ucyIsImF1dGhSZXF1ZXN0UHJvbWlzZSIsIndhaXRGb3JSZXF1ZXN0IiwidGltZW91dCIsImNhdGNoIiwibG9naW5VcmwiLCJmaWVsZHMiLCJzdWJtaXRCdXR0b25TZWxlY3RvciIsInBvc3NpYmxlUmVzdWx0cyIsImNoZWNrUmVhZGluZXNzIiwicHJlQWN0aW9uIiwicG9zdEFjdGlvbiIsIndhaXRGb3JOYXZpZ2F0aW9uIiwiY3VycmVudFVybCIsImdldEN1cnJlbnRVcmwiLCJlbmRzV2l0aCIsInJlcXVlc3QiLCJoZWFkZXJzIiwicmVxdWlyZXNDaGFuZ2VQYXNzd29yZCIsInVzZXJBZ2VudCIsImZldGNoQ2FyZERhdGEiLCJzdGFydE1vbWVudCIsInN0YXJ0RGF0ZSIsImZ1dHVyZU1vbnRoc1RvU2NyYXBlIiwiQXV0aG9yaXphdGlvbiIsInhTaXRlSWQiLCJmZXRjaFBvc3QiLCJjYXJkc0ZvckZyYW1lRGF0YSIsImJhbmtJc3N1ZWRGcmFtZSIsImJhbmtJc3N1ZWRDYXJkcyIsImNhcmRMZXZlbEZyYW1lcyIsImNhbElzc3VlZEZyYW1lIiwiY2FsSXNzdWVkQ2FyZHMiLCJjYXJkVHlwZSIsImFjY291bnRHcm91cCIsIkNhcmRUeXBlIiwiQmFua0lzc3VlZCIsIkNvbXBhbnlJc3N1ZWQiLCJiYWxhbmNlRGF0ZSIsIm5leHREZWJpdERhdGUiLCJuZXh0VG90YWxEZWJpdERhdGVGb3JBY2NvdW50IiwiZmluYWxNb250aFRvRmV0Y2hNb21lbnQiLCJtb250aHMiLCJkaWZmIiwiYWxsTW9udGhzRGF0YSIsImNhcmRVbmlxdWVJREFycmF5IiwiaSIsIm1vbnRoIiwiY2xvbmUiLCJzdWJ0cmFjdCIsImZvcm1hdCIsInllYXIiLCJzdGF0dXNDb2RlIiwidGl0bGUiLCJwdXNoIiwidHhucyIsIm91dHB1dERhdGEiLCJlbmFibGVUcmFuc2FjdGlvbnNGaWx0ZXJCeURhdGUiLCJmaWx0ZXJPbGRUcmFuc2FjdGlvbnMiLCJjb21iaW5lSW5zdGFsbG1lbnRzIiwiYmFsYW5jZUFtb3VudCIsIm5leHRUb3RhbERlYml0IiwibmV4dFRvdGFsRGViaXRGb3JBY2NvdW50IiwiYmFsYW5jZSIsImFjY291bnROdW1iZXIiLCJjYXJkRnJhbWUiLCJmcmFtZUxpbWl0Rm9yQ2FyZEFtb3VudCIsImZldGNoRGF0YSIsImRlZmF1bHRTdGFydE1vbWVudCIsInRvRGF0ZSIsIm1heCIsIkpTT04iLCJzdHJpbmdpZnkiLCJzdWNjZXNzIiwiX2RlZmF1bHQiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vc3JjL3NjcmFwZXJzL3Zpc2EtY2FsLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBtb21lbnQgZnJvbSAnbW9tZW50JztcbmltcG9ydCB7IHR5cGUgSFRUUFJlcXVlc3QsIHR5cGUgRnJhbWUsIHR5cGUgUGFnZSB9IGZyb20gJ3B1cHBldGVlcic7XG5pbXBvcnQgeyBnZXREZWJ1ZyB9IGZyb20gJy4uL2hlbHBlcnMvZGVidWcnO1xuaW1wb3J0IHsgY2xpY2tCdXR0b24sIGVsZW1lbnRQcmVzZW50T25QYWdlLCBwYWdlRXZhbCwgd2FpdFVudGlsRWxlbWVudEZvdW5kIH0gZnJvbSAnLi4vaGVscGVycy9lbGVtZW50cy1pbnRlcmFjdGlvbnMnO1xuaW1wb3J0IHsgZmV0Y2hQb3N0IH0gZnJvbSAnLi4vaGVscGVycy9mZXRjaCc7XG5pbXBvcnQgeyBnZXRDdXJyZW50VXJsLCB3YWl0Rm9yTmF2aWdhdGlvbiB9IGZyb20gJy4uL2hlbHBlcnMvbmF2aWdhdGlvbic7XG5pbXBvcnQgeyBnZXRGcm9tU2Vzc2lvblN0b3JhZ2UgfSBmcm9tICcuLi9oZWxwZXJzL3N0b3JhZ2UnO1xuaW1wb3J0IHsgZmlsdGVyT2xkVHJhbnNhY3Rpb25zLCBnZXRSYXdUcmFuc2FjdGlvbiB9IGZyb20gJy4uL2hlbHBlcnMvdHJhbnNhY3Rpb25zJztcbmltcG9ydCB7IHdhaXRVbnRpbCB9IGZyb20gJy4uL2hlbHBlcnMvd2FpdGluZyc7XG5pbXBvcnQge1xuICBDYXJkVHlwZSxcbiAgVHJhbnNhY3Rpb25TdGF0dXNlcyxcbiAgVHJhbnNhY3Rpb25UeXBlcyxcbiAgdHlwZSBUcmFuc2FjdGlvbixcbiAgdHlwZSBUcmFuc2FjdGlvbnNBY2NvdW50LFxufSBmcm9tICcuLi90cmFuc2FjdGlvbnMnO1xuaW1wb3J0IHsgQmFzZVNjcmFwZXJXaXRoQnJvd3NlciwgTG9naW5SZXN1bHRzLCB0eXBlIExvZ2luT3B0aW9ucyB9IGZyb20gJy4vYmFzZS1zY3JhcGVyLXdpdGgtYnJvd3Nlcic7XG5pbXBvcnQgeyB0eXBlIFNjcmFwZXJTY3JhcGluZ1Jlc3VsdCwgdHlwZSBTY3JhcGVyT3B0aW9ucyB9IGZyb20gJy4vaW50ZXJmYWNlJztcblxuY29uc3QgYXBpSGVhZGVycyA9IHtcbiAgJ1VzZXItQWdlbnQnOlxuICAgICdNb3ppbGxhLzUuMCAoTWFjaW50b3NoOyBJbnRlbCBNYWMgT1MgWCAxMF8xNV83KSBBcHBsZVdlYktpdC81MzcuMzYgKEtIVE1MLCBsaWtlIEdlY2tvKSBDaHJvbWUvMTQyLjAuMC4wIFNhZmFyaS81MzcuMzYnLFxuICBPcmlnaW46ICdodHRwczovL2RpZ2l0YWwtd2ViLmNhbC1vbmxpbmUuY28uaWwnLFxuICBSZWZlcmVyOiAnaHR0cHM6Ly9kaWdpdGFsLXdlYi5jYWwtb25saW5lLmNvLmlsJyxcbiAgJ0FjY2VwdC1MYW5ndWFnZSc6ICdoZS1JTCxoZTtxPTAuOSxlbi1VUztxPTAuOCxlbjtxPTAuNycsXG4gICdTZWMtRmV0Y2gtU2l0ZSc6ICdzYW1lLXNpdGUnLFxuICAnU2VjLUZldGNoLU1vZGUnOiAnY29ycycsXG4gICdTZWMtRmV0Y2gtRGVzdCc6ICdlbXB0eScsXG59O1xuY29uc3QgTE9HSU5fVVJMID0gJ2h0dHBzOi8vd3d3LmNhbC1vbmxpbmUuY28uaWwvJztcbmNvbnN0IFRSQU5TQUNUSU9OU19SRVFVRVNUX0VORFBPSU5UID1cbiAgJ2h0dHBzOi8vYXBpLmNhbC1vbmxpbmUuY28uaWwvVHJhbnNhY3Rpb25zL2FwaS90cmFuc2FjdGlvbnNEZXRhaWxzL2dldENhcmRUcmFuc2FjdGlvbnNEZXRhaWxzJztcbmNvbnN0IEZSQU1FU19SRVFVRVNUX0VORFBPSU5UID0gJ2h0dHBzOi8vYXBpLmNhbC1vbmxpbmUuY28uaWwvRnJhbWVzL2FwaS9GcmFtZXMvR2V0RnJhbWVTdGF0dXMnO1xuY29uc3QgUEVORElOR19UUkFOU0FDVElPTlNfUkVRVUVTVF9FTkRQT0lOVCA9XG4gICdodHRwczovL2FwaS5jYWwtb25saW5lLmNvLmlsL1RyYW5zYWN0aW9ucy9hcGkvYXBwcm92YWxzL2dldENsZWFyYW5jZVJlcXVlc3RzJztcbmNvbnN0IFNTT19BVVRIT1JJWkFUSU9OX1JFUVVFU1RfRU5EUE9JTlQgPSAnaHR0cHM6Ly9jb25uZWN0LmNhbC1vbmxpbmUuY28uaWwvY29sLXJlc3QvY2FsY29ubmVjdC9hdXRoZW50aWNhdGlvbi9TU08nO1xuXG5jb25zdCBJbnZhbGlkUGFzc3dvcmRNZXNzYWdlID0gJ9ep150g15TXntep16rXntepINeQ15Ug15TXodeZ16HXnteUINep15TXldeW16DXlSDXqdeS15XXmdeZ150nO1xuY29uc3QgQ2hhbmdlUGFzc3dvcmRNZXNzYWdlID0gJ9ec15TXl9ec15nXoyDXodeZ16HXnteUJztcbmNvbnN0IENoYW5nZVBhc3N3b3JkU3VidGl0bGUgPSAn15TXkteZ16Ig15TXltee158g15zXodeZ16HXnteUINeX15PXqdeUJztcbmNvbnN0IENoYW5nZVBhc3N3b3JkVXJsID0gJy9jaGFuZ2UtcGFzc3dvcmQnO1xuXG5jb25zdCBkZWJ1ZyA9IGdldERlYnVnKCd2aXNhLWNhbCcpO1xuXG5lbnVtIFRyblR5cGVDb2RlIHtcbiAgcmVndWxhciA9ICc1JyxcbiAgY3JlZGl0ID0gJzYnLFxuICBpbnN0YWxsbWVudHMgPSAnOCcsXG4gIHN0YW5kaW5nT3JkZXIgPSAnOScsXG59XG5cbmludGVyZmFjZSBTY3JhcGVkVHJhbnNhY3Rpb24ge1xuICBhbXRCZWZvcmVDb252QW5kSW5kZXg6IG51bWJlcjtcbiAgYnJhbmNoQ29kZURlc2M6IHN0cmluZztcbiAgY2FzaEFjY01hbmFnZXJOYW1lOiBudWxsO1xuICBjYXNoQWNjb3VudE1hbmFnZXI6IG51bGw7XG4gIGNhc2hBY2NvdW50VHJuQW10OiBudW1iZXI7XG4gIGNoYXJnZUV4dGVybmFsVG9DYXJkQ29tbWVudDogc3RyaW5nO1xuICBjb21tZW50czogW107XG4gIGN1clBheW1lbnROdW06IG51bWJlcjtcbiAgZGViQ3JkQ3VycmVuY3lTeW1ib2w6IEN1cnJlbmN5U3ltYm9sO1xuICBkZWJDcmREYXRlOiBzdHJpbmc7XG4gIGRlYml0U3ByZWFkSW5kOiBib29sZWFuO1xuICBkaXNjb3VudEFtb3VudDogdW5rbm93bjtcbiAgZGlzY291bnRSZWFzb246IHVua25vd247XG4gIGltbWVkaWF0ZUNvbW1lbnRzOiBbXTtcbiAgaXNJbW1lZGlhdGVDb21tZW50SW5kOiBib29sZWFuO1xuICBpc0ltbWVkaWF0ZUhIS0luZDogYm9vbGVhbjtcbiAgaXNNYXJnYXJpdGE6IGJvb2xlYW47XG4gIGlzU3ByZWFkUGF5bWVuc3RBYnJvYWQ6IGJvb2xlYW47XG4gIGxpbmtlZENvbW1lbnRzOiBbXTtcbiAgbWVyY2hhbnRBZGRyZXNzOiBzdHJpbmc7XG4gIG1lcmNoYW50TmFtZTogc3RyaW5nO1xuICBtZXJjaGFudFBob25lTm86IHN0cmluZztcbiAgbnVtT2ZQYXltZW50czogbnVtYmVyO1xuICBvbkdvaW5nVHJhbnNhY3Rpb25zQ29tbWVudDogc3RyaW5nO1xuICByZWZ1bmRJbmQ6IGJvb2xlYW47XG4gIHJvdW5kaW5nQW1vdW50OiB1bmtub3duO1xuICByb3VuZGluZ1JlYXNvbjogdW5rbm93bjtcbiAgdG9rZW5JbmQ6IDA7XG4gIHRva2VuTnVtYmVyUGFydDQ6ICcnO1xuICB0cmFuc0NhcmRQcmVzZW50SW5kOiBib29sZWFuO1xuICB0cmFuc1R5cGVDb21tZW50RGV0YWlsczogW107XG4gIHRybkFtdDogbnVtYmVyO1xuICB0cm5DdXJyZW5jeVN5bWJvbDogQ3VycmVuY3lTeW1ib2w7XG4gIHRybkV4YWNXYXk6IG51bWJlcjtcbiAgdHJuSW50SWQ6IHN0cmluZztcbiAgdHJuTnVtYXJldG9yOiBudW1iZXI7XG4gIHRyblB1cmNoYXNlRGF0ZTogc3RyaW5nO1xuICB0cm5UeXBlOiBzdHJpbmc7XG4gIHRyblR5cGVDb2RlOiBUcm5UeXBlQ29kZTtcbiAgd2FsbGV0UHJvdmlkZXJDb2RlOiAwO1xuICB3YWxsZXRQcm92aWRlckRlc2M6ICcnO1xuICBlYXJseVBheW1lbnRJbmQ6IGJvb2xlYW47XG59XG5pbnRlcmZhY2UgU2NyYXBlZFBlbmRpbmdUcmFuc2FjdGlvbiB7XG4gIG1lcmNoYW50SUQ6IHN0cmluZztcbiAgbWVyY2hhbnROYW1lOiBzdHJpbmc7XG4gIHRyblB1cmNoYXNlRGF0ZTogc3RyaW5nO1xuICB3YWxsZXRUcmFuSW5kOiBudW1iZXI7XG4gIHRyYW5zYWN0aW9uc09yaWdpbjogbnVtYmVyO1xuICB0cm5BbXQ6IG51bWJlcjtcbiAgdHBhQXBwcm92YWxBbW91bnQ6IHVua25vd247XG4gIHRybkN1cnJlbmN5U3ltYm9sOiBDdXJyZW5jeVN5bWJvbDtcbiAgdHJuVHlwZUNvZGU6IFRyblR5cGVDb2RlO1xuICB0cm5UeXBlOiBzdHJpbmc7XG4gIGJyYW5jaENvZGVEZXNjOiBzdHJpbmc7XG4gIHRyYW5zQ2FyZFByZXNlbnRJbmQ6IGJvb2xlYW47XG4gIGo1SW5kaWNhdG9yOiBzdHJpbmc7XG4gIG51bWJlck9mUGF5bWVudHM6IG51bWJlcjtcbiAgZmlyc3RQYXltZW50QW1vdW50OiBudW1iZXI7XG4gIHRyYW5zVHlwZUNvbW1lbnREZXRhaWxzOiBbXTtcbn1cbmludGVyZmFjZSBJbml0UmVzcG9uc2Uge1xuICByZXN1bHQ6IHtcbiAgICBjYXJkczoge1xuICAgICAgY2FyZFVuaXF1ZUlkOiBzdHJpbmc7XG4gICAgICBsYXN0NERpZ2l0czogc3RyaW5nO1xuICAgICAgW2tleTogc3RyaW5nXTogdW5rbm93bjtcbiAgICB9W107XG4gIH07XG59XG50eXBlIEN1cnJlbmN5U3ltYm9sID0gc3RyaW5nO1xuaW50ZXJmYWNlIENhcmRUcmFuc2FjdGlvbkRldGFpbHNFcnJvciB7XG4gIHRpdGxlOiBzdHJpbmc7XG4gIHN0YXR1c0NvZGU6IG51bWJlcjtcbn1cbmludGVyZmFjZSBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzIGV4dGVuZHMgQ2FyZFRyYW5zYWN0aW9uRGV0YWlsc0Vycm9yIHtcbiAgcmVzdWx0OiB7XG4gICAgYmFua0FjY291bnRzOiB7XG4gICAgICBiYW5rQWNjb3VudE51bTogc3RyaW5nO1xuICAgICAgYmFua05hbWU6IHN0cmluZztcbiAgICAgIGNob2ljZUV4dGVybmFsVHJhbnNhY3Rpb25zOiBhbnk7XG4gICAgICBjdXJyZW50QmFua0FjY291bnRJbmQ6IGJvb2xlYW47XG4gICAgICBkZWJpdERhdGVzOiB7XG4gICAgICAgIGJhc2tldEFtb3VudENvbW1lbnQ6IHVua25vd247XG4gICAgICAgIGNob2ljZUhIS0RlYml0OiBudW1iZXI7XG4gICAgICAgIGRhdGU6IHN0cmluZztcbiAgICAgICAgZGViaXRSZWFzb246IHVua25vd247XG4gICAgICAgIGZpeERlYml0QW1vdW50OiBudW1iZXI7XG4gICAgICAgIGZyb21QdXJjaGFzZURhdGU6IHN0cmluZztcbiAgICAgICAgaXNDaG9pY2VSZXBhaW1lbnQ6IGJvb2xlYW47XG4gICAgICAgIHRvUHVyY2hhc2VEYXRlOiBzdHJpbmc7XG4gICAgICAgIHRvdGFsQmFza2V0QW1vdW50OiBudW1iZXI7XG4gICAgICAgIHRvdGFsRGViaXRzOiB7XG4gICAgICAgICAgY3VycmVuY3lTeW1ib2w6IEN1cnJlbmN5U3ltYm9sO1xuICAgICAgICAgIGFtb3VudDogbnVtYmVyO1xuICAgICAgICB9W107XG4gICAgICAgIHRyYW5zYWN0aW9uczogU2NyYXBlZFRyYW5zYWN0aW9uW107XG4gICAgICB9W107XG4gICAgICBpbW1pZGlhdGVEZWJpdHM6IHsgdG90YWxEZWJpdHM6IFtdOyBkZWJpdERheXM6IFtdIH07XG4gICAgfVtdO1xuICAgIGJsb2NrZWRDYXJkSW5kOiBib29sZWFuO1xuICB9O1xuICBzdGF0dXNDb2RlOiAxO1xuICBzdGF0dXNEZXNjcmlwdGlvbjogc3RyaW5nO1xuICBzdGF0dXNUaXRsZTogc3RyaW5nO1xufVxuaW50ZXJmYWNlIENhcmRQZW5kaW5nVHJhbnNhY3Rpb25EZXRhaWxzIGV4dGVuZHMgQ2FyZFRyYW5zYWN0aW9uRGV0YWlsc0Vycm9yIHtcbiAgcmVzdWx0OiB7XG4gICAgY2FyZHNMaXN0OiB7XG4gICAgICBjYXJkVW5pcXVlSUQ6IHN0cmluZztcbiAgICAgIGF1dGhEZXRhbGlzTGlzdDogU2NyYXBlZFBlbmRpbmdUcmFuc2FjdGlvbltdO1xuICAgIH1bXTtcbiAgfTtcbiAgc3RhdHVzQ29kZTogMTtcbiAgc3RhdHVzRGVzY3JpcHRpb246IHN0cmluZztcbiAgc3RhdHVzVGl0bGU6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIENhcmRMZXZlbEZyYW1lIHtcbiAgY2FyZFVuaXF1ZUlkOiBzdHJpbmc7XG4gIG5leHRUb3RhbERlYml0PzogbnVtYmVyO1xuICBuZXh0RGViaXREYXRlPzogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgSXNzdWVkQ2FyZHNHcm91cCB7XG4gIG5leHRUb3RhbERlYml0Rm9yQWNjb3VudD86IG51bWJlcjtcbiAgbmV4dFRvdGFsRGViaXREYXRlRm9yQWNjb3VudD86IHN0cmluZyB8IG51bGw7XG4gIGZyYW1lTGltaXRGb3JDYXJkQW1vdW50PzogbnVtYmVyO1xuICBjYXJkTGV2ZWxGcmFtZXM/OiBDYXJkTGV2ZWxGcmFtZVtdO1xufVxuXG5pbnRlcmZhY2UgRnJhbWVzUmVzcG9uc2Uge1xuICByZXN1bHQ/OiB7XG4gICAgY2FsSXNzdWVkQ2FyZHM/OiBJc3N1ZWRDYXJkc0dyb3VwO1xuICAgIGJhbmtJc3N1ZWRDYXJkcz86IElzc3VlZENhcmRzR3JvdXA7XG4gIH07XG59XG5cbmludGVyZmFjZSBBdXRoTW9kdWxlIHtcbiAgYXV0aDoge1xuICAgIGNhbENvbm5lY3RUb2tlbjogc3RyaW5nIHwgbnVsbDtcbiAgfTtcbn1cblxuZnVuY3Rpb24gaXNBdXRoTW9kdWxlKHJlc3VsdDogYW55KTogcmVzdWx0IGlzIEF1dGhNb2R1bGUge1xuICByZXR1cm4gQm9vbGVhbihyZXN1bHQ/LmF1dGg/LmNhbENvbm5lY3RUb2tlbiAmJiBTdHJpbmcocmVzdWx0LmF1dGguY2FsQ29ubmVjdFRva2VuKS50cmltKCkpO1xufVxuXG5mdW5jdGlvbiBhdXRoTW9kdWxlT3JVbmRlZmluZWQocmVzdWx0OiBhbnkpOiBBdXRoTW9kdWxlIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIGlzQXV0aE1vZHVsZShyZXN1bHQpID8gcmVzdWx0IDogdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBpc1BlbmRpbmcoXG4gIHRyYW5zYWN0aW9uOiBTY3JhcGVkVHJhbnNhY3Rpb24gfCBTY3JhcGVkUGVuZGluZ1RyYW5zYWN0aW9uLFxuKTogdHJhbnNhY3Rpb24gaXMgU2NyYXBlZFBlbmRpbmdUcmFuc2FjdGlvbiB7XG4gIHJldHVybiAodHJhbnNhY3Rpb24gYXMgU2NyYXBlZFRyYW5zYWN0aW9uKS5kZWJDcmREYXRlID09PSB1bmRlZmluZWQ7IC8vIGFuIGFyYml0cmFyeSBmaWVsZCB0aGF0IG9ubHkgYXBwZWFycyBpbiBhIGNvbXBsZXRlZCB0cmFuc2FjdGlvblxufVxuXG5mdW5jdGlvbiBpc0NhcmRUcmFuc2FjdGlvbkRldGFpbHMoXG4gIHJlc3VsdDogQ2FyZFRyYW5zYWN0aW9uRGV0YWlscyB8IENhcmRUcmFuc2FjdGlvbkRldGFpbHNFcnJvcixcbik6IHJlc3VsdCBpcyBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzIHtcbiAgcmV0dXJuIChyZXN1bHQgYXMgQ2FyZFRyYW5zYWN0aW9uRGV0YWlscykucmVzdWx0ICE9PSB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIGlzQ2FyZFBlbmRpbmdUcmFuc2FjdGlvbkRldGFpbHMoXG4gIHJlc3VsdDogQ2FyZFBlbmRpbmdUcmFuc2FjdGlvbkRldGFpbHMgfCBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzRXJyb3IsXG4pOiByZXN1bHQgaXMgQ2FyZFBlbmRpbmdUcmFuc2FjdGlvbkRldGFpbHMge1xuICByZXR1cm4gKHJlc3VsdCBhcyBDYXJkUGVuZGluZ1RyYW5zYWN0aW9uRGV0YWlscykucmVzdWx0ICE9PSB1bmRlZmluZWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldExvZ2luRnJhbWUocGFnZTogUGFnZSkge1xuICBsZXQgZnJhbWU6IEZyYW1lIHwgbnVsbCA9IG51bGw7XG4gIGRlYnVnKCd3YWl0IHVudGlsIGxvZ2luIGZyYW1lIGZvdW5kJyk7XG4gIGF3YWl0IHdhaXRVbnRpbChcbiAgICAoKSA9PiB7XG4gICAgICBmcmFtZSA9IHBhZ2UuZnJhbWVzKCkuZmluZChmID0+IGYudXJsKCkuaW5jbHVkZXMoJ2Nvbm5lY3QnKSkgfHwgbnVsbDtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoISFmcmFtZSk7XG4gICAgfSxcbiAgICAnd2FpdCBmb3IgaWZyYW1lIHdpdGggbG9naW4gZm9ybScsXG4gICAgMTAwMDAsXG4gICAgMTAwMCxcbiAgKTtcblxuICBpZiAoIWZyYW1lKSB7XG4gICAgZGVidWcoJ2ZhaWxlZCB0byBmaW5kIGxvZ2luIGZyYW1lIGZvciAxMCBzZWNvbmRzJyk7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdmYWlsZWQgdG8gZXh0cmFjdCBsb2dpbiBpZnJhbWUnKTtcbiAgfVxuXG4gIHJldHVybiBmcmFtZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFzSW52YWxpZFBhc3N3b3JkRXJyb3IocGFnZTogUGFnZSkge1xuICBjb25zdCBmcmFtZSA9IGF3YWl0IGdldExvZ2luRnJhbWUocGFnZSk7XG4gIGNvbnN0IGVycm9yRm91bmQgPSBhd2FpdCBlbGVtZW50UHJlc2VudE9uUGFnZShmcmFtZSwgJ2Rpdi5nZW5lcmFsLWVycm9yID4gZGl2Jyk7XG4gIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yRm91bmRcbiAgICA/IGF3YWl0IHBhZ2VFdmFsKGZyYW1lLCAnZGl2LmdlbmVyYWwtZXJyb3IgPiBkaXYnLCAnJywgaXRlbSA9PiB7XG4gICAgICAgIHJldHVybiAoaXRlbSBhcyBIVE1MRGl2RWxlbWVudCkuaW5uZXJUZXh0O1xuICAgICAgfSlcbiAgICA6ICcnO1xuICByZXR1cm4gZXJyb3JNZXNzYWdlID09PSBJbnZhbGlkUGFzc3dvcmRNZXNzYWdlO1xufVxuXG5hc3luYyBmdW5jdGlvbiBoYXNDaGFuZ2VQYXNzd29yZEZvcm0ocGFnZTogUGFnZSkge1xuICAvLyBDaGVjayBpZiBhbnkgZnJhbWUgbmF2aWdhdGVkIHRvIHRoZSBjaGFuZ2UtcGFzc3dvcmQgcm91dGVcbiAgY29uc3QgY2hhbmdlUGFzc3dvcmRGcmFtZSA9IHBhZ2UuZnJhbWVzKCkuZmluZChmID0+IHtcbiAgICBjb25zdCB1cmwgPSBmLnVybCgpO1xuICAgIHJldHVybiB1cmwuaW5jbHVkZXMoJ2Nvbm5lY3QuY2FsLW9ubGluZS5jby5pbCcpICYmIHVybC5pbmNsdWRlcyhDaGFuZ2VQYXNzd29yZFVybCk7XG4gIH0pO1xuICBpZiAoY2hhbmdlUGFzc3dvcmRGcmFtZSkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBmcmFtZSA9IGF3YWl0IGdldExvZ2luRnJhbWUocGFnZSk7XG5cbiAgICAvLyBDaGVjayBmb3IgdGhlIGNoYW5nZS1wYXNzd29yZCBBbmd1bGFyIGNvbXBvbmVudFxuICAgIGlmIChhd2FpdCBlbGVtZW50UHJlc2VudE9uUGFnZShmcmFtZSwgJ2NoYW5nZS1wYXNzd29yZCcpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBmb3IgdGhlIGNoYW5nZSBwYXNzd29yZCB0aXRsZSBlbGVtZW50XG4gICAgaWYgKGF3YWl0IGVsZW1lbnRQcmVzZW50T25QYWdlKGZyYW1lLCAnLmNoYW5nZS1wYXNzd29yZC10aXRsZScpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBmb3IgdGhlIGNoYW5nZSBwYXNzd29yZCBzdWJ0aXRsZSB0ZXh0XG4gICAgaWYgKGF3YWl0IGVsZW1lbnRQcmVzZW50T25QYWdlKGZyYW1lLCAnLmNoYW5nZS1wYXNzd29yZC1zdWJ0aXRsZScpKSB7XG4gICAgICBjb25zdCBzdWJ0aXRsZVRleHQgPSBhd2FpdCBwYWdlRXZhbChmcmFtZSwgJy5jaGFuZ2UtcGFzc3dvcmQtc3VidGl0bGUnLCAnJywgaXRlbSA9PiB7XG4gICAgICAgIHJldHVybiAoaXRlbSBhcyBIVE1MRWxlbWVudCkuaW5uZXJUZXh0LnRyaW0oKTtcbiAgICAgIH0pO1xuICAgICAgaWYgKHN1YnRpdGxlVGV4dC5pbmNsdWRlcyhDaGFuZ2VQYXNzd29yZFN1YnRpdGxlKSkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBMZWdhY3k6IGNoZWNrIGZvciB0aGUgb2xkIC5lcnItZGVzYyBiYXNlZCBjaGFuZ2UgcGFzc3dvcmQgbWVzc2FnZVxuICAgIGNvbnN0IGVycm9yRm91bmQgPSBhd2FpdCBlbGVtZW50UHJlc2VudE9uUGFnZShmcmFtZSwgJy5lcnItZGVzYycpO1xuICAgIGlmIChlcnJvckZvdW5kKSB7XG4gICAgICBjb25zdCBlcnJUZXh0ID0gYXdhaXQgcGFnZUV2YWwoZnJhbWUsICcuZXJyLWRlc2MnLCAnJywgaXRlbSA9PiB7XG4gICAgICAgIHJldHVybiAoaXRlbSBhcyBIVE1MRWxlbWVudCkuaW5uZXJUZXh0LnRyaW0oKTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIGVyclRleHQuaW5jbHVkZXMoQ2hhbmdlUGFzc3dvcmRNZXNzYWdlKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBkZWJ1ZygnZmFpbGVkIHRvIGNoZWNrIGNoYW5nZSBwYXNzd29yZCBmb3JtIGluIGxvZ2luIGZyYW1lOiAlcycsIChlIGFzIEVycm9yKS5tZXNzYWdlKTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbmZ1bmN0aW9uIGdldFBvc3NpYmxlTG9naW5SZXN1bHRzKCkge1xuICBkZWJ1ZygncmV0dXJuIHBvc3NpYmxlIGxvZ2luIHJlc3VsdHMnKTtcbiAgY29uc3QgdXJsczogTG9naW5PcHRpb25zWydwb3NzaWJsZVJlc3VsdHMnXSA9IHtcbiAgICBbTG9naW5SZXN1bHRzLlN1Y2Nlc3NdOiBbL2Rhc2hib2FyZC9pXSxcbiAgICBbTG9naW5SZXN1bHRzLkludmFsaWRQYXNzd29yZF06IFtcbiAgICAgIGFzeW5jIChvcHRpb25zPzogeyBwYWdlPzogUGFnZSB9KSA9PiB7XG4gICAgICAgIGNvbnN0IHBhZ2UgPSBvcHRpb25zPy5wYWdlO1xuICAgICAgICBpZiAoIXBhZ2UpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGhhc0ludmFsaWRQYXNzd29yZEVycm9yKHBhZ2UpO1xuICAgICAgfSxcbiAgICBdLFxuICAgIC8vIFtMb2dpblJlc3VsdHMuQWNjb3VudEJsb2NrZWRdOiBbXSwgLy8gVE9ETyBhZGQgd2hlbiByZWFjaGluZyB0aGlzIHNjZW5hcmlvXG4gICAgW0xvZ2luUmVzdWx0cy5DaGFuZ2VQYXNzd29yZF06IFtcbiAgICAgIGFzeW5jIChvcHRpb25zPzogeyBwYWdlPzogUGFnZSB9KSA9PiB7XG4gICAgICAgIGNvbnN0IHBhZ2UgPSBvcHRpb25zPy5wYWdlO1xuICAgICAgICBpZiAoIXBhZ2UpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGhhc0NoYW5nZVBhc3N3b3JkRm9ybShwYWdlKTtcbiAgICAgIH0sXG4gICAgXSxcbiAgfTtcbiAgcmV0dXJuIHVybHM7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUxvZ2luRmllbGRzKGNyZWRlbnRpYWxzOiBTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscykge1xuICBkZWJ1ZygnY3JlYXRlIGxvZ2luIGZpZWxkcyBmb3IgdXNlcm5hbWUgYW5kIHBhc3N3b3JkJyk7XG4gIHJldHVybiBbXG4gICAgeyBzZWxlY3RvcjogJ1tmb3JtY29udHJvbG5hbWU9XCJ1c2VyTmFtZVwiXScsIHZhbHVlOiBjcmVkZW50aWFscy51c2VybmFtZSB9LFxuICAgIHsgc2VsZWN0b3I6ICdbZm9ybWNvbnRyb2xuYW1lPVwicGFzc3dvcmRcIl0nLCB2YWx1ZTogY3JlZGVudGlhbHMucGFzc3dvcmQgfSxcbiAgXTtcbn1cblxuZnVuY3Rpb24gY29udmVydFBhcnNlZERhdGFUb1RyYW5zYWN0aW9ucyhcbiAgZGF0YTogQ2FyZFRyYW5zYWN0aW9uRGV0YWlsc1tdLFxuICBwZW5kaW5nRGF0YT86IENhcmRQZW5kaW5nVHJhbnNhY3Rpb25EZXRhaWxzIHwgbnVsbCxcbiAgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zLFxuKTogVHJhbnNhY3Rpb25bXSB7XG4gIGNvbnN0IHBlbmRpbmdUcmFuc2FjdGlvbnMgPSBwZW5kaW5nRGF0YT8ucmVzdWx0XG4gICAgPyBwZW5kaW5nRGF0YS5yZXN1bHQuY2FyZHNMaXN0LmZsYXRNYXAoY2FyZCA9PiBjYXJkLmF1dGhEZXRhbGlzTGlzdClcbiAgICA6IFtdO1xuXG4gIGNvbnN0IGJhbmtBY2NvdW50cyA9IGRhdGEuZmxhdE1hcChtb250aERhdGEgPT4gbW9udGhEYXRhLnJlc3VsdC5iYW5rQWNjb3VudHMpO1xuICBjb25zdCByZWd1bGFyRGViaXREYXlzID0gYmFua0FjY291bnRzLmZsYXRNYXAoYWNjb3VudHMgPT4gYWNjb3VudHMuZGViaXREYXRlcyk7XG4gIGNvbnN0IGltbWVkaWF0ZURlYml0RGF5cyA9IGJhbmtBY2NvdW50cy5mbGF0TWFwKGFjY291bnRzID0+IGFjY291bnRzLmltbWlkaWF0ZURlYml0cy5kZWJpdERheXMpO1xuICBjb25zdCBjb21wbGV0ZWRUcmFuc2FjdGlvbnMgPSBbLi4ucmVndWxhckRlYml0RGF5cywgLi4uaW1tZWRpYXRlRGViaXREYXlzXS5mbGF0TWFwKFxuICAgIGRlYml0RGF0ZSA9PiBkZWJpdERhdGUudHJhbnNhY3Rpb25zLFxuICApO1xuXG4gIGNvbnN0IGFsbDogKFNjcmFwZWRUcmFuc2FjdGlvbiB8IFNjcmFwZWRQZW5kaW5nVHJhbnNhY3Rpb24pW10gPSBbLi4ucGVuZGluZ1RyYW5zYWN0aW9ucywgLi4uY29tcGxldGVkVHJhbnNhY3Rpb25zXTtcblxuICByZXR1cm4gYWxsLm1hcCh0cmFuc2FjdGlvbiA9PiB7XG4gICAgY29uc3QgbnVtT2ZQYXltZW50cyA9IGlzUGVuZGluZyh0cmFuc2FjdGlvbikgPyB0cmFuc2FjdGlvbi5udW1iZXJPZlBheW1lbnRzIDogdHJhbnNhY3Rpb24ubnVtT2ZQYXltZW50cztcbiAgICBjb25zdCBpbnN0YWxsbWVudHMgPSBudW1PZlBheW1lbnRzXG4gICAgICA/IHtcbiAgICAgICAgICBudW1iZXI6IGlzUGVuZGluZyh0cmFuc2FjdGlvbikgPyAxIDogdHJhbnNhY3Rpb24uY3VyUGF5bWVudE51bSxcbiAgICAgICAgICB0b3RhbDogbnVtT2ZQYXltZW50cyxcbiAgICAgICAgfVxuICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICBjb25zdCBkYXRlID0gbW9tZW50KHRyYW5zYWN0aW9uLnRyblB1cmNoYXNlRGF0ZSk7XG5cbiAgICBjb25zdCBjaGFyZ2VkQW1vdW50ID0gKGlzUGVuZGluZyh0cmFuc2FjdGlvbikgPyB0cmFuc2FjdGlvbi50cm5BbXQgOiB0cmFuc2FjdGlvbi5hbXRCZWZvcmVDb252QW5kSW5kZXgpICogLTE7XG4gICAgY29uc3Qgb3JpZ2luYWxBbW91bnQgPSB0cmFuc2FjdGlvbi50cm5BbXQgKiAodHJhbnNhY3Rpb24udHJuVHlwZUNvZGUgPT09IFRyblR5cGVDb2RlLmNyZWRpdCA/IDEgOiAtMSk7XG5cbiAgICBjb25zdCByZXN1bHQ6IFRyYW5zYWN0aW9uID0ge1xuICAgICAgaWRlbnRpZmllcjogIWlzUGVuZGluZyh0cmFuc2FjdGlvbikgPyB0cmFuc2FjdGlvbi50cm5JbnRJZCA6IHVuZGVmaW5lZCxcbiAgICAgIHR5cGU6IFtUcm5UeXBlQ29kZS5yZWd1bGFyLCBUcm5UeXBlQ29kZS5zdGFuZGluZ09yZGVyXS5pbmNsdWRlcyh0cmFuc2FjdGlvbi50cm5UeXBlQ29kZSlcbiAgICAgICAgPyBUcmFuc2FjdGlvblR5cGVzLk5vcm1hbFxuICAgICAgICA6IFRyYW5zYWN0aW9uVHlwZXMuSW5zdGFsbG1lbnRzLFxuICAgICAgc3RhdHVzOiBpc1BlbmRpbmcodHJhbnNhY3Rpb24pID8gVHJhbnNhY3Rpb25TdGF0dXNlcy5QZW5kaW5nIDogVHJhbnNhY3Rpb25TdGF0dXNlcy5Db21wbGV0ZWQsXG4gICAgICBkYXRlOiBpbnN0YWxsbWVudHMgPyBkYXRlLmFkZChpbnN0YWxsbWVudHMubnVtYmVyIC0gMSwgJ21vbnRoJykudG9JU09TdHJpbmcoKSA6IGRhdGUudG9JU09TdHJpbmcoKSxcbiAgICAgIHByb2Nlc3NlZERhdGU6IGlzUGVuZGluZyh0cmFuc2FjdGlvbikgPyBkYXRlLnRvSVNPU3RyaW5nKCkgOiBuZXcgRGF0ZSh0cmFuc2FjdGlvbi5kZWJDcmREYXRlKS50b0lTT1N0cmluZygpLFxuICAgICAgb3JpZ2luYWxBbW91bnQsXG4gICAgICBvcmlnaW5hbEN1cnJlbmN5OiB0cmFuc2FjdGlvbi50cm5DdXJyZW5jeVN5bWJvbCxcbiAgICAgIGNoYXJnZWRBbW91bnQsXG4gICAgICBjaGFyZ2VkQ3VycmVuY3k6ICFpc1BlbmRpbmcodHJhbnNhY3Rpb24pID8gdHJhbnNhY3Rpb24uZGViQ3JkQ3VycmVuY3lTeW1ib2wgOiB1bmRlZmluZWQsXG4gICAgICBkZXNjcmlwdGlvbjogdHJhbnNhY3Rpb24ubWVyY2hhbnROYW1lLFxuICAgICAgbWVtbzogdHJhbnNhY3Rpb24udHJhbnNUeXBlQ29tbWVudERldGFpbHMudG9TdHJpbmcoKSxcbiAgICAgIGNhdGVnb3J5OiB0cmFuc2FjdGlvbi5icmFuY2hDb2RlRGVzYyxcbiAgICB9O1xuXG4gICAgaWYgKGluc3RhbGxtZW50cykge1xuICAgICAgcmVzdWx0Lmluc3RhbGxtZW50cyA9IGluc3RhbGxtZW50cztcbiAgICB9XG5cbiAgICBpZiAob3B0aW9ucz8uaW5jbHVkZVJhd1RyYW5zYWN0aW9uKSB7XG4gICAgICByZXN1bHQucmF3VHJhbnNhY3Rpb24gPSBnZXRSYXdUcmFuc2FjdGlvbih0cmFuc2FjdGlvbik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSk7XG59XG5cbnR5cGUgU2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHMgPSB7IHVzZXJuYW1lOiBzdHJpbmc7IHBhc3N3b3JkOiBzdHJpbmcgfTtcblxuY2xhc3MgVmlzYUNhbFNjcmFwZXIgZXh0ZW5kcyBCYXNlU2NyYXBlcldpdGhCcm93c2VyPFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzPiB7XG4gIHByaXZhdGUgYXV0aG9yaXphdGlvbjogc3RyaW5nIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuXG4gIHByaXZhdGUgYXV0aFJlcXVlc3RQcm9taXNlOiBQcm9taXNlPEhUVFBSZXF1ZXN0IHwgdW5kZWZpbmVkPiB8IHVuZGVmaW5lZDtcblxuICBvcGVuTG9naW5Qb3B1cCA9IGFzeW5jICgpID0+IHtcbiAgICBkZWJ1Zygnb3BlbiBsb2dpbiBwb3B1cCwgd2FpdCB1bnRpbCBsb2dpbiBidXR0b24gYXZhaWxhYmxlJyk7XG4gICAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHRoaXMucGFnZSwgJyNjY0xvZ2luRGVza3RvcEJ0bicsIHRydWUpO1xuICAgIGRlYnVnKCdjbGljayBvbiB0aGUgbG9naW4gYnV0dG9uJyk7XG4gICAgYXdhaXQgY2xpY2tCdXR0b24odGhpcy5wYWdlLCAnI2NjTG9naW5EZXNrdG9wQnRuJyk7XG4gICAgZGVidWcoJ2dldCB0aGUgZnJhbWUgdGhhdCBob2xkcyB0aGUgbG9naW4nKTtcbiAgICBjb25zdCBmcmFtZSA9IGF3YWl0IGdldExvZ2luRnJhbWUodGhpcy5wYWdlKTtcbiAgICBkZWJ1Zygnd2FpdCB1bnRpbCB0aGUgcGFzc3dvcmQgbG9naW4gdGFiIGhlYWRlciBpcyBhdmFpbGFibGUnKTtcbiAgICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQoZnJhbWUsICcjcmVndWxhci1sb2dpbicpO1xuICAgIGRlYnVnKCduYXZpZ2F0ZSB0byB0aGUgcGFzc3dvcmQgbG9naW4gdGFiJyk7XG4gICAgYXdhaXQgY2xpY2tCdXR0b24oZnJhbWUsICcjcmVndWxhci1sb2dpbicpO1xuICAgIGRlYnVnKCd3YWl0IHVudGlsIHRoZSBwYXNzd29yZCBsb2dpbiB0YWIgaXMgYWN0aXZlJyk7XG4gICAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKGZyYW1lLCAncmVndWxhci1sb2dpbicpO1xuXG4gICAgcmV0dXJuIGZyYW1lO1xuICB9O1xuXG4gIGFzeW5jIGdldENhcmRzKCkge1xuICAgIGNvbnN0IGluaXREYXRhID0gYXdhaXQgd2FpdFVudGlsKFxuICAgICAgKCkgPT4gZ2V0RnJvbVNlc3Npb25TdG9yYWdlPEluaXRSZXNwb25zZT4odGhpcy5wYWdlLCAnaW5pdCcpLFxuICAgICAgJ2dldCBpbml0IGRhdGEgaW4gc2Vzc2lvbiBzdG9yYWdlJyxcbiAgICAgIDEwMDAwLFxuICAgICAgMTAwMCxcbiAgICApO1xuICAgIGlmICghaW5pdERhdGEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignY291bGQgbm90IGZpbmQgXCJpbml0XCIgZGF0YSBpbiBzZXNzaW9uIHN0b3JhZ2UnKTtcbiAgICB9XG4gICAgcmV0dXJuIGluaXREYXRhPy5yZXN1bHQuY2FyZHMubWFwKCh7IGNhcmRVbmlxdWVJZCwgbGFzdDREaWdpdHMgfSkgPT4gKHsgY2FyZFVuaXF1ZUlkLCBsYXN0NERpZ2l0cyB9KSk7XG4gIH1cblxuICBhc3luYyBnZXRBdXRob3JpemF0aW9uSGVhZGVyKCkge1xuICAgIGlmICghdGhpcy5hdXRob3JpemF0aW9uKSB7XG4gICAgICBkZWJ1ZygnZmV0Y2hpbmcgYXV0aG9yaXphdGlvbiBoZWFkZXInKTtcbiAgICAgIGNvbnN0IGF1dGhNb2R1bGUgPSBhd2FpdCB3YWl0VW50aWwoXG4gICAgICAgIGFzeW5jICgpID0+IGF1dGhNb2R1bGVPclVuZGVmaW5lZChhd2FpdCBnZXRGcm9tU2Vzc2lvblN0b3JhZ2U8QXV0aE1vZHVsZT4odGhpcy5wYWdlLCAnYXV0aC1tb2R1bGUnKSksXG4gICAgICAgICdnZXQgYXV0aG9yaXphdGlvbiBoZWFkZXIgd2l0aCB2YWxpZCB0b2tlbiBpbiBzZXNzaW9uIHN0b3JhZ2UnLFxuICAgICAgICAxMF8wMDAsXG4gICAgICAgIDUwLFxuICAgICAgKTtcbiAgICAgIHJldHVybiBgQ0FMQXV0aFNjaGVtZSAke2F1dGhNb2R1bGUuYXV0aC5jYWxDb25uZWN0VG9rZW59YDtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuYXV0aG9yaXphdGlvbjtcbiAgfVxuXG4gIGFzeW5jIGdldFhTaXRlSWQoKSB7XG4gICAgLypcbiAgICAgIEkgZG9uJ3Qga25vdyBpZiB0aGUgY29uc3RhbnQgYmVsb3cgd2lsbCBjaGFuZ2UgaW4gdGhlIGZlYXR1cmUuXG4gICAgICBJZiBzbywgdXNlIHRoZSBuZXh0IGNvZGU6XG5cbiAgICAgIHJldHVybiB0aGlzLnBhZ2UuZXZhbHVhdGUoKCkgPT4gbmV3IFV0KCkueFNpdGVJZCk7XG5cbiAgICAgIFRvIGdldCB0aGUgY2xhc3NuYW1lIHNlYXJjaCBmb3IgJ3hTaXRlSWQnIGluIHRoZSBwYWdlIHNvdXJjZVxuICAgICAgY2xhc3MgVXQge1xuICAgICAgICBjb25zdHJ1Y3RvcihfZSwgb24sIHluKSB7XG4gICAgICAgICAgICB0aGlzLnN0b3JlID0gX2UsXG4gICAgICAgICAgICB0aGlzLmNvbmZpZyA9IG9uLFxuICAgICAgICAgICAgdGhpcy5ldmVudEJ1c1NlcnZpY2UgPSB5bixcbiAgICAgICAgICAgIHRoaXMueFNpdGVJZCA9IFwiMDkwMzE5ODctMjczRS0yMzExLTkwNkMtOEFGODVCMTdDOEQ5XCIsXG4gICAgKi9cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCcwOTAzMTk4Ny0yNzNFLTIzMTEtOTA2Qy04QUY4NUIxN0M4RDknKTtcbiAgfVxuXG4gIGdldExvZ2luT3B0aW9ucyhjcmVkZW50aWFsczogU2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHMpOiBMb2dpbk9wdGlvbnMge1xuICAgIHRoaXMuYXV0aFJlcXVlc3RQcm9taXNlID0gdGhpcy5wYWdlXG4gICAgICAud2FpdEZvclJlcXVlc3QoU1NPX0FVVEhPUklaQVRJT05fUkVRVUVTVF9FTkRQT0lOVCwgeyB0aW1lb3V0OiAxMF8wMDAgfSlcbiAgICAgIC5jYXRjaChlID0+IHtcbiAgICAgICAgZGVidWcoJ2Vycm9yIHdoaWxlIHdhaXRpbmcgZm9yIHRoZSB0b2tlbiByZXF1ZXN0JywgZSk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgbG9naW5Vcmw6IGAke0xPR0lOX1VSTH1gLFxuICAgICAgZmllbGRzOiBjcmVhdGVMb2dpbkZpZWxkcyhjcmVkZW50aWFscyksXG4gICAgICBzdWJtaXRCdXR0b25TZWxlY3RvcjogJ2J1dHRvblt0eXBlPVwic3VibWl0XCJdJyxcbiAgICAgIHBvc3NpYmxlUmVzdWx0czogZ2V0UG9zc2libGVMb2dpblJlc3VsdHMoKSxcbiAgICAgIGNoZWNrUmVhZGluZXNzOiBhc3luYyAoKSA9PiB3YWl0VW50aWxFbGVtZW50Rm91bmQodGhpcy5wYWdlLCAnI2NjTG9naW5EZXNrdG9wQnRuJyksXG4gICAgICBwcmVBY3Rpb246IHRoaXMub3BlbkxvZ2luUG9wdXAsXG4gICAgICBwb3N0QWN0aW9uOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgd2FpdEZvck5hdmlnYXRpb24odGhpcy5wYWdlKTtcbiAgICAgICAgICBjb25zdCBjdXJyZW50VXJsID0gYXdhaXQgZ2V0Q3VycmVudFVybCh0aGlzLnBhZ2UpO1xuICAgICAgICAgIGlmIChjdXJyZW50VXJsLmVuZHNXaXRoKCdzaXRlLXR1dG9yaWFsJykpIHtcbiAgICAgICAgICAgIGF3YWl0IGNsaWNrQnV0dG9uKHRoaXMucGFnZSwgJ2J1dHRvbi5idG4tY2xvc2UnKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IHRoaXMuYXV0aFJlcXVlc3RQcm9taXNlO1xuICAgICAgICAgIHRoaXMuYXV0aG9yaXphdGlvbiA9IFN0cmluZyhyZXF1ZXN0Py5oZWFkZXJzKCkuYXV0aG9yaXphdGlvbiB8fCAnJykudHJpbSgpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgY29uc3QgY3VycmVudFVybCA9IGF3YWl0IGdldEN1cnJlbnRVcmwodGhpcy5wYWdlKTtcbiAgICAgICAgICBpZiAoY3VycmVudFVybC5lbmRzV2l0aCgnZGFzaGJvYXJkJykpIHJldHVybjtcbiAgICAgICAgICBjb25zdCByZXF1aXJlc0NoYW5nZVBhc3N3b3JkID0gYXdhaXQgaGFzQ2hhbmdlUGFzc3dvcmRGb3JtKHRoaXMucGFnZSk7XG4gICAgICAgICAgaWYgKHJlcXVpcmVzQ2hhbmdlUGFzc3dvcmQpIHJldHVybjtcbiAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgdXNlckFnZW50OiBhcGlIZWFkZXJzWydVc2VyLUFnZW50J10sXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZmV0Y2hDYXJkRGF0YShcbiAgICBjYXJkOiB7IGNhcmRVbmlxdWVJZDogc3RyaW5nOyBsYXN0NERpZ2l0czogc3RyaW5nIH0sXG4gICAgc3RhcnRNb21lbnQ6IG1vbWVudC5Nb21lbnQsXG4gICAgc3RhcnREYXRlOiBEYXRlLFxuICAgIGZ1dHVyZU1vbnRoc1RvU2NyYXBlOiBudW1iZXIsXG4gICAgQXV0aG9yaXphdGlvbjogc3RyaW5nLFxuICAgIHhTaXRlSWQ6IHN0cmluZyxcbiAgKTogUHJvbWlzZTxUcmFuc2FjdGlvbnNBY2NvdW50PiB7XG4gICAgZGVidWcoJ2ZldGNoIGZyYW1lcyAobWlzZ2Fyb3QpIGZvciBjYXJkICVzJywgY2FyZC5jYXJkVW5pcXVlSWQpO1xuICAgIGNvbnN0IGZyYW1lcyA9IGF3YWl0IGZldGNoUG9zdDxGcmFtZXNSZXNwb25zZT4oXG4gICAgICBGUkFNRVNfUkVRVUVTVF9FTkRQT0lOVCxcbiAgICAgIHsgY2FyZHNGb3JGcmFtZURhdGE6IFt7IGNhcmRVbmlxdWVJZDogY2FyZC5jYXJkVW5pcXVlSWQgfV0gfSxcbiAgICAgIHtcbiAgICAgICAgQXV0aG9yaXphdGlvbixcbiAgICAgICAgJ1gtU2l0ZS1JZCc6IHhTaXRlSWQsXG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgIC4uLmFwaUhlYWRlcnMsXG4gICAgICB9LFxuICAgICk7XG5cbiAgICBkZWJ1ZygnZnJhbWVzIHJlc3BvbnNlIGZvciBjYXJkICVzOiAlTycsIGNhcmQuY2FyZFVuaXF1ZUlkLCBmcmFtZXMpO1xuXG4gICAgLy8gTG9vayBmb3IgY2FyZC1sZXZlbCBmcmFtZSBpbiBib3RoIGNhbElzc3VlZENhcmRzIGFuZCBiYW5rSXNzdWVkQ2FyZHNcbiAgICBjb25zdCBiYW5rSXNzdWVkRnJhbWUgPSBmcmFtZXMucmVzdWx0Py5iYW5rSXNzdWVkQ2FyZHM/LmNhcmRMZXZlbEZyYW1lcz8uZmluZChcbiAgICAgIChmOiBDYXJkTGV2ZWxGcmFtZSkgPT4gZi5jYXJkVW5pcXVlSWQgPT09IGNhcmQuY2FyZFVuaXF1ZUlkLFxuICAgICk7XG5cbiAgICBjb25zdCBjYWxJc3N1ZWRGcmFtZSA9IGZyYW1lcy5yZXN1bHQ/LmNhbElzc3VlZENhcmRzPy5jYXJkTGV2ZWxGcmFtZXM/LmZpbmQoXG4gICAgICAoZjogQ2FyZExldmVsRnJhbWUpID0+IGYuY2FyZFVuaXF1ZUlkID09PSBjYXJkLmNhcmRVbmlxdWVJZCxcbiAgICApO1xuXG4gICAgbGV0IGZyYW1lOiBDYXJkTGV2ZWxGcmFtZSB8IHVuZGVmaW5lZDtcbiAgICBsZXQgY2FyZFR5cGU6IENhcmRUeXBlO1xuICAgIGxldCBhY2NvdW50R3JvdXA6IElzc3VlZENhcmRzR3JvdXAgfCB1bmRlZmluZWQ7XG5cbiAgICBpZiAoYmFua0lzc3VlZEZyYW1lKSB7XG4gICAgICBmcmFtZSA9IGJhbmtJc3N1ZWRGcmFtZTtcbiAgICAgIGNhcmRUeXBlID0gQ2FyZFR5cGUuQmFua0lzc3VlZDtcbiAgICAgIGFjY291bnRHcm91cCA9IGZyYW1lcy5yZXN1bHQ/LmJhbmtJc3N1ZWRDYXJkcztcbiAgICB9IGVsc2Uge1xuICAgICAgZnJhbWUgPSBjYWxJc3N1ZWRGcmFtZTtcbiAgICAgIGNhcmRUeXBlID0gQ2FyZFR5cGUuQ29tcGFueUlzc3VlZDtcbiAgICAgIGFjY291bnRHcm91cCA9IGZyYW1lcy5yZXN1bHQ/LmNhbElzc3VlZENhcmRzO1xuICAgIH1cblxuICAgIGRlYnVnKCdzZWFyY2hpbmcgZm9yIGZyYW1lIGZvciBjYXJkICVzLCBmb3VuZDogJU8nLCBjYXJkLmNhcmRVbmlxdWVJZCwgZnJhbWUpO1xuICAgIGRlYnVnKCdjYXJkIHR5cGUgZm9yIGNhcmQgJXM6ICVzJywgY2FyZC5jYXJkVW5pcXVlSWQsIGNhcmRUeXBlKTtcblxuICAgIGNvbnN0IGJhbGFuY2VEYXRlOiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkID0gZnJhbWU/Lm5leHREZWJpdERhdGUgPz8gYWNjb3VudEdyb3VwPy5uZXh0VG90YWxEZWJpdERhdGVGb3JBY2NvdW50O1xuXG4gICAgY29uc3QgZmluYWxNb250aFRvRmV0Y2hNb21lbnQgPSBtb21lbnQoKS5hZGQoZnV0dXJlTW9udGhzVG9TY3JhcGUsICdtb250aCcpO1xuICAgIGNvbnN0IG1vbnRocyA9IGZpbmFsTW9udGhUb0ZldGNoTW9tZW50LmRpZmYoc3RhcnRNb21lbnQsICdtb250aHMnKTtcbiAgICBjb25zdCBhbGxNb250aHNEYXRhOiBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzW10gPSBbXTtcblxuICAgIGRlYnVnKGBmZXRjaCBwZW5kaW5nIHRyYW5zYWN0aW9ucyBmb3IgY2FyZCAke2NhcmQuY2FyZFVuaXF1ZUlkfWApO1xuICAgIGxldCBwZW5kaW5nRGF0YSA9IGF3YWl0IGZldGNoUG9zdChcbiAgICAgIFBFTkRJTkdfVFJBTlNBQ1RJT05TX1JFUVVFU1RfRU5EUE9JTlQsXG4gICAgICB7IGNhcmRVbmlxdWVJREFycmF5OiBbY2FyZC5jYXJkVW5pcXVlSWRdIH0sXG4gICAgICB7XG4gICAgICAgIEF1dGhvcml6YXRpb24sXG4gICAgICAgICdYLVNpdGUtSWQnOiB4U2l0ZUlkLFxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAuLi5hcGlIZWFkZXJzLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgZGVidWcoYGZldGNoIGNvbXBsZXRlZCB0cmFuc2FjdGlvbnMgZm9yIGNhcmQgJHtjYXJkLmNhcmRVbmlxdWVJZH1gKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8PSBtb250aHM7IGkrKykge1xuICAgICAgY29uc3QgbW9udGggPSBmaW5hbE1vbnRoVG9GZXRjaE1vbWVudC5jbG9uZSgpLnN1YnRyYWN0KGksICdtb250aHMnKTtcbiAgICAgIGNvbnN0IG1vbnRoRGF0YSA9IGF3YWl0IGZldGNoUG9zdChcbiAgICAgICAgVFJBTlNBQ1RJT05TX1JFUVVFU1RfRU5EUE9JTlQsXG4gICAgICAgIHsgY2FyZFVuaXF1ZUlkOiBjYXJkLmNhcmRVbmlxdWVJZCwgbW9udGg6IG1vbnRoLmZvcm1hdCgnTScpLCB5ZWFyOiBtb250aC5mb3JtYXQoJ1lZWVknKSB9LFxuICAgICAgICB7XG4gICAgICAgICAgQXV0aG9yaXphdGlvbixcbiAgICAgICAgICAnWC1TaXRlLUlkJzogeFNpdGVJZCxcbiAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgIC4uLmFwaUhlYWRlcnMsXG4gICAgICAgIH0sXG4gICAgICApO1xuXG4gICAgICBpZiAobW9udGhEYXRhPy5zdGF0dXNDb2RlICE9PSAxKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgYGZhaWxlZCB0byBmZXRjaCB0cmFuc2FjdGlvbnMgZm9yIGNhcmQgJHtjYXJkLmxhc3Q0RGlnaXRzfS4gTWVzc2FnZTogJHttb250aERhdGE/LnRpdGxlIHx8ICcnfWAsXG4gICAgICAgICk7XG5cbiAgICAgIGlmICghaXNDYXJkVHJhbnNhY3Rpb25EZXRhaWxzKG1vbnRoRGF0YSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdtb250aERhdGEgaXMgbm90IG9mIHR5cGUgQ2FyZFRyYW5zYWN0aW9uRGV0YWlscycpO1xuICAgICAgfVxuXG4gICAgICBhbGxNb250aHNEYXRhLnB1c2gobW9udGhEYXRhKTtcbiAgICB9XG5cbiAgICBpZiAocGVuZGluZ0RhdGE/LnN0YXR1c0NvZGUgIT09IDEgJiYgcGVuZGluZ0RhdGE/LnN0YXR1c0NvZGUgIT09IDk2KSB7XG4gICAgICBkZWJ1ZyhgZmFpbGVkIHRvIGZldGNoIHBlbmRpbmcgdHJhbnNhY3Rpb25zIGZvciBjYXJkICR7Y2FyZC5sYXN0NERpZ2l0c30uIE1lc3NhZ2U6ICR7cGVuZGluZ0RhdGE/LnRpdGxlIHx8ICcnfWApO1xuICAgICAgcGVuZGluZ0RhdGEgPSBudWxsO1xuICAgIH0gZWxzZSBpZiAoIWlzQ2FyZFBlbmRpbmdUcmFuc2FjdGlvbkRldGFpbHMocGVuZGluZ0RhdGEpKSB7XG4gICAgICBkZWJ1ZygncGVuZGluZ0RhdGEgaXMgbm90IG9mIHR5cGUgQ2FyZFRyYW5zYWN0aW9uRGV0YWlscycpO1xuICAgICAgcGVuZGluZ0RhdGEgPSBudWxsO1xuICAgIH1cblxuICAgIGNvbnN0IHRyYW5zYWN0aW9ucyA9IGNvbnZlcnRQYXJzZWREYXRhVG9UcmFuc2FjdGlvbnMoYWxsTW9udGhzRGF0YSwgcGVuZGluZ0RhdGEsIHRoaXMub3B0aW9ucyk7XG5cbiAgICBkZWJ1ZygnZmlsdGVyIG91dCBvbGQgdHJhbnNhY3Rpb25zJyk7XG4gICAgY29uc3QgdHhucyA9XG4gICAgICAodGhpcy5vcHRpb25zLm91dHB1dERhdGE/LmVuYWJsZVRyYW5zYWN0aW9uc0ZpbHRlckJ5RGF0ZSA/PyB0cnVlKVxuICAgICAgICA/IGZpbHRlck9sZFRyYW5zYWN0aW9ucyh0cmFuc2FjdGlvbnMsIG1vbWVudChzdGFydERhdGUpLCB0aGlzLm9wdGlvbnMuY29tYmluZUluc3RhbGxtZW50cyB8fCBmYWxzZSlcbiAgICAgICAgOiB0cmFuc2FjdGlvbnM7XG5cbiAgICAvLyBVc2UgY2FyZC1sZXZlbCBiYWxhbmNlIGlmIGF2YWlsYWJsZSwgb3RoZXJ3aXNlIGZhbGwgYmFjayB0byBhY2NvdW50LWxldmVsIGJhbGFuY2VcbiAgICBjb25zdCBiYWxhbmNlQW1vdW50ID0gZnJhbWU/Lm5leHRUb3RhbERlYml0ID8/IGFjY291bnRHcm91cD8ubmV4dFRvdGFsRGViaXRGb3JBY2NvdW50O1xuICAgIGNvbnN0IHJlc3VsdDogVHJhbnNhY3Rpb25zQWNjb3VudCA9IHtcbiAgICAgIHR4bnMsXG4gICAgICBiYWxhbmNlOiBiYWxhbmNlQW1vdW50ICE9IG51bGwgPyAtYmFsYW5jZUFtb3VudCA6IHVuZGVmaW5lZCxcbiAgICAgIGJhbGFuY2VEYXRlOiBiYWxhbmNlRGF0ZSAhPSBudWxsID8gYmFsYW5jZURhdGUgOiB1bmRlZmluZWQsXG4gICAgICBhY2NvdW50TnVtYmVyOiBjYXJkLmxhc3Q0RGlnaXRzLFxuICAgICAgY2FyZFR5cGUsXG4gICAgICBjYXJkRnJhbWU6IGFjY291bnRHcm91cD8uZnJhbWVMaW1pdEZvckNhcmRBbW91bnQsXG4gICAgfTtcblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICBhc3luYyBmZXRjaERhdGEoKTogUHJvbWlzZTxTY3JhcGVyU2NyYXBpbmdSZXN1bHQ+IHtcbiAgICBjb25zdCBkZWZhdWx0U3RhcnRNb21lbnQgPSBtb21lbnQoKS5zdWJ0cmFjdCgxLCAneWVhcnMnKS5zdWJ0cmFjdCg2LCAnbW9udGhzJykuYWRkKDEsICdkYXknKTtcbiAgICBjb25zdCBzdGFydERhdGUgPSB0aGlzLm9wdGlvbnMuc3RhcnREYXRlIHx8IGRlZmF1bHRTdGFydE1vbWVudC50b0RhdGUoKTtcbiAgICBjb25zdCBzdGFydE1vbWVudCA9IG1vbWVudC5tYXgoZGVmYXVsdFN0YXJ0TW9tZW50LCBtb21lbnQoc3RhcnREYXRlKSk7XG4gICAgZGVidWcoYGZldGNoIHRyYW5zYWN0aW9ucyBzdGFydGluZyAke3N0YXJ0TW9tZW50LmZvcm1hdCgpfWApO1xuXG4gICAgY29uc3QgW2NhcmRzLCB4U2l0ZUlkLCBBdXRob3JpemF0aW9uXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgIHRoaXMuZ2V0Q2FyZHMoKSxcbiAgICAgIHRoaXMuZ2V0WFNpdGVJZCgpLFxuICAgICAgdGhpcy5nZXRBdXRob3JpemF0aW9uSGVhZGVyKCksXG4gICAgXSk7XG5cbiAgICBjb25zdCBmdXR1cmVNb250aHNUb1NjcmFwZSA9IHRoaXMub3B0aW9ucy5mdXR1cmVNb250aHNUb1NjcmFwZSA/PyAxO1xuXG4gICAgY29uc3QgYWNjb3VudHMgPSBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgIGNhcmRzLm1hcChjYXJkID0+IHRoaXMuZmV0Y2hDYXJkRGF0YShjYXJkLCBzdGFydE1vbWVudCwgc3RhcnREYXRlLCBmdXR1cmVNb250aHNUb1NjcmFwZSwgQXV0aG9yaXphdGlvbiwgeFNpdGVJZCkpLFxuICAgICk7XG5cbiAgICBkZWJ1ZygncmV0dXJuIHRoZSBzY3JhcGVkIGFjY291bnRzJyk7XG5cbiAgICBkZWJ1ZyhKU09OLnN0cmluZ2lmeShhY2NvdW50cywgbnVsbCwgMikpO1xuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgYWNjb3VudHMsXG4gICAgfTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBWaXNhQ2FsU2NyYXBlcjtcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUEsSUFBQUEsT0FBQSxHQUFBQyxzQkFBQSxDQUFBQyxPQUFBO0FBRUEsSUFBQUMsTUFBQSxHQUFBRCxPQUFBO0FBQ0EsSUFBQUUscUJBQUEsR0FBQUYsT0FBQTtBQUNBLElBQUFHLE1BQUEsR0FBQUgsT0FBQTtBQUNBLElBQUFJLFdBQUEsR0FBQUosT0FBQTtBQUNBLElBQUFLLFFBQUEsR0FBQUwsT0FBQTtBQUNBLElBQUFNLGFBQUEsR0FBQU4sT0FBQTtBQUNBLElBQUFPLFFBQUEsR0FBQVAsT0FBQTtBQUNBLElBQUFRLGNBQUEsR0FBQVIsT0FBQTtBQU9BLElBQUFTLHVCQUFBLEdBQUFULE9BQUE7QUFBc0csU0FBQUQsdUJBQUFXLENBQUEsV0FBQUEsQ0FBQSxJQUFBQSxDQUFBLENBQUFDLFVBQUEsR0FBQUQsQ0FBQSxLQUFBRSxPQUFBLEVBQUFGLENBQUE7QUFHdEcsTUFBTUcsVUFBVSxHQUFHO0VBQ2pCLFlBQVksRUFDVix1SEFBdUg7RUFDekhDLE1BQU0sRUFBRSxzQ0FBc0M7RUFDOUNDLE9BQU8sRUFBRSxzQ0FBc0M7RUFDL0MsaUJBQWlCLEVBQUUscUNBQXFDO0VBQ3hELGdCQUFnQixFQUFFLFdB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
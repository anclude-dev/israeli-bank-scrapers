export interface TransactionsAccount {
  accountNumber: string;
  balance?: number;
  balanceDate?: string;
  cardFrame?: number;
  cardType?: CardType;
  txns: Transaction[];
}

export enum CardType {
  BankIssued = 'bankIssued',
  CompanyIssued = 'companyIssued',
}

export enum TransactionTypes {
  Normal = 'normal',
  Installments = 'installments',
}

export enum TransactionStatuses {
  Completed = 'completed',
  Pending = 'pending',
}

export interface TransactionInstallments {
  /**
   * the current installment number
   */
  number: number;

  /**
   * the total number of installments
   */
  total: number;
}

/** Read-only destination details; deliberately separate from description/memo identity fields. */
export interface TransferDetails {
  recipient: string;
  bank: string;
  branch: string;
  account: string;
  purpose?: string;
}

export interface Transaction {
  type: TransactionTypes;
  /**
   * sometimes called Asmachta
   */
  identifier?: string | number;
  /**
   * ISO date string
   */
  date: string;
  /**
   * ISO date string
   */
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  chargedCurrency?: string;
  description: string;
  memo?: string;
  transferDetails?: TransferDetails;
  status: TransactionStatuses;
  installments?: TransactionInstallments;
  category?: string;
  rawTransaction?: unknown;
}

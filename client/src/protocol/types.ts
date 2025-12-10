/**
 * Protocol types matching the Zig matching engine.
 * 
 * Binary format: 64-byte fixed messages
 * CSV format: Newline-terminated text
 * 
 * @module protocol/types
 */

// ============================================================================
// Constants (matching Zig constants)
// ============================================================================

export const BINARY_MESSAGE_SIZE = 64;
export const SYMBOL_SIZE = 8;
export const MAX_SYMBOL_LENGTH = 8;
export const MAX_CSV_MESSAGE_LENGTH = 256;

// Binary message type bytes (first byte of message)
export const BINARY_MSG_TYPE_NEW_ORDER = 0x01;
export const BINARY_MSG_TYPE_CANCEL = 0x02;
export const BINARY_MSG_TYPE_FLUSH = 0x03;

// CSV message type characters
export const CSV_MSG_TYPE_NEW_ORDER = 'N';
export const CSV_MSG_TYPE_CANCEL = 'C';
export const CSV_MSG_TYPE_ACK = 'A';
export const CSV_MSG_TYPE_TRADE = 'T';
export const CSV_MSG_TYPE_REJECT = 'R';
export const CSV_MSG_TYPE_TOP_OF_BOOK = 'B';

// ============================================================================
// Enums
// ============================================================================

export const Side = {
  BUY: 1,
  SELL: 2,
} as const;

export type Side = (typeof Side)[keyof typeof Side];

export const MessageType = {
  NEW_ORDER: 'NEW_ORDER',
  CANCEL: 'CANCEL',
  FLUSH: 'FLUSH',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const OutputMessageType = {
  ACK: 'ACK',
  REJECT: 'REJECT',
  TRADE: 'TRADE',
  CANCEL_ACK: 'CANCEL_ACK',
  TOP_OF_BOOK: 'TOP_OF_BOOK',
} as const;

export type OutputMessageType =
  (typeof OutputMessageType)[keyof typeof OutputMessageType];

export const RejectReason = {
  UNKNOWN: 0,
  INVALID_SYMBOL: 1,
  INVALID_PRICE: 2,
  INVALID_QUANTITY: 3,
  ORDER_NOT_FOUND: 4,
  DUPLICATE_ORDER_ID: 5,
  SYSTEM_FULL: 6,
} as const;

export type RejectReason = (typeof RejectReason)[keyof typeof RejectReason];

export const AckStatus = {
  ACCEPTED: 0,
  PARTIAL_FILL: 1,
  FILLED: 2,
} as const;

export type AckStatus = (typeof AckStatus)[keyof typeof AckStatus];

// ============================================================================
// Input Messages (Client -> Engine)
// ============================================================================

export interface NewOrderInput {
  readonly type: typeof MessageType.NEW_ORDER;
  readonly symbol: string;
  readonly userId: number;
  readonly userOrderId: number;
  readonly side: Side;
  readonly price: number;
  readonly quantity: number;
}

export interface CancelInput {
  readonly type: typeof MessageType.CANCEL;
  readonly symbol: string;
  readonly userId: number;
  readonly userOrderId: number;
}

export interface FlushInput {
  readonly type: typeof MessageType.FLUSH;
  readonly userId: number;
}

export type InputMessage = NewOrderInput | CancelInput | FlushInput;

// ============================================================================
// Output Messages (Engine -> Client)
// ============================================================================

export interface AckOutput {
  readonly type: typeof OutputMessageType.ACK;
  readonly symbol: string;
  readonly userOrderId: number;
  readonly status: AckStatus;
}

export interface RejectOutput {
  readonly type: typeof OutputMessageType.REJECT;
  readonly symbol: string;
  readonly userOrderId: number;
  readonly reason: RejectReason;
}

export interface TradeOutput {
  readonly type: typeof OutputMessageType.TRADE;
  readonly symbol: string;
  readonly price: number;
  readonly quantity: number;
  readonly buyOrderId: number;
  readonly sellOrderId: number;
}

export interface CancelAckOutput {
  readonly type: typeof OutputMessageType.CANCEL_ACK;
  readonly symbol: string;
  readonly userOrderId: number;
}

export interface TopOfBookOutput {
  readonly type: typeof OutputMessageType.TOP_OF_BOOK;
  readonly symbol: string;
  readonly bidPrice: number;
  readonly askPrice: number;
  readonly bidQuantity: number;
  readonly askQuantity: number;
}

export type OutputMessage =
  | AckOutput
  | RejectOutput
  | TradeOutput
  | CancelAckOutput
  | TopOfBookOutput;

// ============================================================================
// Codec Detection
// ============================================================================

export const Codec = {
  CSV: 'CSV',
  BINARY: 'BINARY',
  UNKNOWN: 'UNKNOWN',
} as const;

export type Codec = (typeof Codec)[keyof typeof Codec];

// ============================================================================
// Validation Helpers
// ============================================================================

export function isValidSide(value: number): value is Side {
  return value === Side.BUY || value === Side.SELL;
}

export function isValidSymbol(symbol: string): boolean {
  if (symbol.length === 0) {
    return false;
  }
  if (symbol.length > MAX_SYMBOL_LENGTH) {
    return false;
  }
  return true;
}

export function isValidPrice(price: number): boolean {
  if (!Number.isFinite(price)) {
    return false;
  }
  if (price < 0) {
    return false;
  }
  return true;
}

export function isValidQuantity(quantity: number): boolean {
  if (!Number.isInteger(quantity)) {
    return false;
  }
  if (quantity <= 0) {
    return false;
  }
  return true;
}

export function isValidUserId(userId: number): boolean {
  if (!Number.isInteger(userId)) {
    return false;
  }
  if (userId < 0) {
    return false;
  }
  return true;
}

export function isValidOrderId(orderId: number): boolean {
  if (!Number.isInteger(orderId)) {
    return false;
  }
  if (orderId < 0) {
    return false;
  }
  return true;
}

/**
 * CSV codec for human-readable message encoding/decoding.
 *
 * Format (from Zig engine):
 *   Input:
 *     N,<symbol>,<user_id>,<user_order_id>,<side>,<price>,<quantity>
 *     C,<symbol>,<user_id>,<user_order_id>
 *
 *   Output:
 *     A,<symbol>,<user_order_id>,<status>
 *     T,<symbol>,<price>,<quantity>,<buy_order_id>,<sell_order_id>
 *     R,<symbol>,<user_order_id>,<reason>
 *     X,<symbol>,<user_order_id>  (Cancel Ack)
 *     B,<symbol>,<bid_price>,<ask_price>,<bid_qty>,<ask_qty>
 *
 * @module protocol/csv-codec
 */

import {
  type InputMessage,
  type OutputMessage,
  type NewOrderInput,
  type CancelInput,
  MessageType,
  OutputMessageType,
  Side,
  AckStatus,
  RejectReason,
  MAX_CSV_MESSAGE_LENGTH,
  CSV_MSG_TYPE_NEW_ORDER,
  CSV_MSG_TYPE_CANCEL,
  CSV_MSG_TYPE_ACK,
  CSV_MSG_TYPE_TRADE,
  CSV_MSG_TYPE_REJECT,
  CSV_MSG_TYPE_TOP_OF_BOOK,
  isValidSymbol,
  isValidPrice,
  isValidQuantity,
  isValidUserId,
  isValidOrderId,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

const MAX_CSV_FIELDS = 8;
const FIELD_SEPARATOR = ',';
const LINE_TERMINATOR = '\n';
const CSV_MSG_TYPE_CANCEL_ACK = 'X';

// ============================================================================
// Result Types
// ============================================================================

export interface EncodeResult {
  readonly success: boolean;
  readonly data: string;
  readonly error: string | null;
}

export interface DecodeResult {
  readonly success: boolean;
  readonly message: OutputMessage | null;
  readonly error: string | null;
}

// ============================================================================
// Encoding Functions
// ============================================================================

function sideToChar(side: number): string {
  if (side === Side.BUY) {
    return 'B';
  }
  if (side === Side.SELL) {
    return 'S';
  }
  return '?';
}

function encodeNewOrder(msg: NewOrderInput): EncodeResult {
  if (!isValidSymbol(msg.symbol)) {
    return { success: false, data: '', error: 'Invalid symbol' };
  }
  if (!isValidUserId(msg.userId)) {
    return { success: false, data: '', error: 'Invalid user ID' };
  }
  if (!isValidOrderId(msg.userOrderId)) {
    return { success: false, data: '', error: 'Invalid order ID' };
  }
  if (!isValidPrice(msg.price)) {
    return { success: false, data: '', error: 'Invalid price' };
  }
  if (!isValidQuantity(msg.quantity)) {
    return { success: false, data: '', error: 'Invalid quantity' };
  }

  const sideChar = sideToChar(msg.side);
  if (sideChar === '?') {
    return { success: false, data: '', error: 'Invalid side' };
  }

  const csv =
    CSV_MSG_TYPE_NEW_ORDER +
    FIELD_SEPARATOR +
    msg.symbol +
    FIELD_SEPARATOR +
    msg.userId.toString() +
    FIELD_SEPARATOR +
    msg.userOrderId.toString() +
    FIELD_SEPARATOR +
    sideChar +
    FIELD_SEPARATOR +
    msg.price.toString() +
    FIELD_SEPARATOR +
    msg.quantity.toString() +
    LINE_TERMINATOR;

  return { success: true, data: csv, error: null };
}

function encodeCancel(msg: CancelInput): EncodeResult {
  if (!isValidSymbol(msg.symbol)) {
    return { success: false, data: '', error: 'Invalid symbol' };
  }
  if (!isValidUserId(msg.userId)) {
    return { success: false, data: '', error: 'Invalid user ID' };
  }
  if (!isValidOrderId(msg.userOrderId)) {
    return { success: false, data: '', error: 'Invalid order ID' };
  }

  const csv =
    CSV_MSG_TYPE_CANCEL +
    FIELD_SEPARATOR +
    msg.symbol +
    FIELD_SEPARATOR +
    msg.userId.toString() +
    FIELD_SEPARATOR +
    msg.userOrderId.toString() +
    LINE_TERMINATOR;

  return { success: true, data: csv, error: null };
}

export function encode(msg: InputMessage): EncodeResult {
  if (msg.type === MessageType.NEW_ORDER) {
    return encodeNewOrder(msg);
  }
  if (msg.type === MessageType.CANCEL) {
    return encodeCancel(msg);
  }
  if (msg.type === MessageType.FLUSH) {
    return { success: false, data: '', error: 'FLUSH not supported in CSV' };
  }
  return { success: false, data: '', error: 'Unknown message type' };
}

// ============================================================================
// Decoding Functions
// ============================================================================

function splitFields(line: string): string[] | null {
  const fields: string[] = [];
  let fieldStart = 0;
  let fieldCount = 0;

  // Bounded loop: MAX_CSV_MESSAGE_LENGTH iterations max
  const maxLen = Math.min(line.length, MAX_CSV_MESSAGE_LENGTH);
  for (let i = 0; i <= maxLen; i += 1) {
    if (fieldCount >= MAX_CSV_FIELDS) {
      return null; // Too many fields
    }

    const atEnd = i === maxLen;
    const atSeparator = !atEnd && line[i] === FIELD_SEPARATOR;
    const atNewline = !atEnd && line[i] === LINE_TERMINATOR;

    if (atEnd || atSeparator || atNewline) {
      // Trim whitespace from each field (Zig may send "A, AAPL, ..." with spaces)
      fields[fieldCount] = line.slice(fieldStart, i).trim();
      fieldCount += 1;
      fieldStart = i + 1;

      if (atNewline || atEnd) {
        break;
      }
    }
  }

  return fields;
}

function parseIntField(value: string): number | null {
  if (value.length === 0) {
    return null;
  }
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function parseFloatField(value: string): number | null {
  if (value.length === 0) {
    return null;
  }
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function decodeAck(fields: string[]): DecodeResult {
  // A, symbol, userId, userOrderId
  if (fields.length < 4) {
    return { success: false, message: null, error: 'ACK: insufficient fields' };
  }

  const symbol = fields[1];
  if (!isValidSymbol(symbol)) {
    return { success: false, message: null, error: 'ACK: invalid symbol' };
  }

  const userId = parseIntField(fields[2]);
  if (userId === null) {
    return { success: false, message: null, error: 'ACK: invalid user ID' };
  }

  const userOrderId = parseIntField(fields[3]);
  if (userOrderId === null) {
    return { success: false, message: null, error: 'ACK: invalid order ID' };
  }

  return {
    success: true,
    message: {
      type: OutputMessageType.ACK,
      symbol,
      userOrderId,
      status: AckStatus.ACCEPTED,
    },
    error: null,
  };
}

function decodeTrade(fields: string[]): DecodeResult {
  // T, symbol, buyUserId, buyOrderId, sellUserId, sellOrderId, price, qty
  if (fields.length < 8) {
    return { success: false, message: null, error: 'TRADE: insufficient fields' };
  }

  const symbol = fields[1];
  if (!isValidSymbol(symbol)) {
    return { success: false, message: null, error: 'TRADE: invalid symbol' };
  }

  const buyUserId = parseIntField(fields[2]);
  if (buyUserId === null) {
    return { success: false, message: null, error: 'TRADE: invalid buy user ID' };
  }

  const buyOrderId = parseIntField(fields[3]);
  if (buyOrderId === null) {
    return { success: false, message: null, error: 'TRADE: invalid buy order ID' };
  }

  const sellUserId = parseIntField(fields[4]);
  if (sellUserId === null) {
    return { success: false, message: null, error: 'TRADE: invalid sell user ID' };
  }

  const sellOrderId = parseIntField(fields[5]);
  if (sellOrderId === null) {
    return { success: false, message: null, error: 'TRADE: invalid sell order ID' };
  }

  const priceCents = parseFloatField(fields[6]);
  if (priceCents === null) {
    return { success: false, message: null, error: 'TRADE: invalid price' };
  }
  // Zig sends price in cents, convert to dollars
  const price = priceCents / 100;

  const quantity = parseIntField(fields[7]);
  if (quantity === null) {
    return { success: false, message: null, error: 'TRADE: invalid quantity' };
  }

  return {
    success: true,
    message: {
      type: OutputMessageType.TRADE,
      symbol,
      price,
      quantity,
      buyOrderId,
      sellOrderId,
    },
    error: null,
  };
}

function decodeReject(fields: string[]): DecodeResult {
  // R, symbol, userId, userOrderId, reason
  if (fields.length < 5) {
    return { success: false, message: null, error: 'REJECT: insufficient fields' };
  }

  const symbol = fields[1];
  if (!isValidSymbol(symbol)) {
    return { success: false, message: null, error: 'REJECT: invalid symbol' };
  }

  const userId = parseIntField(fields[2]);
  if (userId === null) {
    return { success: false, message: null, error: 'REJECT: invalid user ID' };
  }

  const userOrderId = parseIntField(fields[3]);
  if (userOrderId === null) {
    return { success: false, message: null, error: 'REJECT: invalid order ID' };
  }

  const reason = parseIntField(fields[4]);
  if (reason === null) {
    return { success: false, message: null, error: 'REJECT: invalid reason' };
  }

  return {
    success: true,
    message: {
      type: OutputMessageType.REJECT,
      symbol,
      userOrderId,
      reason: reason as typeof RejectReason[keyof typeof RejectReason],
    },
    error: null,
  };
}

function decodeCancelAck(fields: string[]): DecodeResult {
  // C/X, symbol, userId, userOrderId
  if (fields.length < 4) {
    return { success: false, message: null, error: 'CANCEL_ACK: insufficient fields' };
  }

  const symbol = fields[1];
  if (!isValidSymbol(symbol)) {
    return { success: false, message: null, error: 'CANCEL_ACK: invalid symbol' };
  }

  const userId = parseIntField(fields[2]);
  if (userId === null) {
    return { success: false, message: null, error: 'CANCEL_ACK: invalid user ID' };
  }

  const userOrderId = parseIntField(fields[3]);
  if (userOrderId === null) {
    return { success: false, message: null, error: 'CANCEL_ACK: invalid order ID' };
  }

  return {
    success: true,
    message: {
      type: OutputMessageType.CANCEL_ACK,
      symbol,
      userOrderId,
    },
    error: null,
  };
}

function decodeTopOfBook(fields: string[]): DecodeResult {
  // Zig may send different TOB formats:
  // Full: B,<symbol>,<bid_price>,<ask_price>,<bid_qty>,<ask_qty>
  // Single-side: B,<symbol>,<side>,<price>,<qty>
  
  if (fields.length >= 6) {
    // Full format: B,<symbol>,<bid_price_cents>,<ask_price_cents>,<bid_qty>,<ask_qty>
    const symbol = fields[1];
    if (!isValidSymbol(symbol)) {
      return { success: false, message: null, error: 'TOB: invalid symbol' };
    }

    const bidPriceCents = parseFloatField(fields[2]);
    if (bidPriceCents === null) {
      return { success: false, message: null, error: 'TOB: invalid bid price' };
    }

    const askPriceCents = parseFloatField(fields[3]);
    if (askPriceCents === null) {
      return { success: false, message: null, error: 'TOB: invalid ask price' };
    }

    const bidQuantity = parseIntField(fields[4]);
    if (bidQuantity === null) {
      return { success: false, message: null, error: 'TOB: invalid bid quantity' };
    }

    const askQuantity = parseIntField(fields[5]);
    if (askQuantity === null) {
      return { success: false, message: null, error: 'TOB: invalid ask quantity' };
    }

    // Zig sends prices in cents, convert to dollars
    return {
      success: true,
      message: {
        type: OutputMessageType.TOP_OF_BOOK,
        symbol,
        bidPrice: bidPriceCents / 100,
        askPrice: askPriceCents / 100,
        bidQuantity,
        askQuantity,
      },
      error: null,
    };
  }
  
  if (fields.length >= 5) {
    // Single-side format: B,<symbol>,<side>,<price_cents>,<qty>
    const symbol = fields[1];
    if (!isValidSymbol(symbol)) {
      return { success: false, message: null, error: 'TOB: invalid symbol' };
    }

    const side = fields[2];
    const priceCents = parseFloatField(fields[3]);
    if (priceCents === null) {
      return { success: false, message: null, error: 'TOB: invalid price' };
    }
    // Zig sends price in cents, convert to dollars
    const price = priceCents / 100;

    const quantity = parseIntField(fields[4]);
    if (quantity === null) {
      return { success: false, message: null, error: 'TOB: invalid quantity' };
    }

    const isBid = side === 'B' || side === 'BID' || side === 'BUY';

    return {
      success: true,
      message: {
        type: OutputMessageType.TOP_OF_BOOK,
        symbol,
        bidPrice: isBid ? price : 0,
        askPrice: isBid ? 0 : price,
        bidQuantity: isBid ? quantity : 0,
        askQuantity: isBid ? 0 : quantity,
      },
      error: null,
    };
  }

  return { success: false, message: null, error: `TOB: insufficient fields (got ${fields.length})` };
}

export function decode(line: string): DecodeResult {
  if (line.length === 0) {
    return { success: false, message: null, error: 'Empty message' };
  }
  if (line.length > MAX_CSV_MESSAGE_LENGTH) {
    return { success: false, message: null, error: 'Message too long' };
  }

  const fields = splitFields(line);
  if (fields === null) {
    return { success: false, message: null, error: 'Failed to parse fields' };
  }
  if (fields.length === 0) {
    return { success: false, message: null, error: 'No fields found' };
  }

  const msgType = fields[0];

  if (msgType === CSV_MSG_TYPE_ACK) {
    return decodeAck(fields);
  }
  if (msgType === CSV_MSG_TYPE_TRADE) {
    return decodeTrade(fields);
  }
  if (msgType === CSV_MSG_TYPE_REJECT) {
    return decodeReject(fields);
  }
  if (msgType === CSV_MSG_TYPE_TOP_OF_BOOK) {
    return decodeTopOfBook(fields);
  }
  if (msgType === CSV_MSG_TYPE_CANCEL_ACK || msgType === 'C') {
    return decodeCancelAck(fields);
  }

  return { success: false, message: null, error: `Unknown message type: ${msgType}` };
}

// ============================================================================
// Codec Detection
// ============================================================================

export function isCsvMessage(firstByte: number): boolean {
  // CSV messages start with printable ASCII: N, C, A, T, R, B, X
  if (firstByte === 0x4e) return true; // 'N'
  if (firstByte === 0x43) return true; // 'C'
  if (firstByte === 0x41) return true; // 'A'
  if (firstByte === 0x54) return true; // 'T'
  if (firstByte === 0x52) return true; // 'R'
  if (firstByte === 0x42) return true; // 'B'
  if (firstByte === 0x58) return true; // 'X' (Cancel Ack)
  return false;
}

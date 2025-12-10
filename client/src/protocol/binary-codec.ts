/**
 * Binary codec for low-latency message encoding/decoding.
 *
 * Binary format: 64-byte fixed-size messages
 *
 * Layout:
 *   Offset  Size  Field
 *   ------  ----  -----------
 *   0       1     msg_type
 *   1       1     side
 *   2       8     symbol (null-padded)
 *   10      4     user_id
 *   14      4     user_order_id
 *   18      8     price (scaled integer)
 *   26      4     quantity
 *   30      34    _padding
 *
 * @module protocol/binary-codec
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
  BINARY_MESSAGE_SIZE,
  SYMBOL_SIZE,
  BINARY_MSG_TYPE_NEW_ORDER,
  BINARY_MSG_TYPE_CANCEL,
  BINARY_MSG_TYPE_FLUSH,
  isValidSymbol,
  isValidPrice,
  isValidQuantity,
  isValidUserId,
  isValidOrderId,
  isValidSide,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

// Field offsets
const OFFSET_MSG_TYPE = 0;
const OFFSET_SIDE = 1;
const OFFSET_SYMBOL = 2;
const OFFSET_USER_ID = 10;
const OFFSET_USER_ORDER_ID = 14;
const OFFSET_PRICE = 18;
const OFFSET_QUANTITY = 26;

// Output message types (from engine)
const OUTPUT_MSG_TYPE_ACK = 0x10;
const OUTPUT_MSG_TYPE_REJECT = 0x11;
const OUTPUT_MSG_TYPE_TRADE = 0x12;
const OUTPUT_MSG_TYPE_CANCEL_ACK = 0x13;
const OUTPUT_MSG_TYPE_TOP_OF_BOOK = 0x14;

// Price scaling (engine uses integers, e.g., cents)
const PRICE_SCALE = 100;

// ============================================================================
// Result Types
// ============================================================================

export interface EncodeResult {
  readonly success: boolean;
  readonly data: Uint8Array;
  readonly error: string | null;
}

export interface DecodeResult {
  readonly success: boolean;
  readonly message: OutputMessage | null;
  readonly error: string | null;
}

// ============================================================================
// Pre-allocated Buffer Pool
// ============================================================================

// Pre-allocate a buffer for encoding to avoid allocations in hot path
const encodeBuffer = new ArrayBuffer(BINARY_MESSAGE_SIZE);
const encodeView = new DataView(encodeBuffer);
const encodeBytes = new Uint8Array(encodeBuffer);

// ============================================================================
// Helper Functions
// ============================================================================

function writeSymbol(view: DataView, offset: number, symbol: string): void {
  // Bounded loop: SYMBOL_SIZE iterations max
  for (let i = 0; i < SYMBOL_SIZE; i += 1) {
    if (i < symbol.length) {
      view.setUint8(offset + i, symbol.charCodeAt(i));
    } else {
      view.setUint8(offset + i, 0); // Null padding
    }
  }
}

function readSymbol(view: DataView, offset: number): string {
  let result = '';
  // Bounded loop: SYMBOL_SIZE iterations max
  for (let i = 0; i < SYMBOL_SIZE; i += 1) {
    const byte = view.getUint8(offset + i);
    if (byte === 0) {
      break;
    }
    result += String.fromCharCode(byte);
  }
  return result;
}

function clearBuffer(view: DataView): void {
  // Bounded loop: BINARY_MESSAGE_SIZE / 4 iterations
  const words = BINARY_MESSAGE_SIZE / 4;
  for (let i = 0; i < words; i += 1) {
    view.setUint32(i * 4, 0, true);
  }
}

// ============================================================================
// Encoding Functions
// ============================================================================

function encodeNewOrder(msg: NewOrderInput): EncodeResult {
  if (!isValidSymbol(msg.symbol)) {
    return { success: false, data: new Uint8Array(0), error: 'Invalid symbol' };
  }
  if (!isValidUserId(msg.userId)) {
    return { success: false, data: new Uint8Array(0), error: 'Invalid user ID' };
  }
  if (!isValidOrderId(msg.userOrderId)) {
    return { success: false, data: new Uint8Array(0), error: 'Invalid order ID' };
  }
  if (!isValidSide(msg.side)) {
    return { success: false, data: new Uint8Array(0), error: 'Invalid side' };
  }
  if (!isValidPrice(msg.price)) {
    return { success: false, data: new Uint8Array(0), error: 'Invalid price' };
  }
  if (!isValidQuantity(msg.quantity)) {
    return { success: false, data: new Uint8Array(0), error: 'Invalid quantity' };
  }

  clearBuffer(encodeView);

  encodeView.setUint8(OFFSET_MSG_TYPE, BINARY_MSG_TYPE_NEW_ORDER);
  encodeView.setUint8(OFFSET_SIDE, msg.side);
  writeSymbol(encodeView, OFFSET_SYMBOL, msg.symbol);
  encodeView.setUint32(OFFSET_USER_ID, msg.userId, true);
  encodeView.setUint32(OFFSET_USER_ORDER_ID, msg.userOrderId, true);

  // Scale price to integer (e.g., dollars -> cents)
  const scaledPrice = Math.round(msg.price * PRICE_SCALE);
  encodeView.setBigUint64(OFFSET_PRICE, BigInt(scaledPrice), true);

  encodeView.setUint32(OFFSET_QUANTITY, msg.quantity, true);

  // Return a copy (caller may hold reference)
  const copy = new Uint8Array(BINARY_MESSAGE_SIZE);
  copy.set(encodeBytes);
  return { success: true, data: copy, error: null };
}

function encodeCancel(msg: CancelInput): EncodeResult {
  if (!isValidSymbol(msg.symbol)) {
    return { success: false, data: new Uint8Array(0), error: 'Invalid symbol' };
  }
  if (!isValidUserId(msg.userId)) {
    return { success: false, data: new Uint8Array(0), error: 'Invalid user ID' };
  }
  if (!isValidOrderId(msg.userOrderId)) {
    return { success: false, data: new Uint8Array(0), error: 'Invalid order ID' };
  }

  clearBuffer(encodeView);

  encodeView.setUint8(OFFSET_MSG_TYPE, BINARY_MSG_TYPE_CANCEL);
  encodeView.setUint8(OFFSET_SIDE, 0);
  writeSymbol(encodeView, OFFSET_SYMBOL, msg.symbol);
  encodeView.setUint32(OFFSET_USER_ID, msg.userId, true);
  encodeView.setUint32(OFFSET_USER_ORDER_ID, msg.userOrderId, true);

  const copy = new Uint8Array(BINARY_MESSAGE_SIZE);
  copy.set(encodeBytes);
  return { success: true, data: copy, error: null };
}

export function encode(msg: InputMessage): EncodeResult {
  if (msg.type === MessageType.NEW_ORDER) {
    return encodeNewOrder(msg);
  }
  if (msg.type === MessageType.CANCEL) {
    return encodeCancel(msg);
  }
  if (msg.type === MessageType.FLUSH) {
    clearBuffer(encodeView);
    encodeView.setUint8(OFFSET_MSG_TYPE, BINARY_MSG_TYPE_FLUSH);
    encodeView.setUint32(OFFSET_USER_ID, msg.userId, true);
    const copy = new Uint8Array(BINARY_MESSAGE_SIZE);
    copy.set(encodeBytes);
    return { success: true, data: copy, error: null };
  }
  return { success: false, data: new Uint8Array(0), error: 'Unknown message type' };
}

// ============================================================================
// Decoding Functions
// ============================================================================

function decodeAck(view: DataView): DecodeResult {
  const symbol = readSymbol(view, OFFSET_SYMBOL);
  if (!isValidSymbol(symbol)) {
    return { success: false, message: null, error: 'ACK: invalid symbol' };
  }

  const userOrderId = view.getUint32(OFFSET_USER_ORDER_ID, true);
  const status = view.getUint8(OFFSET_SIDE); // Status stored in side field

  return {
    success: true,
    message: {
      type: OutputMessageType.ACK,
      symbol,
      userOrderId,
      status: status as typeof AckStatus[keyof typeof AckStatus],
    },
    error: null,
  };
}

function decodeReject(view: DataView): DecodeResult {
  const symbol = readSymbol(view, OFFSET_SYMBOL);
  if (!isValidSymbol(symbol)) {
    return { success: false, message: null, error: 'REJECT: invalid symbol' };
  }

  const userOrderId = view.getUint32(OFFSET_USER_ORDER_ID, true);
  const reason = view.getUint8(OFFSET_SIDE); // Reason stored in side field

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

function decodeTrade(view: DataView): DecodeResult {
  const symbol = readSymbol(view, OFFSET_SYMBOL);
  if (!isValidSymbol(symbol)) {
    return { success: false, message: null, error: 'TRADE: invalid symbol' };
  }

  const scaledPrice = Number(view.getBigUint64(OFFSET_PRICE, true));
  const price = scaledPrice / PRICE_SCALE;
  const quantity = view.getUint32(OFFSET_QUANTITY, true);

  // Buy/sell order IDs packed after quantity
  const buyOrderId = view.getUint32(30, true);
  const sellOrderId = view.getUint32(34, true);

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

function decodeCancelAck(view: DataView): DecodeResult {
  const symbol = readSymbol(view, OFFSET_SYMBOL);
  if (!isValidSymbol(symbol)) {
    return { success: false, message: null, error: 'CANCEL_ACK: invalid symbol' };
  }

  const userOrderId = view.getUint32(OFFSET_USER_ORDER_ID, true);

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

function decodeTopOfBook(view: DataView): DecodeResult {
  const symbol = readSymbol(view, OFFSET_SYMBOL);
  if (!isValidSymbol(symbol)) {
    return { success: false, message: null, error: 'TOB: invalid symbol' };
  }

  const scaledBidPrice = Number(view.getBigUint64(OFFSET_PRICE, true));
  const bidPrice = scaledBidPrice / PRICE_SCALE;

  const bidQuantity = view.getUint32(OFFSET_QUANTITY, true);

  // Ask data packed after bid data
  const scaledAskPrice = Number(view.getBigUint64(30, true));
  const askPrice = scaledAskPrice / PRICE_SCALE;
  const askQuantity = view.getUint32(38, true);

  return {
    success: true,
    message: {
      type: OutputMessageType.TOP_OF_BOOK,
      symbol,
      bidPrice,
      askPrice,
      bidQuantity,
      askQuantity,
    },
    error: null,
  };
}

export function decode(data: Uint8Array): DecodeResult {
  if (data.length < BINARY_MESSAGE_SIZE) {
    return { success: false, message: null, error: 'Message too short' };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const msgType = view.getUint8(OFFSET_MSG_TYPE);

  if (msgType === OUTPUT_MSG_TYPE_ACK) {
    return decodeAck(view);
  }
  if (msgType === OUTPUT_MSG_TYPE_REJECT) {
    return decodeReject(view);
  }
  if (msgType === OUTPUT_MSG_TYPE_TRADE) {
    return decodeTrade(view);
  }
  if (msgType === OUTPUT_MSG_TYPE_CANCEL_ACK) {
    return decodeCancelAck(view);
  }
  if (msgType === OUTPUT_MSG_TYPE_TOP_OF_BOOK) {
    return decodeTopOfBook(view);
  }

  return { success: false, message: null, error: `Unknown message type: 0x${msgType.toString(16)}` };
}

// ============================================================================
// Codec Detection
// ============================================================================

export function isBinaryMessage(firstByte: number): boolean {
  // Binary input messages: 0x01, 0x02, 0x03
  if (firstByte === BINARY_MSG_TYPE_NEW_ORDER) return true;
  if (firstByte === BINARY_MSG_TYPE_CANCEL) return true;
  if (firstByte === BINARY_MSG_TYPE_FLUSH) return true;

  // Binary output messages: 0x10-0x14
  if (firstByte === OUTPUT_MSG_TYPE_ACK) return true;
  if (firstByte === OUTPUT_MSG_TYPE_REJECT) return true;
  if (firstByte === OUTPUT_MSG_TYPE_TRADE) return true;
  if (firstByte === OUTPUT_MSG_TYPE_CANCEL_ACK) return true;
  if (firstByte === OUTPUT_MSG_TYPE_TOP_OF_BOOK) return true;

  return false;
}

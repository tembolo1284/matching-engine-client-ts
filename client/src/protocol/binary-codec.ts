/**
 * Binary codec matching Zig matching engine exactly.
 *
 * Wire format:
 *   Byte 0:     Magic (0x4D = 'M')
 *   Byte 1:     Message type (ASCII char)
 *   Byte 2+:    Payload (type-specific, BIG-ENDIAN)
 *
 * Message sizes:
 *   New Order:   27 bytes
 *   Cancel:      18 bytes
 *   Flush:        2 bytes
 *   Ack:         18 bytes
 *   Cancel Ack:  18 bytes
 *   Trade:       34 bytes
 *   Top of Book: 20 bytes
 *   Reject:      19 bytes
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
  SYMBOL_SIZE,
  isValidSymbol,
  isValidPrice,
  isValidQuantity,
  isValidUserId,
  isValidOrderId,
  isValidSide,
} from './types.js';

// ============================================================================
// Protocol Constants (matching Zig)
// ============================================================================

const MAGIC: number = 0x4d; // 'M'
const HEADER_SIZE: number = 2;

// Message type bytes
const MSG_NEW_ORDER: number = 0x4e; // 'N'
const MSG_CANCEL: number = 0x43; // 'C'
const MSG_FLUSH: number = 0x46; // 'F'
const MSG_ACK: number = 0x41; // 'A'
const MSG_CANCEL_ACK: number = 0x58; // 'X'
const MSG_TRADE: number = 0x54; // 'T'
const MSG_TOP_OF_BOOK: number = 0x42; // 'B'
const MSG_REJECT: number = 0x52; // 'R'

// Wire sizes
const NEW_ORDER_WIRE_SIZE: number = 27;
const CANCEL_WIRE_SIZE: number = 18;
const FLUSH_WIRE_SIZE: number = 2;
const ACK_WIRE_SIZE: number = 18;
const CANCEL_ACK_WIRE_SIZE: number = 18;
const TRADE_WIRE_SIZE: number = 34;
const TOP_OF_BOOK_WIRE_SIZE: number = 20;
const REJECT_WIRE_SIZE: number = 19;

// Side bytes
const SIDE_BUY: number = 0x42; // 'B'
const SIDE_SELL: number = 0x53; // 'S'

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
  readonly bytesConsumed: number;
  readonly error: string | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

function writeU32Big(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, false); // false = big-endian
}

function readU32Big(view: DataView, offset: number): number {
  return view.getUint32(offset, false); // false = big-endian
}

function writeSymbol(view: DataView, offset: number, symbol: string): void {
  for (let i = 0; i < SYMBOL_SIZE; i += 1) {
    if (i < symbol.length) {
      view.setUint8(offset + i, symbol.charCodeAt(i));
    } else {
      view.setUint8(offset + i, 0);
    }
  }
}

function readSymbol(view: DataView, offset: number): string {
  let result = '';
  for (let i = 0; i < SYMBOL_SIZE; i += 1) {
    const byte = view.getUint8(offset + i);
    if (byte === 0) break;
    result += String.fromCharCode(byte);
  }
  return result;
}

function sideToWire(side: number): number {
  if (side === Side.BUY) return SIDE_BUY;
  if (side === Side.SELL) return SIDE_SELL;
  return 0;
}

function wireToSide(byte: number): number | null {
  if (byte === SIDE_BUY) return Side.BUY;
  if (byte === SIDE_SELL) return Side.SELL;
  return null;
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

  const buffer = new ArrayBuffer(NEW_ORDER_WIRE_SIZE);
  const view = new DataView(buffer);
  let pos = 0;

  // Header
  view.setUint8(pos, MAGIC);
  pos += 1;
  view.setUint8(pos, MSG_NEW_ORDER);
  pos += 1;

  // user_id
  writeU32Big(view, pos, msg.userId);
  pos += 4;

  // symbol
  writeSymbol(view, pos, msg.symbol);
  pos += SYMBOL_SIZE;

  // price (as integer - assuming price is already scaled or we scale it)
  writeU32Big(view, pos, Math.round(msg.price * 100));
  pos += 4;

  // quantity
  writeU32Big(view, pos, msg.quantity);
  pos += 4;

  // side
  view.setUint8(pos, sideToWire(msg.side));
  pos += 1;

  // user_order_id
  writeU32Big(view, pos, msg.userOrderId);
  pos += 4;

  return { success: true, data: new Uint8Array(buffer), error: null };
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

  const buffer = new ArrayBuffer(CANCEL_WIRE_SIZE);
  const view = new DataView(buffer);
  let pos = 0;

  // Header
  view.setUint8(pos, MAGIC);
  pos += 1;
  view.setUint8(pos, MSG_CANCEL);
  pos += 1;

  // user_id
  writeU32Big(view, pos, msg.userId);
  pos += 4;

  // symbol
  writeSymbol(view, pos, msg.symbol);
  pos += SYMBOL_SIZE;

  // user_order_id
  writeU32Big(view, pos, msg.userOrderId);
  pos += 4;

  return { success: true, data: new Uint8Array(buffer), error: null };
}

function encodeFlush(): EncodeResult {
  const buffer = new ArrayBuffer(FLUSH_WIRE_SIZE);
  const view = new DataView(buffer);

  view.setUint8(0, MAGIC);
  view.setUint8(1, MSG_FLUSH);

  return { success: true, data: new Uint8Array(buffer), error: null };
}

export function encode(msg: InputMessage): EncodeResult {
  if (msg.type === MessageType.NEW_ORDER) {
    return encodeNewOrder(msg);
  }
  if (msg.type === MessageType.CANCEL) {
    return encodeCancel(msg);
  }
  if (msg.type === MessageType.FLUSH) {
    return encodeFlush();
  }
  return { success: false, data: new Uint8Array(0), error: 'Unknown message type' };
}

// ============================================================================
// Decoding Functions
// ============================================================================

function decodeAck(view: DataView): DecodeResult {
  let pos = HEADER_SIZE;

  const symbol = readSymbol(view, pos);
  pos += SYMBOL_SIZE;

  const userId = readU32Big(view, pos);
  pos += 4;

  const userOrderId = readU32Big(view, pos);
  pos += 4;

  return {
    success: true,
    message: {
      type: OutputMessageType.ACK,
      symbol,
      userOrderId,
      status: AckStatus.ACCEPTED,
    },
    bytesConsumed: ACK_WIRE_SIZE,
    error: null,
  };
}

function decodeTrade(view: DataView): DecodeResult {
  let pos = HEADER_SIZE;

  const symbol = readSymbol(view, pos);
  pos += SYMBOL_SIZE;

  const buyUserId = readU32Big(view, pos);
  pos += 4;

  const buyOrderId = readU32Big(view, pos);
  pos += 4;

  const sellUserId = readU32Big(view, pos);
  pos += 4;

  const sellOrderId = readU32Big(view, pos);
  pos += 4;

  const priceRaw = readU32Big(view, pos);
  pos += 4;

  const quantity = readU32Big(view, pos);
  pos += 4;

  return {
    success: true,
    message: {
      type: OutputMessageType.TRADE,
      symbol,
      price: priceRaw / 100,
      quantity,
      buyOrderId,
      sellOrderId,
    },
    bytesConsumed: TRADE_WIRE_SIZE,
    error: null,
  };
}

function decodeReject(view: DataView): DecodeResult {
  let pos = HEADER_SIZE;

  const symbol = readSymbol(view, pos);
  pos += SYMBOL_SIZE;

  const userId = readU32Big(view, pos);
  pos += 4;

  const userOrderId = readU32Big(view, pos);
  pos += 4;

  const reason = view.getUint8(pos);
  pos += 1;

  return {
    success: true,
    message: {
      type: OutputMessageType.REJECT,
      symbol,
      userOrderId,
      reason: reason as RejectReason,
    },
    bytesConsumed: REJECT_WIRE_SIZE,
    error: null,
  };
}

function decodeCancelAck(view: DataView): DecodeResult {
  let pos = HEADER_SIZE;

  const symbol = readSymbol(view, pos);
  pos += SYMBOL_SIZE;

  const userId = readU32Big(view, pos);
  pos += 4;

  const userOrderId = readU32Big(view, pos);
  pos += 4;

  return {
    success: true,
    message: {
      type: OutputMessageType.CANCEL_ACK,
      symbol,
      userOrderId,
    },
    bytesConsumed: CANCEL_ACK_WIRE_SIZE,
    error: null,
  };
}

function decodeTopOfBook(view: DataView): DecodeResult {
  let pos = HEADER_SIZE;

  const symbol = readSymbol(view, pos);
  pos += SYMBOL_SIZE;

  const sideByte = view.getUint8(pos);
  pos += 1;

  const side = wireToSide(sideByte);
  if (side === null) {
    return { success: false, message: null, bytesConsumed: 0, error: 'Invalid side' };
  }

  const priceRaw = readU32Big(view, pos);
  pos += 4;

  const quantity = readU32Big(view, pos);
  pos += 4;

  // Note: TopOfBook in Zig only has one side at a time
  // We'll need to track bid/ask separately in the UI
  const isBid = side === Side.BUY;

  return {
    success: true,
    message: {
      type: OutputMessageType.TOP_OF_BOOK,
      symbol,
      bidPrice: isBid ? priceRaw / 100 : 0,
      askPrice: isBid ? 0 : priceRaw / 100,
      bidQuantity: isBid ? quantity : 0,
      askQuantity: isBid ? 0 : quantity,
    },
    bytesConsumed: TOP_OF_BOOK_WIRE_SIZE,
    error: null,
  };
}

export function decode(data: Uint8Array): DecodeResult {
  if (data.length < HEADER_SIZE) {
    return { success: false, message: null, bytesConsumed: 0, error: 'Message too short' };
  }

  if (data[0] !== MAGIC) {
    return { success: false, message: null, bytesConsumed: 0, error: 'Invalid magic byte' };
  }

  const msgType = data[1];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  if (msgType === MSG_ACK) {
    if (data.length < ACK_WIRE_SIZE) {
      return { success: false, message: null, bytesConsumed: 0, error: 'Incomplete ACK' };
    }
    return decodeAck(view);
  }

  if (msgType === MSG_TRADE) {
    if (data.length < TRADE_WIRE_SIZE) {
      return { success: false, message: null, bytesConsumed: 0, error: 'Incomplete TRADE' };
    }
    return decodeTrade(view);
  }

  if (msgType === MSG_REJECT) {
    if (data.length < REJECT_WIRE_SIZE) {
      return { success: false, message: null, bytesConsumed: 0, error: 'Incomplete REJECT' };
    }
    return decodeReject(view);
  }

  if (msgType === MSG_CANCEL_ACK) {
    if (data.length < CANCEL_ACK_WIRE_SIZE) {
      return { success: false, message: null, bytesConsumed: 0, error: 'Incomplete CANCEL_ACK' };
    }
    return decodeCancelAck(view);
  }

  if (msgType === MSG_TOP_OF_BOOK) {
    if (data.length < TOP_OF_BOOK_WIRE_SIZE) {
      return { success: false, message: null, bytesConsumed: 0, error: 'Incomplete TOP_OF_BOOK' };
    }
    return decodeTopOfBook(view);
  }

  return { success: false, message: null, bytesConsumed: 0, error: `Unknown message type: 0x${msgType.toString(16)}` };
}

// ============================================================================
// Codec Detection
// ============================================================================

export function isBinaryMessage(firstByte: number): boolean {
  return firstByte === MAGIC;
}

// ============================================================================
// Exports for wire sizes (useful for relay)
// ============================================================================

export const WIRE_SIZES = {
  NEW_ORDER: NEW_ORDER_WIRE_SIZE,
  CANCEL: CANCEL_WIRE_SIZE,
  FLUSH: FLUSH_WIRE_SIZE,
  ACK: ACK_WIRE_SIZE,
  CANCEL_ACK: CANCEL_ACK_WIRE_SIZE,
  TRADE: TRADE_WIRE_SIZE,
  TOP_OF_BOOK: TOP_OF_BOOK_WIRE_SIZE,
  REJECT: REJECT_WIRE_SIZE,
} as const;

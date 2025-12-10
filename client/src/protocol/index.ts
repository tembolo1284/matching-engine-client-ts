/**
 * Protocol module exports.
 *
 * Provides message types, codecs, and encoding/decoding utilities
 * for communicating with the Zig matching engine.
 *
 * @module protocol
 */

// ============================================================================
// Types
// ============================================================================

export {
  // Constants
  BINARY_MESSAGE_SIZE,
  SYMBOL_SIZE,
  MAX_SYMBOL_LENGTH,
  MAX_CSV_MESSAGE_LENGTH,
  BINARY_MSG_TYPE_NEW_ORDER,
  BINARY_MSG_TYPE_CANCEL,
  BINARY_MSG_TYPE_FLUSH,
  CSV_MSG_TYPE_NEW_ORDER,
  CSV_MSG_TYPE_CANCEL,
  CSV_MSG_TYPE_ACK,
  CSV_MSG_TYPE_TRADE,
  CSV_MSG_TYPE_REJECT,
  CSV_MSG_TYPE_TOP_OF_BOOK,

  // Enums
  Side,
  MessageType,
  OutputMessageType,
  RejectReason,
  AckStatus,
  Codec,

  // Input message types
  type InputMessage,
  type NewOrderInput,
  type CancelInput,
  type FlushInput,

  // Output message types
  type OutputMessage,
  type AckOutput,
  type RejectOutput,
  type TradeOutput,
  type CancelAckOutput,
  type TopOfBookOutput,

  // Validation
  isValidSide,
  isValidSymbol,
  isValidPrice,
  isValidQuantity,
  isValidUserId,
  isValidOrderId,
} from './types.js';

// ============================================================================
// Codec (main interface)
// ============================================================================

export {
  encode,
  decode,
  decodeWithCodec,
  decodeBatch,
  detectCodec,
  type EncodeResult,
  type DecodeResult,
  type DetectResult,
  type BatchDecodeResult,
} from './codec.js';

// ============================================================================
// Individual codecs (for direct access if needed)
// ============================================================================

export {
  encode as csvEncode,
  decode as csvDecode,
  isCsvMessage,
  type EncodeResult as CsvEncodeResult,
  type DecodeResult as CsvDecodeResult,
} from './csv-codec.js';

export {
  encode as binaryEncode,
  decode as binaryDecode,
  isBinaryMessage,
  type EncodeResult as BinaryEncodeResult,
  type DecodeResult as BinaryDecodeResult,
} from './binary-codec.js';

/**
 * Codec router with automatic protocol detection.
 *
 * Detects CSV vs Binary based on first byte analysis,
 * matching the Zig engine's codec selection logic.
 *
 * @module protocol/codec
 */

import {
  type InputMessage,
  type OutputMessage,
  Codec,
  BINARY_MESSAGE_SIZE,
} from './types.js';

import {
  encode as csvEncode,
  decode as csvDecode,
  isCsvMessage,
  type EncodeResult as CsvEncodeResult,
  type DecodeResult as CsvDecodeResult,
} from './csv-codec.js';

import {
  encode as binaryEncode,
  decode as binaryDecode,
  isBinaryMessage,
  type EncodeResult as BinaryEncodeResult,
  type DecodeResult as BinaryDecodeResult,
} from './binary-codec.js';

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
  readonly codec: Codec;
  readonly error: string | null;
}

export interface DetectResult {
  readonly codec: Codec;
  readonly confidence: 'HIGH' | 'LOW';
}

// ============================================================================
// Codec Detection
// ============================================================================

/**
 * Detect codec from first byte of message.
 *
 * Binary messages start with 0x01-0x03 (input) or 0x10-0x14 (output).
 * CSV messages start with ASCII letters: N, C, A, T, R, B.
 */
export function detectCodec(data: Uint8Array): DetectResult {
  if (data.length === 0) {
    return { codec: Codec.UNKNOWN, confidence: 'LOW' };
  }

  const firstByte = data[0];

  if (isBinaryMessage(firstByte)) {
    return { codec: Codec.BINARY, confidence: 'HIGH' };
  }

  if (isCsvMessage(firstByte)) {
    return { codec: Codec.CSV, confidence: 'HIGH' };
  }

  // Heuristic: printable ASCII range suggests CSV
  if (firstByte >= 0x20 && firstByte <= 0x7e) {
    return { codec: Codec.CSV, confidence: 'LOW' };
  }

  // Heuristic: small values suggest binary
  if (firstByte < 0x20) {
    return { codec: Codec.BINARY, confidence: 'LOW' };
  }

  return { codec: Codec.UNKNOWN, confidence: 'LOW' };
}

// ============================================================================
// Encoding
// ============================================================================

/**
 * Encode message using specified codec.
 */
export function encode(msg: InputMessage, codec: Codec): EncodeResult {
  if (codec === Codec.CSV) {
    const result: CsvEncodeResult = csvEncode(msg);
    if (!result.success) {
      return { success: false, data: new Uint8Array(0), error: result.error };
    }
    // Convert string to Uint8Array
    const encoder = new TextEncoder();
    const data = encoder.encode(result.data);
    return { success: true, data, error: null };
  }

  if (codec === Codec.BINARY) {
    const result: BinaryEncodeResult = binaryEncode(msg);
    return result;
  }

  return { success: false, data: new Uint8Array(0), error: 'Unknown codec' };
}

// ============================================================================
// Decoding
// ============================================================================

/**
 * Decode message with automatic codec detection.
 */
export function decode(data: Uint8Array): DecodeResult {
  if (data.length === 0) {
    return {
      success: false,
      message: null,
      codec: Codec.UNKNOWN,
      error: 'Empty message',
    };
  }

  const detection = detectCodec(data);

  if (detection.codec === Codec.BINARY) {
    return decodeBinary(data);
  }

  if (detection.codec === Codec.CSV) {
    return decodeCsv(data);
  }

  return {
    success: false,
    message: null,
    codec: Codec.UNKNOWN,
    error: 'Could not detect codec',
  };
}

/**
 * Decode message using specified codec (skip auto-detection).
 */
export function decodeWithCodec(data: Uint8Array, codec: Codec): DecodeResult {
  if (codec === Codec.BINARY) {
    return decodeBinary(data);
  }

  if (codec === Codec.CSV) {
    return decodeCsv(data);
  }

  return {
    success: false,
    message: null,
    codec: Codec.UNKNOWN,
    error: 'Unknown codec',
  };
}

function decodeBinary(data: Uint8Array): DecodeResult {
  if (data.length < BINARY_MESSAGE_SIZE) {
    return {
      success: false,
      message: null,
      codec: Codec.BINARY,
      error: `Binary message too short: ${data.length} < ${BINARY_MESSAGE_SIZE}`,
    };
  }

  const result: BinaryDecodeResult = binaryDecode(data);

  return {
    success: result.success,
    message: result.message,
    codec: Codec.BINARY,
    error: result.error,
  };
}

function decodeCsv(data: Uint8Array): DecodeResult {
  // Convert bytes to string
  const decoder = new TextDecoder('utf-8');
  const text = decoder.decode(data);

  const result: CsvDecodeResult = csvDecode(text);

  return {
    success: result.success,
    message: result.message,
    codec: Codec.CSV,
    error: result.error,
  };
}

// ============================================================================
// Batch Decoding (for UDP batched messages)
// ============================================================================

const MAX_BATCH_MESSAGES = 64;
const CSV_NEWLINE = 0x0a; // '\n'

export interface BatchDecodeResult {
  readonly messages: OutputMessage[];
  readonly errors: string[];
  readonly codec: Codec;
}

/**
 * Decode multiple messages from a single buffer.
 *
 * For CSV: splits on newlines
 * For Binary: splits on 64-byte boundaries
 */
export function decodeBatch(data: Uint8Array): BatchDecodeResult {
  if (data.length === 0) {
    return { messages: [], errors: ['Empty buffer'], codec: Codec.UNKNOWN };
  }

  const detection = detectCodec(data);

  if (detection.codec === Codec.BINARY) {
    return decodeBinaryBatch(data);
  }

  if (detection.codec === Codec.CSV) {
    return decodeCsvBatch(data);
  }

  return { messages: [], errors: ['Could not detect codec'], codec: Codec.UNKNOWN };
}

function decodeBinaryBatch(data: Uint8Array): BatchDecodeResult {
  const messages: OutputMessage[] = [];
  const errors: string[] = [];

  const messageCount = Math.floor(data.length / BINARY_MESSAGE_SIZE);
  const boundedCount = Math.min(messageCount, MAX_BATCH_MESSAGES);

  // Bounded loop
  for (let i = 0; i < boundedCount; i += 1) {
    const offset = i * BINARY_MESSAGE_SIZE;
    const slice = data.subarray(offset, offset + BINARY_MESSAGE_SIZE);
    const result = binaryDecode(slice);

    if (result.success && result.message !== null) {
      messages.push(result.message);
    } else if (result.error !== null) {
      errors.push(`Message ${i}: ${result.error}`);
    }
  }

  return { messages, errors, codec: Codec.BINARY };
}

function decodeCsvBatch(data: Uint8Array): BatchDecodeResult {
  const messages: OutputMessage[] = [];
  const errors: string[] = [];

  let lineStart = 0;
  let messageCount = 0;

  // Bounded loop: data.length iterations max
  const maxLen = data.length;
  for (let i = 0; i <= maxLen; i += 1) {
    if (messageCount >= MAX_BATCH_MESSAGES) {
      break;
    }

    const atEnd = i === maxLen;
    const atNewline = !atEnd && data[i] === CSV_NEWLINE;

    if (atEnd || atNewline) {
      if (i > lineStart) {
        const lineData = data.subarray(lineStart, i);
        const decoder = new TextDecoder('utf-8');
        const lineText = decoder.decode(lineData);

        const result = csvDecode(lineText);

        if (result.success && result.message !== null) {
          messages.push(result.message);
        } else if (result.error !== null) {
          errors.push(`Line ${messageCount}: ${result.error}`);
        }

        messageCount += 1;
      }

      lineStart = i + 1;
    }
  }

  return { messages, errors, codec: Codec.CSV };
}

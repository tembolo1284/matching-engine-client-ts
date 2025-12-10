/**
 * Connection manager for orchestrating WebSocket connections.
 *
 * Handles:
 * - Codec selection (CSV/Binary) for outbound messages
 * - Automatic codec detection for inbound messages
 * - Message encoding/decoding
 * - Connection to orders endpoint and market data endpoint
 *
 * @module transport/connection-manager
 */

import {
  type InputMessage,
  type OutputMessage,
  type EncodeResult,
  type DecodeResult,
  type BatchDecodeResult,
  Codec,
  encode,
  decode,
  decodeBatch,
} from '../protocol/index.js';

import {
  createWebSocketClient,
  type WebSocketClient,
  type ConnectionStats,
  ConnectionState,
} from './websocket-client.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_ORDERS_PORT = 8080;
const DEFAULT_MARKET_DATA_PORT = 8082;
const MAX_MESSAGE_HANDLERS = 32;
const MAX_QUEUED_MESSAGES = 256;

// ============================================================================
// Types
// ============================================================================

export interface ConnectionManagerConfig {
  readonly ordersUrl: string;
  readonly marketDataUrl: string | null;
  readonly outboundCodec: Codec;
  readonly reconnect: boolean;
}

export interface ConnectionManagerStats {
  readonly orders: ConnectionStats;
  readonly marketData: ConnectionStats | null;
  readonly outboundCodec: Codec;
  readonly lastInboundCodec: Codec;
}

export type OutputMessageHandler = (message: OutputMessage) => void;
export type ConnectionStateHandler = (
  endpoint: 'orders' | 'marketData',
  state: ConnectionState
) => void;
export type ConnectionErrorHandler = (
  endpoint: 'orders' | 'marketData',
  error: Error
) => void;

// ============================================================================
// Default Configuration
// ============================================================================

function createDefaultConfig(
  host: string,
  ordersPort?: number,
  marketDataPort?: number | null
): ConnectionManagerConfig {
  const oPort = ordersPort ?? DEFAULT_ORDERS_PORT;
  const mdPort = marketDataPort ?? DEFAULT_MARKET_DATA_PORT;

  return {
    ordersUrl: `ws://${host}:${oPort}/orders`,
    marketDataUrl: mdPort !== null ? `ws://${host}:${mdPort}/market-data` : null,
    outboundCodec: Codec.CSV,
    reconnect: true,
  };
}

// ============================================================================
// Connection Manager
// ============================================================================

export interface ConnectionManager {
  connect(): void;
  disconnect(): void;
  sendOrder(message: InputMessage): SendResult;
  setOutboundCodec(codec: Codec): void;
  getOutboundCodec(): Codec;
  getStats(): ConnectionManagerStats;
  getOrdersState(): ConnectionState;
  getMarketDataState(): ConnectionState | null;
  onMessage(handler: OutputMessageHandler): void;
  onStateChange(handler: ConnectionStateHandler): void;
  onError(handler: ConnectionErrorHandler): void;
  destroy(): void;
}

export interface SendResult {
  readonly success: boolean;
  readonly error: string | null;
}

export function createConnectionManager(
  host: string,
  configOverrides?: Partial<ConnectionManagerConfig>
): ConnectionManager {
  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  const config: ConnectionManagerConfig = {
    ...createDefaultConfig(host),
    ...configOverrides,
  };

  let outboundCodec: Codec = config.outboundCodec;
  let lastInboundCodec: Codec = Codec.UNKNOWN;

  // Clients
  let ordersClient: WebSocketClient | null = null;
  let marketDataClient: WebSocketClient | null = null;

  // Handlers (fixed-size arrays to avoid unbounded growth)
  const messageHandlers: (OutputMessageHandler | null)[] = new Array(
    MAX_MESSAGE_HANDLERS
  ).fill(null);
  let messageHandlerCount = 0;

  const stateHandlers: (ConnectionStateHandler | null)[] = new Array(
    MAX_MESSAGE_HANDLERS
  ).fill(null);
  let stateHandlerCount = 0;

  const errorHandlers: (ConnectionErrorHandler | null)[] = new Array(
    MAX_MESSAGE_HANDLERS
  ).fill(null);
  let errorHandlerCount = 0;

  // Message queue for sending while reconnecting
  const messageQueue: Uint8Array[] = [];

  // --------------------------------------------------------------------------
  // Handler Dispatch
  // --------------------------------------------------------------------------

  function dispatchMessage(message: OutputMessage): void {
    // Bounded loop
    for (let i = 0; i < MAX_MESSAGE_HANDLERS; i += 1) {
      const handler = messageHandlers[i];
      if (handler !== null) {
        handler(message);
      }
    }
  }

  function dispatchStateChange(
    endpoint: 'orders' | 'marketData',
    state: ConnectionState
  ): void {
    // Bounded loop
    for (let i = 0; i < MAX_MESSAGE_HANDLERS; i += 1) {
      const handler = stateHandlers[i];
      if (handler !== null) {
        handler(endpoint, state);
      }
    }
  }

  function dispatchError(
    endpoint: 'orders' | 'marketData',
    error: Error
  ): void {
    // Bounded loop
    for (let i = 0; i < MAX_MESSAGE_HANDLERS; i += 1) {
      const handler = errorHandlers[i];
      if (handler !== null) {
        handler(endpoint, error);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Message Processing
  // --------------------------------------------------------------------------

  function handleOrdersMessage(data: Uint8Array): void {
    const result: DecodeResult = decode(data);

    if (result.codec !== Codec.UNKNOWN) {
      lastInboundCodec = result.codec;
    }

    if (!result.success) {
      dispatchError('orders', new Error(result.error ?? 'Decode failed'));
      return;
    }

    if (result.message !== null) {
      dispatchMessage(result.message);
    }
  }

  function handleMarketDataMessage(data: Uint8Array): void {
    // Market data may be batched (multiple messages in one UDP packet)
    const result: BatchDecodeResult = decodeBatch(data);

    if (result.codec !== Codec.UNKNOWN) {
      lastInboundCodec = result.codec;
    }

    // Dispatch all decoded messages (bounded by MAX_BATCH_MESSAGES in codec)
    const messageCount = result.messages.length;
    for (let i = 0; i < messageCount; i += 1) {
      dispatchMessage(result.messages[i]);
    }

    // Report errors
    const errorCount = result.errors.length;
    for (let i = 0; i < errorCount; i += 1) {
      dispatchError('marketData', new Error(result.errors[i]));
    }
  }

  // --------------------------------------------------------------------------
  // Queue Management
  // --------------------------------------------------------------------------

  function flushMessageQueue(): void {
    if (ordersClient === null) {
      return;
    }

    // Bounded loop
    let flushed = 0;
    while (messageQueue.length > 0 && flushed < MAX_QUEUED_MESSAGES) {
      const data = messageQueue.shift();
      if (data === undefined) {
        break;
      }

      const sent = ordersClient.send(data);
      if (!sent) {
        // Put it back and stop
        messageQueue.unshift(data);
        break;
      }

      flushed += 1;
    }
  }

  // --------------------------------------------------------------------------
  // Client Setup
  // --------------------------------------------------------------------------

  function setupOrdersClient(): void {
    ordersClient = createWebSocketClient(config.ordersUrl, {
      reconnect: config.reconnect,
    });

    ordersClient.onMessage(handleOrdersMessage);

    ordersClient.onStateChange((state: ConnectionState) => {
      dispatchStateChange('orders', state);

      if (state === ConnectionState.CONNECTED) {
        flushMessageQueue();
      }
    });

    ordersClient.onError((error: Error) => {
      dispatchError('orders', error);
    });
  }

  function setupMarketDataClient(): void {
    if (config.marketDataUrl === null) {
      return;
    }

    marketDataClient = createWebSocketClient(config.marketDataUrl, {
      reconnect: config.reconnect,
    });

    marketDataClient.onMessage(handleMarketDataMessage);

    marketDataClient.onStateChange((state: ConnectionState) => {
      dispatchStateChange('marketData', state);
    });

    marketDataClient.onError((error: Error) => {
      dispatchError('marketData', error);
    });
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  function connect(): void {
    if (ordersClient === null) {
      setupOrdersClient();
    }
    if (marketDataClient === null && config.marketDataUrl !== null) {
      setupMarketDataClient();
    }

    if (ordersClient !== null) {
      ordersClient.connect();
    }
    if (marketDataClient !== null) {
      marketDataClient.connect();
    }
  }

  function disconnect(): void {
    if (ordersClient !== null) {
      ordersClient.disconnect();
    }
    if (marketDataClient !== null) {
      marketDataClient.disconnect();
    }
  }

  function sendOrder(message: InputMessage): SendResult {
    const encodeResult: EncodeResult = encode(message, outboundCodec);

    if (!encodeResult.success) {
      return { success: false, error: encodeResult.error };
    }

    // If not connected, queue the message
    if (ordersClient === null) {
      if (messageQueue.length < MAX_QUEUED_MESSAGES) {
        messageQueue.push(encodeResult.data);
        return { success: true, error: null };
      }
      return { success: false, error: 'Message queue full' };
    }

    const state = ordersClient.getState();
    if (state !== ConnectionState.CONNECTED) {
      if (messageQueue.length < MAX_QUEUED_MESSAGES) {
        messageQueue.push(encodeResult.data);
        return { success: true, error: null };
      }
      return { success: false, error: 'Message queue full' };
    }

    const sent = ordersClient.send(encodeResult.data);
    if (!sent) {
      return { success: false, error: 'Failed to send' };
    }

    return { success: true, error: null };
  }

  function setOutboundCodec(codec: Codec): void {
    if (codec === Codec.UNKNOWN) {
      return;
    }
    outboundCodec = codec;
  }

  function getOutboundCodec(): Codec {
    return outboundCodec;
  }

  function getStats(): ConnectionManagerStats {
    return {
      orders: ordersClient?.getStats() ?? createEmptyStats(),
      marketData: marketDataClient?.getStats() ?? null,
      outboundCodec,
      lastInboundCodec,
    };
  }

  function getOrdersState(): ConnectionState {
    if (ordersClient === null) {
      return ConnectionState.DISCONNECTED;
    }
    return ordersClient.getState();
  }

  function getMarketDataState(): ConnectionState | null {
    if (marketDataClient === null) {
      return null;
    }
    return marketDataClient.getState();
  }

  function onMessage(handler: OutputMessageHandler): void {
    if (messageHandlerCount >= MAX_MESSAGE_HANDLERS) {
      return;
    }
    messageHandlers[messageHandlerCount] = handler;
    messageHandlerCount += 1;
  }

  function onStateChange(handler: ConnectionStateHandler): void {
    if (stateHandlerCount >= MAX_MESSAGE_HANDLERS) {
      return;
    }
    stateHandlers[stateHandlerCount] = handler;
    stateHandlerCount += 1;
  }

  function onError(handler: ConnectionErrorHandler): void {
    if (errorHandlerCount >= MAX_MESSAGE_HANDLERS) {
      return;
    }
    errorHandlers[errorHandlerCount] = handler;
    errorHandlerCount += 1;
  }

  function destroy(): void {
    disconnect();

    if (ordersClient !== null) {
      ordersClient.destroy();
      ordersClient = null;
    }

    if (marketDataClient !== null) {
      marketDataClient.destroy();
      marketDataClient = null;
    }

    // Clear handlers
    for (let i = 0; i < MAX_MESSAGE_HANDLERS; i += 1) {
      messageHandlers[i] = null;
      stateHandlers[i] = null;
      errorHandlers[i] = null;
    }

    messageHandlerCount = 0;
    stateHandlerCount = 0;
    errorHandlerCount = 0;

    // Clear queue
    messageQueue.length = 0;
  }

  // --------------------------------------------------------------------------
  // Return interface
  // --------------------------------------------------------------------------

  return {
    connect,
    disconnect,
    sendOrder,
    setOutboundCodec,
    getOutboundCodec,
    getStats,
    getOrdersState,
    getMarketDataState,
    onMessage,
    onStateChange,
    onError,
    destroy,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function createEmptyStats(): ConnectionStats {
  return {
    state: ConnectionState.DISCONNECTED,
    reconnectAttempts: 0,
    messagesSent: 0,
    messagesReceived: 0,
    bytesReceived: 0,
    bytesSent: 0,
    lastMessageTime: 0,
    connectedAt: null,
    latencyMs: null,
  };
}

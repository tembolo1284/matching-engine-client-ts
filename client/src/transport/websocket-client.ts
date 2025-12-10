/**
 * WebSocket client for connecting to the relay server.
 *
 * Handles:
 * - Connection lifecycle (connect, disconnect, reconnect)
 * - Binary message handling
 * - Connection health monitoring
 *
 * FRAMING NOTE:
 * WebSocket has built-in message framing, so we send/receive raw messages.
 * The relay server handles TCP length-prefix framing when forwarding to the
 * matching engine.
 *
 * @module transport/websocket-client
 */

// ============================================================================
// Constants
// ============================================================================

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const HEALTH_CHECK_INTERVAL_MS = 5000;
const CONNECTION_TIMEOUT_MS = 10000;

// ============================================================================
// Types
// ============================================================================

export const ConnectionState = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
  FAILED: 'FAILED',
} as const;

export type ConnectionState =
  (typeof ConnectionState)[keyof typeof ConnectionState];

export interface ConnectionStats {
  readonly state: ConnectionState;
  readonly reconnectAttempts: number;
  readonly messagesSent: number;
  readonly messagesReceived: number;
  readonly bytesReceived: number;
  readonly bytesSent: number;
  readonly lastMessageTime: number;
  readonly connectedAt: number | null;
  readonly latencyMs: number | null;
}

export interface WebSocketClientConfig {
  readonly url: string;
  readonly reconnect: boolean;
  readonly maxReconnectAttempts: number;
  readonly healthCheckIntervalMs: number;
}

export type MessageHandler = (data: Uint8Array) => void;
export type StateHandler = (state: ConnectionState) => void;
export type ErrorHandler = (error: Error) => void;

// ============================================================================
// Default Configuration
// ============================================================================

function createDefaultConfig(url: string): WebSocketClientConfig {
  return {
    url,
    reconnect: true,
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
    healthCheckIntervalMs: HEALTH_CHECK_INTERVAL_MS,
  };
}

// ============================================================================
// WebSocket Client
// ============================================================================

export interface WebSocketClient {
  connect(): void;
  disconnect(): void;
  send(data: Uint8Array): boolean;
  getStats(): ConnectionStats;
  getState(): ConnectionState;
  onMessage(handler: MessageHandler): void;
  onStateChange(handler: StateHandler): void;
  onError(handler: ErrorHandler): void;
  destroy(): void;
}

export function createWebSocketClient(
  url: string,
  configOverrides?: Partial<WebSocketClientConfig>
): WebSocketClient {
  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  const config: WebSocketClientConfig = {
    ...createDefaultConfig(url),
    ...configOverrides,
  };

  let socket: WebSocket | null = null;
  let state: ConnectionState = ConnectionState.DISCONNECTED;
  let reconnectAttempts = 0;
  let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let healthCheckIntervalId: ReturnType<typeof setInterval> | null = null;
  let connectionTimeoutId: ReturnType<typeof setTimeout> | null = null;

  let messagesSent = 0;
  let messagesReceived = 0;
  let bytesReceived = 0;
  let bytesSent = 0;
  let lastMessageTime = 0;
  let connectedAt: number | null = null;
  let latencyMs: number | null = null;

  // Handlers
  let messageHandler: MessageHandler | null = null;
  let stateHandler: StateHandler | null = null;
  let errorHandler: ErrorHandler | null = null;

  // --------------------------------------------------------------------------
  // State Management
  // --------------------------------------------------------------------------

  function setState(newState: ConnectionState): void {
    if (state === newState) {
      return;
    }
    state = newState;
    if (stateHandler !== null) {
      stateHandler(state);
    }
  }

  function emitError(error: Error): void {
    if (errorHandler !== null) {
      errorHandler(error);
    }
  }

  // --------------------------------------------------------------------------
  // Connection Management
  // --------------------------------------------------------------------------

  function clearTimers(): void {
    if (reconnectTimeoutId !== null) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
    if (healthCheckIntervalId !== null) {
      clearInterval(healthCheckIntervalId);
      healthCheckIntervalId = null;
    }
    if (connectionTimeoutId !== null) {
      clearTimeout(connectionTimeoutId);
      connectionTimeoutId = null;
    }
  }

  function startHealthCheck(): void {
    if (healthCheckIntervalId !== null) {
      return;
    }

    healthCheckIntervalId = setInterval(() => {
      if (socket === null || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      // Note: Browser WebSocket doesn't expose ping/pong frames
      // We rely on WebSocket's built-in keepalive
      // For explicit latency, we'd need application-level ping
    }, config.healthCheckIntervalMs);
  }

  function scheduleReconnect(): void {
    if (!config.reconnect) {
      setState(ConnectionState.FAILED);
      return;
    }

    if (reconnectAttempts >= config.maxReconnectAttempts) {
      setState(ConnectionState.FAILED);
      emitError(new Error('Max reconnection attempts reached'));
      return;
    }

    setState(ConnectionState.RECONNECTING);

    // Exponential backoff with jitter
    const baseDelay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts);
    const cappedDelay = Math.min(baseDelay, RECONNECT_MAX_DELAY_MS);
    const jitter = Math.random() * 0.3 * cappedDelay;
    const delay = cappedDelay + jitter;

    reconnectAttempts += 1;

    reconnectTimeoutId = setTimeout(() => {
      reconnectTimeoutId = null;
      connectInternal();
    }, delay);
  }

  function handleOpen(): void {
    if (connectionTimeoutId !== null) {
      clearTimeout(connectionTimeoutId);
      connectionTimeoutId = null;
    }

    setState(ConnectionState.CONNECTED);
    reconnectAttempts = 0;
    connectedAt = Date.now();

    startHealthCheck();
  }

  function handleClose(event: CloseEvent): void {
    clearTimers();
    socket = null;
    connectedAt = null;

    const wasConnected = state === ConnectionState.CONNECTED;

    if (wasConnected && config.reconnect) {
      scheduleReconnect();
    } else if (state !== ConnectionState.DISCONNECTED) {
      setState(ConnectionState.DISCONNECTED);
    }
  }

  function handleError(event: Event): void {
    emitError(new Error('WebSocket error'));
  }

  function handleMessage(event: MessageEvent): void {
    // Handle binary data (ArrayBuffer)
    if (event.data instanceof ArrayBuffer) {
      const data = new Uint8Array(event.data);
      bytesReceived += data.length;
      messagesReceived += 1;
      lastMessageTime = Date.now();

      // Deliver raw message directly - no framing to parse
      if (messageHandler !== null) {
        messageHandler(data);
      }
      return;
    }

    // Handle Blob (convert to ArrayBuffer)
    if (event.data instanceof Blob) {
      event.data.arrayBuffer().then((buffer) => {
        const data = new Uint8Array(buffer);
        bytesReceived += data.length;
        messagesReceived += 1;
        lastMessageTime = Date.now();

        if (messageHandler !== null) {
          messageHandler(data);
        }
      }).catch((err) => {
        emitError(new Error('Failed to read Blob data'));
      });
      return;
    }

    // Text messages not expected but handle gracefully
    emitError(new Error('Unexpected text message received'));
  }

  function connectInternal(): void {
    if (socket !== null) {
      return;
    }

    setState(ConnectionState.CONNECTING);

    try {
      socket = new WebSocket(config.url);
      socket.binaryType = 'arraybuffer';

      socket.onopen = handleOpen;
      socket.onclose = handleClose;
      socket.onerror = handleError;
      socket.onmessage = handleMessage;

      // Connection timeout
      connectionTimeoutId = setTimeout(() => {
        if (state === ConnectionState.CONNECTING) {
          emitError(new Error('Connection timeout'));
          if (socket !== null) {
            socket.close();
          }
        }
      }, CONNECTION_TIMEOUT_MS);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      emitError(error);
      scheduleReconnect();
    }
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  function connect(): void {
    if (state === ConnectionState.CONNECTED) {
      return;
    }
    if (state === ConnectionState.CONNECTING) {
      return;
    }

    reconnectAttempts = 0;
    connectInternal();
  }

  function disconnect(): void {
    clearTimers();

    if (socket !== null) {
      socket.onclose = null; // Prevent reconnect
      socket.close();
      socket = null;
    }

    setState(ConnectionState.DISCONNECTED);
    connectedAt = null;
  }

  function send(data: Uint8Array): boolean {
    if (socket === null) {
      return false;
    }
    if (socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      // Send raw message - WebSocket handles framing
      // The relay will add TCP length prefix when forwarding
      socket.send(data);
      messagesSent += 1;
      bytesSent += data.length;
      return true;
    } catch (err) {
      emitError(new Error('Failed to send message'));
      return false;
    }
  }

  function getStats(): ConnectionStats {
    return {
      state,
      reconnectAttempts,
      messagesSent,
      messagesReceived,
      bytesReceived,
      bytesSent,
      lastMessageTime,
      connectedAt,
      latencyMs,
    };
  }

  function getState(): ConnectionState {
    return state;
  }

  function onMessage(handler: MessageHandler): void {
    messageHandler = handler;
  }

  function onStateChange(handler: StateHandler): void {
    stateHandler = handler;
  }

  function onError(handler: ErrorHandler): void {
    errorHandler = handler;
  }

  function destroy(): void {
    disconnect();
    messageHandler = null;
    stateHandler = null;
    errorHandler = null;
  }

  // --------------------------------------------------------------------------
  // Return interface
  // --------------------------------------------------------------------------

  return {
    connect,
    disconnect,
    send,
    getStats,
    getState,
    onMessage,
    onStateChange,
    onError,
    destroy,
  };
}

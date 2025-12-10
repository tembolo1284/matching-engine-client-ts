/**
 * Transport module exports.
 *
 * Provides WebSocket client and connection manager for
 * communicating with the relay server.
 *
 * @module transport
 */

// ============================================================================
// WebSocket Client
// ============================================================================

export {
  createWebSocketClient,
  ConnectionState,
  type WebSocketClient,
  type WebSocketClientConfig,
  type ConnectionStats,
  type MessageHandler,
  type StateHandler,
  type ErrorHandler,
} from './websocket-client.js';

// ============================================================================
// Connection Manager
// ============================================================================

export {
  createConnectionManager,
  type ConnectionManager,
  type ConnectionManagerConfig,
  type ConnectionManagerStats,
  type SendResult,
  type OutputMessageHandler,
  type ConnectionStateHandler,
  type ConnectionErrorHandler,
} from './connection-manager.js';

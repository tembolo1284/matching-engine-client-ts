/**
 * Store state types.
 *
 * Defines the shape of application state for orders,
 * positions, trades, market data, and connection status.
 *
 * @module store/types
 */

import { type OutputMessage, type Side, type Codec } from '../protocol/index.js';
import { type ConnectionState } from '../transport/index.js';

// ============================================================================
// Constants
// ============================================================================

export const MAX_ORDERS = 1024;
export const MAX_TRADES = 2048;
export const MAX_SYMBOLS = 256;

// ============================================================================
// Order State
// ============================================================================

export const OrderStatus = {
  PENDING: 'PENDING',
  ACKED: 'ACKED',
  PARTIAL: 'PARTIAL',
  FILLED: 'FILLED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export interface Order {
  readonly symbol: string;
  readonly userId: number;
  readonly userOrderId: number;
  readonly side: Side;
  readonly price: number;
  readonly quantity: number;
  readonly filledQuantity: number;
  readonly status: OrderStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
}

// ============================================================================
// Position State
// ============================================================================

export interface Position {
  readonly symbol: string;
  readonly netQuantity: number;
  readonly buyQuantity: number;
  readonly sellQuantity: number;
  readonly avgBuyPrice: number;
  readonly avgSellPrice: number;
  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
  readonly lastPrice: number;
  readonly updatedAt: number;
}

// ============================================================================
// Trade State
// ============================================================================

export interface Trade {
  readonly id: number;
  readonly symbol: string;
  readonly price: number;
  readonly quantity: number;
  readonly side: Side;
  readonly userOrderId: number;
  readonly timestamp: number;
}

// ============================================================================
// Market Data State
// ============================================================================

export interface TopOfBook {
  readonly symbol: string;
  readonly bidPrice: number;
  readonly askPrice: number;
  readonly bidQuantity: number;
  readonly askQuantity: number;
  readonly updatedAt: number;
}

// ============================================================================
// Connection State
// ============================================================================

export interface ConnectionStatus {
  readonly ordersState: ConnectionState;
  readonly marketDataState: ConnectionState | null;
  readonly outboundCodec: Codec;
  readonly lastInboundCodec: Codec;
  readonly messagesSent: number;
  readonly messagesReceived: number;
  readonly lastError: string | null;
  readonly lastErrorAt: number | null;
}

// ============================================================================
// Application State
// ============================================================================

export interface AppState {
  // Orders indexed by `${userId}-${userOrderId}`
  readonly orders: Map<string, Order>;

  // Positions indexed by symbol
  readonly positions: Map<string, Position>;

  // Trade history (circular buffer - newest first)
  readonly trades: Trade[];
  readonly tradeCount: number;

  // Market data indexed by symbol
  readonly marketData: Map<string, TopOfBook>;

  // Connection status
  readonly connection: ConnectionStatus;

  // UI state
  readonly selectedSymbol: string;
  readonly userId: number;
  readonly nextOrderId: number;
}

// ============================================================================
// State Keys for Subscriptions
// ============================================================================

export const StateKey = {
  ORDERS: 'orders',
  POSITIONS: 'positions',
  TRADES: 'trades',
  MARKET_DATA: 'marketData',
  CONNECTION: 'connection',
  SELECTED_SYMBOL: 'selectedSymbol',
  USER_ID: 'userId',
} as const;

export type StateKey = (typeof StateKey)[keyof typeof StateKey];

// ============================================================================
// Helper Functions
// ============================================================================

export function createOrderKey(userId: number, userOrderId: number): string {
  return `${userId}-${userOrderId}`;
}

export function parseOrderKey(key: string): { userId: number; userOrderId: number } | null {
  const parts = key.split('-');
  if (parts.length !== 2) {
    return null;
  }

  const userId = parseInt(parts[0], 10);
  const userOrderId = parseInt(parts[1], 10);

  if (!Number.isFinite(userId)) {
    return null;
  }
  if (!Number.isFinite(userOrderId)) {
    return null;
  }

  return { userId, userOrderId };
}

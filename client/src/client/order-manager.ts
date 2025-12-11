/**
 * Order manager - orchestrates order flow between UI, transport, and store.
 *
 * Handles:
 * - Sending orders through the connection manager
 * - Processing incoming messages and updating store
 * - Mapping engine responses to order state changes
 *
 * @module client/order-manager
 */

import {
  type ConnectionManager,
  type OutputMessageHandler,
  type ConnectionStateHandler,
  type ConnectionErrorHandler,
  createConnectionManager,
  ConnectionState,
} from '../transport/index.js';

import {
  type InputMessage,
  type OutputMessage,
  type NewOrderInput,
  type CancelInput,
  MessageType,
  OutputMessageType,
  Side,
  Codec,
  AckStatus,
} from '../protocol/index.js';

import {
  type Store,
  type Order,
  OrderStatus,
  createOrderKey,
} from '../store/index.js';

// ============================================================================
// Constants
// ============================================================================

const MAX_PENDING_ACKS = 256;

// ============================================================================
// Types
// ============================================================================

export interface OrderManagerConfig {
  readonly host: string;
  readonly ordersPort?: number;
  readonly marketDataPort?: number | null;
  readonly codec?: Codec;
}

export interface OrderResult {
  readonly success: boolean;
  readonly userOrderId: number;
  readonly error: string | null;
}

export interface CancelResult {
  readonly success: boolean;
  readonly error: string | null;
}

interface PendingOrder {
  readonly userOrderId: number;
  readonly symbol: string;
  readonly side: Side;
  readonly price: number;
  readonly quantity: number;
  readonly sentAt: number;
}

// ============================================================================
// Order Manager
// ============================================================================

export interface OrderManager {
  connect(): void;
  disconnect(): void;
  submitOrder(symbol: string, side: Side, price: number, quantity: number): OrderResult;
  cancelOrder(symbol: string, userOrderId: number): CancelResult;
  cancelAllOrders(symbol: string): void;
  setCodec(codec: Codec): void;
  getCodec(): Codec;
  isConnected(): boolean;
  destroy(): void;
}

export function createOrderManager(
  store: Store,
  config: OrderManagerConfig
): OrderManager {
  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  const connectionManager: ConnectionManager = createConnectionManager(
    config.host,
    {
      ordersUrl: `ws://${config.host}:${config.ordersPort ?? 9080}/orders`,
      marketDataUrl: config.marketDataPort !== null
        ? `ws://${config.host}:${config.marketDataPort ?? 9082}/market-data`
        : null,
      outboundCodec: config.codec ?? Codec.CSV,
      reconnect: true,
    }
  );

  // Track pending orders awaiting ack (fixed-size array)
  const pendingOrders: (PendingOrder | null)[] = new Array(MAX_PENDING_ACKS).fill(null);

  // --------------------------------------------------------------------------
  // Pending Order Tracking
  // --------------------------------------------------------------------------

  function addPendingOrder(order: PendingOrder): boolean {
    // Find empty slot (bounded loop)
    for (let i = 0; i < MAX_PENDING_ACKS; i += 1) {
      if (pendingOrders[i] === null) {
        pendingOrders[i] = order;
        return true;
      }
    }
    return false;
  }

  function removePendingOrder(userOrderId: number): PendingOrder | null {
    // Find and remove (bounded loop)
    for (let i = 0; i < MAX_PENDING_ACKS; i += 1) {
      const pending = pendingOrders[i];
      if (pending !== null && pending.userOrderId === userOrderId) {
        pendingOrders[i] = null;
        return pending;
      }
    }
    return null;
  }

  function getPendingOrder(userOrderId: number): PendingOrder | null {
    for (let i = 0; i < MAX_PENDING_ACKS; i += 1) {
      const pending = pendingOrders[i];
      if (pending !== null && pending.userOrderId === userOrderId) {
        return pending;
      }
    }
    return null;
  }

  // --------------------------------------------------------------------------
  // Message Handlers
  // --------------------------------------------------------------------------

  function handleAck(msg: OutputMessage): void {
    if (msg.type !== OutputMessageType.ACK) {
      return;
    }

    const userId = store.getUserId();
    const pending = removePendingOrder(msg.userOrderId);

    if (pending !== null) {
      // Create order from pending data
      const order: Order = {
        symbol: pending.symbol,
        userId,
        userOrderId: pending.userOrderId,
        side: pending.side,
        price: pending.price,
        quantity: pending.quantity,
        filledQuantity: 0,
        status: OrderStatus.ACKED,
        createdAt: pending.sentAt,
        updatedAt: Date.now(),
      };

      store.addOrder(order);
    }

    // Update status based on ack status
    let status = OrderStatus.ACKED;
    if (msg.status === AckStatus.FILLED) {
      status = OrderStatus.FILLED;
    } else if (msg.status === AckStatus.PARTIAL_FILL) {
      status = OrderStatus.PARTIAL;
    }

    if (status !== OrderStatus.ACKED) {
      store.updateOrderStatus(userId, msg.userOrderId, status);
    }
  }

  function handleReject(msg: OutputMessage): void {
    if (msg.type !== OutputMessageType.REJECT) {
      return;
    }

    const userId = store.getUserId();
    const pending = removePendingOrder(msg.userOrderId);

    if (pending !== null) {
      // Create rejected order record
      const order: Order = {
        symbol: pending.symbol,
        userId,
        userOrderId: pending.userOrderId,
        side: pending.side,
        price: pending.price,
        quantity: pending.quantity,
        filledQuantity: 0,
        status: OrderStatus.REJECTED,
        createdAt: pending.sentAt,
        updatedAt: Date.now(),
      };

      store.addOrder(order);
    } else {
      // Update existing order
      store.updateOrderStatus(userId, msg.userOrderId, OrderStatus.REJECTED);
    }
  }

  function handleTrade(msg: OutputMessage): void {
    if (msg.type !== OutputMessageType.TRADE) {
      return;
    }

    const userId = store.getUserId();

    // Check if we're the buyer (compare userIds, not just look up orders)
    if (msg.buyUserId === userId) {
      const buyOrder = store.getOrder(userId, msg.buyOrderId);

      // Add trade record for our buy
      store.addTrade({
        symbol: msg.symbol,
        price: msg.price,
        quantity: msg.quantity,
        side: Side.BUY,
        userOrderId: msg.buyOrderId,
        timestamp: Date.now(),
      });

      // Update position (we bought, so positive)
      store.updatePosition(msg.symbol, Side.BUY, msg.price, msg.quantity);

      // Update order filled quantity if we have the order
      if (buyOrder !== null) {
        const newFilled = buyOrder.filledQuantity + msg.quantity;
        const status = newFilled >= buyOrder.quantity
          ? OrderStatus.FILLED
          : OrderStatus.PARTIAL;
        store.updateOrderStatus(userId, msg.buyOrderId, status, newFilled);
      }
    }

    // Check if we're the seller (compare userIds, not just look up orders)
    if (msg.sellUserId === userId) {
      const sellOrder = store.getOrder(userId, msg.sellOrderId);

      // Add trade record for our sell
      store.addTrade({
        symbol: msg.symbol,
        price: msg.price,
        quantity: msg.quantity,
        side: Side.SELL,
        userOrderId: msg.sellOrderId,
        timestamp: Date.now(),
      });

      // Update position (we sold, so negative)
      store.updatePosition(msg.symbol, Side.SELL, msg.price, msg.quantity);

      // Update order filled quantity if we have the order
      if (sellOrder !== null) {
        const newFilled = sellOrder.filledQuantity + msg.quantity;
        const status = newFilled >= sellOrder.quantity
          ? OrderStatus.FILLED
          : OrderStatus.PARTIAL;
        store.updateOrderStatus(userId, msg.sellOrderId, status, newFilled);
      }
    }
  }

  function handleCancelAck(msg: OutputMessage): void {
    if (msg.type !== OutputMessageType.CANCEL_ACK) {
      return;
    }

    const userId = store.getUserId();
    store.updateOrderStatus(userId, msg.userOrderId, OrderStatus.CANCELLED);
  }

  function handleTopOfBook(msg: OutputMessage): void {
    if (msg.type !== OutputMessageType.TOP_OF_BOOK) {
      return;
    }

    store.updateMarketData({
      symbol: msg.symbol,
      bidPrice: msg.bidPrice,
      askPrice: msg.askPrice,
      bidQuantity: msg.bidQuantity,
      askQuantity: msg.askQuantity,
      updatedAt: Date.now(),
    });
  }

  const messageHandler: OutputMessageHandler = (msg: OutputMessage): void => {
    // Update connection stats
    const stats = connectionManager.getStats();
    store.updateConnection({
      messagesReceived: stats.orders.messagesReceived,
      lastInboundCodec: stats.lastInboundCodec,
    });

    // Route to appropriate handler
    if (msg.type === OutputMessageType.ACK) {
      handleAck(msg);
      return;
    }
    if (msg.type === OutputMessageType.REJECT) {
      handleReject(msg);
      return;
    }
    if (msg.type === OutputMessageType.TRADE) {
      handleTrade(msg);
      return;
    }
    if (msg.type === OutputMessageType.CANCEL_ACK) {
      handleCancelAck(msg);
      return;
    }
    if (msg.type === OutputMessageType.TOP_OF_BOOK) {
      handleTopOfBook(msg);
      return;
    }
  };

  const stateHandler: ConnectionStateHandler = (
    endpoint: 'orders' | 'marketData',
    state: ConnectionState
  ): void => {
    if (endpoint === 'orders') {
      store.updateConnection({ ordersState: state });
    } else {
      store.updateConnection({ marketDataState: state });
    }
  };

  const errorHandler: ConnectionErrorHandler = (
    endpoint: 'orders' | 'marketData',
    error: Error
  ): void => {
    store.updateConnection({
      lastError: `${endpoint}: ${error.message}`,
      lastErrorAt: Date.now(),
    });
  };

  // --------------------------------------------------------------------------
  // Setup
  // --------------------------------------------------------------------------

  connectionManager.onMessage(messageHandler);
  connectionManager.onStateChange(stateHandler);
  connectionManager.onError(errorHandler);

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  function connect(): void {
    connectionManager.connect();
  }

  function disconnect(): void {
    connectionManager.disconnect();
  }

  function submitOrder(
    symbol: string,
    side: Side,
    price: number,
    quantity: number
  ): OrderResult {
    const userOrderId = store.consumeOrderId();
    const userId = store.getUserId();

    const msg: NewOrderInput = {
      type: MessageType.NEW_ORDER,
      symbol,
      userId,
      userOrderId,
      side,
      price,
      quantity,
    };

    // Track pending
    const pending: PendingOrder = {
      userOrderId,
      symbol,
      side,
      price,
      quantity,
      sentAt: Date.now(),
    };

    const added = addPendingOrder(pending);
    if (!added) {
      return {
        success: false,
        userOrderId,
        error: 'Too many pending orders',
      };
    }

    // Send
    const result = connectionManager.sendOrder(msg);

    if (!result.success) {
      removePendingOrder(userOrderId);
      return {
        success: false,
        userOrderId,
        error: result.error,
      };
    }

    // Update stats
    const stats = connectionManager.getStats();
    store.updateConnection({
      messagesSent: stats.orders.messagesSent,
      outboundCodec: stats.outboundCodec,
    });

    return {
      success: true,
      userOrderId,
      error: null,
    };
  }

  function cancelOrder(symbol: string, userOrderId: number): CancelResult {
    const userId = store.getUserId();

    const msg: CancelInput = {
      type: MessageType.CANCEL,
      symbol,
      userId,
      userOrderId,
    };

    const result = connectionManager.sendOrder(msg);

    if (!result.success) {
      return {
        success: false,
        error: result.error,
      };
    }

    return { success: true, error: null };
  }

  function cancelAllOrders(symbol: string): void {
    const orders = store.getOrders();
    const userId = store.getUserId();

    // Bounded iteration over orders
    let cancelled = 0;
    const maxCancels = 100;

    orders.forEach((order, key) => {
      if (cancelled >= maxCancels) {
        return;
      }

      if (order.symbol !== symbol) {
        return;
      }

      if (order.userId !== userId) {
        return;
      }

      const isActive =
        order.status === OrderStatus.ACKED ||
        order.status === OrderStatus.PARTIAL ||
        order.status === OrderStatus.PENDING;

      if (!isActive) {
        return;
      }

      cancelOrder(symbol, order.userOrderId);
      cancelled += 1;
    });
  }

  function setCodec(codec: Codec): void {
    connectionManager.setOutboundCodec(codec);
    store.updateConnection({ outboundCodec: codec });
  }

  function getCodec(): Codec {
    return connectionManager.getOutboundCodec();
  }

  function isConnected(): boolean {
    return connectionManager.getOrdersState() === ConnectionState.CONNECTED;
  }

  function destroy(): void {
    connectionManager.destroy();

    // Clear pending orders
    for (let i = 0; i < MAX_PENDING_ACKS; i += 1) {
      pendingOrders[i] = null;
    }
  }

  // --------------------------------------------------------------------------
  // Return interface
  // --------------------------------------------------------------------------

  return {
    connect,
    disconnect,
    submitOrder,
    cancelOrder,
    cancelAllOrders,
    setCodec,
    getCodec,
    isConnected,
    destroy,
  };
}

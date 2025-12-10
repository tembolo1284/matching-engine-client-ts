/**
 * Reactive store with subscriber pattern.
 *
 * Simple observable state management without external dependencies.
 * Supports fine-grained subscriptions by state key.
 *
 * @module store/store
 */

import {
  type AppState,
  type Order,
  type Position,
  type Trade,
  type TopOfBook,
  type ConnectionStatus,
  type OrderStatus,
  type StateKey,
  OrderStatus as OrderStatusEnum,
  MAX_ORDERS,
  MAX_TRADES,
  MAX_SYMBOLS,
  createOrderKey,
} from './types.js';

import { type Side, Codec, Side as SideEnum } from '../protocol/index.js';
import { ConnectionState } from '../transport/index.js';

// ============================================================================
// Constants
// ============================================================================

const MAX_SUBSCRIBERS_PER_KEY = 64;

// ============================================================================
// Types
// ============================================================================

export type Subscriber<T> = (value: T) => void;

export type StateSubscriber = Subscriber<AppState>;
export type OrdersSubscriber = Subscriber<Map<string, Order>>;
export type PositionsSubscriber = Subscriber<Map<string, Position>>;
export type TradesSubscriber = Subscriber<Trade[]>;
export type MarketDataSubscriber = Subscriber<Map<string, TopOfBook>>;
export type ConnectionSubscriber = Subscriber<ConnectionStatus>;

// ============================================================================
// Initial State
// ============================================================================

function createInitialState(): AppState {
  return {
    orders: new Map(),
    positions: new Map(),
    trades: [],
    tradeCount: 0,
    marketData: new Map(),
    connection: {
      ordersState: ConnectionState.DISCONNECTED,
      marketDataState: null,
      outboundCodec: Codec.CSV,
      lastInboundCodec: Codec.UNKNOWN,
      messagesSent: 0,
      messagesReceived: 0,
      lastError: null,
      lastErrorAt: null,
    },
    selectedSymbol: 'AAPL',
    userId: 1001,
    nextOrderId: 1,
  };
}

// ============================================================================
// Store Implementation
// ============================================================================

export interface Store {
  // Getters
  getState(): AppState;
  getOrders(): Map<string, Order>;
  getOrder(userId: number, userOrderId: number): Order | null;
  getPositions(): Map<string, Position>;
  getPosition(symbol: string): Position | null;
  getTrades(): Trade[];
  getMarketData(): Map<string, TopOfBook>;
  getTopOfBook(symbol: string): TopOfBook | null;
  getConnection(): ConnectionStatus;
  getSelectedSymbol(): string;
  getUserId(): number;
  getNextOrderId(): number;

  // Mutations
  addOrder(order: Order): void;
  updateOrderStatus(userId: number, userOrderId: number, status: OrderStatus, filledQty?: number): void;
  removeOrder(userId: number, userOrderId: number): void;
  updatePosition(symbol: string, side: Side, price: number, quantity: number): void;
  addTrade(trade: Omit<Trade, 'id'>): void;
  updateMarketData(tob: TopOfBook): void;
  updateConnection(partial: Partial<ConnectionStatus>): void;
  setSelectedSymbol(symbol: string): void;
  setUserId(userId: number): void;
  consumeOrderId(): number;

  // Subscriptions
  subscribe(key: StateKey, callback: Subscriber<unknown>): () => void;
  subscribeAll(callback: StateSubscriber): () => void;
}

export function createStore(): Store {
  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  let state: AppState = createInitialState();

  // Subscribers per key (fixed-size arrays)
  const subscribers: Record<StateKey, (Subscriber<unknown> | null)[]> = {
    orders: new Array(MAX_SUBSCRIBERS_PER_KEY).fill(null),
    positions: new Array(MAX_SUBSCRIBERS_PER_KEY).fill(null),
    trades: new Array(MAX_SUBSCRIBERS_PER_KEY).fill(null),
    marketData: new Array(MAX_SUBSCRIBERS_PER_KEY).fill(null),
    connection: new Array(MAX_SUBSCRIBERS_PER_KEY).fill(null),
    selectedSymbol: new Array(MAX_SUBSCRIBERS_PER_KEY).fill(null),
    userId: new Array(MAX_SUBSCRIBERS_PER_KEY).fill(null),
  };

  const globalSubscribers: (StateSubscriber | null)[] = new Array(
    MAX_SUBSCRIBERS_PER_KEY
  ).fill(null);

  // Trade ID counter
  let tradeIdCounter = 1;

  // --------------------------------------------------------------------------
  // Notification
  // --------------------------------------------------------------------------

  function notify(key: StateKey): void {
    const value = getValueForKey(key);
    const subs = subscribers[key];

    // Bounded loop
    for (let i = 0; i < MAX_SUBSCRIBERS_PER_KEY; i += 1) {
      const sub = subs[i];
      if (sub !== null) {
        sub(value);
      }
    }

    // Notify global subscribers
    for (let i = 0; i < MAX_SUBSCRIBERS_PER_KEY; i += 1) {
      const sub = globalSubscribers[i];
      if (sub !== null) {
        sub(state);
      }
    }
  }

  function getValueForKey(key: StateKey): unknown {
    if (key === 'orders') return state.orders;
    if (key === 'positions') return state.positions;
    if (key === 'trades') return state.trades;
    if (key === 'marketData') return state.marketData;
    if (key === 'connection') return state.connection;
    if (key === 'selectedSymbol') return state.selectedSymbol;
    if (key === 'userId') return state.userId;
    return null;
  }

  // --------------------------------------------------------------------------
  // Getters
  // --------------------------------------------------------------------------

  function getState(): AppState {
    return state;
  }

  function getOrders(): Map<string, Order> {
    return state.orders;
  }

  function getOrder(userId: number, userOrderId: number): Order | null {
    const key = createOrderKey(userId, userOrderId);
    return state.orders.get(key) ?? null;
  }

  function getPositions(): Map<string, Position> {
    return state.positions;
  }

  function getPosition(symbol: string): Position | null {
    return state.positions.get(symbol) ?? null;
  }

  function getTrades(): Trade[] {
    return state.trades;
  }

  function getMarketData(): Map<string, TopOfBook> {
    return state.marketData;
  }

  function getTopOfBook(symbol: string): TopOfBook | null {
    return state.marketData.get(symbol) ?? null;
  }

  function getConnection(): ConnectionStatus {
    return state.connection;
  }

  function getSelectedSymbol(): string {
    return state.selectedSymbol;
  }

  function getUserId(): number {
    return state.userId;
  }

  function getNextOrderId(): number {
    return state.nextOrderId;
  }

  // --------------------------------------------------------------------------
  // Mutations
  // --------------------------------------------------------------------------

  function addOrder(order: Order): void {
    if (state.orders.size >= MAX_ORDERS) {
      console.warn('Max orders reached, cannot add');
      return;
    }

    const key = createOrderKey(order.userId, order.userOrderId);
    const newOrders = new Map(state.orders);
    newOrders.set(key, order);

    state = { ...state, orders: newOrders };
    notify('orders');
  }

  function updateOrderStatus(
    userId: number,
    userOrderId: number,
    status: OrderStatus,
    filledQty?: number
  ): void {
    const key = createOrderKey(userId, userOrderId);
    const existing = state.orders.get(key);

    if (existing === undefined) {
      return;
    }

    const updated: Order = {
      ...existing,
      status,
      filledQuantity: filledQty ?? existing.filledQuantity,
      updatedAt: Date.now(),
    };

    const newOrders = new Map(state.orders);
    newOrders.set(key, updated);

    state = { ...state, orders: newOrders };
    notify('orders');
  }

  function removeOrder(userId: number, userOrderId: number): void {
    const key = createOrderKey(userId, userOrderId);

    if (!state.orders.has(key)) {
      return;
    }

    const newOrders = new Map(state.orders);
    newOrders.delete(key);

    state = { ...state, orders: newOrders };
    notify('orders');
  }

  function updatePosition(
    symbol: string,
    side: Side,
    price: number,
    quantity: number
  ): void {
    const existing = state.positions.get(symbol);
    const now = Date.now();

    let position: Position;

    if (existing === undefined) {
      // New position
      if (state.positions.size >= MAX_SYMBOLS) {
        console.warn('Max symbols reached, cannot add position');
        return;
      }

      const isBuy = side === SideEnum.BUY;
      position = {
        symbol,
        netQuantity: isBuy ? quantity : -quantity,
        buyQuantity: isBuy ? quantity : 0,
        sellQuantity: isBuy ? 0 : quantity,
        avgBuyPrice: isBuy ? price : 0,
        avgSellPrice: isBuy ? 0 : price,
        realizedPnl: 0,
        unrealizedPnl: 0,
        lastPrice: price,
        updatedAt: now,
      };
    } else {
      // Update existing position
      const isBuy = side === SideEnum.BUY;

      const newBuyQty = existing.buyQuantity + (isBuy ? quantity : 0);
      const newSellQty = existing.sellQuantity + (isBuy ? 0 : quantity);
      const newNetQty = existing.netQuantity + (isBuy ? quantity : -quantity);

      // Weighted average price calculation
      let newAvgBuyPrice = existing.avgBuyPrice;
      let newAvgSellPrice = existing.avgSellPrice;

      if (isBuy && quantity > 0) {
        const totalBuyCost = existing.avgBuyPrice * existing.buyQuantity + price * quantity;
        newAvgBuyPrice = newBuyQty > 0 ? totalBuyCost / newBuyQty : 0;
      } else if (!isBuy && quantity > 0) {
        const totalSellCost = existing.avgSellPrice * existing.sellQuantity + price * quantity;
        newAvgSellPrice = newSellQty > 0 ? totalSellCost / newSellQty : 0;
      }

      // Calculate realized P&L when closing position
      let realizedPnl = existing.realizedPnl;
      const closingQty = Math.min(
        isBuy ? existing.sellQuantity : existing.buyQuantity,
        quantity
      );

      if (closingQty > 0) {
        if (isBuy) {
          realizedPnl += closingQty * (existing.avgSellPrice - price);
        } else {
          realizedPnl += closingQty * (price - existing.avgBuyPrice);
        }
      }

      position = {
        symbol,
        netQuantity: newNetQty,
        buyQuantity: newBuyQty,
        sellQuantity: newSellQty,
        avgBuyPrice: newAvgBuyPrice,
        avgSellPrice: newAvgSellPrice,
        realizedPnl,
        unrealizedPnl: existing.unrealizedPnl,
        lastPrice: price,
        updatedAt: now,
      };
    }

    const newPositions = new Map(state.positions);
    newPositions.set(symbol, position);

    state = { ...state, positions: newPositions };
    notify('positions');
  }

  function addTrade(trade: Omit<Trade, 'id'>): void {
    const newTrade: Trade = {
      ...trade,
      id: tradeIdCounter,
    };
    tradeIdCounter += 1;

    // Circular buffer - keep newest first, limit to MAX_TRADES
    let newTrades: Trade[];
    if (state.trades.length >= MAX_TRADES) {
      newTrades = [newTrade, ...state.trades.slice(0, MAX_TRADES - 1)];
    } else {
      newTrades = [newTrade, ...state.trades];
    }

    state = {
      ...state,
      trades: newTrades,
      tradeCount: state.tradeCount + 1,
    };
    notify('trades');
  }

  function updateMarketData(tob: TopOfBook): void {
    if (!state.marketData.has(tob.symbol) && state.marketData.size >= MAX_SYMBOLS) {
      console.warn('Max symbols reached, cannot add market data');
      return;
    }

    const newMarketData = new Map(state.marketData);
    newMarketData.set(tob.symbol, tob);

    // Update unrealized P&L for positions
    const position = state.positions.get(tob.symbol);
    if (position !== undefined) {
      const midPrice = (tob.bidPrice + tob.askPrice) / 2;
      let unrealizedPnl = 0;

      if (position.netQuantity > 0) {
        unrealizedPnl = position.netQuantity * (midPrice - position.avgBuyPrice);
      } else if (position.netQuantity < 0) {
        unrealizedPnl = Math.abs(position.netQuantity) * (position.avgSellPrice - midPrice);
      }

      const updatedPosition: Position = {
        ...position,
        unrealizedPnl,
        lastPrice: midPrice,
        updatedAt: Date.now(),
      };

      const newPositions = new Map(state.positions);
      newPositions.set(tob.symbol, updatedPosition);
      state = { ...state, positions: newPositions };
      notify('positions');
    }

    state = { ...state, marketData: newMarketData };
    notify('marketData');
  }

  function updateConnection(partial: Partial<ConnectionStatus>): void {
    state = {
      ...state,
      connection: { ...state.connection, ...partial },
    };
    notify('connection');
  }

  function setSelectedSymbol(symbol: string): void {
    if (symbol === state.selectedSymbol) {
      return;
    }
    state = { ...state, selectedSymbol: symbol };
    notify('selectedSymbol');
  }

  function setUserId(userId: number): void {
    if (userId === state.userId) {
      return;
    }
    state = { ...state, userId };
    notify('userId');
  }

  function consumeOrderId(): number {
    const orderId = state.nextOrderId;
    state = { ...state, nextOrderId: orderId + 1 };
    return orderId;
  }

  // --------------------------------------------------------------------------
  // Subscriptions
  // --------------------------------------------------------------------------

  function subscribe(key: StateKey, callback: Subscriber<unknown>): () => void {
    const subs = subscribers[key];
    let slotIndex = -1;

    // Find empty slot (bounded loop)
    for (let i = 0; i < MAX_SUBSCRIBERS_PER_KEY; i += 1) {
      if (subs[i] === null) {
        slotIndex = i;
        break;
      }
    }

    if (slotIndex === -1) {
      console.warn(`Max subscribers reached for key: ${key}`);
      return () => {};
    }

    subs[slotIndex] = callback;

    // Return unsubscribe function
    return () => {
      subs[slotIndex] = null;
    };
  }

  function subscribeAll(callback: StateSubscriber): () => void {
    let slotIndex = -1;

    // Find empty slot (bounded loop)
    for (let i = 0; i < MAX_SUBSCRIBERS_PER_KEY; i += 1) {
      if (globalSubscribers[i] === null) {
        slotIndex = i;
        break;
      }
    }

    if (slotIndex === -1) {
      console.warn('Max global subscribers reached');
      return () => {};
    }

    globalSubscribers[slotIndex] = callback;

    return () => {
      globalSubscribers[slotIndex] = null;
    };
  }

  // --------------------------------------------------------------------------
  // Return interface
  // --------------------------------------------------------------------------

  return {
    getState,
    getOrders,
    getOrder,
    getPositions,
    getPosition,
    getTrades,
    getMarketData,
    getTopOfBook,
    getConnection,
    getSelectedSymbol,
    getUserId,
    getNextOrderId,
    addOrder,
    updateOrderStatus,
    removeOrder,
    updatePosition,
    addTrade,
    updateMarketData,
    updateConnection,
    setSelectedSymbol,
    setUserId,
    consumeOrderId,
    subscribe,
    subscribeAll,
  };
}

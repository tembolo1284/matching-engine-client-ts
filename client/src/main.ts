/**
 * Application entry point.
 *
 * Bootstraps the store, order manager, and UI components.
 *
 * @module main
 */

import { createStore, type Store } from './store/index.js';
import { createOrderManager, type OrderManager } from './client/index.js';
import { Codec } from './protocol/index.js';
import {
  createElement,
  getById,
  removeAllChildren,
  setInputValue,
  getNumericValue,
  addClass,
  removeClass,
} from './ui/utils/dom.js';
import {
  formatPrice,
  formatQuantity,
  formatPnl,
  formatPnlClass,
  formatSide,
  formatSideClass,
  formatOrderStatus,
  formatOrderStatusClass,
  formatConnectionStatus,
  formatConnectionStatusClass,
  formatCodec,
  formatTime,
  parsePrice,
  parseQuantity,
  parseSymbol,
} from './ui/utils/format.js';
import { Side } from './protocol/index.js';
import { type Order, type Position, type Trade, type TopOfBook, OrderStatus } from './store/index.js';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  host: 'localhost',
  ordersPort: 9080,
  marketDataPort: 9082,
  defaultCodec: Codec.BINARY,
};

// ============================================================================
// Globals
// ============================================================================

let store: Store;
let orderManager: OrderManager;

// ============================================================================
// Connection Status Component
// ============================================================================

function renderConnectionStatus(): void {
  const container = getById('connection-status');
  if (container === null) return;

  removeAllChildren(container);

  const connection = store.getConnection();

  const wrapper = createElement('div', { className: 'connection-status' });
  addClass(wrapper, formatConnectionStatusClass(connection.ordersState));

  const indicator = createElement('div', { className: 'connection-indicator' });
  const label = createElement('span', {
    textContent: formatConnectionStatus(connection.ordersState),
  });

  wrapper.appendChild(indicator);
  wrapper.appendChild(label);
  container.appendChild(wrapper);
}

// ============================================================================
// Codec Selector Component
// ============================================================================

function renderCodecSelector(): void {
  const container = getById('codec-selector');
  if (container === null) return;

  removeAllChildren(container);

  const wrapper = createElement('div', { className: 'codec-selector' });

  const label = createElement('label', { textContent: 'Codec:' });

  const select = createElement('select', {}, {
    onChange: (event: Event) => {
      const target = event.target as HTMLSelectElement;
      const codec = target.value === 'BINARY' ? Codec.BINARY : Codec.CSV;
      orderManager.setCodec(codec);
    },
  });

  const csvOption = createElement('option', { value: 'CSV', textContent: 'CSV' });
  const binaryOption = createElement('option', { value: 'BINARY', textContent: 'Binary' });

  const currentCodec = orderManager.getCodec();
  if (currentCodec === Codec.BINARY) {
    binaryOption.selected = true;
  } else {
    csvOption.selected = true;
  }

  select.appendChild(csvOption);
  select.appendChild(binaryOption);

  wrapper.appendChild(label);
  wrapper.appendChild(select);
  container.appendChild(wrapper);
}

// ============================================================================
// Order Entry Component
// ============================================================================

function renderOrderEntry(): void {
  const container = getById('order-entry');
  if (container === null) return;

  removeAllChildren(container);

  const wrapper = createElement('div', { className: 'order-entry' });

  const form = createElement('div', { className: 'order-entry-form' });

  // Symbol input
  const symbolGroup = createElement('div', { className: 'form-group' });
  const symbolLabel = createElement('label', { textContent: 'Symbol' });
  const symbolInput = createElement('input', {
    id: 'order-symbol',
    type: 'text',
    value: store.getSelectedSymbol(),
    placeholder: 'AAPL',
  });
  symbolGroup.appendChild(symbolLabel);
  symbolGroup.appendChild(symbolInput);

  // Price and Quantity row
  const priceQtyRow = createElement('div', { className: 'form-row' });

  const priceGroup = createElement('div', { className: 'form-group' });
  const priceLabel = createElement('label', { textContent: 'Price' });
  const priceInput = createElement('input', {
    id: 'order-price',
    type: 'number',
    placeholder: '0.00',
    min: '0',
    step: '0.01',
  });
  priceGroup.appendChild(priceLabel);
  priceGroup.appendChild(priceInput);

  const qtyGroup = createElement('div', { className: 'form-group' });
  const qtyLabel = createElement('label', { textContent: 'Quantity' });
  const qtyInput = createElement('input', {
    id: 'order-quantity',
    type: 'number',
    placeholder: '100',
    min: '1',
    step: '1',
  });
  qtyGroup.appendChild(qtyLabel);
  qtyGroup.appendChild(qtyInput);

  priceQtyRow.appendChild(priceGroup);
  priceQtyRow.appendChild(qtyGroup);

  // Buttons
  const buttons = createElement('div', { className: 'order-buttons' });

  const buyBtn = createElement('button', {
    className: 'btn-buy',
    textContent: 'Buy',
  }, {
    onClick: () => {
        console.log('Buy button clicked!');
        submitOrder(Side.BUY);
    },
  });

  const sellBtn = createElement('button', {
    className: 'btn-sell',
    textContent: 'Sell',
  }, {
    onClick: () => submitOrder(Side.SELL),
  });

  buttons.appendChild(buyBtn);
  buttons.appendChild(sellBtn);

  form.appendChild(symbolGroup);
  form.appendChild(priceQtyRow);
  form.appendChild(buttons);

  wrapper.appendChild(form);
  container.appendChild(wrapper);
}

function submitOrder(side: Side): void {
  const symbolInput = getById<HTMLInputElement>('order-symbol');
  const priceInput = getById<HTMLInputElement>('order-price');
  const qtyInput = getById<HTMLInputElement>('order-quantity');

  if (symbolInput === null || priceInput === null || qtyInput === null) {
    return;
  }

  const symbol = parseSymbol(symbolInput.value);
  const price = parsePrice(priceInput.value);
  const quantity = parseQuantity(qtyInput.value);

  if (symbol === null) {
    symbolInput.focus();
    return;
  }

  if (price === null) {
    priceInput.focus();
    return;
  }

  if (quantity === null) {
    qtyInput.focus();
    return;
  }

  const result = orderManager.submitOrder(symbol, side, price, quantity);

  if (result.success) {
    setInputValue(priceInput, '');
    setInputValue(qtyInput, '');
    store.setSelectedSymbol(symbol);
  }
}

// ============================================================================
// Positions Table Component
// ============================================================================

function renderPositionsTable(): void {
  const container = getById('positions-table');
  if (container === null) return;

  removeAllChildren(container);

  const positions = store.getPositions();

  if (positions.size === 0) {
    const empty = createElement('div', {
      className: 'empty-state',
      textContent: 'No positions',
    });
    container.appendChild(empty);
    return;
  }

  const table = createElement('table', { className: 'data-table' });

  // Header
  const thead = createElement('thead');
  const headerRow = createElement('tr');
  const headers = ['Symbol', 'Net Qty', 'Avg Buy', 'Avg Sell', 'Last', 'Unrealized', 'Realized'];

  for (let i = 0; i < headers.length; i += 1) {
    const th = createElement('th', { textContent: headers[i] });
    if (i > 0) addClass(th, 'align-right');
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = createElement('tbody');

  positions.forEach((position: Position) => {
    const row = createElement('tr');

    const symbolCell = createElement('td', { textContent: position.symbol });

    const netQtyCell = createElement('td', {
      textContent: formatQuantity(position.netQuantity),
      className: 'align-right ' + (position.netQuantity >= 0 ? 'side-buy' : 'side-sell'),
    });

    const avgBuyCell = createElement('td', {
      textContent: formatPrice(position.avgBuyPrice),
      className: 'align-right',
    });

    const avgSellCell = createElement('td', {
      textContent: formatPrice(position.avgSellPrice),
      className: 'align-right',
    });

    const lastCell = createElement('td', {
      textContent: formatPrice(position.lastPrice),
      className: 'align-right',
    });

    const unrealizedCell = createElement('td', {
      textContent: formatPnl(position.unrealizedPnl),
      className: 'align-right ' + formatPnlClass(position.unrealizedPnl),
    });

    const realizedCell = createElement('td', {
      textContent: formatPnl(position.realizedPnl),
      className: 'align-right ' + formatPnlClass(position.realizedPnl),
    });

    row.appendChild(symbolCell);
    row.appendChild(netQtyCell);
    row.appendChild(avgBuyCell);
    row.appendChild(avgSellCell);
    row.appendChild(lastCell);
    row.appendChild(unrealizedCell);
    row.appendChild(realizedCell);

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

// ============================================================================
// Orders Table Component
// ============================================================================

function renderOrdersTable(): void {
  const container = getById('orders-table');
  if (container === null) return;

  removeAllChildren(container);

  const orders = store.getOrders();
  const userId = store.getUserId();

  // Filter to working orders only
  const workingOrders: Order[] = [];
  orders.forEach((order: Order) => {
    if (order.userId !== userId) return;

    const isWorking =
      order.status === OrderStatus.PENDING ||
      order.status === OrderStatus.ACKED ||
      order.status === OrderStatus.PARTIAL;

    if (isWorking) {
      workingOrders.push(order);
    }
  });

  if (workingOrders.length === 0) {
    const empty = createElement('div', {
      className: 'empty-state',
      textContent: 'No working orders',
    });
    container.appendChild(empty);
    return;
  }

  const table = createElement('table', { className: 'data-table' });

  // Header
  const thead = createElement('thead');
  const headerRow = createElement('tr');
  const headers = ['Symbol', 'Side', 'Price', 'Qty', 'Filled', 'Status', ''];

  for (let i = 0; i < headers.length; i += 1) {
    const th = createElement('th', { textContent: headers[i] });
    if (i >= 2 && i <= 4) addClass(th, 'align-right');
    if (i === 6) addClass(th, 'align-center');
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = createElement('tbody');

  for (let i = 0; i < workingOrders.length; i += 1) {
    const order = workingOrders[i];
    const row = createElement('tr');

    const symbolCell = createElement('td', { textContent: order.symbol });

    const sideCell = createElement('td', {
      textContent: formatSide(order.side),
      className: formatSideClass(order.side),
    });

    const priceCell = createElement('td', {
      textContent: formatPrice(order.price),
      className: 'align-right',
    });

    const qtyCell = createElement('td', {
      textContent: formatQuantity(order.quantity),
      className: 'align-right',
    });

    const filledCell = createElement('td', {
      textContent: formatQuantity(order.filledQuantity),
      className: 'align-right',
    });

    const statusCell = createElement('td', {
      textContent: formatOrderStatus(order.status),
      className: formatOrderStatusClass(order.status),
    });

    const actionCell = createElement('td', { className: 'align-center' });
    const cancelBtn = createElement('button', {
      className: 'btn-cancel',
      textContent: 'Cancel',
    }, {
      onClick: () => {
        orderManager.cancelOrder(order.symbol, order.userOrderId);
      },
    });
    actionCell.appendChild(cancelBtn);

    row.appendChild(symbolCell);
    row.appendChild(sideCell);
    row.appendChild(priceCell);
    row.appendChild(qtyCell);
    row.appendChild(filledCell);
    row.appendChild(statusCell);
    row.appendChild(actionCell);

    tbody.appendChild(row);
  }

  table.appendChild(tbody);
  container.appendChild(table);
}

// ============================================================================
// Trades Table Component
// ============================================================================

function renderTradesTable(): void {
  const container = getById('trades-table');
  if (container === null) return;

  removeAllChildren(container);

  const trades = store.getTrades();

  if (trades.length === 0) {
    const empty = createElement('div', {
      className: 'empty-state',
      textContent: 'No trades',
    });
    container.appendChild(empty);
    return;
  }

  const table = createElement('table', { className: 'data-table' });

  // Header
  const thead = createElement('thead');
  const headerRow = createElement('tr');
  const headers = ['Time', 'Symbol', 'Side', 'Price', 'Qty'];

  for (let i = 0; i < headers.length; i += 1) {
    const th = createElement('th', { textContent: headers[i] });
    if (i >= 3) addClass(th, 'align-right');
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = createElement('tbody');
  const maxTrades = Math.min(trades.length, 100);

  for (let i = 0; i < maxTrades; i += 1) {
    const trade = trades[i];
    const row = createElement('tr');

    const timeCell = createElement('td', {
      textContent: formatTime(trade.timestamp),
    });

    const symbolCell = createElement('td', { textContent: trade.symbol });

    const sideCell = createElement('td', {
      textContent: formatSide(trade.side),
      className: formatSideClass(trade.side),
    });

    const priceCell = createElement('td', {
      textContent: formatPrice(trade.price),
      className: 'align-right',
    });

    const qtyCell = createElement('td', {
      textContent: formatQuantity(trade.quantity),
      className: 'align-right',
    });

    row.appendChild(timeCell);
    row.appendChild(symbolCell);
    row.appendChild(sideCell);
    row.appendChild(priceCell);
    row.appendChild(qtyCell);

    tbody.appendChild(row);
  }

  table.appendChild(tbody);
  container.appendChild(table);
}

// ============================================================================
// Market Data Component
// ============================================================================

function renderMarketData(): void {
  const container = getById('market-data');
  if (container === null) return;

  removeAllChildren(container);

  const marketData = store.getMarketData();

  if (marketData.size === 0) {
    const empty = createElement('div', {
      className: 'empty-state',
      textContent: 'No market data',
    });
    container.appendChild(empty);
    return;
  }

  const list = createElement('div', { className: 'market-data-list' });

  marketData.forEach((tob: TopOfBook) => {
    const item = createElement('div', { className: 'market-data-item' });

    const symbol = createElement('div', {
      className: 'market-data-symbol',
      textContent: tob.symbol,
    });

    const prices = createElement('div', { className: 'market-data-prices' });

    const bidWrapper = createElement('div');
    const bidPrice = createElement('span', {
      className: 'market-data-bid',
      textContent: formatPrice(tob.bidPrice),
    });
    const bidQty = createElement('span', {
      className: 'market-data-qty',
      textContent: ' (' + formatQuantity(tob.bidQuantity) + ')',
    });
    bidWrapper.appendChild(bidPrice);
    bidWrapper.appendChild(bidQty);

    const askWrapper = createElement('div');
    const askPrice = createElement('span', {
      className: 'market-data-ask',
      textContent: formatPrice(tob.askPrice),
    });
    const askQty = createElement('span', {
      className: 'market-data-qty',
      textContent: ' (' + formatQuantity(tob.askQuantity) + ')',
    });
    askWrapper.appendChild(askPrice);
    askWrapper.appendChild(askQty);

    prices.appendChild(bidWrapper);
    prices.appendChild(askWrapper);

    item.appendChild(symbol);
    item.appendChild(prices);
    list.appendChild(item);
  });

  container.appendChild(list);
}

// ============================================================================
// Footer Stats Component
// ============================================================================

function renderFooterStats(): void {
  const sentEl = getById('messages-sent');
  const recvEl = getById('messages-received');
  const errorEl = getById('last-error');

  const connection = store.getConnection();

  if (sentEl !== null) {
    sentEl.textContent = 'Sent: ' + connection.messagesSent;
  }

  if (recvEl !== null) {
    recvEl.textContent = 'Recv: ' + connection.messagesReceived;
  }

  if (errorEl !== null) {
    if (connection.lastError !== null) {
      errorEl.textContent = connection.lastError;
    } else {
      errorEl.textContent = '';
    }
  }
}

// ============================================================================
// Subscriptions
// ============================================================================

function setupSubscriptions(): void {
  store.subscribe('connection', () => {
    renderConnectionStatus();
    renderFooterStats();
  });

  store.subscribe('orders', () => {
    renderOrdersTable();
  });

  store.subscribe('positions', () => {
    renderPositionsTable();
  });

  store.subscribe('trades', () => {
    renderTradesTable();
  });

  store.subscribe('marketData', () => {
    renderMarketData();
  });
}

// ============================================================================
// Initialization
// ============================================================================

function init(): void {
  // Create store
  store = createStore();

  // Create order manager
  orderManager = createOrderManager(store, {
    host: CONFIG.host,
    ordersPort: CONFIG.ordersPort,
    marketDataPort: CONFIG.marketDataPort,
    codec: CONFIG.defaultCodec,
  });

  // Setup subscriptions
  setupSubscriptions();

  // Initial render
  renderConnectionStatus();
  renderCodecSelector();
  renderOrderEntry();
  renderPositionsTable();
  renderOrdersTable();
  renderTradesTable();
  renderMarketData();
  renderFooterStats();

  // Connect
  orderManager.connect();

  // Expose for debugging
  (window as any).store = store;
  (window as any).orderManager = orderManager;
  (window as any).Side = Side;
  (window as any).Codec = Codec;
  console.log('App initialized, orderManager exposed to window');
}

// ============================================================================
// Start
// ============================================================================

document.addEventListener('DOMContentLoaded', init);

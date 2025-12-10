/**
 * Formatting utilities for numbers, prices, dates, and display values.
 *
 * @module ui/utils/format
 */

// ============================================================================
// Constants
// ============================================================================

const PRICE_DECIMALS = 2;
const QUANTITY_DECIMALS = 0;
const PNL_DECIMALS = 2;
const PERCENT_DECIMALS = 2;

const THOUSAND = 1000;
const MILLION = 1000000;
const BILLION = 1000000000;

// ============================================================================
// Price Formatting
// ============================================================================

export function formatPrice(price: number): string {
  if (!Number.isFinite(price)) {
    return '-';
  }

  return price.toFixed(PRICE_DECIMALS);
}

export function formatPriceWithSign(price: number): string {
  if (!Number.isFinite(price)) {
    return '-';
  }

  const formatted = price.toFixed(PRICE_DECIMALS);
  if (price > 0) {
    return '+' + formatted;
  }

  return formatted;
}

export function formatBidAsk(bid: number, ask: number): string {
  const bidStr = formatPrice(bid);
  const askStr = formatPrice(ask);
  return `${bidStr} / ${askStr}`;
}

export function formatSpread(bid: number, ask: number): string {
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
    return '-';
  }

  const spread = ask - bid;
  return spread.toFixed(PRICE_DECIMALS);
}

// ============================================================================
// Quantity Formatting
// ============================================================================

export function formatQuantity(quantity: number): string {
  if (!Number.isFinite(quantity)) {
    return '-';
  }

  return quantity.toFixed(QUANTITY_DECIMALS);
}

export function formatQuantityWithSign(quantity: number): string {
  if (!Number.isFinite(quantity)) {
    return '-';
  }

  const formatted = quantity.toFixed(QUANTITY_DECIMALS);
  if (quantity > 0) {
    return '+' + formatted;
  }

  return formatted;
}

export function formatQuantityCompact(quantity: number): string {
  if (!Number.isFinite(quantity)) {
    return '-';
  }

  const abs = Math.abs(quantity);

  if (abs >= BILLION) {
    return (quantity / BILLION).toFixed(1) + 'B';
  }

  if (abs >= MILLION) {
    return (quantity / MILLION).toFixed(1) + 'M';
  }

  if (abs >= THOUSAND) {
    return (quantity / THOUSAND).toFixed(1) + 'K';
  }

  return quantity.toFixed(QUANTITY_DECIMALS);
}

// ============================================================================
// P&L Formatting
// ============================================================================

export function formatPnl(pnl: number): string {
  if (!Number.isFinite(pnl)) {
    return '-';
  }

  const formatted = Math.abs(pnl).toFixed(PNL_DECIMALS);

  if (pnl > 0) {
    return '+$' + formatted;
  }

  if (pnl < 0) {
    return '-$' + formatted;
  }

  return '$' + formatted;
}

export function formatPnlClass(pnl: number): string {
  if (!Number.isFinite(pnl)) {
    return 'pnl-neutral';
  }

  if (pnl > 0) {
    return 'pnl-positive';
  }

  if (pnl < 0) {
    return 'pnl-negative';
  }

  return 'pnl-neutral';
}

export function formatPnlPercent(pnl: number, basis: number): string {
  if (!Number.isFinite(pnl) || !Number.isFinite(basis) || basis === 0) {
    return '-';
  }

  const percent = (pnl / basis) * 100;
  const formatted = Math.abs(percent).toFixed(PERCENT_DECIMALS);

  if (percent > 0) {
    return '+' + formatted + '%';
  }

  if (percent < 0) {
    return '-' + formatted + '%';
  }

  return formatted + '%';
}

// ============================================================================
// Side Formatting
// ============================================================================

export function formatSide(side: number): string {
  if (side === 1) {
    return 'BUY';
  }

  if (side === 2) {
    return 'SELL';
  }

  return '-';
}

export function formatSideShort(side: number): string {
  if (side === 1) {
    return 'B';
  }

  if (side === 2) {
    return 'S';
  }

  return '-';
}

export function formatSideClass(side: number): string {
  if (side === 1) {
    return 'side-buy';
  }

  if (side === 2) {
    return 'side-sell';
  }

  return 'side-neutral';
}

// ============================================================================
// Status Formatting
// ============================================================================

export function formatOrderStatus(status: string): string {
  if (status === 'PENDING') return 'Pending';
  if (status === 'ACKED') return 'Open';
  if (status === 'PARTIAL') return 'Partial';
  if (status === 'FILLED') return 'Filled';
  if (status === 'CANCELLED') return 'Cancelled';
  if (status === 'REJECTED') return 'Rejected';
  return status;
}

export function formatOrderStatusClass(status: string): string {
  if (status === 'PENDING') return 'status-pending';
  if (status === 'ACKED') return 'status-open';
  if (status === 'PARTIAL') return 'status-partial';
  if (status === 'FILLED') return 'status-filled';
  if (status === 'CANCELLED') return 'status-cancelled';
  if (status === 'REJECTED') return 'status-rejected';
  return 'status-unknown';
}

export function formatConnectionStatus(status: string): string {
  if (status === 'DISCONNECTED') return 'Disconnected';
  if (status === 'CONNECTING') return 'Connecting...';
  if (status === 'CONNECTED') return 'Connected';
  if (status === 'RECONNECTING') return 'Reconnecting...';
  if (status === 'FAILED') return 'Failed';
  return status;
}

export function formatConnectionStatusClass(status: string): string {
  if (status === 'DISCONNECTED') return 'conn-disconnected';
  if (status === 'CONNECTING') return 'conn-connecting';
  if (status === 'CONNECTED') return 'conn-connected';
  if (status === 'RECONNECTING') return 'conn-reconnecting';
  if (status === 'FAILED') return 'conn-failed';
  return 'conn-unknown';
}

// ============================================================================
// Time Formatting
// ============================================================================

export function formatTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '-';
  }

  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

export function formatTimeWithMillis(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '-';
  }

  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  const millis = date.getMilliseconds().toString().padStart(3, '0');

  return `${hours}:${minutes}:${seconds}.${millis}`;
}

export function formatDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '-';
  }

  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function formatDateTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '-';
  }

  return formatDate(timestamp) + ' ' + formatTime(timestamp);
}

export function formatRelativeTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '-';
  }

  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 1000) {
    return 'just now';
  }

  if (diff < 60000) {
    const seconds = Math.floor(diff / 1000);
    return `${seconds}s ago`;
  }

  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}m ago`;
  }

  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  }

  const days = Math.floor(diff / 86400000);
  return `${days}d ago`;
}

// ============================================================================
// Symbol Formatting
// ============================================================================

export function formatSymbol(symbol: string): string {
  if (symbol.length === 0) {
    return '-';
  }

  return symbol.toUpperCase();
}

// ============================================================================
// Codec Formatting
// ============================================================================

export function formatCodec(codec: string): string {
  if (codec === 'CSV') return 'CSV';
  if (codec === 'BINARY') return 'Binary';
  if (codec === 'UNKNOWN') return 'Unknown';
  return codec;
}

// ============================================================================
// Number Parsing
// ============================================================================

export function parsePrice(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  const parsed = parseFloat(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (parsed < 0) {
    return null;
  }

  return parsed;
}

export function parseQuantity(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  const parsed = parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (parsed <= 0) {
    return null;
  }

  return parsed;
}

export function parseSymbol(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  if (trimmed === '') {
    return null;
  }

  if (trimmed.length > 8) {
    return null;
  }

  return trimmed;
}

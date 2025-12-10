# Architecture

## Overview
```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Browser                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                         Vanilla TS UI                               │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │ │
│  │  │Connection│ │  Order   │ │Positions │ │  Orders  │ │  Trades  │  │ │
│  │  │  Status  │ │  Entry   │ │  Table   │ │  Table   │ │  Table   │  │ │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘  │ │
│  │       │            │            │            │            │         │ │
│  │       └────────────┴────────────┴────────────┴────────────┘         │ │
│  │                                  │                                   │ │
│  │                           ┌──────▼──────┐                            │ │
│  │                           │    Store    │                            │ │
│  │                           │ (Reactive)  │                            │ │
│  │                           └──────┬──────┘                            │ │
│  │                                  │                                   │ │
│  │                           ┌──────▼──────┐                            │ │
│  │                           │   Order     │                            │ │
│  │                           │  Manager    │                            │ │
│  │                           └──────┬──────┘                            │ │
│  │                                  │                                   │ │
│  │  ┌───────────────────────────────┴───────────────────────────────┐  │ │
│  │  │                    Connection Manager                          │  │ │
│  │  │  ┌─────────────────────┐    ┌─────────────────────┐           │  │ │
│  │  │  │  WebSocket Client   │    │  WebSocket Client   │           │  │ │
│  │  │  │     (Orders)        │    │   (Market Data)     │           │  │ │
│  │  │  └──────────┬──────────┘    └──────────┬──────────┘           │  │ │
│  │  └─────────────┼──────────────────────────┼──────────────────────┘  │ │
│  │                │                          │                         │ │
│  │  ┌─────────────▼──────────────────────────▼──────────────────────┐  │ │
│  │  │                     Protocol Layer                             │  │ │
│  │  │  ┌──────────┐  ┌───────────┐  ┌────────────┐                  │  │ │
│  │  │  │  Codec   │  │ CSV Codec │  │Binary Codec│                  │  │ │
│  │  │  │(Detect)  │  │           │  │            │                  │  │ │
│  │  │  └──────────┘  └───────────┘  └────────────┘                  │  │ │
│  │  └────────────────────────────────────────────────────────────────┘  │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────┬─────────────────────────────┬─┘
                                            │ WS                          │ WS
                                            │ :9080                       │ :9082
┌───────────────────────────────────────────▼─────────────────────────────▼─┐
│                            Relay Server (Node.js)                         │
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐ │
│  │          TCP Relay              │  │       Multicast Relay           │ │
│  │   WS ◄──► Length-Prefix ◄──► TCP│  │   UDP Multicast ──► WS Broadcast│ │
│  └───────────────┬─────────────────┘  └───────────────┬─────────────────┘ │
└──────────────────┼────────────────────────────────────┼───────────────────┘
                   │ TCP :8080                          │ UDP 239.0.0.1:8082
┌──────────────────▼────────────────────────────────────▼───────────────────┐
│                         Zig Matching Engine                                │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                          I/O Thread                                  │  │
│  │   TCP Server ◄──► Codec ◄──► Router ──► SPSC Queues                 │  │
│  └─────────────────────────────────┬───────────────────────────────────┘  │
│                                    │                                       │
│            ┌───────────────────────┴───────────────────────┐              │
│            ▼                                               ▼              │
│  ┌─────────────────────┐                     ┌─────────────────────┐      │
│  │    Processor 0      │                     │    Processor 1      │      │
│  │   (Symbols A-M)     │                     │   (Symbols N-Z)     │      │
│  └─────────────────────┘                     └─────────────────────┘      │
└───────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Order Submission
```
1. User clicks "Buy" in UI
2. OrderEntry calls orderManager.submitOrder()
3. OrderManager:
   - Generates userOrderId
   - Creates NewOrderInput message
   - Tracks in pendingOrders
   - Calls connectionManager.sendOrder()
4. ConnectionManager:
   - Encodes message (CSV or Binary)
   - Sends via WebSocket
5. Relay:
   - Receives WebSocket message
   - Forwards to TCP with length prefix
6. Zig Engine:
   - Decodes message
   - Routes to processor
   - Matches order
   - Sends Ack/Trade/Reject
7. Response flows back through same path
8. OrderManager updates store
9. Store notifies UI subscribers
10. UI re-renders affected components
```

### Market Data Flow
```
1. Zig Engine publishes TopOfBook to multicast
2. Multicast Relay receives UDP packet
3. Relay broadcasts to all WebSocket clients
4. ConnectionManager receives message
5. Codec auto-detects format and decodes
6. OrderManager calls store.updateMarketData()
7. Store updates positions with unrealized P&L
8. Store notifies subscribers
9. UI updates market data and positions
```

## Component Details

### Protocol Layer

| File | Purpose |
|------|---------|
| `types.ts` | Message types, enums, validation |
| `csv-codec.ts` | CSV encode/decode |
| `binary-codec.ts` | 64-byte binary encode/decode |
| `codec.ts` | Auto-detection and routing |

### Transport Layer

| File | Purpose |
|------|---------|
| `websocket-client.ts` | Single WebSocket connection |
| `connection-manager.ts` | Multiple connections, codec selection |

### Store

Reactive state management with subscriber pattern:
```typescript
// Subscribe to changes
const unsubscribe = store.subscribe('positions', (positions) => {
  renderPositions(positions);
});

// Mutations trigger notifications
store.updatePosition('AAPL', Side.BUY, 150.0, 100);
```

### UI Components

Pure functions that create DOM elements and subscribe to store:
```typescript
function createPositionsTable(container: HTMLElement, store: Store): void {
  const table = createElement('table', { className: 'positions-table' });
  
  store.subscribe('positions', (positions) => {
    updateTableRows(table, positions);
  });
  
  container.appendChild(table);
}
```

## Design Principles

### NASA Power of Ten Compliance

| Rule | Implementation |
|------|----------------|
| No recursion | All algorithms iterative |
| Bounded loops | `MAX_*` constants on all iterations |
| No dynamic allocation | Fixed-size arrays for handlers/buffers |
| Short functions | All functions ≤60 lines |
| Assertions | Validation checks with early returns |
| Minimal scope | `const` at point of use |
| Check returns | All results handled |
| Limited complexity | No complex generics |
| Pointer discipline | Explicit null checks |
| Strict mode | TypeScript strict, no `any` |

### Performance Considerations

| Optimization | Benefit |
|--------------|---------|
| Fixed handler arrays | No allocation during message processing |
| Pre-allocated encode buffers | Zero-copy encoding |
| Bounded batch processing | Predictable latency |
| Direct DOM manipulation | No virtual DOM overhead |
| Fine-grained subscriptions | Minimal re-renders |

## Message Formats

### Length-Prefixed Framing (TCP/WebSocket)
```
┌────────────┬─────────────────────────────────┐
│  4 bytes   │           N bytes               │
│  (length)  │          (payload)              │
│  LE uint32 │                                 │
└────────────┴─────────────────────────────────┘
```

### Codec Detection

First byte determines codec:

| First Byte | Codec |
|------------|-------|
| 0x01-0x03 | Binary (input) |
| 0x10-0x14 | Binary (output) |
| 'N', 'C', 'A', 'T', 'R', 'B' | CSV |

## Error Handling

| Layer | Strategy |
|-------|----------|
| Protocol | Return `{ success, error }` objects |
| Transport | Emit errors to handlers, auto-reconnect |
| Store | Log warnings, ignore invalid operations |
| UI | Display error state, allow retry |

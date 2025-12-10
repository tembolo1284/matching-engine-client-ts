# Matching Engine Client

A TypeScript client and UI for the Zig matching engine. Features a WebSocket relay for browser connectivity and a vanilla TypeScript reactive UI.

## Features

- **Multi-Protocol Support**: CSV (human-readable) and Binary (low-latency) codecs
- **Auto-Detection**: Automatically detects inbound message format
- **Real-Time Updates**: Reactive store with fine-grained subscriptions
- **Position Tracking**: Automatic P&L calculation from trades
- **Market Data**: Live top-of-book updates via multicast relay
- **NASA Power of Ten Compliant**: Bounded loops, no recursion, fixed allocations

## Components

| Component | Description |
|-----------|-------------|
| `relay/` | WebSocket to TCP/Multicast bridge (Node.js) |
| `client/` | Browser application with reactive UI |
| `client/src/protocol/` | Message encoding/decoding |
| `client/src/transport/` | WebSocket connection management |
| `client/src/store/` | Reactive state management |
| `client/src/client/` | Order management orchestration |
| `client/src/ui/` | Vanilla TypeScript UI components |

## Requirements

- Node.js 18+
- Zig matching engine running on TCP port 8080
- (Optional) Multicast enabled for market data

## Quick Start
```bash
# Install dependencies
npm install

# Start the relay server
npm run relay

# Start the client dev server
npm run dev
```

See [QUICK_START.md](QUICK_START.md) for detailed setup.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for design details.

## Configuration

### Relay Server

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_WS_PORT` | 9080 | WebSocket port for orders |
| `RELAY_MCAST_WS_PORT` | 9082 | WebSocket port for market data |
| `ME_TCP_HOST` | localhost | Matching engine TCP host |
| `ME_TCP_PORT` | 8080 | Matching engine TCP port |
| `ME_MCAST_GROUP` | 239.0.0.1 | Multicast group address |
| `ME_MCAST_PORT` | 8082 | Multicast port |

### Client

Configure in `client/src/app.ts`:
```typescript
const config = {
  host: 'localhost',
  ordersPort: 9080,
  marketDataPort: 9082,
  codec: Codec.CSV,
};
```

## Protocol Support

### CSV Format
```
N,AAPL,1001,1,B,150.00,100    # New order
C,AAPL,1001,1                  # Cancel
A,AAPL,1,0                     # Ack
T,AAPL,150.00,100,1,2          # Trade
R,AAPL,1,3                     # Reject
```

### Binary Format

64-byte fixed-size messages with native byte order.


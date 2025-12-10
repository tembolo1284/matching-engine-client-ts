# Quick Start Guide

## Prerequisites

- Node.js 18 or later
- Zig matching engine (built and ready to run)
- Terminal with multiple tabs/panes

## Step 1: Clone and Install
```bash
git clone <repository-url>
cd matching-engine-client

# Install root dependencies
npm install

# Install relay dependencies
cd relay
npm install
cd ..

# Install client dependencies
cd client
npm install
cd ..
```

## Step 2: Start the Zig Matching Engine

In terminal 1:
```bash
cd /path/to/zig-matching-engine
make run-threaded
```

You should see:
```
TCP server listening on 0.0.0.0:8080
UDP server listening on 0.0.0.0:8081
Multicast publishing to 239.0.0.1:8082
Processors started
```

## Step 3: Start the Relay Server

In terminal 2:
```bash
cd matching-engine-client/relay
npm run dev
```

You should see:
```
TCP Relay listening on ws://localhost:9080/orders
Forwarding to TCP localhost:8080
Connecting to TCP localhost:8080...
TCP connected to localhost:8080
Multicast Relay listening on ws://localhost:9082/market-data
Subscribing to multicast 239.0.0.1:8082
Joined multicast group 239.0.0.1:8082
```

## Step 4: Start the Client

In terminal 3:
```bash
cd matching-engine-client/client
npm run dev
```

You should see:
```
VITE v5.x.x  ready in xxx ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
```

## Step 5: Open the UI

Open http://localhost:5173 in your browser.

You should see:

- Connection status: Connected (green)
- Order entry form
- Empty positions table
- Empty orders table
- Empty trades table

## Step 6: Submit a Test Order

1. Symbol: `AAPL`
2. Side: `BUY`
3. Price: `150.00`
4. Quantity: `100`
5. Click "Submit"

The order should appear in the Orders table with status "ACKED".

## Step 7: Create a Trade

Submit a matching sell order:

1. Symbol: `AAPL`
2. Side: `SELL`
3. Price: `150.00`
4. Quantity: `100`
5. Click "Submit"

You should see:

- Trade in the Trades table
- Position in the Positions table
- Orders updated to "FILLED" status

## Troubleshooting

### Connection Status: Disconnected

1. Verify relay is running: `npm run dev` in relay/
2. Verify matching engine is running
3. Check browser console for WebSocket errors
4. Verify ports 9080/9082 are not blocked

### Orders Not Appearing

1. Check relay console for "TCP connected"
2. Check browser console for encode/decode errors
3. Verify matching engine is accepting connections

### No Market Data

1. Multicast requires network configuration
2. Check relay console for "Joined multicast group"
3. May need to run on same machine as engine

### Codec Errors

1. Default is CSV - verify engine accepts CSV
2. Switch to Binary in UI if engine sends Binary
3. Check protocol/types.ts matches engine format

## Configuration

### Change Ports

Edit `relay/src/index.ts`:
```typescript
const tcpRelayWsPort = 9080;  // WebSocket port for orders
const tcpPort = 8080;          // Engine TCP port
```

Edit `client/src/app.ts`:
```typescript
const config = {
  host: 'localhost',
  ordersPort: 9080,
  marketDataPort: 9082,
};
```

### Use Binary Codec

In the UI, click the codec selector and choose "Binary".

Or set default in `client/src/app.ts`:
```typescript
const config = {
  codec: Codec.BINARY,
};
```

## Development

### Run Tests
```bash
# Relay tests
cd relay
npm test

# Client tests
cd client
npm test
```

### Build for Production
```bash
# Build relay
cd relay
npm run build

# Build client
cd client
npm run build
```

### Type Check
```bash
# Both projects
npm run typecheck
```

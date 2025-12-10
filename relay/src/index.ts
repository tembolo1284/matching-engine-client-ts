/**
 * Relay server entry point.
 *
 * Starts both TCP and Multicast relays for bridging
 * browser WebSocket connections to the Zig matching engine.
 *
 * @module relay
 */

import { createTcpRelay, type TcpRelay } from './tcp-relay.js';
import { createMulticastRelay, type MulticastRelay } from './multicast-relay.js';

// ============================================================================
// Configuration from Environment
// ============================================================================

function getEnvInt(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  return parsed;
}

function getEnvString(name: string, defaultValue: string): string {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }
  return value;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  // Parse configuration from environment
  const tcpRelayWsPort = getEnvInt('RELAY_WS_PORT', 9080);
  const tcpHost = getEnvString('ME_TCP_HOST', 'localhost');
  const tcpPort = getEnvInt('ME_TCP_PORT', 8080);

  const multicastRelayWsPort = getEnvInt('RELAY_MCAST_WS_PORT', 9082);
  const multicastGroup = getEnvString('ME_MCAST_GROUP', '239.0.0.1');
  const multicastPort = getEnvInt('ME_MCAST_PORT', 8082);

  // Create relays
  const tcpRelay: TcpRelay = createTcpRelay({
    wsPort: tcpRelayWsPort,
    tcpHost,
    tcpPort,
  });

  const multicastRelay: MulticastRelay = createMulticastRelay({
    wsPort: multicastRelayWsPort,
    multicastGroup,
    multicastPort,
  });

  // Graceful shutdown
  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    console.log('\nShutting down...');

    await tcpRelay.stop();
    await multicastRelay.stop();

    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start relays
  try {
    await tcpRelay.start();
    await multicastRelay.start();

    console.log('\nRelay server running. Press Ctrl+C to stop.\n');

    // Print stats periodically
    setInterval(() => {
      const tcpStats = tcpRelay.getStats();
      const mcastStats = multicastRelay.getStats();

      console.log(
        `[TCP] clients=${tcpStats.clientCount} ` +
        `connected=${tcpStats.tcpConnected} ` +
        `relayed=${tcpStats.messagesRelayed}`
      );
      console.log(
        `[MCAST] clients=${mcastStats.clientCount} ` +
        `joined=${mcastStats.multicastJoined} ` +
        `received=${mcastStats.messagesReceived} ` +
        `gaps=${mcastStats.sequenceGaps}`
      );
    }, 10000);
  } catch (err) {
    console.error('Failed to start relay server:', err);
    process.exit(1);
  }
}

// Run
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// ============================================================================
// Exports for programmatic use
// ============================================================================

export { createTcpRelay, type TcpRelay, type TcpRelayConfig, type TcpRelayStats } from './tcp-relay.js';
export { createMulticastRelay, type MulticastRelay, type MulticastRelayConfig, type MulticastRelayStats } from './multicast-relay.js';

/**
 * Multicast Relay - UDP Multicast to WebSocket bridge.
 *
 * Subscribes to the matching engine's multicast market data feed
 * and broadcasts to connected WebSocket clients.
 *
 * WebSocket clients connect to ws://host:port/market-data
 * Relay subscribes to multicast group and forwards all data.
 *
 * @module relay/multicast-relay
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createSocket, Socket as UdpSocket } from 'dgram';
import { createServer, Server } from 'http';

// ============================================================================
// Constants
// ============================================================================

const MAX_CLIENTS = 256;
const MAX_UDP_PAYLOAD = 1400;
const SEQUENCE_SIZE = 8;

// ============================================================================
// Types
// ============================================================================

export interface MulticastRelayConfig {
  readonly wsPort: number;
  readonly wsPath: string;
  readonly multicastGroup: string;
  readonly multicastPort: number;
  readonly multicastInterface: string;
}

export interface MulticastRelayStats {
  readonly clientCount: number;
  readonly multicastJoined: boolean;
  readonly messagesReceived: number;
  readonly messagesBroadcast: number;
  readonly bytesReceived: number;
  readonly lastSequence: bigint;
  readonly sequenceGaps: number;
}

interface ClientState {
  readonly id: number;
  readonly ws: WebSocket;
}

// ============================================================================
// Default Configuration
// ============================================================================

function createDefaultConfig(): MulticastRelayConfig {
  return {
    wsPort: 9082,
    wsPath: '/market-data',
    multicastGroup: '239.0.0.1',
    multicastPort: 8082,
    multicastInterface: '0.0.0.0',
  };
}

// ============================================================================
// Multicast Relay
// ============================================================================

export interface MulticastRelay {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStats(): MulticastRelayStats;
}

export function createMulticastRelay(
  configOverrides?: Partial<MulticastRelayConfig>
): MulticastRelay {
  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  const config: MulticastRelayConfig = {
    ...createDefaultConfig(),
    ...configOverrides,
  };

  let httpServer: Server | null = null;
  let wss: WebSocketServer | null = null;
  let udpSocket: UdpSocket | null = null;
  let multicastJoined = false;

  // Client management (fixed-size array)
  const clients: (ClientState | null)[] = new Array(MAX_CLIENTS).fill(null);
  let clientIdCounter = 0;

  // Stats
  let messagesReceived = 0;
  let messagesBroadcast = 0;
  let bytesReceived = 0;
  let lastSequence: bigint = BigInt(0);
  let sequenceGaps = 0;

  // --------------------------------------------------------------------------
  // Client Management
  // --------------------------------------------------------------------------

  function addClient(ws: WebSocket): ClientState | null {
    // Find empty slot (bounded loop)
    for (let i = 0; i < MAX_CLIENTS; i += 1) {
      if (clients[i] === null) {
        const client: ClientState = {
          id: clientIdCounter,
          ws,
        };
        clientIdCounter += 1;
        clients[i] = client;
        return client;
      }
    }
    return null;
  }

  function removeClient(client: ClientState): void {
    // Find and remove (bounded loop)
    for (let i = 0; i < MAX_CLIENTS; i += 1) {
      if (clients[i] !== null && clients[i]!.id === client.id) {
        clients[i] = null;
        break;
      }
    }
  }

  function getClientCount(): number {
    let count = 0;
    for (let i = 0; i < MAX_CLIENTS; i += 1) {
      if (clients[i] !== null) {
        count += 1;
      }
    }
    return count;
  }

  function broadcastToClients(data: Buffer): void {
    const clientCount = getClientCount();
    if (clientCount === 0) {
      return;
    }

    // Bounded loop
    for (let i = 0; i < MAX_CLIENTS; i += 1) {
      const client = clients[i];
      if (client === null) {
        continue;
      }

      if (client.ws.readyState !== WebSocket.OPEN) {
        continue;
      }

      try {
        client.ws.send(data);
        messagesBroadcast += 1;
      } catch (err) {
        console.error(`Failed to send to client ${client.id}:`, err);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Sequence Tracking
  // --------------------------------------------------------------------------

  function checkSequence(data: Buffer): void {
    // Multicast packets have 8-byte sequence header (big-endian)
    if (data.length < SEQUENCE_SIZE) {
      return;
    }

    const sequence = data.readBigUInt64BE(0);

    if (lastSequence !== BigInt(0)) {
      const expected = lastSequence + BigInt(1);
      if (sequence !== expected) {
        const gap = Number(sequence - lastSequence - BigInt(1));
        sequenceGaps += gap > 0 ? gap : 1;
        console.warn(
          `Sequence gap detected: expected ${expected}, got ${sequence}`
        );
      }
    }

    lastSequence = sequence;
  }

  // --------------------------------------------------------------------------
  // UDP Multicast
  // --------------------------------------------------------------------------

  function setupMulticast(): void {
    udpSocket = createSocket({ type: 'udp4', reuseAddr: true });

    udpSocket.on('listening', () => {
      if (udpSocket === null) {
        return;
      }

      try {
        udpSocket.addMembership(config.multicastGroup, config.multicastInterface);
        multicastJoined = true;
        console.log(
          `Joined multicast group ${config.multicastGroup}:${config.multicastPort}`
        );
      } catch (err) {
        console.error('Failed to join multicast group:', err);
      }
    });

    udpSocket.on('message', (msg: Buffer, rinfo) => {
      // Sanity check
      if (msg.length > MAX_UDP_PAYLOAD) {
        console.warn(`Oversized UDP packet: ${msg.length} bytes`);
        return;
      }

      messagesReceived += 1;
      bytesReceived += msg.length;

      // Track sequence numbers
      checkSequence(msg);

      // Broadcast to all WebSocket clients (raw data including sequence)
      broadcastToClients(msg);
    });

    udpSocket.on('error', (err: Error) => {
      console.error('UDP error:', err.message);
    });

    udpSocket.on('close', () => {
      multicastJoined = false;
      console.log('UDP socket closed');
    });

    // Bind to multicast port
    udpSocket.bind(config.multicastPort);
  }

  function closeMulticast(): void {
    if (udpSocket === null) {
      return;
    }

    if (multicastJoined) {
      try {
        udpSocket.dropMembership(config.multicastGroup, config.multicastInterface);
      } catch (err) {
        // Ignore errors during shutdown
      }
      multicastJoined = false;
    }

    udpSocket.close();
    udpSocket = null;
  }

  // --------------------------------------------------------------------------
  // WebSocket Server
  // --------------------------------------------------------------------------

  function handleWsConnection(ws: WebSocket): void {
    const client = addClient(ws);

    if (client === null) {
      console.warn('Max clients reached, rejecting connection');
      ws.close(1013, 'Max clients reached');
      return;
    }

    console.log(`Market data client ${client.id} connected`);

    // Market data is one-way (server -> client)
    // Ignore any messages from client
    ws.on('message', () => {
      // No-op: market data is read-only
    });

    ws.on('close', () => {
      console.log(`Market data client ${client.id} disconnected`);
      removeClient(client);
    });

    ws.on('error', (err: Error) => {
      console.error(`Market data client ${client.id} error:`, err.message);
    });
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  async function start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Create HTTP server
      httpServer = createServer();

      // Create WebSocket server
      wss = new WebSocketServer({
        server: httpServer,
        path: config.wsPath,
      });

      wss.on('connection', handleWsConnection);

      wss.on('error', (err: Error) => {
        console.error('WebSocket server error:', err);
      });

      // Start listening
      httpServer.listen(config.wsPort, () => {
        console.log(
          `Multicast Relay listening on ws://localhost:${config.wsPort}${config.wsPath}`
        );
        console.log(
          `Subscribing to multicast ${config.multicastGroup}:${config.multicastPort}`
        );

        // Setup multicast subscription
        setupMulticast();

        resolve();
      });

      httpServer.on('error', (err: Error) => {
        reject(err);
      });
    });
  }

  async function stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close multicast
      closeMulticast();

      // Close all WebSocket clients
      for (let i = 0; i < MAX_CLIENTS; i += 1) {
        const client = clients[i];
        if (client !== null) {
          client.ws.close(1001, 'Server shutting down');
          clients[i] = null;
        }
      }

      // Close WebSocket server
      if (wss !== null) {
        wss.close();
        wss = null;
      }

      // Close HTTP server
      if (httpServer !== null) {
        httpServer.close(() => {
          httpServer = null;
          console.log('Multicast Relay stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  function getStats(): MulticastRelayStats {
    return {
      clientCount: getClientCount(),
      multicastJoined,
      messagesReceived,
      messagesBroadcast,
      bytesReceived,
      lastSequence,
      sequenceGaps,
    };
  }

  // --------------------------------------------------------------------------
  // Return interface
  // --------------------------------------------------------------------------

  return {
    start,
    stop,
    getStats,
  };
}

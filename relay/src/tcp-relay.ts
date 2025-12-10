/**
 * TCP Relay - WebSocket to TCP bridge.
 *
 * Bridges browser WebSocket connections to the Zig matching engine's
 * TCP server. 
 * 
 * FRAMING:
 * - WebSocket: No length prefix needed (WS has built-in message framing)
 * - TCP: Uses 4-byte little-endian length prefix
 *
 * WebSocket clients connect to ws://host:port/orders
 * Relay forwards to TCP engine at configured host:port
 *
 * @module relay/tcp-relay
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createConnection, Socket } from 'net';
import { createServer, IncomingMessage, Server } from 'http';

// ============================================================================
// Constants
// ============================================================================

const LENGTH_PREFIX_SIZE = 4;
const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB sanity limit
const MAX_CLIENTS = 256;
const TCP_CONNECT_TIMEOUT_MS = 5000;
const TCP_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_ATTEMPTS = 10;

// ============================================================================
// Types
// ============================================================================

export interface TcpRelayConfig {
  readonly wsPort: number;
  readonly wsPath: string;
  readonly tcpHost: string;
  readonly tcpPort: number;
}

export interface TcpRelayStats {
  readonly clientCount: number;
  readonly tcpConnected: boolean;
  readonly messagesRelayed: number;
  readonly bytesFromClients: number;
  readonly bytesToClients: number;
}

interface ClientState {
  readonly id: number;
  readonly ws: WebSocket;
}

// ============================================================================
// Default Configuration
// ============================================================================

function createDefaultConfig(): TcpRelayConfig {
  return {
    wsPort: 9080,
    wsPath: '/orders',
    tcpHost: 'localhost',
    tcpPort: 8080,
  };
}

// ============================================================================
// TCP Relay
// ============================================================================

export interface TcpRelay {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStats(): TcpRelayStats;
}

export function createTcpRelay(
  configOverrides?: Partial<TcpRelayConfig>
): TcpRelay {
  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  const config: TcpRelayConfig = {
    ...createDefaultConfig(),
    ...configOverrides,
  };

  let httpServer: Server | null = null;
  let wss: WebSocketServer | null = null;
  let tcpSocket: Socket | null = null;
  let tcpConnected = false;
  let tcpReconnectAttempts = 0;
  let tcpReconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Client management (fixed-size array)
  const clients: (ClientState | null)[] = new Array(MAX_CLIENTS).fill(null);
  let clientIdCounter = 0;

  // Stats
  let messagesRelayed = 0;
  let bytesFromClients = 0;
  let bytesToClients = 0;

  // TCP receive buffer for length-prefixed framing
  let tcpReceiveBuffer: Buffer = Buffer.alloc(0);

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
    return null; // No slots available
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

  // --------------------------------------------------------------------------
  // WebSocket -> TCP (add length prefix for TCP)
  // --------------------------------------------------------------------------

  function forwardToTcp(data: Buffer): void {
    if (tcpSocket === null || !tcpConnected) {
      console.warn('TCP not connected, dropping message');
      return;
    }

    // Add length prefix for TCP framing (big-endian, matching Zig server)
    const framed = Buffer.alloc(LENGTH_PREFIX_SIZE + data.length);
    framed.writeUInt32BE(data.length, 0);
    data.copy(framed, LENGTH_PREFIX_SIZE);

    try {
      tcpSocket.write(framed);
      messagesRelayed += 1;
    } catch (err) {
      console.error('Failed to write to TCP:', err);
    }
  }

  // --------------------------------------------------------------------------
  // TCP -> WebSocket (strip length prefix, send raw to WS)
  // --------------------------------------------------------------------------

  function broadcastToClients(data: Buffer): void {
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
        // Send raw message - WebSocket has its own framing
        client.ws.send(data);
        bytesToClients += data.length;
      } catch (err) {
        console.error(`Failed to send to client ${client.id}:`, err);
      }
    }
  }

  function processTcpBuffer(): void {
    // Bounded loop: process up to 100 messages per call
    let iterations = 0;
    const maxIterations = 100;

    while (iterations < maxIterations) {
      iterations += 1;

      // Need at least length prefix
      if (tcpReceiveBuffer.length < LENGTH_PREFIX_SIZE) {
        break;
      }

      const messageLength = tcpReceiveBuffer.readUInt32BE(0);

      // Sanity check
      if (messageLength > MAX_MESSAGE_SIZE) {
        console.error(`TCP: invalid message length ${messageLength}`);
        tcpReceiveBuffer = Buffer.alloc(0);
        break;
      }

      const totalLength = LENGTH_PREFIX_SIZE + messageLength;

      // Wait for complete message
      if (tcpReceiveBuffer.length < totalLength) {
        break;
      }

      // Extract message payload (without length prefix)
      const messageData = Buffer.from(
        tcpReceiveBuffer.subarray(LENGTH_PREFIX_SIZE, totalLength)
      );

      // Update buffer
      tcpReceiveBuffer = tcpReceiveBuffer.subarray(totalLength);

      // Broadcast raw payload to all WebSocket clients
      broadcastToClients(messageData);
      messagesRelayed += 1;
    }
  }

  // --------------------------------------------------------------------------
  // TCP Connection
  // --------------------------------------------------------------------------

  function connectTcp(): void {
    if (tcpSocket !== null) {
      return;
    }

    console.log(`Connecting to TCP ${config.tcpHost}:${config.tcpPort}...`);

    tcpSocket = createConnection({
      host: config.tcpHost,
      port: config.tcpPort,
    });

    // Connection timeout
    const timeoutId = setTimeout(() => {
      if (!tcpConnected && tcpSocket !== null) {
        console.error('TCP connection timeout');
        tcpSocket.destroy();
      }
    }, TCP_CONNECT_TIMEOUT_MS);

    tcpSocket.on('connect', () => {
      clearTimeout(timeoutId);
      tcpConnected = true;
      tcpReconnectAttempts = 0;
      tcpReceiveBuffer = Buffer.alloc(0);
      console.log(`TCP connected to ${config.tcpHost}:${config.tcpPort}`);
    });

    tcpSocket.on('data', (data: Buffer) => {
      // Append to receive buffer
      tcpReceiveBuffer = Buffer.concat([tcpReceiveBuffer, data]);
      processTcpBuffer();
    });

    tcpSocket.on('close', () => {
      clearTimeout(timeoutId);
      tcpConnected = false;
      tcpSocket = null;
      console.log('TCP connection closed');
      scheduleTcpReconnect();
    });

    tcpSocket.on('error', (err: Error) => {
      console.error('TCP error:', err.message);
    });
  }

  function scheduleTcpReconnect(): void {
    if (tcpReconnectTimeoutId !== null) {
      return;
    }

    if (tcpReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('Max TCP reconnect attempts reached');
      return;
    }

    tcpReconnectAttempts += 1;
    const delay = TCP_RECONNECT_DELAY_MS * tcpReconnectAttempts;

    console.log(`Scheduling TCP reconnect in ${delay}ms (attempt ${tcpReconnectAttempts})`);

    tcpReconnectTimeoutId = setTimeout(() => {
      tcpReconnectTimeoutId = null;
      connectTcp();
    }, delay);
  }

  function disconnectTcp(): void {
    if (tcpReconnectTimeoutId !== null) {
      clearTimeout(tcpReconnectTimeoutId);
      tcpReconnectTimeoutId = null;
    }

    if (tcpSocket !== null) {
      tcpSocket.destroy();
      tcpSocket = null;
      tcpConnected = false;
    }
  }

  // --------------------------------------------------------------------------
  // WebSocket Server
  // --------------------------------------------------------------------------

  function handleWsConnection(ws: WebSocket, req: IncomingMessage): void {
    const client = addClient(ws);

    if (client === null) {
      console.warn('Max clients reached, rejecting connection');
      ws.close(1013, 'Max clients reached');
      return;
    }

    console.log(`Client ${client.id} connected from ${req.socket.remoteAddress}`);

    ws.on('message', (data: Buffer) => {
      bytesFromClients += data.length;
      
      // WebSocket messages are already complete - forward directly to TCP
      // The forwardToTcp function adds the length prefix for the Zig server
      forwardToTcp(data);
    });

    ws.on('close', () => {
      console.log(`Client ${client.id} disconnected`);
      removeClient(client);
    });

    ws.on('error', (err: Error) => {
      console.error(`Client ${client.id} error:`, err.message);
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
          `TCP Relay listening on ws://localhost:${config.wsPort}${config.wsPath}`
        );
        console.log(
          `Forwarding to TCP ${config.tcpHost}:${config.tcpPort}`
        );

        // Connect to TCP server
        connectTcp();

        resolve();
      });

      httpServer.on('error', (err: Error) => {
        reject(err);
      });
    });
  }

  async function stop(): Promise<void> {
    return new Promise((resolve) => {
      // Disconnect TCP
      disconnectTcp();

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
          console.log('TCP Relay stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  function getStats(): TcpRelayStats {
    return {
      clientCount: getClientCount(),
      tcpConnected,
      messagesRelayed,
      bytesFromClients,
      bytesToClients,
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

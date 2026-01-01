import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

export type ClientType = 'pos';

export interface ConnectedClient {
  ws: WebSocket;
  type: ClientType;
  id: string;
  connectedAt: number;
}


export class WebSocketServerManager {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ConnectedClient> = new Map();
  private port: number = 19967;
  private isRunning: boolean = false;

  /**
   * Start the WebSocket server
   */
  start(port: number = 19967): { success: boolean; error?: string; port?: number } {
    if (this.isRunning) {
      return { success: false, error: 'WebSocket server is already running' };
    }

    try {
      this.port = port;
      this.wss = new WebSocketServer({ port });

      this.wss.on('connection', (ws: WebSocket, req) => {
        const clientId = this.generateClientId();
        console.log(`[WebSocket] New client connected: ${clientId}`);

        // Set up client
        const client: ConnectedClient = {
          ws,
          type: 'pos', // Default, will be updated when client identifies itself
          id: clientId,
          connectedAt: Date.now()
        };

        this.clients.set(clientId, client);

        // Handle messages
        ws.on('message', (data: Buffer) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleMessage(clientId, message);
          } catch (error) {
            console.error('[WebSocket] Error parsing message:', error);
            this.sendError(clientId, 'Invalid message format');
          }
        });

        // Handle disconnection
        ws.on('close', () => {
          console.log(`[WebSocket] Client disconnected: ${clientId}`);
          this.clients.delete(clientId);
        });

        // Handle errors
        ws.on('error', (error) => {
          console.error(`[WebSocket] Error for client ${clientId}:`, error);
          this.clients.delete(clientId);
        });

        // Send welcome message
        this.send(clientId, {
          type: 'connected',
          clientId,
          message: 'Connected to POS server'
        });
      });

      this.wss.on('error', (error) => {
        console.error('[WebSocket] Server error:', error);
      });

      this.isRunning = true;
      console.log(`[WebSocket] Server started on port ${port}`);
      return { success: true, port };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[WebSocket] Failed to start server:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Stop the WebSocket server
   */
  stop(): { success: boolean; error?: string } {
    if (!this.isRunning || !this.wss) {
      return { success: false, error: 'WebSocket server is not running' };
    }

    try {
      // Close all client connections
      this.clients.forEach((client) => {
        try {
          client.ws.close();
        } catch (error) {
          console.error('[WebSocket] Error closing client connection:', error);
        }
      });
      this.clients.clear();

      // Close server
      this.wss.close(() => {
        console.log('[WebSocket] Server stopped');
      });

      this.wss = null;
      this.isRunning = false;
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[WebSocket] Failed to stop server:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get server status
   */
  getStatus(): {
    isRunning: boolean;
    port: number;
    clientCount: number;
    clients: Array<{ id: string; type: ClientType; connectedAt: number }>;
  } {
    return {
      isRunning: this.isRunning,
      port: this.port,
      clientCount: this.clients.size,
      clients: Array.from(this.clients.values()).map((client) => ({
        id: client.id,
        type: client.type,
        connectedAt: client.connectedAt
      }))
    };
  }


  /**
   * Handle incoming messages from clients
   */
  private handleMessage(clientId: string, message: any): void {
    const client = this.clients.get(clientId);
    if (!client) {
      console.error(`[WebSocket] Client not found: ${clientId}`);
      return;
    }

    switch (message.type) {
      case 'identify':
        // Client identifies itself (always 'pos' now)
        client.type = 'pos';
        console.log(`[WebSocket] Client ${clientId} identified as: ${client.type}`);
        this.send(clientId, {
          type: 'identified',
          clientType: client.type
        });
        break;

      case 'ping':
        // Heartbeat
        this.send(clientId, { type: 'pong' });
        break;

      default:
        console.warn(`[WebSocket] Unknown message type: ${message.type}`);
    }
  }

  /**
   * Send message to specific client
   */
  private send(clientId: string, message: any): void {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      client.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error(`[WebSocket] Error sending message to ${clientId}:`, error);
      this.clients.delete(clientId);
    }
  }

  /**
   * Send error message to client
   */
  private sendError(clientId: string, error: string): void {
    this.send(clientId, {
      type: 'error',
      error
    });
  }

  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Singleton instance
export const websocketServer = new WebSocketServerManager();

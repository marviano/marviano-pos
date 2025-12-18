/**
 * WebSocket Client for POS Network Communication
 * Handles connection to the WebSocket server for multi-client POS system
 */

export type ClientType = 'pos' | 'kitchen' | 'barista';

export interface CustomizationOption {
  option_id: number;
  option_name: string;
  price_adjustment: number;
}

export interface Customization {
  customization_id: number;
  customization_name: string;
  selected_options: CustomizationOption[];
}

export interface BundleSelection {
  category2_id: number;
  category2_name: string;
  selectedProducts: {
    product: {
      id: number;
      nama: string;
    };
    quantity?: number;
    customizations?: Customization[];
    customNote?: string;
  }[];
  requiredQuantity: number;
}

export interface OrderItem {
  itemId: string;
  productId: number;
  productName: string;
  category1_id: number;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  customNote?: string;
  bundleSelections?: BundleSelection[];
  customizations?: Customization[];
  status: 'pending' | 'preparing' | 'ready';
}

export interface OrderData {
  transactionId: string;
  receiptNumber: number;
  businessId: number;
  items: OrderItem[];
  createdAt: string;
  customerName?: string;
  customerUnit?: number;
  pickupMethod: 'dine-in' | 'take-away';
}

export interface StatusUpdate {
  transactionId: string;
  itemId: string;
  status: 'pending' | 'preparing' | 'ready';
  preparedBy?: string;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

type WebSocketMessage = Record<string, unknown>;

type MessageHandler = (message: WebSocketMessage) => void;

export class NetworkClient {
  private ws: WebSocket | null = null;
  private serverAddress: string = '';
  private port: number = 19967;
  private clientType: ClientType = 'pos';
  private connectionState: ConnectionState = 'disconnected';
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 3000; // 3 seconds
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private messageHandlers: Map<string, MessageHandler[]> = new Map();
  private intentionalDisconnect: boolean = false; // Flag to prevent auto-reconnect

  /**
   * Connect to WebSocket server
   */
  async connect(
    serverAddress: string = 'localhost',
    port: number = 19967,
    clientType: ClientType = 'pos'
  ): Promise<{ success: boolean; error?: string }> {
    // Reset intentional disconnect flag for new connection
    this.intentionalDisconnect = false;
    
    // If already connected or connecting, disconnect first to ensure clean state
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
      this.disconnect();
      this.intentionalDisconnect = false; // Reset again after disconnect
    }

    this.serverAddress = serverAddress;
    this.port = port;
    this.clientType = clientType;

    return this.attemptConnection();
  }

  /**
   * Attempt to establish WebSocket connection
   */
  private async attemptConnection(): Promise<{ success: boolean; error?: string }> {
    // Prevent duplicate connections
    if (this.connectionState === 'connected') {
      console.log(`[NetworkClient] Already connected, skipping attemptConnection`);
      return { success: true };
    }
    
    return new Promise((resolve) => {
      try {
        this.connectionState = 'connecting';
        const wsUrl = `ws://${this.serverAddress}:${this.port}`;
        console.log(`[NetworkClient] Connecting to ${wsUrl} as ${this.clientType}...`);

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log(`[NetworkClient] Connected to server`);
          this.connectionState = 'connected';
          this.reconnectAttempts = 0;
          
          // Cancel any pending reconnect timer
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }

          // Identify ourselves to the server
          this.send({
            type: 'identify',
            clientType: this.clientType
          });

          // Start ping interval
          this.startPingInterval();

          // Notify handlers
          this.notifyHandlers('connected', {} as WebSocketMessage);
          resolve({ success: true });
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('[NetworkClient] Error parsing message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[NetworkClient] WebSocket error:', error);
          this.connectionState = 'error';
          this.notifyHandlers('error', { error } as WebSocketMessage);
          resolve({ success: false, error: 'Connection error' });
        };

        this.ws.onclose = () => {
          console.log('[NetworkClient] Connection closed');
          this.connectionState = 'disconnected';
          this.stopPingInterval();
          this.notifyHandlers('disconnected', {} as WebSocketMessage);

          // Only attempt to reconnect if not intentionally disconnected
          if (!this.intentionalDisconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[NetworkClient] Max reconnect attempts reached');
            this.notifyHandlers('error', { error: 'Max reconnect attempts reached' } as WebSocketMessage);
          }
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('[NetworkClient] Failed to create connection:', errorMessage);
        this.connectionState = 'error';
        resolve({ success: false, error: errorMessage });
      }
    });
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts; // Exponential backoff

    console.log(`[NetworkClient] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.attemptConnection();
    }, delay);
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      if (this.isConnected()) {
        this.send({ type: 'ping' });
      }
    }, 30000); // Ping every 30 seconds
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Send message to server
   */
  send(message: WebSocketMessage): boolean {
    if (!this.isConnected() || !this.ws) {
      console.warn('[NetworkClient] Cannot send message: not connected');
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('[NetworkClient] Error sending message:', error);
      return false;
    }
  }

  /**
   * Send order to server (for POS clients)
   */
  sendOrder(order: OrderData): boolean {
    return this.send({
      type: 'new_order',
      order
    });
  }

  /**
   * Send status update (for kitchen/barista clients)
   */
  sendStatusUpdate(update: StatusUpdate): boolean {
    return this.send({
      type: 'status_update',
      update
    });
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(message: WebSocketMessage): void {
    // Handle specific message types
    switch (message.type) {
      case 'connected':
        console.log('[NetworkClient] Server confirmed connection');
        break;

      case 'identified':
        console.log(`[NetworkClient] Identified as ${message.clientType}`);
        break;

      case 'new_order':
        // New order received (for kitchen/barista displays)
        if ('order' in message && message.order) {
          this.notifyHandlers('new_order', message.order as WebSocketMessage);
        }
        break;

      case 'status_update':
        // Status update received (for POS clients)
        if ('update' in message && message.update) {
          this.notifyHandlers('status_update', message.update as WebSocketMessage);
        }
        break;

      case 'pong':
        // Heartbeat response
        break;

      case 'error':
        console.error('[NetworkClient] Server error:', message.error);
        if ('error' in message) {
          this.notifyHandlers('error', { error: message.error } as WebSocketMessage);
        }
        break;

      default:
        console.warn('[NetworkClient] Unknown message type:', message.type);
        this.notifyHandlers('message', message);
    }
  }

  /**
   * Register message handler
   */
  on(event: string, handler: MessageHandler): void {
    if (!this.messageHandlers.has(event)) {
      this.messageHandlers.set(event, []);
    }
    this.messageHandlers.get(event)!.push(handler);
  }

  /**
   * Unregister message handler
   */
  off(event: string, handler: MessageHandler): void {
    const handlers = this.messageHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Notify all handlers for an event
   */
  private notifyHandlers(event: string, data: WebSocketMessage): void {
    const handlers = this.messageHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`[NetworkClient] Error in handler for ${event}:`, error);
        }
      });
    }
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    this.intentionalDisconnect = true; // Prevent auto-reconnect
    this.stopPingInterval();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connectionState = 'disconnected';
    this.reconnectAttempts = 0;
    console.log('[NetworkClient] Disconnected');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Get server address
   */
  getServerAddress(): string {
    return `${this.serverAddress}:${this.port}`;
  }
}

// Singleton instance
export const networkClient = new NetworkClient();

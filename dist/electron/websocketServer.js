"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.websocketServer = exports.WebSocketServerManager = void 0;
const ws_1 = require("ws");
class WebSocketServerManager {
    constructor() {
        this.wss = null;
        this.clients = new Map();
        this.port = 19967;
        this.isRunning = false;
    }
    /**
     * Start the WebSocket server
     */
    start(port = 19967) {
        if (this.isRunning) {
            return { success: false, error: 'WebSocket server is already running' };
        }
        try {
            this.port = port;
            this.wss = new ws_1.WebSocketServer({ port });
            this.wss.on('connection', (ws, req) => {
                const clientId = this.generateClientId();
                console.log(`[WebSocket] New client connected: ${clientId}`);
                // Set up client
                const client = {
                    ws,
                    type: 'pos', // Default, will be updated when client identifies itself
                    id: clientId,
                    connectedAt: Date.now()
                };
                this.clients.set(clientId, client);
                // Handle messages
                ws.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        this.handleMessage(clientId, message);
                    }
                    catch (error) {
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
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('[WebSocket] Failed to start server:', errorMessage);
            return { success: false, error: errorMessage };
        }
    }
    /**
     * Stop the WebSocket server
     */
    stop() {
        if (!this.isRunning || !this.wss) {
            return { success: false, error: 'WebSocket server is not running' };
        }
        try {
            // Close all client connections
            this.clients.forEach((client) => {
                try {
                    client.ws.close();
                }
                catch (error) {
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
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('[WebSocket] Failed to stop server:', errorMessage);
            return { success: false, error: errorMessage };
        }
    }
    /**
     * Get server status
     */
    getStatus() {
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
     * Broadcast order to appropriate displays
     */
    broadcastOrder(order) {
        if (!this.isRunning) {
            return { success: false, sentTo: [], sentToKitchen: 0, sentToBarista: 0 };
        }
        const sentTo = [];
        let sentToKitchen = 0;
        let sentToBarista = 0;
        // Route items to kitchen (category1_id = 1 or 5) or barista (category1_id = 2 or 3)
        // Kitchen: category1_id = 1 (Makanan) or 5 (Bakery)
        // Barista: category1_id = 2 (Minuman) or 3 (Dessert)
        const kitchenItems = order.items.filter((item) => item.category1_id === 1 || item.category1_id === 5);
        const baristaItems = order.items.filter((item) => item.category1_id === 2 || item.category1_id === 3);
        // Send to kitchen displays
        if (kitchenItems.length > 0) {
            const kitchenOrder = { ...order, items: kitchenItems };
            this.clients.forEach((client) => {
                if (client.type === 'kitchen') {
                    this.send(client.id, {
                        type: 'new_order',
                        order: kitchenOrder
                    });
                    sentTo.push(client.id);
                    sentToKitchen++;
                }
            });
        }
        // Send to barista displays
        if (baristaItems.length > 0) {
            const baristaOrder = { ...order, items: baristaItems };
            this.clients.forEach((client) => {
                if (client.type === 'barista') {
                    this.send(client.id, {
                        type: 'new_order',
                        order: baristaOrder
                    });
                    sentTo.push(client.id);
                    sentToBarista++;
                }
            });
        }
        return { success: true, sentTo, sentToKitchen, sentToBarista };
    }
    /**
     * Broadcast status update to all POS clients
     */
    broadcastStatusUpdate(update) {
        if (!this.isRunning) {
            return { success: false, sentTo: [] };
        }
        const sentTo = [];
        this.clients.forEach((client) => {
            if (client.type === 'pos') {
                this.send(client.id, {
                    type: 'status_update',
                    update
                });
                sentTo.push(client.id);
            }
        });
        return { success: true, sentTo };
    }
    /**
     * Handle incoming messages from clients
     */
    handleMessage(clientId, message) {
        const client = this.clients.get(clientId);
        if (!client) {
            console.error(`[WebSocket] Client not found: ${clientId}`);
            return;
        }
        switch (message.type) {
            case 'identify':
                // Client identifies itself (pos, kitchen, or barista)
                client.type = message.clientType || 'pos';
                console.log(`[WebSocket] Client ${clientId} identified as: ${client.type}`);
                this.send(clientId, {
                    type: 'identified',
                    clientType: client.type
                });
                break;
            case 'status_update':
                // Kitchen/barista sends status update
                if (client.type === 'kitchen' || client.type === 'barista') {
                    const update = message.update;
                    // Broadcast to all POS clients
                    this.broadcastStatusUpdate(update);
                }
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
    send(clientId, message) {
        const client = this.clients.get(clientId);
        if (!client || client.ws.readyState !== ws_1.WebSocket.OPEN) {
            return;
        }
        try {
            client.ws.send(JSON.stringify(message));
        }
        catch (error) {
            console.error(`[WebSocket] Error sending message to ${clientId}:`, error);
            this.clients.delete(clientId);
        }
    }
    /**
     * Send error message to client
     */
    sendError(clientId, error) {
        this.send(clientId, {
            type: 'error',
            error
        });
    }
    /**
     * Generate unique client ID
     */
    generateClientId() {
        return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}
exports.WebSocketServerManager = WebSocketServerManager;
// Singleton instance
exports.websocketServer = new WebSocketServerManager();

"use strict";
/**
 * Receipt Printer Module
 * Handles 80mm thermal receipt printing using Windows native printing
 * with character-based formatting for reliable text wrapping
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ThermalReceiptPrinter = void 0;
class ThermalReceiptPrinter {
    constructor(printerName) {
        this.printerName = printerName;
    }
    /**
     * Print a test receipt
     */
    async printTest() {
        // Return simple test HTML for Windows printing
        // This will be handled by the main process
        return { success: true };
    }
    /**
     * Print a transaction receipt
     */
    async printReceipt(data) {
        // This is now handled by the main process with HTML printing
        return { success: true };
    }
}
exports.ThermalReceiptPrinter = ThermalReceiptPrinter;
exports.default = ThermalReceiptPrinter;

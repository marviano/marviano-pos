#!/bin/bash
# Script to view salespulse server logs

echo "=== Viewing PM2 Logs ==="
echo ""

# Option 1: Use PM2 logs command (recommended)
echo "1. Real-time logs (Ctrl+C to exit):"
echo "   pm2 logs salespulse"
echo ""
echo "2. Last 100 lines:"
echo "   pm2 logs salespulse --lines 100"
echo ""
echo "3. Search for specific transaction:"
echo "   pm2 logs salespulse --lines 1000 | grep '0142512261253320001'"
echo ""

# Option 2: View log files directly
echo "=== Viewing Log Files ==="
echo ""
echo "4. View output log (last 100 lines):"
echo "   tail -n 100 ~/.pm2/logs/salespulse-out.log"
echo ""
echo "5. View error log (last 100 lines):"
echo "   tail -n 100 ~/.pm2/logs/salespulse-error.log"
echo ""
echo "6. Search for database info:"
echo "   grep -i 'dbName\|dbHost\|DB_NAME' ~/.pm2/logs/salespulse-out.log | tail -20"
echo ""
echo "7. Search for transaction sync logs:"
echo "   grep 'After SELECT to verify transaction' ~/.pm2/logs/salespulse-out.log | tail -20"
echo ""

# Option 3: Check PM2 status
echo "=== PM2 Status ==="
echo ""
echo "8. Check PM2 status:"
echo "   pm2 status"
echo ""
echo "9. Check PM2 info:"
echo "   pm2 info salespulse"
echo ""

echo "=== Quick Commands to Run ==="
echo ""
echo "# View last 200 lines of logs"
echo "pm2 logs salespulse --lines 200 --nostream"
echo ""
echo "# Search for database name in recent logs"
echo "pm2 logs salespulse --lines 500 --nostream | grep -i 'dbName\|DB_NAME'"
echo ""
echo "# Search for transaction verification"
echo "pm2 logs salespulse --lines 500 --nostream | grep 'After SELECT to verify transaction'"






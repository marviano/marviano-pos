#!/bin/bash
# Search for specific log entries in PM2 logs

echo "=== Searching for Transaction INSERT Logs ==="
pm2 logs salespulse --lines 2000 --nostream | grep -E "After executeQuery upsert|After SELECT to verify transaction|Transaction saved successfully|Transaction upserted with ID|CRITICAL.*Transaction INSERT"

echo ""
echo "=== Searching for Database Info ==="
pm2 logs salespulse --lines 2000 --nostream | grep -E "dbName|dbHost|DB_NAME|DB_HOST"

echo ""
echo "=== Searching for Transaction 8695 (first synced transaction) ==="
pm2 logs salespulse --lines 2000 --nostream | grep -E "8695|0142512261253320001"

echo ""
echo "=== Searching for 'Creating transaction' logs ==="
pm2 logs salespulse --lines 2000 --nostream | grep "Creating transaction with ID"

echo ""
echo "=== Searching for 'Upserting transaction' logs ==="
pm2 logs salespulse --lines 2000 --nostream | grep "Upserting transaction"






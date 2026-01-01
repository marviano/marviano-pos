# Where to Find Server Logs

## What Are Server Logs?

**Server logs** = Logs from the **salespulse backend API server** (running on your VPS/server)
**Client logs** = Logs from the **marviano-pos Electron app** (the console you've been showing me)

## Where to Find Server Logs

### Option 1: PM2 Logs (Most Common)

If you're using PM2 to run the salespulse server (which you are, based on `ecosystem.config.js`):

```bash
# SSH into your VPS/server
ssh your-server

# View PM2 logs
pm2 logs salespulse

# Or view last 100 lines
pm2 logs salespulse --lines 100

# Or view logs in real-time
pm2 logs salespulse --lines 0
```

**PM2 log files are usually located at:**
```bash
~/.pm2/logs/
# Files:
# - salespulse-out.log (stdout)
# - salespulse-error.log (stderr)
```

### Option 2: Terminal/Console Where Server is Running

If you started the server manually in a terminal:
- Look at that terminal window
- The logs will appear there in real-time

### Option 3: System Logs (if using systemd)

```bash
# Check systemd logs
journalctl -u salespulse -f

# Or if it's a service
journalctl -u your-service-name -f
```

### Option 4: Next.js Logs

If running Next.js directly:
- Check the terminal where you ran `npm run start` or `next start`
- Logs appear in that console

## What to Look For in Server Logs

When a transaction sync happens, you should see these log entries:

### 1. Transaction Received
```
[API][transactions][POST] ===== ENDPOINT CALLED =====
[API][transactions][POST] Creating transaction with ID: 0142512261253320001
[API][transactions][POST] Upserting transaction: 0142512261253320001
```

### 2. After INSERT (Check This!)
```
[API][transactions][POST] After executeQuery upsert
  - Look for: resultInsertId, resultAffectedRows, dbName
```

### 3. After SELECT Verification (IMPORTANT!)
```
[API][transactions][POST] After SELECT to verify transaction
  - Look for: dbHost, dbName, hasTxRow, insertId
  - **If hasTxRow: true → SELECT found it**
  - **If hasTxRow: false → SELECT didn't find it (should return 500, not 200)**
```

### 4. Critical Error (If SELECT Fails)
```
[API][transactions][POST] CRITICAL: Transaction INSERT succeeded but SELECT cannot find it!
  - This means INSERT worked but SELECT can't find it
  - Check: dbHost, dbName in this log
```

### 5. Success Message
```
[API][transactions][POST] Transaction saved successfully
  - uuid, insertId, receiptNumber
```

## Quick Commands to Check Logs

### Check PM2 Status
```bash
pm2 status
pm2 info salespulse
```

### View Recent Logs
```bash
# Last 50 lines
pm2 logs salespulse --lines 50

# Last 200 lines (more context)
pm2 logs salespulse --lines 200

# Search for specific transaction UUID
pm2 logs salespulse --lines 1000 | grep "0142512261253320001"
```

### Search for Database Info
```bash
# Search for dbName in logs
pm2 logs salespulse --lines 1000 | grep "dbName"

# Search for database connection info
pm2 logs salespulse --lines 1000 | grep "DB_NAME\|dbHost"
```

## If You Can't Access Server Logs

If you don't have SSH access or can't see the logs:

1. **Check the API response** - I've added `_debug` info to the response
   - Look in your **client console** (marviano-pos) for the response
   - The `_debug` object will show `dbName`

2. **Check environment variables** - Look at the salespulse `.env` file:
   ```bash
   # On your server
   cat /var/www/salespulse/.env | grep DB_NAME
   ```

3. **Add temporary logging** - We can add a log endpoint that writes to a file you can access

## What Information You Need

From the server logs, we need to find:

1. **Database Name**: What database is the API using?
   - Look for: `dbName: "..."` in logs
   - Or check: `process.env.DB_NAME` value

2. **Did SELECT Find It?**: 
   - Look for: `hasTxRow: true` or `hasTxRow: false`
   - If `true` → SELECT found it (but you're querying wrong DB)
   - If `false` → SELECT didn't find it (should return 500, not 200)

3. **INSERT Result**:
   - Look for: `resultInsertId`, `resultAffectedRows`
   - If `affectedRows > 0` → INSERT worked

## Example: What Good Logs Look Like

```
[API][transactions][POST] Creating transaction with ID: 0142512261253320001
[API][transactions][POST] Upserting transaction: 0142512261253320001
[API][transactions][POST] After executeQuery upsert
  resultInsertId: 12345
  resultAffectedRows: 1
  dbName: "salespulse_prod"
[API][transactions][POST] After SELECT to verify transaction
  dbHost: "localhost"
  dbName: "salespulse_prod"  ← Check this matches your query DB!
  hasTxRow: true
  insertId: 12345
[API][transactions][POST] Transaction saved successfully
```

## Next Steps

1. **SSH into your server**
2. **Run**: `pm2 logs salespulse --lines 200`
3. **Look for** the log entries above, especially:
   - `dbName` value
   - `hasTxRow` value
4. **Compare** the `dbName` in logs with the database you're querying

If they don't match → **That's your problem!**






# Delete POS Offline Database Instructions

## Database Location

The offline database is stored at:
- **Windows**: `%APPDATA%\marviano-pos\pos-offline.db`
- **Full path example**: `C:\Users\YourUsername\AppData\Roaming\marviano-pos\pos-offline.db`

## How to Delete

### Option 1: Delete via File Explorer
1. Press `Win + R` to open Run dialog
2. Type: `%APPDATA%\marviano-pos`
3. Press Enter
4. Find `pos-offline.db` file
5. Delete it

### Option 2: Delete via Command Line
```powershell
Remove-Item "$env:APPDATA\marviano-pos\pos-offline.db"
```

### Option 3: Delete via Code (if needed)
The database path is: `app.getPath('userData')/pos-offline.db`

## What Happens After Deletion

1. **Database will be recreated** automatically when the app starts
2. **New schema** will be used (without `customizations_json` column)
3. **Normalized tables** will be created automatically
4. **All data will be lost** - but you mentioned past data is dummy, so this is fine

## Important Notes

⚠️ **Warning**: Deleting the database will:
- Remove ALL local transaction data
- Remove ALL local product data
- Remove ALL local settings
- Everything will need to be synced from the server again

✅ **Benefits**:
- Clean start with new schema
- No migration needed
- No `customizations_json` column
- Only normalized tables

## After Deletion

1. Start the app
2. Database will be recreated with new schema
3. Sync data from server if needed
4. New transactions will use normalized tables only



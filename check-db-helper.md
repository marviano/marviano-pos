# Database Reset Instructions

The database schema was updated to include platform price columns (harga_gofood, harga_grabfood, harga_shopeefood, harga_tiktok).

To apply the migration, you need to delete the old database file:

**Location:** `c:\Users\alvus\Desktop\code\marviano-pos\dist\pos-offline.db`

## Steps:

1. Stop the application if it's running
2. Delete the file: `dist/pos-offline.db`
3. Start the application again
4. The new database will be created with all the new columns
5. Go to Settings → Sinkronisasi Lengkap to sync all data from VPS

This will ensure Product ID 275 (Coffee Sundae) and all other products have the platform price columns available in the local SQLite database.


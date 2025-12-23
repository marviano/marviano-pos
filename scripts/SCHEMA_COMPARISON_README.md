# Schema Comparison Tool

This tool compares the SQLite local database schema (marviano-pos) with the Salespulse MySQL database schema.

## Requirements

- SQLite can have fewer tables than MySQL (this is acceptable)
- For tables that exist in both databases, their CREATE TABLE statements must be identical

## Usage

### Option 1: Compare with MySQL Schema File

If you have a MySQL schema file (containing CREATE TABLE statements):

```bash
node scripts/compare-schemas.js path/to/mysql_schema.sql
```

### Option 2: Extract MySQL Schema First, Then Compare

1. Extract MySQL schema from Salespulse database:

```bash
# Make sure your .env file has MySQL connection details
node scripts/extract-mysql-schema.js mysql_schema.sql
```

2. Compare the schemas:

```bash
node scripts/compare-schemas.js mysql_schema.sql
```

### Option 3: Connect Directly to MySQL

Set environment variables and run:

```bash
set MYSQL_HOST=localhost
set MYSQL_DATABASE=marviano_pos
set MYSQL_USER=root
set MYSQL_PASSWORD=your_password
node scripts/compare-schemas.js
```

## SQLite Database Location

By default, the script looks for the SQLite database at:
- Windows: `%USERPROFILE%\AppData\Roaming\marviano-pos\pos-offline.db`

You can override this with:
```bash
set SQLITE_DB_PATH=C:\path\to\pos-offline.db
node scripts/compare-schemas.js mysql_schema.sql
```

## Output

The script will show:
- ✅ Matching tables (identical CREATE TABLE statements)
- 📋 Tables only in SQLite
- 📋 Tables only in MySQL (acceptable)
- ⚠️ Tables with differences (column mismatches, missing columns, etc.)

## Example Output

```
🔍 Schema Comparison Tool

Comparing SQLite (marviano-pos) with MySQL (Salespulse)

📂 Reading SQLite database from: C:\Users\...\pos-offline.db
✅ Found 45 tables in SQLite database

📄 Reading MySQL schema from file: mysql_schema.sql
✅ Found 50 tables in MySQL schema file

🔍 Comparing schemas...

================================================================================
COMPARISON RESULTS
================================================================================

✅ Matching tables (40):
   ✓ users
   ✓ businesses
   ✓ products
   ...

📋 Tables only in SQLite (5):
   + offline_transactions
   + offline_transaction_items
   ...

📋 Tables only in MySQL (10):
   - some_mysql_only_table
   ...

⚠️  Tables with differences (0):
   (none - all matching tables are identical!)

================================================================================
SUMMARY
================================================================================
Total SQLite tables: 45
Total MySQL tables: 50
Common tables: 40
Matching tables: 40 (100.0%)
Tables with differences: 0

✅ SUCCESS: All common tables match perfectly!
   (SQLite can have fewer tables, which is acceptable)
```

## Notes

- The comparison normalizes SQL syntax differences (spacing, case, etc.)
- MySQL-specific syntax (ENGINE, CHARSET) is ignored for comparison
- Column types are normalized (INT -> INTEGER, VARCHAR -> TEXT, etc.)
- The script exits with code 1 if differences are found

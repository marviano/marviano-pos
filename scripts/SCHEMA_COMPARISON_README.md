# Schema Comparison (Legacy)

This project no longer uses a local SQLite database. All data operations use **DB_HOST (MySQL)** only.

The previous schema comparison script (`compare-schemas.js`) that compared SQLite with MySQL has been removed.

To inspect or compare MySQL schema only, you can still use:

- `node scripts/extract-mysql-schema.js mysql_schema.sql` — extract schema from the MySQL database (see `.env` / DB_HOST).

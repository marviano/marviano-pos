# MySQL grants for `system_pos` (all LAN clients)

The POS app writes to the `system_pos` database for printer-audit and sync.

**Option A – Use .env credentials for system_pos (recommended for dev/test):**  
If the machine has a `.env` file with `DB_HOST`, `DB_USER`, and `DB_PASSWORD` (e.g. `root` / your .env password), the app uses those credentials for the `system_pos` connection. No GRANTs for a limited user are needed.

**Option B – Grant privileges for limited user (e.g. `client`):**  
If you use a limited MySQL user (e.g. from pos-config) for the main DB, that user must have **CREATE** (and **REFERENCES** and other) privileges on `system_pos` so that:

- `CREATE TABLE IF NOT EXISTS` in `ensureSystemPosSchema()` can run
- Inserts into `system_pos.transactions` and related tables succeed

Grant for **all computers on the LAN** (e.g. `192.168.1.x`). Run on the **MySQL server** that clients connect to:

```sql
-- Replace 192.168.1 with your actual LAN subnet if different (e.g. 10.0.0.%)
GRANT CREATE, SELECT, INSERT, UPDATE, DELETE, DROP, INDEX, ALTER
ON system_pos.*
TO 'client'@'192.168.1.%';

FLUSH PRIVILEGES;
```

- `'client'@'192.168.1.%'` matches any host in `192.168.1.0–255`, so every PC on that subnet can use the `client` user with these privileges.
- If you previously granted only for a single IP (e.g. `'client'@'192.168.1.105'`), you can keep it or revoke it; the subnet grant above covers all LAN clients.

After applying, the error  
`CREATE command denied to user 'client'@'192.168.1.105' for table 'transactions'`  
should stop for any client on `192.168.1.x`.

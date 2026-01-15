# MySQL LAN Connection Setup Guide (Docker Edition)

## Problem
Error: "Access denied for user 'root'@'192.168.1.105'"

This happens because MySQL in Docker on Ubuntu VPS (192.168.1.106) is blocking connections from your client (192.168.1.105).

## Solution: Create Client User (Do This)

**Run these commands on your Ubuntu VPS:**

```bash
# 1. Connect to MySQL in Docker
sudo docker exec -it mysql-8.4-lts mysql -u root -p

# 2. In MySQL, run these SQL commands:
CREATE USER 'client'@'192.168.1.%' IDENTIFIED BY 'madiunlarasnona123';
GRANT ALL PRIVILEGES ON salespulse.* TO 'client'@'192.168.1.%';
FLUSH PRIVILEGES;
EXIT;
```

**3. Also create user for localhost (needed for testing):**
```sql
CREATE USER IF NOT EXISTS 'client'@'localhost' IDENTIFIED BY 'madiunlarasnona123';
GRANT ALL PRIVILEGES ON salespulse.* TO 'client'@'localhost';
FLUSH PRIVILEGES;
```

**4. Update your POS login settings:**
- IP Database: `192.168.1.106`
- Port Database: `3307` (check with `sudo docker port mysql-8.4-lts` if unsure)
- Nama Database: `salespulse`
- Username Database: `client`
- Password Database: `madiunlarasnona123`

**4. Test the connection** using the "Test Koneksi Database" button in POS login settings.

## That's It!

The steps above should work. If it doesn't, check:

**Verify Docker port is exposed:**
```bash
sudo docker ps | grep mysql
# Check the port mapping - might be 3307:3306 or 3306:3306
```

**Check what port MySQL is actually using:**
```bash
sudo docker port mysql-8.4-lts
# This shows the port mapping
```

**If firewall is blocking:**
```bash
sudo ufw allow from 192.168.1.0/24 to any port 3306
```


## Troubleshooting

**If you get "Username atau password salah" error:**

**First, verify the user was actually created:**
```bash
sudo docker exec -it mysql-8.4-lts mysql -u root -p -e "SELECT user, host FROM mysql.user WHERE user = 'client';"
```

You should see:
```
+--------+--------------+
| user   | host         |
+--------+--------------+
| client | 192.168.1.% |
+--------+--------------+
```

**If the user doesn't exist, run the CREATE USER command again:**
```bash
sudo docker exec -it mysql-8.4-lts mysql -u root -p
```

Then:
```sql
CREATE USER 'client'@'192.168.1.%' IDENTIFIED BY 'madiunlarasnona123';
GRANT ALL PRIVILEGES ON salespulse.* TO 'client'@'192.168.1.%';
FLUSH PRIVILEGES;
EXIT;
```

**If the user exists but still doesn't work, check:**

**1. Test the password from inside Docker (this is the correct way):**
```bash
sudo docker exec -it mysql-8.4-lts mysql -u client -p
# When prompted, enter: madiunlarasnona123
```

Or test with a query:
```bash
sudo docker exec -it mysql-8.4-lts mysql -u client -pmadiunlarasnona123 -e "SELECT 1;"
```

**Note:** Testing from server with `-h 192.168.1.106` won't work because MySQL sees it as coming from the server IP, not matching the wildcard. Test from inside Docker instead.

If this works, the user/password is correct. If this fails, the password is wrong.

**2. Double-check your POS login settings EXACTLY match:**
- Username Database: `client` (lowercase, no spaces, no quotes)
- Password Database: `madiunlarasnona123` (exact match, no spaces, no quotes)
- IP Database: `192.168.1.106` (no http://, no port)
- Nama Database: `salespulse` (lowercase)

**3. If password test fails, reset the password:**
```bash
sudo docker exec -it mysql-8.4-lts mysql -u root -p
```

Then:
```sql
ALTER USER 'client'@'192.168.1.%' IDENTIFIED BY 'madiunlarasnona123';
FLUSH PRIVILEGES;
EXIT;
```

**4. Verify database exists:**
```bash
sudo docker exec -it mysql-8.4-lts mysql -u root -p -e "SHOW DATABASES LIKE 'salespulse';"
```

**5. Check user privileges:**
```bash
sudo docker exec -it mysql-8.4-lts mysql -u root -p -e "SHOW GRANTS FOR 'client'@'192.168.1.%';"
```

You should see privileges for `salespulse.*` database.

# URGENT FIX: Plugin 'mysql_native_password' is not loaded

## Masalah

User `root@192.168.1.%` sudah di-set ke plugin `mysql_native_password` yang **tidak tersedia** di MySQL 8.4, sehingga tidak bisa connect.

## Solusi: Login sebagai root@localhost

Karena `root@localhost` masih bisa connect, kita bisa login sebagai user tersebut untuk memperbaiki user yang bermasalah.

### Langkah 1: Login sebagai root@localhost

**PENTING:** Login sebagai `root@localhost`, BUKAN `root@192.168.1.%`!

Di Command Prompt, jalankan:
```cmd
mysql -u root -p
```

Atau:
```cmd
mysql -h localhost -u root -p
```

Masukkan password untuk `root@localhost` (mungkin berbeda dengan 'test' atau tidak ada password).

### Langkah 2: Drop User yang Bermasalah

Setelah login sebagai `root@localhost`, jalankan:

```sql
-- Hapus user yang bermasalah
DROP USER IF EXISTS 'root'@'192.168.1.%';
FLUSH PRIVILEGES;
```

### Langkah 3: Buat User Baru dengan Default Plugin

```sql
-- Buat user baru dengan default plugin (caching_sha2_password)
-- TIDAK perlu specify plugin, akan pakai default MySQL 8.4
CREATE USER 'root'@'192.168.1.%' IDENTIFIED BY 'test';
GRANT ALL PRIVILEGES ON salespulse.* TO 'root'@'192.168.1.%';
FLUSH PRIVILEGES;
```

**CATATAN:** Jangan gunakan `WITH mysql_native_password`! Biarkan default (caching_sha2_password).

### Langkah 4: Verifikasi

```sql
-- Cek plugin yang digunakan
SELECT user, host, plugin FROM mysql.user WHERE user = 'root' AND host LIKE '192.168.1.%';
```

Seharusnya menampilkan:
```
+------+-------------+-----------------------+
| user | host        | plugin                |
+------+-------------+-----------------------+
| root | 192.168.1.% | caching_sha2_password |
+------+-------------+-----------------------+
```

Plugin harus = `caching_sha2_password` (bukan `mysql_native_password`).

### Langkah 5: Test dari Aplikasi

1. Buka aplikasi marviano-pos di komputer test (192.168.1.10)
2. Settings → Setup DB MySQL
3. Isi:
   - IP Database: `192.168.1.16`
   - Nama Database: `salespulse`
   - Username Database: `root`
   - Password Database: `test`
4. Klik **"Test Koneksi Database"**

Seharusnya sekarang berhasil!

## Script Lengkap (Copy-Paste)

Login sebagai root@localhost dulu:
```cmd
mysql -u root -p
```

Kemudian jalankan script SQL ini:

```sql
-- Hapus user yang bermasalah
DROP USER IF EXISTS 'root'@'192.168.1.%';

-- Buat user baru dengan default plugin
CREATE USER 'root'@'192.168.1.%' IDENTIFIED BY 'test';
GRANT ALL PRIVILEGES ON salespulse.* TO 'root'@'192.168.1.%';
FLUSH PRIVILEGES;

-- Verifikasi
SELECT user, host, plugin FROM mysql.user WHERE user = 'root' AND host LIKE '192.168.1.%';
```

## Catatan Penting

- **JANGAN** login sebagai `root@192.168.1.%` (sudah bermasalah)
- **HARUS** login sebagai `root@localhost` (masih bisa connect)
- **JANGAN** gunakan `WITH mysql_native_password` saat create user
- Biarkan MySQL 8.4 menggunakan default plugin (`caching_sha2_password`)
- Library `mysql2` versi 3.x sudah mendukung `caching_sha2_password`

## Jika Tidak Bisa Login sebagai root@localhost

Jika `root@localhost` juga tidak bisa connect, coba:

1. **Cek apakah root@localhost ada password:**
   - Coba login tanpa password: `mysql -u root`
   - Atau coba password yang berbeda

2. **Cek user yang ada:**
   ```sql
   SELECT user, host FROM mysql.user WHERE user = 'root';
   ```

3. **Buat user admin baru (jika perlu):**
   ```sql
   CREATE USER 'admin'@'localhost' IDENTIFIED BY 'password';
   GRANT ALL PRIVILEGES ON *.* TO 'admin'@'localhost' WITH GRANT OPTION;
   FLUSH PRIVILEGES;
   ```

   Login dengan: `mysql -u admin -p`

4. **Atau reset password root@localhost (jika lupa):**
   - Stop MySQL service
   - Start MySQL dengan `--skip-grant-tables`
   - Login tanpa password
   - Reset password
   - Restart MySQL normal



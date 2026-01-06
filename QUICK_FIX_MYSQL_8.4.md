# Quick Fix untuk MySQL 8.4.7 Remote Connection

## Masalah

Setelah semua konfigurasi benar:
- ✅ User `root@192.168.1.%` sudah dibuat
- ✅ Privileges sudah diberikan
- ✅ Firewall rule sudah dibuat
- ✅ bind_address = 0.0.0.0
- ✅ Password di aplikasi = 'test'
- ✅ Ping berhasil

Tapi masih error: "Username atau password salah untuk koneksi jaringan"

## Penyebab

MySQL 8.4.7 menggunakan `caching_sha2_password` sebagai default authentication plugin. Meskipun mysql2 (library yang digunakan) mendukung plugin ini, kadang lebih stabil dengan `mysql_native_password` untuk remote connection.

## Solusi: Ubah Authentication Plugin

### Langkah 1: Jalankan di MySQL Server (192.168.1.16)

Buka MySQL Command Line di server dan jalankan:

```sql
-- Ubah authentication plugin ke mysql_native_password
ALTER USER 'root'@'192.168.1.%' IDENTIFIED WITH mysql_native_password BY 'test';
FLUSH PRIVILEGES;
```

**Atau gunakan file script:**
- Copy isi `fix_mysql_auth.sql`
- Jalankan di MySQL

### Langkah 2: Verifikasi

```sql
-- Cek plugin yang digunakan
SELECT user, host, plugin FROM mysql.user WHERE user = 'root' AND host LIKE '192.168.1.%';
```

Seharusnya menampilkan:
```
+------+-------------+-----------------------+
| user | host        | plugin                |
+------+-------------+-----------------------+
| root | 192.168.1.% | mysql_native_password |
+------+-------------+-----------------------+
```

Plugin harus berubah dari `caching_sha2_password` ke `mysql_native_password`.

### Langkah 3: Test dari Komputer Test (192.168.1.10)

Jika ada MySQL client di komputer test, coba:

```cmd
mysql -h 192.168.1.16 -u root -ptest salespulse
```

Jika berhasil masuk ke MySQL prompt, berarti koneksi OK.

### Langkah 4: Test di Aplikasi marviano-pos

1. Buka aplikasi di komputer test (192.168.1.10)
2. Settings → Setup DB MySQL
3. Isi:
   - IP Database: `192.168.1.16`
   - Nama Database: `salespulse`
   - Username Database: `root`
   - Password Database: `test`
4. Klik "Test Koneksi Database"

Seharusnya sekarang berhasil!

## Alternatif: Test Manual dari Komputer Test

Jika tidak ada MySQL client, gunakan file batch yang sudah dibuat:

1. Copy `test_mysql_connection.bat` ke komputer test (192.168.1.10)
2. Edit password jika perlu (default: `test`)
3. Double-click untuk test

Atau test dengan telnet:
```cmd
telnet 192.168.1.16 3306
```

Jika berhasil konek (tidak "Could not open connection"), berarti port terbuka.

## Jika Masih Gagal

1. **Pastikan MySQL service di-restart** setelah semua perubahan
2. **Cek log MySQL** untuk error detail
3. **Test dari server sendiri** dengan IP:
   ```cmd
   mysql -h 192.168.1.16 -u root -ptest
   ```
4. **Cek apakah ada antivirus/firewall lain** yang memblokir

## Catatan

- `mysql_native_password` lebih kompatibel dengan berbagai client library
- `caching_sha2_password` lebih secure tapi kadang bermasalah dengan remote connection
- Untuk production, pertimbangkan membuat user khusus (bukan root) dengan password kuat


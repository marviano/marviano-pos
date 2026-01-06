# Fix: "mysql_native_password is not loaded" di MySQL 8.4

## Masalah

Error: `mysql_native_password is not loaded`

Di MySQL 8.4, plugin `mysql_native_password` mungkin sudah tidak tersedia secara default atau perlu diaktifkan secara khusus.

## Solusi: Gunakan caching_sha2_password (Default MySQL 8.4)

Karena `mysql_native_password` tidak tersedia, kita harus menggunakan `caching_sha2_password` (default MySQL 8.4).

**Berita baik:** Library `mysql2` versi 3.x yang digunakan marviano-pos sudah mendukung `caching_sha2_password`!

### Langkah 1: Ubah User ke caching_sha2_password

Jalankan di MySQL server (192.168.1.16):

```sql
-- Ubah kembali ke caching_sha2_password (default MySQL 8.4)
ALTER USER 'root'@'192.168.1.%' IDENTIFIED BY 'test';
FLUSH PRIVILEGES;

-- Verifikasi
SELECT user, host, plugin FROM mysql.user WHERE user = 'root' AND host LIKE '192.168.1.%';
```

Plugin akan menjadi `caching_sha2_password` (default).

### Langkah 2: Pastikan my.ini Benar

Edit `my.ini`:
1. **Hapus** baris `mysql_native_password=ON` (baris ini tidak valid)
2. Pastikan `bind-address = 0.0.0.0` ada
3. **TIDAK perlu** menambahkan setting plugin apapun

Contoh `my.ini` yang benar:
```ini
[mysqld]
bind-address = 0.0.0.0
port=3306
# ... setting lainnya
# TIDAK ada mysql_native_password=ON
```

### Langkah 3: Restart MySQL Service

**PENTING:** Setelah perubahan, restart MySQL!

Via Services:
- Win + R → `services.msc`
- MySQL → Restart

Atau via CMD (Admin):
```cmd
net stop MySQL80
net start MySQL80
```

### Langkah 4: Test dari Aplikasi

1. Buka aplikasi marviano-pos di komputer test (192.168.1.10)
2. Settings → Setup DB MySQL
3. Isi:
   - IP Database: `192.168.1.16`
   - Nama Database: `salespulse`
   - Username Database: `root`
   - Password Database: `test`
4. Klik **"Test Koneksi Database"**

Seharusnya sekarang berhasil!

## Alternatif: Jika Masih Error dengan caching_sha2_password

Jika masih error dengan `caching_sha2_password`, mungkin perlu konfigurasi SSL atau password yang berbeda.

### Opsi A: Gunakan Password yang Lebih Kuat

MySQL 8.4 mungkin memerlukan password yang lebih kompleks untuk `caching_sha2_password`:

```sql
ALTER USER 'root'@'192.168.1.%' IDENTIFIED BY 'Test123!@#';
FLUSH PRIVILEGES;
```

Kemudian di aplikasi, gunakan password: `Test123!@#`

### Opsi B: Cek SSL Configuration

Jika masih error, mungkin perlu SSL. Coba test dengan SSL disabled (tidak disarankan untuk production):

Cek di MySQL:
```sql
SHOW VARIABLES LIKE '%ssl%';
```

Jika perlu, edit `my.ini` untuk disable SSL requirement (hanya untuk testing):
```ini
[mysqld]
skip-ssl
```

**WARNING:** Hanya untuk testing! Jangan gunakan di production.

### Opsi C: Buat User Baru (Bukan root)

Coba buat user baru dengan caching_sha2_password:

```sql
CREATE USER 'posuser'@'192.168.1.%' IDENTIFIED BY 'test123';
GRANT ALL PRIVILEGES ON salespulse.* TO 'posuser'@'192.168.1.%';
FLUSH PRIVILEGES;
```

Test dengan:
- Username: `posuser`
- Password: `test123`

## Verifikasi

Setelah perubahan, verifikasi:

```sql
-- Cek plugin yang digunakan
SELECT user, host, plugin FROM mysql.user WHERE user = 'root' AND host LIKE '192.168.1.%';

-- Seharusnya menampilkan:
-- plugin = caching_sha2_password
```

## Checklist

- [ ] User menggunakan plugin `caching_sha2_password` (bukan mysql_native_password)
- [ ] Baris `mysql_native_password=ON` sudah dihapus dari my.ini
- [ ] MySQL service sudah di-restart
- [ ] bind_address = 0.0.0.0
- [ ] Firewall rule enabled
- [ ] Test dari aplikasi marviano-pos

## Catatan

- MySQL 8.4 menggunakan `caching_sha2_password` sebagai default
- `mysql_native_password` sudah deprecated dan mungkin tidak tersedia di MySQL 8.4
- Library `mysql2` versi 3.x sudah mendukung `caching_sha2_password`
- Seharusnya tidak ada masalah menggunakan `caching_sha2_password` dengan marviano-pos


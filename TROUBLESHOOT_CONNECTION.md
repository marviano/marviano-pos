# Troubleshooting MySQL Remote Connection

Jika semua konfigurasi sudah benar tapi masih gagal terhubung, ikuti checklist ini:

## ✅ Checklist yang Sudah Benar

Dari output Anda, sudah benar:
- ✅ Firewall rule sudah dibuat dan enabled
- ✅ User `root@192.168.1.%` sudah dibuat
- ✅ Privileges sudah diberikan
- ✅ `bind_address = 0.0.0.0`
- ✅ `FLUSH PRIVILEGES` sudah dijalankan

## 🔍 Masalah yang Mungkin Terjadi

### 1. **Password Tidak Cocok** (PALING MUNGKIN)

Anda membuat user dengan password `'test'`, tapi di aplikasi marviano-pos mungkin passwordnya berbeda.

**Solusi:**

**A. Pastikan password di aplikasi = 'test'**
- Di aplikasi marviano-pos, Settings → Setup DB MySQL
- Pastikan **Password Database** = `test` (password yang Anda set di MySQL)

**B. Atau ubah password MySQL sesuai password di aplikasi**

Jika password di aplikasi bukan 'test', ubah password MySQL:

```sql
-- Ubah password untuk user root@192.168.1.%
ALTER USER 'root'@'192.168.1.%' IDENTIFIED BY 'password_yang_di_aplikasi';
FLUSH PRIVILEGES;
```

**C. Atau set ulang user dengan password yang sama dengan localhost**

Cek password user root@localhost, lalu set yang sama untuk network user:

```sql
-- Cek dulu apakah user root@localhost ada password
SELECT user, host, plugin FROM mysql.user WHERE user = 'root';

-- Set password yang sama (ganti 'password_anda' dengan password sebenarnya)
ALTER USER 'root'@'192.168.1.%' IDENTIFIED BY 'password_anda';
FLUSH PRIVILEGES;
```

### 2. **MySQL Service Belum Di-restart**

Setelah mengubah `my.ini` (bind-address), MySQL harus di-restart.

**Cek:**
- Apakah MySQL sudah di-restart setelah mengubah `my.ini`?

**Solusi:**
- Restart MySQL service:
  - Services (Win + R → `services.msc`) → MySQL → Restart
  - Atau XAMPP: Stop → Start MySQL
  - Atau WAMP: Restart MySQL service

### 3. **Password Kosong di Localhost Tapi Ada Password di Network**

Jika `root@localhost` tidak pakai password, tapi `root@192.168.1.%` pakai password, pastikan password di aplikasi sesuai.

**Cek:**
```sql
-- Cek apakah root@localhost pakai password
SELECT user, host, authentication_string FROM mysql.user WHERE user = 'root';
```

Jika `root@localhost` tidak pakai password (authentication_string kosong), tapi `root@192.168.1.%` pakai password 'test', maka:
- Di aplikasi, jika pakai koneksi localhost → password kosong
- Di aplikasi, jika pakai koneksi network → password = 'test'

### 4. **IP Komputer Kedua Tidak Masuk Subnet**

Pastikan IP komputer kedua memang di subnet `192.168.1.x`.

**Cek dari komputer kedua:**
```cmd
ipconfig
```

Pastikan IP Address komputer kedua adalah `192.168.1.xxx` (bukan `192.168.0.x` atau subnet lain).

**Solusi:**
Jika IP komputer kedua berbeda subnet (misalnya `192.168.0.20`), buat user untuk IP spesifik:

```sql
-- Ganti 192.168.0.20 dengan IP komputer kedua yang sebenarnya
CREATE USER 'root'@'192.168.0.20' IDENTIFIED BY 'test';
GRANT ALL PRIVILEGES ON salespulse.* TO 'root'@'192.168.0.20';
FLUSH PRIVILEGES;
```

Atau jika mau fleksibel, buat untuk semua subnet:

```sql
CREATE USER 'root'@'%' IDENTIFIED BY 'test';
GRANT ALL PRIVILEGES ON salespulse.* TO 'root'@'%';
FLUSH PRIVILEGES;
```

### 5. **Test Koneksi Manual dari Komputer Kedua**

Test apakah koneksi MySQL benar-benar bisa dari komputer kedua.

**A. Install MySQL Client di komputer kedua (atau pakai telnet):**

```cmd
telnet 192.168.1.16 3306
```

Jika berhasil, akan ada koneksi (atau error dari MySQL, bukan "Could not open connection").

**B. Atau jika ada MySQL client di komputer kedua:**

```cmd
mysql -h 192.168.1.16 -u root -p
```

Masukkan password: `test`

Jika berhasil, berarti MySQL OK, masalahnya di aplikasi.
Jika gagal, berarti masalah di MySQL/firewall.

### 6. **Cek Log Error MySQL**

Lihat log error MySQL untuk detail error yang sebenarnya.

**Lokasi log:**
- XAMPP: `C:\xampp\mysql\data\*.err`
- WAMP: `C:\wamp64\logs\mysql*.log`
- MySQL Standalone: `C:\ProgramData\MySQL\MySQL Server 8.4\Data\*.err`

Atau cek di MySQL:
```sql
SHOW VARIABLES LIKE 'log_error';
```

Buka file log tersebut dan cari error terkait koneksi.

### 7. **Cek dari Server (192.168.1.16)**

Test koneksi dari server itu sendiri dengan IP 192.168.1.16:

```cmd
mysql -h 192.168.1.16 -u root -p
```

Masukkan password: `test`

Jika dari server sendiri juga gagal, berarti ada masalah konfigurasi.

## 🔧 Quick Fix: Reset User dengan Password yang Jelas

Jika masih bingung, coba reset user dengan password yang jelas:

```sql
-- Hapus user lama
DROP USER IF EXISTS 'root'@'192.168.1.%';

-- Buat ulang dengan password yang jelas (ganti 'MyPassword123!' dengan password Anda)
CREATE USER 'root'@'192.168.1.%' IDENTIFIED BY 'MyPassword123!';
GRANT ALL PRIVILEGES ON salespulse.* TO 'root'@'192.168.1.%';
FLUSH PRIVILEGES;

-- Verifikasi
SELECT user, host FROM mysql.user WHERE user = 'root';
SHOW GRANTS FOR 'root'@'192.168.1.%';
```

Kemudian di aplikasi marviano-pos, pastikan password = `MyPassword123!`

## 🔧 Fix Authentication Plugin (MySQL 8.4)

**PENTING untuk MySQL 8.4.7:**

MySQL 8.4 menggunakan `caching_sha2_password` sebagai default authentication plugin. Beberapa client library (termasuk mysql2 yang digunakan marviano-pos) mungkin lebih kompatibel dengan `mysql_native_password`.

**Solusi:**

Jalankan di MySQL server (192.168.1.16):

```sql
-- Ubah authentication plugin ke mysql_native_password
ALTER USER 'root'@'192.168.1.%' IDENTIFIED WITH mysql_native_password BY 'test';
FLUSH PRIVILEGES;

-- Verifikasi plugin
SELECT user, host, plugin FROM mysql.user WHERE user = 'root' AND host LIKE '192.168.1.%';
```

Plugin harus berubah dari `caching_sha2_password` ke `mysql_native_password`.

**File script:** `fix_mysql_auth.sql` sudah tersedia untuk dijalankan.

## 📋 Checklist Final

Sebelum test lagi, pastikan:

- [ ] Password di aplikasi marviano-pos = password yang di-set di MySQL (saat ini: `test`)
- [ ] MySQL service sudah di-restart setelah mengubah `my.ini`
- [ ] IP komputer kedua adalah `192.168.1.xxx`
- [ ] Firewall rule enabled
- [ ] bind_address = 0.0.0.0
- [ ] User `root@192.168.1.%` ada dan privileges benar
- [ ] Database `salespulse` benar-benar ada

## 🎯 Debugging Step by Step

1. **Dari server (192.168.1.16), test koneksi:**
   ```cmd
   mysql -h 127.0.0.1 -u root -p
   ```
   (Masukkan password untuk root@localhost)

2. **Dari server (192.168.1.16), test koneksi dengan IP:**
   ```cmd
   mysql -h 192.168.1.16 -u root -p
   ```
   (Masukkan password: `test`)

3. **Dari komputer kedua, test dengan telnet:**
   ```cmd
   telnet 192.168.1.16 3306
   ```

4. **Dari komputer kedua, test dengan MySQL client (jika ada):**
   ```cmd
   mysql -h 192.168.1.16 -u root -ptest salespulse
   ```
   (Perhatikan `-ptest` tanpa spasi = password langsung)

Jika semua test di atas berhasil, berarti masalahnya di aplikasi marviano-pos (konfigurasi atau kode).


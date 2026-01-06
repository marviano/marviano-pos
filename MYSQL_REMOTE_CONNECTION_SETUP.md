# Setup MySQL Remote Connection

Panduan untuk mengonfigurasi MySQL di komputer server (192.168.1.16) agar dapat menerima koneksi dari komputer lain di LAN.

## Masalah

Ketika komputer kedua mencoba terhubung ke MySQL di 192.168.1.16, muncul error:
```
Username atau password salah untuk koneksi jaringan ke 192.168.1.16
```

Ini terjadi karena:
1. MySQL belum dikonfigurasi untuk menerima koneksi remote
2. User MySQL belum dibuat untuk koneksi dari IP remote

## Solusi

### Langkah 1: Konfigurasi MySQL untuk Remote Connection

#### Windows (XAMPP/WAMP/MySQL Standalone)

1. **Cari file konfigurasi MySQL:**
   - XAMPP: `C:\xampp\mysql\bin\my.ini`
   - WAMP: `C:\wamp64\bin\mysql\mysql[version]\my.ini`
   - MySQL Standalone: `C:\ProgramData\MySQL\MySQL Server [version]\my.ini`

2. **Edit file `my.ini` dan cari bagian `[mysqld]`**

3. **Cari atau tambahkan baris `bind-address`:**
   ```ini
   [mysqld]
   bind-address = 0.0.0.0
   ```
   
   **Catatan:** 
   - `bind-address = 127.0.0.1` atau `localhost` = hanya localhost
   - `bind-address = 0.0.0.0` = terima koneksi dari semua IP
   - `bind-address = 192.168.1.16` = terima koneksi dari IP tertentu

4. **Restart MySQL service:**
   - XAMPP: Stop dan Start MySQL dari Control Panel
   - WAMP: Klik icon WAMP → MySQL → Service → Restart Service
   - MySQL Standalone: Services → MySQL → Restart

#### Linux

1. Edit file `/etc/mysql/mysql.conf.d/mysqld.cnf` atau `/etc/my.cnf`
2. Cari `bind-address = 127.0.0.1` dan ubah menjadi `bind-address = 0.0.0.0`
3. Restart MySQL: `sudo systemctl restart mysql`

### Langkah 2: Buat User MySQL untuk Remote Connection

#### Cara Membuka MySQL melalui Command Prompt (Windows 11)

Karena MySQL Workbench tidak support versi 8.4.7, gunakan Command Prompt:

**Metode 1: Menggunakan Full Path (Paling Mudah)**

1. Buka **Command Prompt** (CMD) atau **PowerShell** sebagai Administrator
2. Cari lokasi MySQL bin folder:
   - MySQL Standalone: `C:\Program Files\MySQL\MySQL Server 8.4\bin\`
   - XAMPP: `C:\xampp\mysql\bin\`
   - WAMP: `C:\wamp64\bin\mysql\mysql8.4\bin\`

3. Masuk ke folder tersebut:
   ```cmd
   cd "C:\Program Files\MySQL\MySQL Server 8.4\bin"
   ```

4. Login ke MySQL:
   ```cmd
   mysql.exe -u root -p
   ```
   Atau jika tidak ada password:
   ```cmd
   mysql.exe -u root
   ```

5. Masukkan password saat diminta (jika ada)

**Metode 2: Menambahkan MySQL ke PATH (Permanen)**

1. Buka **System Properties** → **Environment Variables**
2. Di **System Variables**, cari dan pilih **Path** → **Edit**
3. Klik **New** dan tambahkan path MySQL bin:
   ```
   C:\Program Files\MySQL\MySQL Server 8.4\bin
   ```
4. Klik **OK** pada semua dialog
5. Tutup dan buka Command Prompt baru
6. Sekarang bisa langsung ketik:
   ```cmd
   mysql -u root -p
   ```

**Metode 3: Menggunakan MySQL Shell (mysqlsh)**

MySQL 8.4.7 biasanya sudah include MySQL Shell:

```cmd
cd "C:\Program Files\MySQL\MySQL Server 8.4\bin"
mysqlsh.exe --uri root@localhost
```

Atau dengan password:
```cmd
mysqlsh.exe --uri root@localhost --password
```

**Cara Menemukan Lokasi MySQL:**

Jika tidak tahu lokasi MySQL, coba:

1. **Cek di Services:**
   - Buka **Services** (Win + R → `services.msc`)
   - Cari service **MySQL** atau **MySQL80**
   - Klik kanan → **Properties** → **Path to executable** akan menunjukkan lokasi

2. **Cari manual:**
   ```cmd
   dir "C:\Program Files\MySQL" /s /b | findstr mysql.exe
   ```

3. **Cek di Start Menu:**
   - Buka Start Menu → Cari "MySQL" → Klik kanan → **Open file location**

**Setelah Berhasil Login:**

Setelah berhasil masuk ke MySQL, Anda akan melihat prompt:
```
mysql>
```

Sekarang bisa menjalankan perintah SQL seperti di bawah ini.

**Cara Menjalankan Script SQL File:**

Jika Anda punya file SQL (seperti `setup_mysql_remote_user.sql`), bisa langsung dijalankan tanpa masuk ke MySQL prompt:

```cmd
cd "C:\Program Files\MySQL\MySQL Server 8.4\bin"
mysql.exe -u root -p salespulse < "C:\Code\marviano-pos\setup_mysql_remote_user.sql"
```

Atau jika sudah di PATH:
```cmd
mysql -u root -p salespulse < "C:\Code\marviano-pos\setup_mysql_remote_user.sql"
```

**Tips:**
- Ganti path sesuai lokasi file SQL Anda
- `-u root` = username
- `-p` = akan meminta password
- `salespulse` = nama database (opsional, bisa dihapus jika tidak perlu)

**Cara Mudah dengan File Batch (Recommended):**

Saya sudah membuat 2 file batch untuk memudahkan:

1. **`open_mysql.bat`** - Membuka MySQL Command Line
   - Double-click file ini
   - Edit path MySQL di dalam file jika perlu
   - Akan langsung membuka MySQL prompt

2. **`run_sql_script.bat`** - Menjalankan script SQL
   - Double-click file ini
   - Edit path MySQL dan file SQL di dalam file
   - Akan langsung menjalankan script SQL

**Contoh Langkah-Langkah Lengkap:**

1. **Buka Command Prompt sebagai Administrator**
   - Tekan `Win + X` → Pilih **Windows Terminal (Admin)** atau **Command Prompt (Admin)**

2. **Masuk ke folder MySQL:**
   ```cmd
   cd "C:\Program Files\MySQL\MySQL Server 8.4\bin"
   ```
   *(Ganti path sesuai instalasi MySQL Anda)*

3. **Login ke MySQL:**
   ```cmd
   mysql.exe -u root -p
   ```
   Masukkan password saat diminta

4. **Setelah masuk (muncul prompt `mysql>`), jalankan perintah SQL:**
   ```sql
   CREATE USER 'root'@'192.168.1.%' IDENTIFIED BY 'password_mysql_anda';
   GRANT ALL PRIVILEGES ON salespulse.* TO 'root'@'192.168.1.%';
   FLUSH PRIVILEGES;
   ```

5. **Verifikasi:**
   ```sql
   SELECT user, host FROM mysql.user WHERE user = 'root';
   ```

6. **Keluar dari MySQL:**
   ```sql
   exit;
   ```

#### Opsi 1: User untuk IP Spesifik (Lebih Aman)

Ganti `[IP_KOMPUTER_KEDUA]` dengan IP komputer kedua yang akan terhubung:

```sql
-- Buat user untuk IP spesifik
CREATE USER 'root'@'[IP_KOMPUTER_KEDUA]' IDENTIFIED BY 'password_yang_sama';

-- Berikan privileges ke database salespulse
GRANT ALL PRIVILEGES ON salespulse.* TO 'root'@'[IP_KOMPUTER_KEDUA]';

-- Refresh privileges
FLUSH PRIVILEGES;
```

**Contoh jika IP komputer kedua adalah 192.168.1.20:**
```sql
CREATE USER 'root'@'192.168.1.20' IDENTIFIED BY 'password_mysql_anda';
GRANT ALL PRIVILEGES ON salespulse.* TO 'root'@'192.168.1.20';
FLUSH PRIVILEGES;
```

#### Opsi 2: User untuk Seluruh Subnet (Lebih Mudah)

Jika semua komputer di subnet 192.168.1.x perlu akses:

```sql
-- Buat user untuk seluruh subnet 192.168.1.x
CREATE USER 'root'@'192.168.1.%' IDENTIFIED BY 'password_yang_sama';

-- Berikan privileges ke database salespulse
GRANT ALL PRIVILEGES ON salespulse.* TO 'root'@'192.168.1.%';

-- Refresh privileges
FLUSH PRIVILEGES;
```

#### Opsi 3: User untuk Semua IP (Tidak Disarankan untuk Production)

```sql
CREATE USER 'root'@'%' IDENTIFIED BY 'password_yang_sama';
GRANT ALL PRIVILEGES ON salespulse.* TO 'root'@'%';
FLUSH PRIVILEGES;
```

### Langkah 3: Verifikasi Konfigurasi

1. **Cek bind-address:**
   ```sql
   SHOW VARIABLES LIKE 'bind_address';
   ```
   Harus menampilkan `0.0.0.0` atau IP yang dikonfigurasi.

2. **Cek user yang sudah dibuat:**
   ```sql
   SELECT user, host FROM mysql.user WHERE user = 'root';
   ```
   Harus menampilkan user `root` dengan host yang sesuai (misalnya `192.168.1.%` atau IP spesifik).

3. **Cek privileges:**
   ```sql
   SHOW GRANTS FOR 'root'@'192.168.1.%';
   ```

### Langkah 4: Test Koneksi dari Komputer Kedua

1. Buka aplikasi marviano-pos di komputer kedua
2. Masuk ke Settings → Setup DB MySQL
3. Isi:
   - **IP Database:** `192.168.1.16`
   - **Nama Database:** `salespulse`
   - **Username Database:** `root`
   - **Password Database:** `[password MySQL Anda]`
4. Klik **Test Koneksi Database**
5. Seharusnya muncul: "Berhasil terhubung ke database salespulse di 192.168.1.16:3306"

## Troubleshooting

### Error: "Host 'xxx' is not allowed to connect"

**Solusi:** Pastikan user sudah dibuat untuk IP/host tersebut:
```sql
CREATE USER 'root'@'xxx' IDENTIFIED BY 'password';
GRANT ALL PRIVILEGES ON salespulse.* TO 'root'@'xxx';
FLUSH PRIVILEGES;
```

### Error: "Can't connect to MySQL server"

**Solusi:**
1. Pastikan MySQL service berjalan di server
2. Pastikan firewall tidak memblokir port 3306
3. Cek `bind-address` sudah diubah ke `0.0.0.0`
4. Restart MySQL service

### Error: "Access denied for user"

**Solusi:**
1. Pastikan password benar
2. Pastikan user sudah dibuat untuk IP/host yang tepat
3. Pastikan privileges sudah diberikan

### Cek Firewall Windows

Jika masih tidak bisa terhubung, pastikan Windows Firewall mengizinkan koneksi MySQL. Ada 3 cara:

#### Metode 1: Melalui Windows Defender Firewall GUI (Paling Mudah)

1. **Buka Windows Defender Firewall:**
   - Tekan `Win + R` → ketik `wf.msc` → Enter
   - Atau: Control Panel → System and Security → Windows Defender Firewall → Advanced Settings

2. **Buat Inbound Rule:**
   - Klik **Inbound Rules** di panel kiri
   - Klik **New Rule...** di panel kanan

3. **Pilih Rule Type:**
   - Pilih **Port** → **Next**

4. **Konfigurasi Port:**
   - Pilih **TCP**
   - Pilih **Specific local ports**
   - Ketik: `3306`
   - Klik **Next**

5. **Pilih Action:**
   - Pilih **Allow the connection** → **Next**

6. **Pilih Profile:**
   - Centang semua: **Domain**, **Private**, **Public**
   - Klik **Next**

7. **Beri Nama:**
   - Name: `MySQL Remote Access (Port 3306)`
   - Description (opsional): `Allow MySQL connections from remote computers`
   - Klik **Finish**

8. **Verifikasi:**
   - Pastikan rule **MySQL Remote Access (Port 3306** muncul di list Inbound Rules
   - Status harus **Enabled** (centang hijau)

#### Metode 2: Melalui Command Prompt (Cepat)

Buka **Command Prompt sebagai Administrator** (Win + X → Windows Terminal Admin):

```cmd
netsh advfirewall firewall add rule name="MySQL Remote Access" dir=in action=allow protocol=TCP localport=3306
```

**Verifikasi rule sudah dibuat:**
```cmd
netsh advfirewall firewall show rule name="MySQL Remote Access"
```

**Hapus rule (jika perlu):**
```cmd
netsh advfirewall firewall delete rule name="MySQL Remote Access"
```

#### Metode 3: Melalui PowerShell (Advanced)

Buka **PowerShell sebagai Administrator**:

```powershell
New-NetFirewallRule -DisplayName "MySQL Remote Access" -Direction Inbound -LocalPort 3306 -Protocol TCP -Action Allow
```

**Verifikasi:**
```powershell
Get-NetFirewallRule -DisplayName "MySQL Remote Access"
```

**Hapus rule (jika perlu):**
```powershell
Remove-NetFirewallRule -DisplayName "MySQL Remote Access"
```

#### Verifikasi Firewall Rule Aktif

Setelah membuat rule, verifikasi dengan salah satu cara:

**Via Command Prompt:**
```cmd
netsh advfirewall firewall show rule name=all | findstr "3306"
```

**Via PowerShell:**
```powershell
Get-NetFirewallRule | Where-Object {$_.DisplayName -like "*MySQL*" -or $_.DisplayName -like "*3306*"}
```

**Via GUI:**
- Buka `wf.msc`
- Inbound Rules → cari "MySQL Remote Access"
- Pastikan status **Enabled** (centang hijau)

#### Troubleshooting Firewall

**Jika masih tidak bisa terhubung setelah membuat rule:**

1. **Cek apakah rule aktif:**
   - Pastikan status **Enabled** (bukan Disabled)

2. **Cek profile yang aktif:**
   - Jika komputer di jaringan **Public**, pastikan rule mengizinkan **Public** profile
   - Jika di **Private**, pastikan rule mengizinkan **Private** profile

3. **Cek firewall lain:**
   - Apakah ada antivirus dengan firewall (seperti Kaspersky, Norton, dll)?
   - Nonaktifkan sementara untuk testing

4. **Test dengan telnet:**
   - Dari komputer kedua, buka Command Prompt:
   ```cmd
   telnet 192.168.1.16 3306
   ```
   - Jika berhasil, akan muncul koneksi (atau error dari MySQL, bukan firewall)
   - Jika gagal dengan "Could not open connection", firewall masih memblokir

5. **Cek Windows Firewall Status:**
   ```cmd
   netsh advfirewall show allprofiles
   ```
   Pastikan firewall **ON** dan tidak memblokir semua koneksi

## Catatan Keamanan

- **Opsi 2 (subnet)** lebih praktis untuk development/testing di LAN
- **Opsi 1 (IP spesifik)** lebih aman untuk production
- **Opsi 3 (semua IP)** **TIDAK DISARANKAN** kecuali untuk testing lokal
- Pastikan password MySQL kuat
- Pertimbangkan membuat user khusus (bukan root) untuk aplikasi

## Script SQL Lengkap (Copy-Paste)

Ganti `[PASSWORD]` dengan password MySQL Anda:

```sql
-- Untuk seluruh subnet 192.168.1.x
CREATE USER IF NOT EXISTS 'root'@'192.168.1.%' IDENTIFIED BY '[PASSWORD]';
GRANT ALL PRIVILEGES ON salespulse.* TO 'root'@'192.168.1.%';
FLUSH PRIVILEGES;

-- Verifikasi
SELECT user, host FROM mysql.user WHERE user = 'root';
```


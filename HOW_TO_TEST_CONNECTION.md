# Cara Test Koneksi MySQL dari Komputer Test

## Apakah Perlu Install MySQL?

**TIDAK perlu install MySQL Server lengkap!** Anda hanya perlu:

1. **MySQL Client** (opsional, untuk test manual)
2. **Telnet Client** (opsional, untuk test port)

Atau lebih mudah: **Langsung test dari aplikasi marviano-pos!**

## Opsi 1: Test Langsung dari Aplikasi (PALING MUDAH)

Tidak perlu install apapun! Aplikasi marviano-pos sudah punya fitur "Test Koneksi Database":

1. Buka aplikasi marviano-pos di komputer test (192.168.1.10)
2. Settings → Setup DB MySQL
3. Isi konfigurasi:
   - IP Database: `192.168.1.16`
   - Nama Database: `salespulse`
   - Username Database: `root`
   - Password Database: `test`
4. Klik **"Test Koneksi Database"**
5. Lihat hasilnya

**Ini adalah cara TERMUDAH dan TIDAK perlu install apapun!**

## Opsi 2: Test dengan Telnet (Hanya Cek Port)

Telnet hanya untuk cek apakah port 3306 terbuka, **TIDAK untuk test MySQL**.

### Aktifkan Telnet di Windows 11:

1. **Settings** → **Apps** → **Optional Features**
2. Klik **"View features"** atau **"Add a feature"**
3. Cari **"Telnet Client"**
4. Centang dan klik **Install**
5. Atau via PowerShell (Admin):
   ```powershell
   dism /online /Enable-Feature /FeatureName:TelnetClient
   ```

### Test dengan Telnet:

```cmd
telnet 192.168.1.16 3306
```

**Jika berhasil:**
- Akan muncul koneksi (layar hitam atau karakter aneh)
- Tekan `Ctrl + ]` lalu ketik `quit` untuk keluar
- Berarti port 3306 terbuka

**Jika gagal:**
- "Could not open connection" = Port tidak terbuka / firewall memblokir
- Timeout = Server tidak reachable

**Catatan:** Telnet hanya cek port, tidak cek MySQL authentication!

## Opsi 3: Install MySQL Client (Untuk Test Lengkap)

Jika mau test koneksi MySQL secara manual:

### Cara 1: Download MySQL Client Only (Recommended)

1. Download **MySQL Installer** dari: https://dev.mysql.com/downloads/installer/
2. Pilih **Custom** installation
3. Pilih **MySQL Command Line Client** saja (jangan install server)
4. Install
5. Test:
   ```cmd
   mysql -h 192.168.1.16 -u root -ptest salespulse
   ```

### Cara 2: Install via Chocolatey (Jika punya)

```cmd
choco install mysql.utilities
```

### Cara 3: Download Portable MySQL Client

1. Download dari: https://dev.mysql.com/downloads/mysql/
2. Extract ZIP
3. Gunakan `bin/mysql.exe` langsung:
   ```cmd
   C:\path\to\mysql\bin\mysql.exe -h 192.168.1.16 -u root -ptest salespulse
   ```

## Opsi 4: Test dari Server Sendiri (192.168.1.16)

Jika MySQL sudah terinstall di server, test dari server sendiri:

```cmd
mysql -h 192.168.1.16 -u root -ptest salespulse
```

Atau test dengan IP localhost:
```cmd
mysql -h 127.0.0.1 -u root -p
```
(Masukkan password untuk root@localhost)

## Rekomendasi

**Untuk troubleshooting cepat, gunakan Opsi 1 (Test dari aplikasi) saja!**

Jika aplikasi masih error, baru coba:
1. Test dengan telnet (Opsi 2) - cek port terbuka
2. Test dari server sendiri (Opsi 4) - cek MySQL berjalan
3. Test dengan MySQL client (Opsi 3) - cek koneksi lengkap

## Checklist

Sesuai dengan masalah Anda:

1. **Hapus baris `mysql_native_password=ON` dari my.ini** ✓
2. **Restart MySQL service** ✓
3. **Test dari aplikasi marviano-pos** ← LAKUKAN INI DULU!
4. Jika masih error, baru install telnet/MySQL client untuk debug lebih lanjut

## Langkah Selanjutnya

1. Pastikan sudah:
   - [x] Hapus `mysql_native_password=ON` dari my.ini
   - [x] Restart MySQL service
   - [x] Plugin user = `mysql_native_password` (sudah benar)

2. Test dari aplikasi marviano-pos di komputer test (192.168.1.10)

3. Jika masih error, baru install telnet/MySQL client untuk debug lebih detail


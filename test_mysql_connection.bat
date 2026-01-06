@echo off
REM ============================================
REM Script untuk test koneksi MySQL dari remote
REM ============================================
REM 
REM INSTRUKSI:
REM 1. Edit MYSQL_HOST, MYSQL_USER, dan MYSQL_PASSWORD di bawah
REM 2. Jalankan script ini dari komputer kedua
REM 3. Script akan test apakah koneksi MySQL berhasil
REM
REM ============================================

REM ===== EDIT KONFIGURASI INI =====
set MYSQL_HOST=192.168.1.16
set MYSQL_USER=root
set MYSQL_PASSWORD=test
set MYSQL_DATABASE=salespulse
REM ============================================

echo.
echo ============================================
echo Test Koneksi MySQL Remote
echo ============================================
echo.
echo Host: %MYSQL_HOST%
echo User: %MYSQL_USER%
echo Database: %MYSQL_DATABASE%
echo.

REM Cek apakah MySQL client ada
where mysql.exe >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [INFO] MySQL client tidak ditemukan di PATH.
    echo.
    echo Mencoba test dengan telnet...
    echo.
    goto :telnet_test
)

echo [1] Test koneksi MySQL...
echo.

REM Test koneksi MySQL
mysql.exe -h %MYSQL_HOST% -u %MYSQL_USER% -p%MYSQL_PASSWORD% -e "SELECT 'Connection successful!' AS Status, DATABASE() AS CurrentDB, USER() AS CurrentUser;" %MYSQL_DATABASE% 2>&1

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ============================================
    echo SUCCESS: Koneksi MySQL berhasil!
    echo ============================================
    echo.
    echo MySQL siap menerima koneksi remote.
    echo Pastikan password di aplikasi marviano-pos = %MYSQL_PASSWORD%
    echo.
) else (
    echo.
    echo ============================================
    echo ERROR: Koneksi MySQL gagal!
    echo ============================================
    echo.
    echo Kemungkinan masalah:
    echo 1. Password salah (password di MySQL: %MYSQL_PASSWORD%?)
    echo 2. User belum dibuat untuk IP ini
    echo 3. Firewall memblokir
    echo 4. MySQL tidak berjalan
    echo.
    goto :telnet_test
)

goto :end

:telnet_test
echo.
echo [2] Test koneksi port 3306 dengan telnet...
echo.
echo Memeriksa apakah port 3306 bisa diakses...

REM Cek apakah telnet tersedia
where telnet.exe >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [INFO] Telnet tidak tersedia. Install Telnet Client:
    echo Settings ^> Apps ^> Optional Features ^> Add a feature ^> Telnet Client
    echo.
    goto :end
)

echo.
echo Mencoba koneksi ke %MYSQL_HOST%:3306...
echo Jika berhasil, akan ada koneksi (tekan Ctrl+C untuk keluar)
echo Jika gagal, akan muncul "Could not open connection"
echo.
timeout /t 2 >nul
telnet %MYSQL_HOST% 3306

:end
echo.
pause


@echo off
REM ============================================
REM Script untuk membuka MySQL Command Line
REM ============================================
REM 
REM INSTRUKSI:
REM 1. Edit path MySQL di bawah sesuai instalasi Anda
REM 2. Double-click file ini untuk membuka MySQL
REM
REM ============================================

REM ===== EDIT PATH INI SESUAI INSTALASI ANDA =====
REM MySQL Standalone (default)
set MYSQL_PATH=C:\Program Files\MySQL\MySQL Server 8.4\bin

REM Atau jika pakai XAMPP, uncomment baris ini:
REM set MYSQL_PATH=C:\xampp\mysql\bin

REM Atau jika pakai WAMP, uncomment baris ini:
REM set MYSQL_PATH=C:\wamp64\bin\mysql\mysql8.4\bin
REM ============================================

echo.
echo ============================================
echo Membuka MySQL Command Line...
echo ============================================
echo.
echo Path MySQL: %MYSQL_PATH%
echo.

REM Cek apakah path ada
if not exist "%MYSQL_PATH%\mysql.exe" (
    echo ERROR: MySQL tidak ditemukan di: %MYSQL_PATH%
    echo.
    echo Silakan edit file ini dan ubah MYSQL_PATH sesuai instalasi Anda.
    echo.
    pause
    exit /b 1
)

REM Masuk ke folder MySQL
cd /d "%MYSQL_PATH%"

REM Buka MySQL dengan user root
echo Masukkan password MySQL (atau tekan Enter jika tidak ada password):
echo.
mysql.exe -u root -p

pause


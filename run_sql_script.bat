@echo off
REM ============================================
REM Script untuk menjalankan file SQL
REM ============================================
REM 
REM INSTRUKSI:
REM 1. Edit path MySQL dan file SQL di bawah
REM 2. Double-click file ini untuk menjalankan script SQL
REM
REM ============================================

REM ===== EDIT PATH INI SESUAI INSTALASI ANDA =====
set MYSQL_PATH=C:\Program Files\MySQL\MySQL Server 8.4\bin
set SQL_FILE=C:\Code\marviano-pos\setup_mysql_remote_user.sql
set DB_NAME=salespulse
set DB_USER=root
REM ============================================

echo.
echo ============================================
echo Menjalankan Script SQL...
echo ============================================
echo.
echo MySQL Path: %MYSQL_PATH%
echo SQL File: %SQL_FILE%
echo Database: %DB_NAME%
echo User: %DB_USER%
echo.

REM Cek apakah path MySQL ada
if not exist "%MYSQL_PATH%\mysql.exe" (
    echo ERROR: MySQL tidak ditemukan di: %MYSQL_PATH%
    echo Silakan edit file ini dan ubah MYSQL_PATH.
    pause
    exit /b 1
)

REM Cek apakah file SQL ada
if not exist "%SQL_FILE%" (
    echo ERROR: File SQL tidak ditemukan: %SQL_FILE%
    echo Silakan edit file ini dan ubah SQL_FILE.
    pause
    exit /b 1
)

REM Masuk ke folder MySQL
cd /d "%MYSQL_PATH%"

REM Jalankan script SQL
echo Masukkan password MySQL:
echo.
mysql.exe -u %DB_USER% -p %DB_NAME% < "%SQL_FILE%"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ============================================
    echo Script SQL berhasil dijalankan!
    echo ============================================
) else (
    echo.
    echo ============================================
    echo ERROR: Script SQL gagal dijalankan!
    echo ============================================
)

echo.
pause


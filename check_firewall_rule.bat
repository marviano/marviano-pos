@echo off
REM ============================================
REM Script untuk mengecek Firewall Rule MySQL
REM ============================================
REM 
REM Script ini mengecek apakah rule untuk port 3306 sudah ada
REM

echo.
echo ============================================
echo Mengecek Firewall Rule untuk MySQL Port 3306
echo ============================================
echo.

REM Cek rule MySQL
echo [1] Mencari rule "MySQL Remote Access"...
netsh advfirewall firewall show rule name="MySQL Remote Access" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✓ Rule ditemukan:
    echo.
    netsh advfirewall firewall show rule name="MySQL Remote Access"
) else (
    echo.
    echo ✗ Rule "MySQL Remote Access" tidak ditemukan.
)

echo.
echo [2] Mencari semua rule untuk port 3306...
echo.
netsh advfirewall firewall show rule name=all | findstr /C:"3306" /C:"MySQL" /C:"mysql"
if %ERRORLEVEL% NEQ 0 (
    echo ✗ Tidak ada rule yang ditemukan untuk port 3306.
)

echo.
echo [3] Status Windows Firewall:
echo.
netsh advfirewall show allprofiles | findstr "State"
echo.

echo ============================================
echo Selesai
echo ============================================
echo.
echo Jika rule tidak ditemukan, jalankan add_firewall_rule.bat sebagai Administrator.
echo.
pause


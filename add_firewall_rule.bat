@echo off
REM ============================================
REM Script untuk menambahkan Firewall Rule
REM untuk MySQL Port 3306
REM ============================================
REM 
REM INSTRUKSI:
REM 1. Jalankan sebagai Administrator (Right-click → Run as administrator)
REM 2. Script ini akan menambahkan rule untuk port 3306
REM
REM ============================================

echo.
echo ============================================
echo Menambahkan Firewall Rule untuk MySQL
echo ============================================
echo.
echo Port: 3306
echo Protocol: TCP
echo Direction: Inbound
echo Action: Allow
echo.

REM Cek apakah running as admin
net session >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Script ini harus dijalankan sebagai Administrator!
    echo.
    echo Cara menjalankan sebagai Admin:
    echo 1. Right-click file ini
    echo 2. Pilih "Run as administrator"
    echo.
    pause
    exit /b 1
)

REM Cek apakah rule sudah ada
netsh advfirewall firewall show rule name="MySQL Remote Access" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Rule "MySQL Remote Access" sudah ada.
    echo.
    choice /C YN /M "Hapus rule lama dan buat baru"
    if errorlevel 2 goto :end
    if errorlevel 1 (
        echo Menghapus rule lama...
        netsh advfirewall firewall delete rule name="MySQL Remote Access"
        if %ERRORLEVEL% EQU 0 (
            echo Rule lama berhasil dihapus.
        ) else (
            echo Warning: Gagal menghapus rule lama, akan membuat rule baru.
        )
        echo.
    )
)

REM Tambahkan rule baru
echo Menambahkan firewall rule...
netsh advfirewall firewall add rule name="MySQL Remote Access" dir=in action=allow protocol=TCP localport=3306

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ============================================
    echo SUCCESS: Firewall rule berhasil ditambahkan!
    echo ============================================
    echo.
    echo Rule Details:
    netsh advfirewall firewall show rule name="MySQL Remote Access"
    echo.
    echo MySQL port 3306 sekarang diizinkan untuk koneksi inbound.
    echo.
) else (
    echo.
    echo ============================================
    echo ERROR: Gagal menambahkan firewall rule!
    echo ============================================
    echo.
    echo Pastikan Anda menjalankan sebagai Administrator.
    echo.
)

:end
pause


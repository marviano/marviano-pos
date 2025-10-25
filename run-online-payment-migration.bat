@echo off
echo Running Online Payment Methods Migration...
echo.

cd /d "%~dp0"

echo Step 1: Running migration script...
node scripts\run-online-payment-migration.js

if %errorlevel% neq 0 (
    echo.
    echo ❌ Migration failed! Please check the error messages above.
    pause
    exit /b 1
)

echo.
echo ✅ Migration completed successfully!
echo.
echo Next steps:
echo 1. Test the POS system to ensure online payments work
echo 2. Check that transactions are saved with correct payment methods
echo 3. Verify that transaction history shows the correct platform names
echo.
pause

-- ============================================
-- Fix MySQL 8.4 Plugin Error
-- Error: "mysql_native_password is not loaded"
-- ============================================
-- 
-- MySQL 8.4 tidak support mysql_native_password secara default
-- Kita harus menggunakan caching_sha2_password (default MySQL 8.4)
-- 
-- Jalankan script ini di MySQL server (192.168.1.16)
-- ============================================

-- Ubah user ke caching_sha2_password (default MySQL 8.4)
-- Library mysql2 versi 3.x sudah mendukung caching_sha2_password
ALTER USER 'root'@'192.168.1.%' IDENTIFIED BY 'test';
FLUSH PRIVILEGES;

-- Verifikasi plugin
SELECT user, host, plugin FROM mysql.user WHERE user = 'root' AND host LIKE '192.168.1.%';

-- Plugin seharusnya = caching_sha2_password (bukan mysql_native_password)

-- ============================================
-- PENTING: Setelah menjalankan script ini
-- 1. Pastikan baris 'mysql_native_password=ON' sudah dihapus dari my.ini
-- 2. RESTART MySQL service
-- 3. Test dari aplikasi marviano-pos
-- ============================================


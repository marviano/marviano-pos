-- ============================================
-- Fix User Plugin Error di MySQL 8.4
-- Error: Plugin 'mysql_native_password' is not loaded
-- ============================================
-- 
-- MASALAH: User root@192.168.1.% sudah di-set ke plugin 
-- mysql_native_password yang tidak tersedia di MySQL 8.4
-- 
-- SOLUSI: Login sebagai root@localhost (yang masih bisa connect),
-- lalu drop user yang bermasalah dan buat ulang dengan default plugin
-- 
-- JALANKAN: Login sebagai root@localhost terlebih dahulu!
-- ============================================

-- PENTING: Pastikan Anda login sebagai root@localhost
-- Bukan root@192.168.1.%
-- 
-- Login dengan:
-- mysql -u root -p
-- (atau mysql -h localhost -u root -p)

-- Hapus user yang bermasalah
DROP USER IF EXISTS 'root'@'192.168.1.%';

-- Buat user baru dengan default plugin (caching_sha2_password)
-- Tidak perlu specify plugin, akan pakai default MySQL 8.4
CREATE USER 'root'@'192.168.1.%' IDENTIFIED BY 'test';
GRANT ALL PRIVILEGES ON salespulse.* TO 'root'@'192.168.1.%';
FLUSH PRIVILEGES;

-- Verifikasi
SELECT user, host, plugin FROM mysql.user WHERE user = 'root' AND host LIKE '192.168.1.%';

-- Plugin seharusnya = caching_sha2_password (default MySQL 8.4)



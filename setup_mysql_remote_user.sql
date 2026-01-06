-- ============================================
-- Setup MySQL Remote User untuk marviano-pos
-- ============================================
-- 
-- INSTRUKSI:
-- 1. Ganti [PASSWORD] dengan password MySQL Anda
-- 2. Jika perlu IP spesifik, ganti 192.168.1.% dengan IP komputer (misalnya: 192.168.1.20)
-- 3. Jalankan script ini di MySQL server (192.168.1.16)
--
-- ============================================

-- Opsi 1: User untuk seluruh subnet 192.168.1.x (RECOMMENDED untuk LAN)
-- Ganti [PASSWORD] dengan password MySQL Anda
CREATE USER IF NOT EXISTS 'root'@'192.168.1.%' IDENTIFIED BY '[PASSWORD]';
GRANT ALL PRIVILEGES ON salespulse.* TO 'root'@'192.168.1.%';
FLUSH PRIVILEGES;

-- Opsi 2: User untuk IP spesifik (jika Anda tahu IP komputer kedua)
-- Uncomment dan ganti [IP_KOMPUTER_KEDUA] dan [PASSWORD]
-- CREATE USER IF NOT EXISTS 'root'@'[IP_KOMPUTER_KEDUA]' IDENTIFIED BY '[PASSWORD]';
-- GRANT ALL PRIVILEGES ON salespulse.* TO 'root'@'[IP_KOMPUTER_KEDUA]';
-- FLUSH PRIVILEGES;

-- ============================================
-- Verifikasi
-- ============================================
-- Cek user yang sudah dibuat
SELECT user, host FROM mysql.user WHERE user = 'root';

-- Cek privileges
SHOW GRANTS FOR 'root'@'192.168.1.%';

-- Cek bind-address (harus 0.0.0.0 untuk remote connection)
SHOW VARIABLES LIKE 'bind_address';


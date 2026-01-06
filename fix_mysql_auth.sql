-- ============================================
-- Fix MySQL Authentication untuk MySQL 8.4
-- ============================================
-- 
-- MySQL 8.4 menggunakan caching_sha2_password sebagai default
-- Beberapa client library mungkin butuh mysql_native_password
-- 
-- Jalankan script ini di MySQL server (192.168.1.16)
-- ============================================

-- ============================================
-- PENTING: Setelah menjalankan script ini,
-- RESTART MySQL service!
-- ============================================

-- Opsi 1: Ubah authentication plugin ke mysql_native_password (RECOMMENDED)
-- Ini lebih kompatibel dengan berbagai client library
ALTER USER 'root'@'192.168.1.%' IDENTIFIED WITH mysql_native_password BY 'test';
FLUSH PRIVILEGES;

-- Opsi 2: Atau tetap pakai caching_sha2_password tapi pastikan password benar
-- Uncomment jika Opsi 1 tidak berhasil
-- ALTER USER 'root'@'192.168.1.%' IDENTIFIED BY 'test';
-- FLUSH PRIVILEGES;

-- Catatan: Hapus baris 'mysql_native_password=ON' dari my.ini jika ada
-- Baris tersebut bukan setting yang valid di MySQL 8.4

-- Verifikasi
SELECT user, host, plugin, authentication_string FROM mysql.user WHERE user = 'root' AND host LIKE '192.168.1.%';

-- Test koneksi (akan muncul error jika password salah, tapi akan connect jika benar)
-- Dari komputer test, jalankan: mysql -h 192.168.1.16 -u root -ptest


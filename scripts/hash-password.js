/**
 * Utility script to hash passwords using bcrypt
 * Usage: node scripts/hash-password.js "your-password"
 */

const bcrypt = require('bcryptjs');

const password = process.argv[2];

if (!password) {
  console.error('❌ Error: Please provide a password to hash');
  console.log('\nUsage: node scripts/hash-password.js "your-password"');
  process.exit(1);
}

const saltRounds = 10;
const hashedPassword = bcrypt.hashSync(password, saltRounds);

console.log('\n✅ Password hashed successfully!');
console.log('\n📋 Hashed Password (copy this to your database):');
console.log(hashedPassword);
console.log('\n📝 SQL Query to update user password:');
console.log(`UPDATE users SET password = '${hashedPassword}' WHERE email = 'user@example.com';`);
console.log('\n⚠️  Remember to replace user@example.com with the actual user email!\n');

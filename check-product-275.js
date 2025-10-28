const mysql = require('mysql2/promise');

async function checkProduct() {
  const connection = await mysql.createConnection({
    host: '217.217.252.95',
    user: 'root',
    password: 'MarvianoSalespulse96!',
    database: 'salespulse'
  });

  try {
    // Check product 275
    const [products] = await connection.execute(`
      SELECT 
        id, nama,
        harga_jual, harga_online,
        harga_gofood, harga_grabfood, harga_shopeefood, harga_tiktok
      FROM products
      WHERE id = 275
    `);

    console.log('Product ID 275:');
    console.log(JSON.stringify(products, null, 2));
    console.log('\n');

    // Also check what category/jenis this product is in
    const [categories] = await connection.execute(`
      SELECT p.id, p.nama,
             c1.name as category1_name, c2.name as category2_name
      FROM products p
      LEFT JOIN category1 c1 ON p.category1_id = c1.id
      LEFT JOIN category2 c2 ON p.category2_id = c2.id
      WHERE p.id = 275
    `);

    console.log('Product with category names:');
    console.log(JSON.stringify(categories, null, 2));
    console.log('\n');

    // Check if product has any TikTok prices
    const [allTiktok] = await connection.execute(`
      SELECT COUNT(*) as count
      FROM products
      WHERE harga_tiktok IS NOT NULL AND harga_tiktok > 0
    `);

    console.log(`Total products with harga_tiktok > 0: ${allTiktok[0].count}`);

    // Check Sundae products specifically
    const [sundaeProducts] = await connection.execute(`
      SELECT p.id, p.nama, 
             c2.name as category2_name,
             p.harga_tiktok
      FROM products p
      LEFT JOIN category2 c2 ON p.category2_id = c2.id
      WHERE c2.name = 'Sundae'
      ORDER BY p.nama
    `);

    console.log('\nAll Sundae products:');
    sundaeProducts.forEach(p => {
      console.log(`ID ${p.id}: ${p.nama} (${p.category2_name}) - harga_tiktok: ${p.harga_tiktok}`);
    });

  } finally {
    await connection.end();
  }
}

checkProduct().catch(console.error);


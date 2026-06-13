import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

const envPath = path.join(process.cwd(), '.env');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const conn = await mysql.createConnection({
  host: env.DB_VPS_HOST,
  user: env.DB_VPS_USER,
  password: env.DB_VPS_PASSWORD,
  database: env.DB_VPS_NAME,
});

const businessId = 14;
const [serverPi] = await conn.query(`
  SELECT pi.id, pi.package_product_id, pi.selection_type, pi.product_id
  FROM package_items pi
  INNER JOIN product_businesses pb ON pi.package_product_id = pb.product_id
  INNER JOIN products p_pkg ON pi.package_product_id = p_pkg.id AND p_pkg.status = 'active'
  WHERE pb.business_id = ?
`, [businessId]);

const [serverPip] = await conn.query(`
  SELECT pip.id, pip.package_item_id, pip.product_id
  FROM package_item_products pip
  INNER JOIN package_items pi ON pip.package_item_id = pi.id
  INNER JOIN product_businesses pb ON pi.package_product_id = pb.product_id
  INNER JOIN products p ON pip.product_id = p.id AND p.status = 'active'
  WHERE pb.business_id = ?
`, [businessId]);

await conn.end();

const local = await mysql.createConnection({
  host: env.DB_HOST,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
});

const [localProds] = await local.query('SELECT id FROM products');
const [localPi] = await local.query('SELECT id FROM package_items');
const prodSet = new Set(localProds.map((r) => r.id));
const localPiSet = new Set(localPi.map((r) => r.id));

const skippedParents = [];
for (const pi of serverPi) {
  if (!prodSet.has(pi.package_product_id)) {
    skippedParents.push({ id: pi.id, package_product_id: pi.package_product_id });
  }
}

const pipWouldSkip = serverPip.filter((pip) => {
  const parentMissing = !localPiSet.has(pip.package_item_id);
  const parentWouldSkip = skippedParents.some((s) => s.id === pip.package_item_id);
  const productMissing = !prodSet.has(pip.product_id);
  return parentMissing || parentWouldSkip || productMissing;
});

console.log(JSON.stringify({
  sessionId: '004827',
  runId: 'simulation',
  serverPackageItems: serverPi.length,
  serverPackageItemProducts: serverPip.length,
  skippedParentPackageItems: skippedParents.length,
  skippedParentSample: skippedParents.slice(0, 10),
  pipRowsWouldSkipFk: pipWouldSkip.length,
  pipWouldSkipSample: pipWouldSkip.slice(0, 10),
  pipValidCount: serverPip.length - pipWouldSkip.length,
}, null, 2));

await local.end();

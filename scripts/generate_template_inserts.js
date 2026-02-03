/**
 * Script to generate INSERT queries for receipt templates
 * Run with: node scripts/generate_template_inserts.js > database_migrations/insert_default_templates_generated.sql
 */

const fs = require('fs');
const path = require('path');

// Read the current receipt template from main.ts
// For now, we'll provide the templates here
// You can extract them from generateReceiptHTML function

const receiptTemplate = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      width: 42ch;
      max-width: 42ch;
      font-size: 10pt;
      font-weight: 500;
      line-height: 1.2;
      padding: 2mm {{rightPadding}}mm 2mm {{leftPadding}}mm;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .contact { text-align: center; font-size: 8pt; font-weight: 600; margin-bottom: 1mm; }
    .logo-container { text-align: center; margin-bottom: 1mm; }
    .logo { max-width: 100%; height: auto; max-height: 18mm; }
    .store-name { text-align: center; font-size: 13pt; font-weight: bold; margin-bottom: 1mm; }
    .branch { text-align: center; font-size: 11pt; font-weight: 600; margin-bottom: 1mm; }
    .address { text-align: center; font-size: 8pt; font-weight: 500; margin-bottom: 1.5mm; max-width: 100%; line-height: 1.3; }
    .transaction-type { text-align: center; font-size: 10pt; font-weight: 700; margin-bottom: 1.5mm; }
    .dashed-line { border-top: 1px dashed #000; margin: 1.5mm 0; }
    .info-line { display: flex; justify-content: space-between; margin-bottom: 0.5mm; }
    .info-label { font-size: 9pt; font-weight: 500; }
    .info-value { font-size: 9pt; font-weight: 700; }
    .order-number-value { font-size: 9pt; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin: 1mm 0; font-size: 9pt; }
    th { text-align: left; font-weight: 700; border-bottom: 1px solid #000; padding: 0.5mm 0; font-size: 8pt; }
    td { padding: 0.5mm 0; font-weight: 500; }
    .summary-line { display: flex; justify-content: space-between; margin-bottom: 0.5mm; font-size: 9pt; font-weight: 500; }
    .summary-label { font-weight: 500; }
    .summary-value { font-weight: 700; }
    .footer { margin-top: 2mm; font-size: 8pt; text-align: center; line-height: 1.3; font-weight: 500; }
  </style>
</head>
<body>
  {{logo}}
  <div class="branch">{{businessName}}</div>
  {{#ifReprint}}
  <div class="reprint-notice" style="text-align: center; font-size: 10pt; font-weight: bold; margin: 1mm 0; color: #000;">REPRINT KE-{{reprintCount}}</div>
  {{/ifReprint}}
  <div class="address">{{address}}</div>
  <div class="contact">{{contactPhone}}</div>
  
  <div class="transaction-type">{{transactionDisplay}} {{displayCounter}}</div>
  
  <div class="dashed-line"></div>
  
  <div class="info-line">
    <span class="info-label">Nomor Pesanan:</span>
    <span class="info-value order-number-value mono-value">{{receiptNumber}}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Waktu Pesanan:</span>
    <span class="info-value mono-value">{{orderTime}}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Waktu Print:</span>
    <span class="info-value mono-value">{{printTime}}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Operator Kasir:</span>
    <span class="info-value">{{cashier}}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Nama Pelanggan:</span>
    <span class="info-value">{{customerName}}</span>
  </div>
  
  <div class="dashed-line"></div>
  
  <table>
    <tr>
      <th style="width: 30%;">Nama Produk</th>
      <th style="width: 25%; text-align: right;">Harga</th>
      <th style="width: 20%; text-align: right;">Jumlah</th>
      <th style="width: 25%; text-align: right;">Subtotal</th>
    </tr>
    {{items}}
  </table>
  
  <div class="dashed-line"></div>
  
  <div class="summary-line">
    <span class="summary-label">Total Pesanan:</span>
    <span class="summary-value">{{totalItems}}</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Total Harga:</span>
    <span class="summary-value">{{total}}</span>
  </div>
  
  <div class="dashed-line"></div>
  
  <div class="summary-line">
    <span class="summary-label">Metode Pembayaran:</span>
    <span class="summary-value">{{paymentMethod}}</span>
  </div>
  {{#ifAmountReceived}}
  <div class="summary-line">
    <span class="summary-label">Bayar Jumlah:</span>
    <span class="summary-value">{{amountReceived}}</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Kembali Uang Kecil:</span>
    <span class="summary-value">{{change}}</span>
  </div>
  {{/ifAmountReceived}}
  <div class="summary-line">
    <span class="summary-label">Pembayaran Sebenarnya:</span>
    <span class="summary-value">{{total}}</span>
  </div>
  
  <div class="dashed-line"></div>
  
  <div class="footer">
    {{footerText}}
  </div>
</body>
</html>`;

const billTemplate = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      width: 42ch;
      max-width: 42ch;
      font-size: 10pt;
      font-weight: 500;
      line-height: 1.2;
      padding: 2mm {{rightPadding}}mm 2mm {{leftPadding}}mm;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .contact { text-align: center; font-size: 8pt; font-weight: 600; margin-bottom: 1mm; }
    .logo-container { text-align: center; margin-bottom: 1mm; }
    .logo { max-width: 100%; height: auto; max-height: 18mm; }
    .store-name { text-align: center; font-size: 13pt; font-weight: bold; margin-bottom: 1mm; }
    .branch { text-align: center; font-size: 11pt; font-weight: 600; margin-bottom: 1mm; }
    .address { text-align: center; font-size: 8pt; font-weight: 500; margin-bottom: 1.5mm; max-width: 100%; line-height: 1.3; }
    .dashed-line { border-top: 1px dashed #000; margin: 1.5mm 0; }
    .info-line { display: flex; justify-content: space-between; margin-bottom: 0.5mm; }
    .info-label { font-size: 9pt; font-weight: 500; }
    .info-value { font-size: 9pt; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin: 1mm 0; font-size: 9pt; }
    th { text-align: left; font-weight: 700; border-bottom: 1px solid #000; padding: 0.5mm 0; font-size: 8pt; }
    td { padding: 0.5mm 0; font-weight: 500; }
    .summary-line { display: flex; justify-content: space-between; margin-bottom: 0.5mm; font-size: 9pt; font-weight: 500; }
    .summary-label { font-weight: 500; }
    .summary-value { font-weight: 700; }
    .footer { margin-top: 2mm; font-size: 8pt; text-align: center; line-height: 1.3; font-weight: 500; }
  </style>
</head>
<body>
  <div class="contact">{{contactPhone}}</div>
  
  {{logo}}
  <div class="branch">{{businessName}}</div>
  <div style="text-align: center; font-size: 11pt; font-weight: 700; margin-bottom: 1mm;">Print Bill</div>
  <div class="address">{{address}}</div>
  
  <div class="dashed-line"></div>
  
  <div class="info-line">
    <span class="info-label">Waktu Pesanan:</span>
    <span class="info-value mono-value">{{orderTime}}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Waktu Print:</span>
    <span class="info-value mono-value">{{printTime}}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Operator Kasir:</span>
    <span class="info-value">{{cashier}}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Nama Pelanggan:</span>
    <span class="info-value">{{customerName}}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Saluran:</span>
    <span class="info-value">Toko Offline</span>
  </div>
  
  <div class="dashed-line"></div>
  
  <table>
    <tr>
      <th style="width: 30%;">Nama Produk</th>
      <th style="width: 25%; text-align: right;">Harga</th>
      <th style="width: 20%; text-align: right;">Jumlah</th>
      <th style="width: 25%; text-align: right;">Subtotal</th>
    </tr>
    {{items}}
  </table>
  
  <div class="dashed-line"></div>
  
  <div class="summary-line">
    <span class="summary-label">Total Pesanan:</span>
    <span class="summary-value">{{totalItems}}</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Total Harga:</span>
    <span class="summary-value">{{total}}</span>
  </div>
  {{#ifVoucher}}
  <div class="summary-line">
    <span class="summary-label">Diskon ({{voucherLabel}}):</span>
    <span class="summary-value">-{{voucherDiscount}}</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Total Bayar:</span>
    <span class="summary-value">{{finalAmount}}</span>
  </div>
  {{/ifVoucher}}
  
  <div class="dashed-line"></div>
  
  <div class="footer">
    {{footerText}}
  </div>
</body>
</html>`;

const refundTemplate = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      width: 42ch;
      max-width: 42ch;
      font-size: 10pt;
      font-weight: 500;
      line-height: 1.2;
      padding: 2mm {{rightPadding}}mm 2mm {{leftPadding}}mm;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .contact { text-align: center; font-size: 8pt; font-weight: 600; margin-bottom: 1mm; }
    .logo-container { text-align: center; margin-bottom: 1mm; }
    .logo { max-width: 100%; height: auto; max-height: 18mm; }
    .store-name { text-align: center; font-size: 13pt; font-weight: bold; margin-bottom: 1mm; }
    .branch { text-align: center; font-size: 11pt; font-weight: 600; margin-bottom: 1mm; }
    .address { text-align: center; font-size: 8pt; font-weight: 500; margin-bottom: 1.5mm; max-width: 100%; line-height: 1.3; }
    .transaction-type { text-align: center; font-size: 10pt; font-weight: 700; margin-bottom: 1.5mm; }
    .dashed-line { border-top: 1px dashed #000; margin: 1.5mm 0; }
    .info-line { display: flex; justify-content: space-between; margin-bottom: 0.5mm; }
    .info-label { font-size: 9pt; font-weight: 500; }
    .info-value { font-size: 9pt; font-weight: 700; }
    .order-number-value { font-size: 9pt; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin: 1mm 0; font-size: 9pt; }
    th { text-align: left; font-weight: 700; border-bottom: 1px solid #000; padding: 0.5mm 0; font-size: 8pt; }
    td { padding: 0.5mm 0; font-weight: 500; }
    .summary-line { display: flex; justify-content: space-between; margin-bottom: 0.5mm; font-size: 9pt; font-weight: 500; }
    .summary-label { font-weight: 500; }
    .summary-value { font-weight: 700; }
    .footer { margin-top: 2mm; font-size: 8pt; text-align: center; line-height: 1.3; font-weight: 500; }
  </style>
</head>
<body>
  <div class="contact">{{contactPhone}}</div>
  
  {{logo}}
  <div class="branch">{{businessName}}</div>
  <div style="text-align: center; font-size: 11pt; font-weight: 700; margin-bottom: 1mm; color: #dc2626;">REFUND</div>
  <div class="address">{{address}}</div>
  
  <div class="dashed-line"></div>
  
  <div class="info-line">
    <span class="info-label">Nomor Pesanan:</span>
    <span class="info-value order-number-value mono-value">{{receiptNumber}}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Waktu Pesanan:</span>
    <span class="info-value mono-value">{{orderTime}}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Waktu Print:</span>
    <span class="info-value mono-value">{{printTime}}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Operator Kasir:</span>
    <span class="info-value">{{cashier}}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Nama Pelanggan:</span>
    <span class="info-value">{{customerName}}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Saluran:</span>
    <span class="info-value">Toko Offline</span>
  </div>
  
  <div class="dashed-line"></div>
  
  <table>
    <tr>
      <th style="width: 30%;">Nama Produk</th>
      <th style="width: 25%; text-align: right;">Harga</th>
      <th style="width: 20%; text-align: right;">Jumlah</th>
      <th style="width: 25%; text-align: right;">Subtotal</th>
    </tr>
    {{items}}
  </table>
  
  <div class="dashed-line"></div>
  
  <div class="summary-line">
    <span class="summary-label">Total Pesanan:</span>
    <span class="summary-value">{{totalItems}}</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Total Harga:</span>
    <span class="summary-value">{{total}}</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Nominal Refund:</span>
    <span class="summary-value">{{total}}</span>
  </div>
  
  <div class="dashed-line"></div>
  
  <div class="summary-line">
    <span class="summary-label">Metode Pembayaran:</span>
    <span class="summary-value">{{paymentMethod}}</span>
  </div>
  
  <div class="dashed-line"></div>
  
  <div class="footer">
    {{footerText}}
  </div>
</body>
</html>`;

// Escape single quotes for SQL
function escapeSQL(str) {
  return str.replace(/'/g, "''");
}

// Generate INSERT queries
const templates = [
  { type: 'receipt', name: 'MOMOYO Receipt', code: receiptTemplate },
  { type: 'bill', name: 'MOMOYO Bill', code: billTemplate },
  { type: 'refund', name: 'MOMOYO Refund', code: refundTemplate }
];

console.log('-- Insert default templates: MOMOYO Receipt, MOMOYO Bill, MOMOYO Refund');
console.log('-- Execute this after running add_receipt_templates_and_settings.sql and add_template_name_and_selection.sql');
console.log('');

templates.forEach(template => {
  const escapedCode = escapeSQL(template.code);
  console.log(`-- ${template.name} Template (for ${template.type === 'receipt' ? 'paid transactions' : template.type === 'bill' ? 'unpaid orders' : 'refunds'})`);
  console.log(`INSERT INTO receipt_templates (template_type, template_name, business_id, template_code, is_active, is_default, version) VALUES`);
  console.log(`('${template.type}', '${template.name}', NULL,`);
  console.log(`'${escapedCode}',`);
  console.log(`1, 1, 1)`);
  console.log(`ON DUPLICATE KEY UPDATE template_code = VALUES(template_code), is_default = VALUES(is_default);`);
  console.log('');
});

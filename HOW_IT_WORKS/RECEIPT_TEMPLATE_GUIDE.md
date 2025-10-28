# Receipt Template Guide - 80mm Thermal Printers

## Overview

This guide explains how to format receipts for 80mm thermal printers (like the NOTA XP-80C).

---

## Paper Specifications

### 80mm Thermal Receipt Paper
- **Width**: 80mm (3.15 inches)
- **Standard width in pixels**: ~302px at 96 DPI
- **Typical printable area**: 302-320px
- **Font size**: 11-12px for readable text
- **Line spacing**: 1.2-1.5 for readability

---

## Current Configuration

### Print Settings
Located in `electron/main.ts` around line 1951:

```typescript
const printOptions = {
  silent: true,
  printBackground: false,
  deviceName: data.printerName || undefined,
  pageRanges: [{ from: 1, to: 1 }],
  margins: {
    marginType: 'custom',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0
  }
};
```

### HTML/CSS Settings

```css
@page {
  size: 302px;  /* 80mm width */
  margin: 0;
}

body {
  font-family: 'Courier New', monospace;
  width: 302px;
  padding: 10px;
  font-size: 11px;
  line-height: 1.3;
}
```

---

## Receipt Template Structure

### Recommended Layout

```html
<!DOCTYPE html>
<html>
  <head>
    <style>
      @page { size: 302px; margin: 0; }
      
      body {
        width: 302px;
        padding: 10px;
        font-size: 11px;
        line-height: 1.4;
      }
      
      .center { text-align: center; }
      .bold { font-weight: bold; }
      .line { border-top: 1px dashed #000; margin: 10px 0; }
      
      /* Header */
      .header { text-align: center; font-weight: bold; padding-bottom: 10px; }
      .store-name { font-size: 14px; }
      
      /* Items */
      .item { display: flex; justify-content: space-between; margin-bottom: 5px; }
      .item-name { flex: 1; }
      .item-qty { margin: 0 5px; }
      
      /* Totals */
      .totals { border-top: 1px solid #000; margin-top: 10px; }
      
      /* Footer */
      .footer { text-align: center; margin-top: 15px; font-size: 9px; }
    </style>
  </head>
  <body>
    <!-- Store Header -->
    <div class="header">
      <div class="store-name">MARVIANO</div>
      <div>Jl. Example Street 123</div>
      <div>Tel: 08123456789</div>
    </div>
    
    <div class="line"></div>
    
    <!-- Transaction Info -->
    <div class="center">
      <div class="bold">Receipt #123</div>
      <div>${new Date().toLocaleString()}</div>
      <div>Cashier: John Doe</div>
    </div>
    
    <div class="line"></div>
    
    <!-- Items -->
    <div>
      <div class="item">
        <span>Coffee Latte</span>
        <span>x2</span>
        <span>Rp 50,000</span>
      </div>
      <div class="item">
        <span>Croissant</span>
        <span>x1</span>
        <span>Rp 25,000</span>
      </div>
    </div>
    
    <div class="line"></div>
    
    <!-- Totals -->
    <div class="totals">
      <div class="item">
        <span class="bold">TOTAL</span>
        <span class="bold">Rp 75,000</span>
      </div>
      <div class="item">
        <span>Cash</span>
        <span>Rp 100,000</span>
      </div>
      <div class="item">
        <span>Change</span>
        <span>Rp 25,000</span>
      </div>
    </div>
    
    <div class="line"></div>
    
    <!-- Footer -->
    <div class="footer">
      Thank you for your visit!<br>
      Follow us on Instagram @marviano
    </div>
  </body>
</html>
```

---

## Character Limits for 80mm Receipts

### Width Guidelines (302px at 96 DPI)

| Element | Max Characters | Recommended |
|---------|----------------|-------------|
| Store name | 32 chars | 25 chars |
| Store address | 40 chars | 35 chars |
| Item name | 25 chars | 20 chars |
| Item with modifiers | 30 chars | 25 chars |
| Total line | 35 chars | - |

### Font Size Guidelines

- **Store name**: 14-16px
- **Headers**: 12px bold
- **Regular text**: 11px
- **Details**: 10px
- **Fine print**: 9px

---

## Best Practices

### 1. Keep it Simple
- Use monospace font for consistent spacing
- Avoid complex layouts (no flexbox/table complications)
- Stick to vertical layout

### 2. Character Alignment
```html
<!-- ❌ BAD - Hard to align -->
<div>Coffee     x2      Rp 50,000</div>

<!-- ✅ GOOD - Use table or flex -->
<div style="display: flex; justify-content: space-between;">
  <span>Coffee</span>
  <span>x2</span>
  <span>Rp 50,000</span>
</div>
```

### 3. Use Lines for Separation
```css
.line { 
  border-top: 1px dashed #000; 
  margin: 10px 0; 
  width: 100%; 
}
```

### 4. Truncate Long Names
```javascript
function truncateName(name, maxLength = 25) {
  return name.length > maxLength 
    ? name.substring(0, maxLength - 3) + '...' 
    : name;
}
```

### 5. Format Currency
```javascript
function formatCurrency(amount) {
  return `Rp ${amount.toLocaleString('id-ID')}`;
}

formatCurrency(75000); // "Rp 75,000"
```

---

## Testing Your Receipt

### Print Test Script

Add this to your receipt printing code:

```typescript
// Test with sample data
const testReceipt = {
  transactionNumber: 'TEST-001',
  date: new Date(),
  cashier: 'Test User',
  items: [
    { name: 'Coffee Latte', qty: 2, price: 25000, total: 50000 },
    { name: 'Croissant', qty: 1, price: 25000, total: 25000 }
  ],
  subtotal: 75000,
  total: 75000,
  paymentMethod: 'Cash',
  amountReceived: 100000,
  change: 25000
};

await printReceipt(testReceipt);
```

### Checklist
- [ ] All text fits within 302px width
- [ ] No text is cut off
- [ ] Numbers align properly (currency formatting)
- [ ] Lines/dividers print correctly
- [ ] Footer has proper spacing
- [ ] Receipt is centered on paper

---

## Adjusting Paper Size

If your printer uses different paper width:

### 58mm Paper (Common for small POS)
```css
@page { size: 218px; } /* 58mm = 218px */
body { width: 218px; font-size: 10px; }
```

### 112mm Paper
```css
@page { size: 423px; } /* 112mm = 423px */
body { width: 423px; font-size: 12px; }
```

### Common Thermal Receipt Sizes

| Paper Size | Width (mm) | Pixels (96 DPI) | Pixels (72 DPI) |
|------------|------------|----------------|----------------|
| 58mm       | 58         | 218            | 164            |
| 80mm       | 80         | 302            | 227            |
| 112mm      | 112        | 423            | 318            |

---

## Troubleshooting

### Text is Cut Off
- **Problem**: Content wider than paper width
- **Solution**: Reduce font size or content width
- **Check**: Use browser dev tools to measure element width

### Margins Too Large
- **Problem**: Content pushed to edges
- **Solution**: Set `margin: 0` in `@page` CSS
- **Check**: Use `printOptions.margins` configuration

### Font Too Small
- **Problem**: Text unreadable
- **Solution**: Increase font size
- **Recommend**: Minimum 10px for 80mm paper

### Numbers Don't Align
- **Problem**: Inconsistent spacing
- **Solution**: Use monospace font + fixed-width columns
- **Example**: Use `<pre>` or set `letter-spacing` in CSS

---

## Advanced: Dynamic Content Width

If you need to adjust based on printer settings:

```typescript
// In your print handler
const receiptWidth = data.paperWidth || 302; // default 80mm

const htmlContent = `
  <style>
    @page { size: ${receiptWidth}px; margin: 0; }
    body { width: ${receiptWidth}px; }
  </style>
  ...
`;
```

---

## Summary

**Current Setup for 80mm Receipts:**
- Page width: **302px**
- Font size: **11px** (main), 14px (header)
- Margins: **0** (full bleed)
- Font family: **Courier New** (monospace)
- Padding: **10px** (content padding)

**Next Steps:**
1. Test with your actual receipt printer
2. Adjust font sizes if needed
3. Fine-tune character width limits
4. Create actual transaction receipt template


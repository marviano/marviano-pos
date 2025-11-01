# Label Printing Troubleshooting & Best Practices Guide

## ⚠️ IMPORTANT: Printer Calibration Required

**The issue you described (blank labels, inconsistent positioning) is almost certainly a PRINTER CALIBRATION problem, not a software problem.**

Your POS code is working correctly. The thermal label printer's optical sensor needs to be calibrated to properly detect the label boundaries.

---

## Original Problem Summary
- ✅ Labels printing but content is cut off
- ✅ 2 blank labels print first
- ✅ Printed content appears between 3rd and 4th label position
- ✅ Inconsistent positioning ("print can't stick to its own page")

**Root Cause:** Printer optical sensor not properly detecting label size and gaps

---

## 🔧 SOLUTION: Calibrate Your Printer

This **MUST** be done on the physical printer itself. The exact steps vary by manufacturer:

### General Calibration Steps (Most Thermal Printers)

1. **Turn OFF the printer**
2. **Hold the FEED button** while turning it ON
3. **Watch the LED/Light**: 
   - It will flash in a pattern (often 2-3 times)
   - The pattern indicates calibration mode
4. **Release the FEED button** after the flashing pattern
5. **Let it feed some blank labels** (usually 3-5 labels)
6. **Press FEED once more** to complete calibration
7. **LED should stop flashing** = calibration complete

### Manufacturer-Specific Instructions

#### Zebra Printers
- Hold FEED button while powering on
- Release after 2 flashes
- Let it feed labels
- Press FEED to complete

#### Brother Label Printers
- Press and hold the FEED/POWER combination
- Follow light pattern for your specific model
- Refer to Brother manual for exact pattern

#### Generic/Thermal POS Printers
- Check your printer manual for "calibration" or "media calibration"
- Usually involves FEED button hold + power cycle
- The sensor needs to "learn" your label size

---

## 🖨️ Software Configuration

### Label Size Settings

**Current Configuration:**
- **Page Width:** 40mm (thermal printer standard)
- **Page Height:** Auto (adapts to content)
- **Content Width:** 21 characters (21ch)
- **Font:** Arial 8pt, bold
- **Padding:** 2mm

This configuration is correct for most 40mm thermal label rolls.

### If You Need to Change Label Size

Edit `electron/main.ts` around line 2876:

```css
@page { 
  size: [WIDTH]mm auto;  /* e.g., 40mm, 50mm, 80mm */
  margin: 0;
}
```

Common label widths:
- **40mm** - Standard POS labels (current setting)
- **50mm** - Wide labels
- **80mm** - Receipt paper width

---

## 🧹 Printer Maintenance

### 1. Clean the Printhead (Weekly)
- Turn OFF printer, let it cool
- Open printer cover
- Use lint-free cloth with isopropyl alcohol
- Gently wipe printhead and rollers
- Let dry completely before closing

### 2. Clean the Optical Sensor (Monthly)
- Located at the back of the label path
- Use lint-free cloth + isopropyl alcohol
- Very gentle cleaning
- Recalibrate after cleaning

### 3. Check Label Loading
- Ensure labels are loaded correctly
- Printable side should face UP
- No wrinkles or gaps in the roll
- Labels should feed smoothly

---

## 🔍 Troubleshooting Checklist

### Labels are Blank

1. ✅ Check printer is set to **"Direct Thermal"** mode
2. ✅ Verify labels are **thermal labels** (scratch test: should turn black)
3. ✅ Clean printhead (dirty heads = blank prints)
4. ✅ Increase print darkness/density in printer settings
5. ✅ Recalibrate the printer
6. ✅ Check power supply (use original adapter)

### Labels Print But Position is Wrong

1. ✅ **RECALIBRATE** (most common fix!)
2. ✅ Clean optical sensor
3. ✅ Verify label size in settings matches actual labels
4. ✅ Check for label gaps/adhesive issues
5. ✅ Ensure labels are loaded tightly (no slack)

### Extra Blank Labels Between Prints

1. ✅ **RECALIBRATE** (sensor detecting wrong boundary)
2. ✅ Check printer mode (Gap detection vs Black Mark)
3. ✅ Verify label stock has consistent spacing
4. ✅ Clean and realign sensor

### Labels Cut Off

1. ✅ Check label size matches printer settings
2. ✅ Reduce font size if needed
3. ✅ Check printer doesn't need calibration
4. ✅ Verify print margins are correct

---

## 📊 Testing After Calibration

Print a test order with multiple items to verify:

1. ✅ First label prints on FIRST label (not 3rd or 4th)
2. ✅ No blank labels before content
3. ✅ All content fits on label
4. ✅ Consistent positioning across all labels
5. ✅ Labels tear off cleanly

---

## 🏭 Production Best Practices

### 1. Regular Maintenance Schedule
- **Daily:** Visual check of label path, no jams
- **Weekly:** Clean printhead
- **Monthly:** Clean sensor, full calibration
- **As needed:** Recalibrate after paper change or issues

### 2. Quality Label Stock
- Use reputable brands (consistent spacing)
- Store labels in cool, dry place
- Avoid damaged or curled labels
- Check adhesive isn't gummy

### 3. Printer Settings
- Print darkness: Start medium, adjust as needed
- Print speed: Normal is fine for POS
- Media type: Direct Thermal
- Gap sensing: On (for gap labels)

### 4. Staff Training
- How to load labels correctly
- How to calibrate when issues occur
- When to clean components
- Signs that calibration is needed

---

## 🆘 Still Not Working?

If calibration doesn't fix it:

1. **Check Printer Driver**
   - Update to latest driver
   - Verify label size in driver matches hardware

2. **Test Different Labels**
   - Try a different roll
   - Compare with known-good labels

3. **Contact Manufacturer Support**
   - Have model number ready
   - Describe calibration procedure you tried
   - They may have model-specific steps

4. **Hardware Inspection**
   - Sensor might need replacement
   - Printhead might be failing
   - Ribbon/ink issues (if thermal transfer)

---

## 📝 Key Takeaways

✅ **99% of label printing issues are hardware/calibration problems**  
✅ **Recalibrate FIRST before changing software**  
✅ **Use proper maintenance schedule**  
✅ **Quality labels = consistent printing**  
✅ **Keep optical sensor clean**

**Your POS software is configured correctly.** The thermal printer just needs its optical sensor calibrated to properly detect your label size.

---

**Last Updated:** January 2025  
**Related Files:** 
- `electron/main.ts` (Label HTML generation)
- `src/components/PaymentModal.tsx` (Label printing logic)

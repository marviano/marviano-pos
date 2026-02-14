const fs = require('fs');
const path = require('path');

// To change the app icon: replace public/256x256.png with your image (256x256 recommended), then run: npm run build-icon
const pngPath = path.join(__dirname, '..', 'public', '256x256.png');
const icoPath = path.join(__dirname, '..', 'public', 'pictos.ico');

try {
    const pngData = fs.readFileSync(pngPath);
    const size = pngData.length;

    // ICO Header
    // Reserved (2), Type (2), Count (2)
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // Reserved
    header.writeUInt16LE(1, 2); // Type 1 = ICO
    header.writeUInt16LE(1, 4); // Count = 1 image

    // Icon Directory Entry
    // Width (1), Height (1), ColorCount (1), Reserved (1), Planes (2), BitCount (2), BytesInRes (4), ImageOffset (4)
    const entry = Buffer.alloc(16);
    entry.writeUInt8(0, 0); // Width 0 = 256
    entry.writeUInt8(0, 1); // Height 0 = 256
    entry.writeUInt8(0, 2); // ColorCount 0 = No palette
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Planes
    entry.writeUInt16LE(32, 6); // BitCount
    entry.writeUInt32LE(size, 8); // BytesInRes
    entry.writeUInt32LE(22, 12); // ImageOffset (6 + 16 = 22)

    const icoData = Buffer.concat([header, entry, pngData]);

    fs.writeFileSync(icoPath, icoData);
    console.log(`Successfully created ${icoPath} from ${pngPath}`);
} catch (error) {
    console.error('Error converting PNG to ICO:', error);
    process.exit(1);
}

const fs = require('fs');
const path = require('path');

/**
 * Fixes asset paths in nested HTML files by adding a <base> tag.
 * This is needed for Next.js static export with Electron file:// protocol.
 */
function fixNestedHtmlPaths() {
  const outDir = path.join(__dirname, '..', 'out');
  
  if (!fs.existsSync(outDir)) {
    console.log('out directory not found, skipping HTML path fix');
    return;
  }

  // Find all HTML files in nested directories (not root)
  function findNestedHtmlFiles(dir, relativePath = '') {
    const files = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativeFilePath = path.join(relativePath, entry.name);

      if (entry.isDirectory() && entry.name !== '_next' && entry.name !== 'images' && entry.name !== 'data' && entry.name !== 'logo') {
        // Recursively search in subdirectories
        files.push(...findNestedHtmlFiles(fullPath, relativeFilePath));
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        // Only process HTML files that are in nested directories
        if (relativePath) {
          // Include the filename in the relative path for depth calculation
          const relativeFilePath = path.join(relativePath, entry.name);
          files.push({ fullPath, relativePath: relativeFilePath });
        }
      }
    }

    return files;
  }

  const nestedHtmlFiles = findNestedHtmlFiles(outDir);

  if (nestedHtmlFiles.length === 0) {
    console.log('No nested HTML files found to fix');
    return;
  }

  console.log(`Found ${nestedHtmlFiles.length} nested HTML file(s) to fix`);

  for (const { fullPath, relativePath } of nestedHtmlFiles) {
    // Calculate depth (number of directories deep)
    // relativePath is like "logs/printing.html", so we need to count directories only
    const pathParts = relativePath.split(path.sep);
    const directories = pathParts.slice(0, -1); // Remove the filename
    const depth = directories.length;
    const baseHref = depth > 0 ? '../'.repeat(depth) : './';

    let content = fs.readFileSync(fullPath, 'utf8');

    // Check if <base> tag already exists and fix it if needed
    const baseTagRegex = /<base[^>]*>/i;
    const existingBaseMatch = content.match(baseTagRegex);
    
    if (existingBaseMatch) {
      // Check if the href is correct
      const existingBase = existingBaseMatch[0];
      const hrefMatch = existingBase.match(/href=["']([^"']*)["']/i);
      const existingHref = hrefMatch ? hrefMatch[1] : '';
      
      if (existingHref === baseHref) {
        console.log(`✓ ${relativePath} already has correct base href="${baseHref}"`);
        continue;
      }
      
      // Update existing base tag
      const newBaseTag = `<base href="${baseHref}">`;
      content = content.replace(baseTagRegex, newBaseTag);
      console.log(`✓ Updated ${relativePath} base href from "${existingHref}" to "${baseHref}"`);
    } else {
      // Add <base> tag right after <head> tag
      const headMatch = content.match(/<head[^>]*>/i);
      if (headMatch) {
        const headTag = headMatch[0];
        const baseTag = `<base href="${baseHref}">\n`;
        
        // Insert base tag after head tag
        content = content.replace(headTag, headTag + baseTag);
        console.log(`✓ Added base tag to ${relativePath} with href="${baseHref}"`);
      } else {
        console.warn(`⚠ Could not find <head> tag in ${relativePath}`);
        continue;
      }
    }
    
    fs.writeFileSync(fullPath, content, 'utf8');
  }

  console.log('✓ Finished fixing nested HTML paths');
}

// Run the fix
try {
  fixNestedHtmlPaths();
} catch (error) {
  console.error('Error fixing nested HTML paths:', error);
  process.exit(1);
}


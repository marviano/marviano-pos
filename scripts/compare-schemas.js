const Database = require('better-sqlite3');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Schema Comparison Script
 * 
 * Compares SQLite local database schema with Salespulse MySQL schema.
 * 
 * Requirements:
 * - SQLite can have fewer tables than MySQL (OK)
 * - For tables that exist in both, CREATE TABLE statements must be identical
 */

// Normalize SQL statements for comparison
function normalizeSQL(sql) {
  if (!sql) return '';
  
  return sql
    .replace(/\s+/g, ' ')           // Replace multiple spaces with single space
    .replace(/,\s+/g, ', ')         // Normalize comma spacing
    .replace(/\s*\(\s*/g, ' (')     // Normalize opening parens
    .replace(/\s*\)\s*/g, ') ')     // Normalize closing parens
    .replace(/\s*,\s*/g, ', ')      // Normalize commas
    .trim()
    .toLowerCase();
}

// Extract table name from CREATE TABLE statement
function extractTableName(createStatement) {
  const match = createStatement.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:`?(\w+)`?|(\w+))/i);
  return match ? (match[1] || match[2]) : null;
}

// Convert SQLite type to normalized form for comparison
function normalizeSQLiteType(type) {
  const upper = type.toUpperCase();
  // SQLite type mappings
  if (upper.includes('INT')) return 'INTEGER';
  if (upper.includes('REAL') || upper.includes('FLOAT') || upper.includes('DOUBLE')) return 'REAL';
  if (upper.includes('TEXT') || upper.includes('CHAR') || upper.includes('CLOB')) return 'TEXT';
  if (upper.includes('BLOB')) return 'BLOB';
  return type;
}

// Convert MySQL type to normalized form for comparison
function normalizeMySQLType(type) {
  const upper = type.toUpperCase();
  // MySQL type mappings
  if (upper.includes('INT')) return 'INTEGER';
  if (upper.includes('DECIMAL') || upper.includes('FLOAT') || upper.includes('DOUBLE')) return 'REAL';
  if (upper.includes('VARCHAR') || upper.includes('CHAR') || upper.includes('TEXT')) return 'TEXT';
  if (upper.includes('DATETIME') || upper.includes('TIMESTAMP') || upper.includes('DATE')) return 'TEXT';
  if (upper.includes('ENUM')) return 'TEXT';
  return type;
}

// Extract columns from CREATE TABLE statement (simplified parser)
function extractColumns(createStatement) {
  const columns = [];
  
  // Extract the column definitions part (between first ( and matching closing )
  // Handle nested parentheses properly
  let startIdx = createStatement.indexOf('(');
  if (startIdx === -1) return columns;
  
  let depth = 0;
  let endIdx = startIdx;
  for (let i = startIdx; i < createStatement.length; i++) {
    if (createStatement[i] === '(') depth++;
    else if (createStatement[i] === ')') {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  
  const columnDefs = createStatement.substring(startIdx + 1, endIdx);
  
  // Split by comma, but be careful of nested parentheses and strings
  depth = 0;
  let inString = false;
  let stringChar = null;
  let current = '';
  const parts = [];
  
  for (let i = 0; i < columnDefs.length; i++) {
    const char = columnDefs[i];
    const nextChar = i < columnDefs.length - 1 ? columnDefs[i + 1] : null;
    
    // Handle string literals
    if ((char === '"' || char === "'" || char === '`') && !inString) {
      inString = true;
      stringChar = char;
      current += char;
    } else if (char === stringChar && inString) {
      // Check if escaped
      if (columnDefs[i - 1] !== '\\') {
        inString = false;
        stringChar = null;
      }
      current += char;
    } else if (char === '(' && !inString) {
      depth++;
      current += char;
    } else if (char === ')' && !inString) {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0 && !inString) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    
    // Skip table-level constraints
    const upper = trimmed.toUpperCase();
    if (upper.startsWith('PRIMARY KEY') || upper.startsWith('FOREIGN KEY') || 
        upper.startsWith('UNIQUE KEY') || upper.startsWith('UNIQUE INDEX') ||
        upper.startsWith('KEY ') || upper.startsWith('INDEX ') || 
        upper.startsWith('CHECK ') || upper.startsWith('CONSTRAINT ')) {
      continue;
    }
    
    // Extract column name (first identifier, may be backticked)
    const colMatch = trimmed.match(/^`?([^`\s]+)`?/);
    if (colMatch) {
      const colName = colMatch[1];
      
      // Extract type
      const typeMatch = trimmed.match(/`?[^`\s]+`?\s+([A-Za-z]+(?:\([^)]+\))?)/i);
      const colType = typeMatch ? typeMatch[1] : 'TEXT';
      
      // Check for NOT NULL
      const hasNotNull = /\bNOT\s+NULL\b/i.test(trimmed);
      
      // Check for PRIMARY KEY
      const hasPrimaryKey = /\bPRIMARY\s+KEY\b/i.test(trimmed);
      
      // Extract DEFAULT value
      const defaultMatch = trimmed.match(/\bDEFAULT\s+([^,\s]+)/i);
      const defaultValue = defaultMatch ? defaultMatch[1] : null;
      
      columns.push({
        name: colName,
        type: normalizeMySQLType(colType),
        notNull: hasNotNull,
        primaryKey: hasPrimaryKey,
        defaultValue: defaultValue,
        definition: trimmed
      });
    }
  }
  
  return columns;
}

// Get SQLite schema from database file
async function getSQLiteSchema(dbPath) {
  console.log(`📂 Reading SQLite database from: ${dbPath}`);
  
  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite database file not found: ${dbPath}`);
  }
  
  const db = new Database(dbPath, { readonly: true });
  const tables = {};
  
  try {
    // Get all table names
    const tableNames = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all();
    
    for (const row of tableNames) {
      const tableName = row.name;
      
      // Get table info
      const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
      
      // Build CREATE TABLE statement
      let createSQL = `CREATE TABLE ${tableName} (`;
      const colDefs = [];
      const constraints = [];
      
      for (const col of columns) {
        let colDef = `${col.name} `;
        
        // Type
        colDef += normalizeSQLiteType(col.type || 'TEXT');
        
        // Primary key
        if (col.pk) {
          if (col.pk === 1) {
            colDef += ' PRIMARY KEY';
          }
        }
        
        // NOT NULL
        if (col.notnull) {
          colDef += ' NOT NULL';
        }
        
        // Default value
        if (col.dflt_value !== null) {
          colDef += ` DEFAULT ${col.dflt_value}`;
        }
        
        colDefs.push(colDef);
      }
      
      createSQL += colDefs.join(', ');
      createSQL += ')';
      
      tables[tableName] = {
        name: tableName,
        createStatement: createSQL,
        columns: columns.map(c => ({
          name: c.name,
          type: normalizeSQLiteType(c.type || 'TEXT'),
          notNull: !!c.notnull,
          defaultValue: c.dflt_value,
          primaryKey: !!c.pk
        }))
      };
    }
  } finally {
    db.close();
  }
  
  return tables;
}

// Parse MySQL CREATE TABLE statements from text
function parseMySQLSchema(schemaText) {
  const tables = {};
  
  // More robust regex to handle multi-line CREATE TABLE statements
  // This handles statements that may span multiple lines with ENGINE, CHARSET, etc.
  const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`?(\w+)`?|(\w+))\s*\([\s\S]*?\)[\s\S]*?;/gi;
  let match;
  
  while ((match = createTableRegex.exec(schemaText)) !== null) {
    const tableName = match[1] || match[2];
    let fullStatement = match[0];
    
    // Clean up the statement - remove trailing ENGINE, CHARSET, etc. for comparison
    // But keep the column definitions intact
    const cleanedStatement = fullStatement.replace(/\)\s*ENGINE[^;]*/i, ')');
    
    tables[tableName] = {
      name: tableName,
      createStatement: cleanedStatement,
      originalStatement: fullStatement,
      columns: extractColumns(cleanedStatement)
    };
  }
  
  return tables;
}

// Compare two schemas
function compareSchemas(sqliteSchema, mysqlSchema) {
  const results = {
    sqliteOnly: [],
    mysqlOnly: [],
    matching: [],
    differences: []
  };
  
  const sqliteTables = Object.keys(sqliteSchema);
  const mysqlTables = Object.keys(mysqlSchema);
  
  // Find tables only in SQLite
  for (const tableName of sqliteTables) {
    if (!mysqlSchema[tableName]) {
      results.sqliteOnly.push(tableName);
    }
  }
  
  // Find tables only in MySQL
  for (const tableName of mysqlTables) {
    if (!sqliteSchema[tableName]) {
      results.mysqlOnly.push(tableName);
    }
  }
  
  // Compare tables that exist in both
  for (const tableName of sqliteTables) {
    if (mysqlSchema[tableName]) {
      const sqliteTable = sqliteSchema[tableName];
      const mysqlTable = mysqlSchema[tableName];
      
      // Compare CREATE statements (normalized)
      const sqliteNormalized = normalizeSQL(sqliteTable.createStatement);
      const mysqlNormalized = normalizeSQL(mysqlTable.createStatement);
      
      if (sqliteNormalized === mysqlNormalized) {
        results.matching.push(tableName);
      } else {
        // Detailed comparison
        const diff = {
          tableName,
          sqliteColumns: sqliteTable.columns,
          mysqlColumns: mysqlTable.columns,
          sqliteStatement: sqliteTable.createStatement,
          mysqlStatement: mysqlTable.createStatement
        };
        
        // Compare columns
        const sqliteColNames = new Set(sqliteTable.columns.map(c => c.name));
        const mysqlColNames = new Set(mysqlTable.columns.map(c => c.name));
        
        diff.missingInSQLite = mysqlTable.columns.filter(c => !sqliteColNames.has(c.name));
        diff.missingInMySQL = sqliteTable.columns.filter(c => !mysqlColNames.has(c.name));
        diff.differentColumns = [];
        
        for (const sqliteCol of sqliteTable.columns) {
          const mysqlCol = mysqlTable.columns.find(c => c.name === sqliteCol.name);
          if (mysqlCol) {
            // Compare types and constraints
            if (sqliteCol.type !== mysqlCol.type || 
                sqliteCol.notNull !== mysqlCol.notNull ||
                sqliteCol.primaryKey !== mysqlCol.primaryKey) {
              diff.differentColumns.push({
                column: sqliteCol.name,
                sqlite: sqliteCol,
                mysql: mysqlCol
              });
            }
          }
        }
        
        results.differences.push(diff);
      }
    }
  }
  
  return results;
}

// Main function
async function main() {
  console.log('🔍 Schema Comparison Tool\n');
  console.log('Comparing SQLite (marviano-pos) with MySQL (Salespulse)\n');
  
  // Determine SQLite database path
  const dbPath = process.env.SQLITE_DB_PATH || 
    path.join(os.homedir(), 'AppData', 'Roaming', 'marviano-pos', 'pos-offline.db');
  
  let mysqlSchema = {};
  
  // Check if MySQL schema file is provided
  const schemaFile = process.argv[2];
  if (schemaFile && fs.existsSync(schemaFile)) {
    console.log(`📄 Reading MySQL schema from file: ${schemaFile}`);
    const schemaText = fs.readFileSync(schemaFile, 'utf8');
    mysqlSchema = parseMySQLSchema(schemaText);
    console.log(`✅ Found ${Object.keys(mysqlSchema).length} tables in MySQL schema file\n`);
  } else if (process.env.MYSQL_HOST && process.env.MYSQL_DATABASE) {
    // Connect to MySQL and extract schema
    console.log('🔌 Connecting to MySQL database...');
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE,
      port: parseInt(process.env.MYSQL_PORT || '3306')
    });
    
    const [tables] = await connection.query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME
    `, [process.env.MYSQL_DATABASE]);
    
    for (const table of tables) {
      const [createResult] = await connection.query(`SHOW CREATE TABLE \`${table.TABLE_NAME}\``);
      const createStatement = createResult[0]['Create Table'];
      mysqlSchema[table.TABLE_NAME] = {
        name: table.TABLE_NAME,
        createStatement: createStatement,
        columns: extractColumns(createStatement)
      };
    }
    
    await connection.end();
    console.log(`✅ Found ${Object.keys(mysqlSchema).length} tables in MySQL database\n`);
  } else {
    console.error('❌ Error: Please provide either:');
    console.error('   1. A MySQL schema file as first argument: node compare-schemas.js schema.sql');
    console.error('   2. MySQL connection environment variables: MYSQL_HOST, MYSQL_DATABASE, etc.');
    process.exit(1);
  }
  
  // Get SQLite schema
  const sqliteSchema = await getSQLiteSchema(dbPath);
  console.log(`✅ Found ${Object.keys(sqliteSchema).length} tables in SQLite database\n`);
  
  // Compare schemas
  console.log('🔍 Comparing schemas...\n');
  const comparison = compareSchemas(sqliteSchema, mysqlSchema);
  
  // Print results
  console.log('='.repeat(80));
  console.log('COMPARISON RESULTS');
  console.log('='.repeat(80));
  console.log();
  
  console.log(`✅ Matching tables (${comparison.matching.length}):`);
  if (comparison.matching.length > 0) {
    comparison.matching.forEach(name => console.log(`   ✓ ${name}`));
  } else {
    console.log('   (none)');
  }
  console.log();
  
  console.log(`📋 Tables only in SQLite (${comparison.sqliteOnly.length}):`);
  if (comparison.sqliteOnly.length > 0) {
    comparison.sqliteOnly.forEach(name => console.log(`   + ${name}`));
  } else {
    console.log('   (none)');
  }
  console.log();
  
  console.log(`📋 Tables only in MySQL (${comparison.mysqlOnly.length}):`);
  if (comparison.mysqlOnly.length > 0) {
    comparison.mysqlOnly.forEach(name => console.log(`   - ${name}`));
  } else {
    console.log('   (none)');
  }
  console.log();
  
  console.log(`⚠️  Tables with differences (${comparison.differences.length}):`);
  if (comparison.differences.length > 0) {
    for (const diff of comparison.differences) {
      console.log(`\n   Table: ${diff.tableName}`);
      
      if (diff.missingInSQLite.length > 0) {
        console.log(`   ❌ Missing columns in SQLite:`);
        diff.missingInSQLite.forEach(col => {
          console.log(`      - ${col.name}`);
        });
      }
      
      if (diff.missingInMySQL.length > 0) {
        console.log(`   ❌ Missing columns in MySQL:`);
        diff.missingInMySQL.forEach(col => {
          console.log(`      - ${col.name}`);
        });
      }
      
      if (diff.differentColumns.length > 0) {
        console.log(`   ⚠️  Different column definitions:`);
        diff.differentColumns.forEach(({ column, sqlite, mysql }) => {
          console.log(`      Column: ${column}`);
          console.log(`        SQLite: ${sqlite.type}${sqlite.notNull ? ' NOT NULL' : ''}${sqlite.primaryKey ? ' PRIMARY KEY' : ''}`);
          console.log(`        MySQL:  ${mysql.type}${mysql.notNull ? ' NOT NULL' : ''}${mysql.primaryKey ? ' PRIMARY KEY' : ''}`);
        });
      }
      
      console.log(`\n   SQLite CREATE TABLE:`);
      console.log(`   ${diff.sqliteStatement.split('\n').join('\n   ')}`);
      console.log(`\n   MySQL CREATE TABLE:`);
      console.log(`   ${diff.mysqlStatement.split('\n').join('\n   ')}`);
    }
  } else {
    console.log('   (none - all matching tables are identical!)');
  }
  console.log();
  
  // Summary
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  const totalCommon = comparison.matching.length + comparison.differences.length;
  const matchPercentage = totalCommon > 0 
    ? ((comparison.matching.length / totalCommon) * 100).toFixed(1)
    : 0;
  
  console.log(`Total SQLite tables: ${Object.keys(sqliteSchema).length}`);
  console.log(`Total MySQL tables: ${Object.keys(mysqlSchema).length}`);
  console.log(`Common tables: ${totalCommon}`);
  console.log(`Matching tables: ${comparison.matching.length} (${matchPercentage}%)`);
  console.log(`Tables with differences: ${comparison.differences.length}`);
  console.log();
  
  if (comparison.differences.length === 0 && comparison.mysqlOnly.length >= 0) {
    console.log('✅ SUCCESS: All common tables match perfectly!');
    console.log('   (SQLite can have fewer tables, which is acceptable)');
  } else if (comparison.differences.length > 0) {
    console.log('❌ FAILURE: Some common tables have differences');
    process.exit(1);
  }
}

// Run
main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});

const { pool } = require('../config/db');
const fs = require('fs');
const path = require('path');

async function initDatabase() {
  const client = await pool.connect();
  try {
    console.log('🔄 Initializing database...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schema);
    console.log('✅ Database initialized successfully');
  } catch (err) {
    console.error('❌ Database initialization error:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

initDatabase();
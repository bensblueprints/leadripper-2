const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:JEsus777$$!!!!@@db.eyaitfxwjhsrizsbqcem.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function testConnection() {
  try {
    console.log('Testing new Supabase connection...\n');

    const result = await pool.query('SELECT NOW()');
    console.log('✅ CONNECTION SUCCESSFUL!');
    console.log('Server time:', result.rows[0].now);

    // Test creating a simple table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS test_table (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100)
      )
    `);
    console.log('✅ Table creation works!');

    await pool.query(`DROP TABLE IF EXISTS test_table`);
    console.log('✅ Database is fully functional!\n');

    await pool.end();

    console.log('New Supabase database is ready. Proceeding to create LeadRipper tables...');

  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    console.log('\nTroubleshooting:');
    console.log('1. Check if password has special characters that need escaping');
    console.log('2. Verify the project URL is correct');
    console.log('3. Check if database is paused in Supabase dashboard');
  }
}

testConnection();

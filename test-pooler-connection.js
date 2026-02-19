const { Pool } = require('pg');

// Test the exact connection string from Netlify env
const connectionString = 'postgresql://postgres.eyaitfxwjhsrizsbqcem:JEsus777%24%24!!!!%40@aws-0-us-east-1.pooler.supabase.com:6543/postgres';

console.log('Testing pooler connection...');
console.log('Connection string:', connectionString);
console.log('');

const pool = new Pool({
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false }
});

async function testConnection() {
  try {
    console.log('Attempting connection...');
    const client = await pool.connect();

    console.log('✅ CONNECTED!');

    const result = await client.query('SELECT NOW(), current_database(), current_user');
    console.log('Database:', result.rows[0].current_database);
    console.log('User:', result.rows[0].current_user);
    console.log('Time:', result.rows[0].now);

    // Test if lr_users table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'lr_users'
      );
    `);

    console.log('\nlr_users table exists:', tableCheck.rows[0].exists);

    if (tableCheck.rows[0].exists) {
      const countResult = await client.query('SELECT COUNT(*) FROM lr_users');
      console.log('Users in database:', countResult.rows[0].count);
    }

    client.release();
    await pool.end();

    console.log('\n✅ Connection test SUCCESSFUL!');
    console.log('The DATABASE_URL is working correctly.');

  } catch (error) {
    console.error('\n❌ CONNECTION FAILED');
    console.error('Error:', error.message);
    console.error('Code:', error.code);
    console.error('\nThis is the same error the Netlify function is getting.');

    if (error.message.includes('Tenant or user not found')) {
      console.log('\n🔍 Troubleshooting:');
      console.log('1. Password might have special characters causing parsing issues');
      console.log('2. The pooler username format might be incorrect');
      console.log('3. Database might need to be unpaused in Supabase dashboard');
    }
  }
}

testConnection();

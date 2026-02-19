const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres.afnikqescveajfempelv:0QBMgYyI351GmM3v@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
  ssl: true
});

async function setupDatabase() {
  try {
    console.log('Connecting to Supabase...');

    // Create lr_users table
    console.log('\nCreating lr_users table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name VARCHAR(255) NOT NULL,
        company VARCHAR(255),
        plan VARCHAR(50) DEFAULT 'free',
        leads_limit INTEGER DEFAULT 50,
        leads_used INTEGER DEFAULT 0,
        trial_ends_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✓ lr_users table ready');

    // Create lr_user_settings table
    console.log('\nCreating lr_user_settings table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_user_settings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES lr_users(id) ON DELETE CASCADE,
        ghl_location_id VARCHAR(255),
        ghl_api_key TEXT,
        ghl_pipeline_id VARCHAR(255),
        auto_sync_enabled BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id)
      )
    `);
    console.log('✓ lr_user_settings table ready');

    // Create lr_subscriptions table
    console.log('\nCreating lr_subscriptions table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES lr_users(id) ON DELETE CASCADE,
        plan VARCHAR(50) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        payment_intent_id VARCHAR(255),
        airwallex_subscription_id VARCHAR(255),
        airwallex_customer_id VARCHAR(255),
        billing_cycle VARCHAR(50) DEFAULT 'monthly',
        is_trial BOOLEAN DEFAULT false,
        trial_ends_at TIMESTAMP,
        current_period_start TIMESTAMP,
        current_period_end TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id)
      )
    `);
    console.log('✓ lr_subscriptions table ready');

    // Create indexes
    console.log('\nCreating indexes...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON lr_users(email);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON lr_subscriptions(user_id);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_airwallex ON lr_subscriptions(airwallex_subscription_id);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_intent ON lr_subscriptions(payment_intent_id);
    `);
    console.log('✓ Indexes created');

    // Create lr_leads table
    console.log('\nCreating lr_leads table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_leads (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES lr_users(id) ON DELETE CASCADE,
        business_name VARCHAR(255),
        email VARCHAR(255),
        phone VARCHAR(50),
        address TEXT,
        city VARCHAR(100),
        state VARCHAR(50),
        zip VARCHAR(20),
        website VARCHAR(255),
        category VARCHAR(100),
        rating DECIMAL(2, 1),
        reviews_count INTEGER,
        scraped_at TIMESTAMP DEFAULT NOW(),
        synced_to_ghl BOOLEAN DEFAULT false,
        ghl_contact_id VARCHAR(255)
      )
    `);
    console.log('✓ lr_leads table ready');

    // Create lr_pending_payments table
    console.log('\nCreating lr_pending_payments table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_pending_payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES lr_users(id) ON DELETE CASCADE,
        payment_intent_id VARCHAR(255) UNIQUE NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        currency VARCHAR(10) DEFAULT 'USD',
        status VARCHAR(50) DEFAULT 'pending',
        plan VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      )
    `);
    console.log('✓ lr_pending_payments table ready');

    console.log('\n✅ Supabase database setup complete!');

    // Test query
    const result = await pool.query('SELECT COUNT(*) FROM lr_users');
    console.log(`\nTotal users: ${result.rows[0].count}`);

    await pool.end();

  } catch (error) {
    console.error('Database setup error:', error.message);
    process.exit(1);
  }
}

setupDatabase();

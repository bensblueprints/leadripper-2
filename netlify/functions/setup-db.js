const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const results = [];

  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        company VARCHAR(255),
        plan VARCHAR(50) DEFAULT 'free',
        leads_used INTEGER DEFAULT 0,
        leads_limit INTEGER DEFAULT 50,
        trial_ends_at TIMESTAMP,
        is_admin BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    results.push('✅ Created lr_users table');

    // Create subscriptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE,
        payment_intent_id VARCHAR(255),
        plan VARCHAR(50) DEFAULT 'free',
        status VARCHAR(50) DEFAULT 'active',
        billing_cycle VARCHAR(20),
        is_trial BOOLEAN DEFAULT false,
        trial_ends_at TIMESTAMP,
        current_period_end TIMESTAMP,
        airwallex_subscription_id VARCHAR(255),
        airwallex_customer_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    results.push('✅ Created lr_subscriptions table');

    // Create indexes for Airwallex columns
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_lr_subscriptions_airwallex_sub ON lr_subscriptions(airwallex_subscription_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_lr_subscriptions_airwallex_customer ON lr_subscriptions(airwallex_customer_id)
    `);
    results.push('✅ Created Airwallex indexes');

    // Create leads table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_leads (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        business_name VARCHAR(255),
        phone VARCHAR(50),
        email VARCHAR(255),
        address TEXT,
        city VARCHAR(100),
        state VARCHAR(50),
        industry VARCHAR(100),
        website VARCHAR(255),
        rating DECIMAL(2,1),
        reviews INTEGER,
        ghl_synced BOOLEAN DEFAULT false,
        ghl_contact_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    results.push('✅ Created lr_leads table');

    // Create scraped cities tracking
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_scraped_cities (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        city VARCHAR(255) NOT NULL,
        industry VARCHAR(100) NOT NULL,
        lead_count INTEGER DEFAULT 0,
        scraped_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, city, industry)
      )
    `);
    results.push('✅ Created lr_scraped_cities table');

    // Create user settings table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_user_settings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE,
        ghl_api_key VARCHAR(255),
        ghl_location_id VARCHAR(255),
        ghl_auto_sync BOOLEAN DEFAULT false,
        ghl_pipeline_id VARCHAR(255),
        ghl_stage_id VARCHAR(255),
        ghl_industry_pipelines TEXT,
        webhook_url VARCHAR(500),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    results.push('✅ Created lr_user_settings table');

    // Create coupons table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_coupons (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        discount_type VARCHAR(20) NOT NULL,
        discount_value DECIMAL(10,2) NOT NULL,
        max_uses INTEGER,
        uses INTEGER DEFAULT 0,
        active BOOLEAN DEFAULT true,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    results.push('✅ Created lr_coupons table');

    // Set admin user
    await pool.query(`
      UPDATE lr_users SET is_admin = true WHERE email = 'ben@justfeatured.com'
    `).catch(() => {});
    results.push('✅ Set admin user');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'LeadRipper database initialized successfully',
        results
      })
    };
  } catch (error) {
    console.error('Database setup error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Database setup failed',
        message: error.message
      })
    };
  }
};

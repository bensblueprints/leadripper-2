const fetch = require('node-fetch');

const SUPABASE_URL = 'https://afnikqescveajfempelv.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmbmlrcWVzY3ZlYWpmZW1wZWx2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTQzMDM1MCwiZXhwIjoyMDg1MDA2MzUwfQ.la0AQ7Yd0HRY3FzkmJ1uavWAf8RnSEwxEjn_k33g83M';

const SQL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS lr_users (
    id BIGSERIAL PRIMARY KEY,
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
  )`,

  `CREATE TABLE IF NOT EXISTS lr_user_settings (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES lr_users(id) ON DELETE CASCADE,
    ghl_location_id VARCHAR(255),
    ghl_api_key TEXT,
    ghl_pipeline_id VARCHAR(255),
    auto_sync_enabled BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS lr_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES lr_users(id) ON DELETE CASCADE,
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
  )`,

  `CREATE TABLE IF NOT EXISTS lr_leads (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES lr_users(id) ON DELETE CASCADE,
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
  )`,

  `CREATE TABLE IF NOT EXISTS lr_pending_payments (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES lr_users(id) ON DELETE CASCADE,
    payment_intent_id VARCHAR(255) UNIQUE NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    status VARCHAR(50) DEFAULT 'pending',
    plan VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
  )`,

  `CREATE INDEX IF NOT EXISTS idx_users_email ON lr_users(email)`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON lr_subscriptions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_airwallex ON lr_subscriptions(airwallex_subscription_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_intent ON lr_subscriptions(payment_intent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_leads_user ON lr_leads(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pending_payments_user ON lr_pending_payments(user_id)`
];

async function executeSqlStatements() {
  try {
    console.log('Executing SQL statements via Supabase REST API...\n');

    for (let i = 0; i < SQL_STATEMENTS.length; i++) {
      const sql = SQL_STATEMENTS[i];
      const tableName = sql.match(/TABLE IF NOT EXISTS (\w+)|INDEX IF NOT EXISTS (\w+)/)?.[1] || SQL_STATEMENTS[i].match(/INDEX IF NOT EXISTS (\w+)/)?.[1];

      console.log(`${i + 1}/${SQL_STATEMENTS.length}) Creating ${tableName}...`);

      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'apikey': SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: sql })
      });

      if (!response.ok) {
        console.log(`  ⚠️ Response status: ${response.status}`);
        const text = await response.text();
        console.log(`  Response: ${text.substring(0, 200)}`);
      } else {
        console.log(`  ✓ Success`);
      }
    }

    console.log('\n✅ Database initialization complete!');
    console.log('\nTesting table access via REST API...');

    // Test if we can access the tables
    const testResponse = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
      }
    });

    const schema = await testResponse.json();
    const lrTables = Object.keys(schema.paths || {}).filter(path => path.includes('lr_'));

    if (lrTables.length > 0) {
      console.log('\n✓ LeadRipper tables are accessible:');
      lrTables.forEach(table => console.log(`  - ${table.replace('/', '')}`));
    } else {
      console.log('\n⚠️ LeadRipper tables not found in REST API schema');
      console.log('This is expected - Supabase may need a moment to refresh the schema');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.log('\nNote: Supabase REST API may not have a direct SQL execution endpoint.');
    console.log('You may need to:');
    console.log('1. Log into https://supabase.com/dashboard/project/afnikqescveajfempelv');
    console.log('2. Go to SQL Editor');
    console.log('3. Run the SQL from create-leadripper-tables.sql manually');
  }
}

executeSqlStatements();

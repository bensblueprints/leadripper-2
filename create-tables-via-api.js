const fetch = require('node-fetch');

const ACCESS_TOKEN = 'sbp_229a0b62932457fc813653bae94a7382eb1851e9';
const PROJECT_REF = 'eyaitfxwjhsrizsbqcem';

const SQL = `
CREATE TABLE IF NOT EXISTS lr_users (
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
);

CREATE TABLE IF NOT EXISTS lr_user_settings (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES lr_users(id) ON DELETE CASCADE,
  ghl_location_id VARCHAR(255),
  ghl_api_key TEXT,
  ghl_pipeline_id VARCHAR(255),
  auto_sync_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS lr_subscriptions (
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
);

CREATE TABLE IF NOT EXISTS lr_leads (
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
);

CREATE TABLE IF NOT EXISTS lr_pending_payments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES lr_users(id) ON DELETE CASCADE,
  payment_intent_id VARCHAR(255) UNIQUE NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'USD',
  status VARCHAR(50) DEFAULT 'pending',
  plan VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON lr_users(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON lr_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_airwallex ON lr_subscriptions(airwallex_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_intent ON lr_subscriptions(payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_leads_user ON lr_leads(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_payments_user ON lr_pending_payments(user_id);
`;

async function createTables() {
  try {
    console.log('Creating LeadRipper tables via Supabase Management API...\n');

    const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: SQL })
    });

    console.log('Response status:', response.status);
    const result = await response.text();
    console.log('Response:', result);

    if (response.ok) {
      console.log('\n✅ LeadRipper tables created successfully!');
      console.log('\nNow testing database connection...');
    } else {
      console.log('\n❌ Failed to create tables');
      console.log('Trying alternative approach...');
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

createTables();

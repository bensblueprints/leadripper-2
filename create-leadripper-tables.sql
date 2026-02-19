-- LeadRipper Database Schema for Supabase

-- Users table
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

-- User settings table
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

-- Subscriptions table
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

-- Leads table
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

-- Pending payments table
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

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON lr_users(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON lr_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_airwallex ON lr_subscriptions(airwallex_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_intent ON lr_subscriptions(payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_leads_user ON lr_leads(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_payments_user ON lr_pending_payments(user_id);

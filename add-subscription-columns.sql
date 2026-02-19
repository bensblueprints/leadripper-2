-- Add Airwallex subscription tracking columns
ALTER TABLE lr_subscriptions ADD COLUMN IF NOT EXISTS airwallex_subscription_id VARCHAR(255);
ALTER TABLE lr_subscriptions ADD COLUMN IF NOT EXISTS airwallex_customer_id VARCHAR(255);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_lr_subscriptions_airwallex_sub ON lr_subscriptions(airwallex_subscription_id);
CREATE INDEX IF NOT EXISTS idx_lr_subscriptions_airwallex_customer ON lr_subscriptions(airwallex_customer_id);

-- Verify columns were added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'lr_subscriptions'
ORDER BY ordinal_position;

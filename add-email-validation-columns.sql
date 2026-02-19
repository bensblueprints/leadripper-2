-- Add email validation columns to lr_leads table
ALTER TABLE lr_leads
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS email_score INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS email_warnings TEXT,
ADD COLUMN IF NOT EXISTS email_validation_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS is_disposable BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_role_based BOOLEAN DEFAULT FALSE;

-- Add index for filtering validated emails
CREATE INDEX IF NOT EXISTS idx_leads_email_verified ON lr_leads(email_verified);
CREATE INDEX IF NOT EXISTS idx_leads_email_score ON lr_leads(email_score);

-- Add comment
COMMENT ON COLUMN lr_leads.email_verified IS 'Whether email passed validation (score >= 60)';
COMMENT ON COLUMN lr_leads.email_score IS 'Validation confidence score 0-100';
COMMENT ON COLUMN lr_leads.email_warnings IS 'Validation warnings (disposable, role-based, etc)';
COMMENT ON COLUMN lr_leads.is_disposable IS 'Email is from disposable/temp email service';
COMMENT ON COLUMN lr_leads.is_role_based IS 'Email is role-based (info@, admin@, etc)';

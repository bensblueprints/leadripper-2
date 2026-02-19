-- Update ben@justfeatured.com to enterprise plan with unlimited leads
UPDATE lr_users
SET plan = 'enterprise',
    leads_limit = -1,
    updated_at = NOW()
WHERE email = 'ben@justfeatured.com';

SELECT id, email, plan, leads_limit, leads_used FROM lr_users WHERE email = 'ben@justfeatured.com';

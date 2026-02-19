const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

async function createTeamAccounts(teamMembers) {
  const results = [];

  for (const member of teamMembers) {
    const tempPassword = `LeadRipper${Math.random().toString(36).substring(2, 10)}!`;
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    try {
      // Create user
      const userResult = await pool.query(`
        INSERT INTO lr_users (email, password_hash, name, company, plan, leads_limit, is_admin, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (email)
        DO UPDATE SET
          plan = $5,
          leads_limit = $6,
          is_admin = $7,
          updated_at = NOW()
        RETURNING id, email, name
      `, [member.email.toLowerCase(), passwordHash, member.name, 'Advanced Marketing', 'unlimited', -1, true]);

      const userId = userResult.rows[0].id;

      // Create user settings
      await pool.query(`
        INSERT INTO lr_user_settings (user_id, created_at)
        VALUES ($1, NOW())
        ON CONFLICT (user_id) DO NOTHING
      `, [userId]);

      // Create active subscription
      await pool.query(`
        INSERT INTO lr_subscriptions (user_id, plan, status, is_trial, created_at)
        VALUES ($1, $2, 'active', false, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          plan = $2,
          status = 'active',
          updated_at = NOW()
      `, [userId, 'unlimited']);

      results.push({
        name: member.name,
        email: member.email,
        tempPassword: tempPassword,
        userId: userId
      });

      console.log(`✅ Created account for ${member.name} (${member.email})`);
    } catch (error) {
      console.error(`❌ Failed to create account for ${member.email}:`, error.message);
      console.error('Full error:', error);
    }
  }

  return results;
}

// ClickUp team members
const teamMembers = [
  { name: 'Benjamin Boyce', email: 'ben@advancedmarketing.co' },
  { name: 'Prathamesh Mali', email: 'pratham@advancedmarketing.co' },
  { name: 'Saurebh', email: 'saurebh@advancedmarketing.co' },
];

createTeamAccounts(teamMembers)
  .then(results => {
    console.log('\n📋 ACCOUNT CREDENTIALS TO SHARE IN CLICKUP:\n');
    results.forEach(account => {
      console.log(`Name: ${account.name}`);
      console.log(`Email: ${account.email}`);
      console.log(`Password: ${account.tempPassword}`);
      console.log(`Login URL: https://leadripper-2.netlify.app/app`);
      console.log('---');
    });
    pool.end();
  })
  .catch(error => {
    console.error('Error:', error);
    pool.end();
    process.exit(1);
  });

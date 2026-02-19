const fetch = require('node-fetch');
const fs = require('fs');

const ACCESS_TOKEN = 'sbp_229a0b62932457fc813653bae94a7382eb1851e9';
const PROJECT_REF = 'afnikqescveajfempelv';

async function createBlogTables() {
  try {
    console.log('Creating LeadRipper blog tables via Supabase Management API...\n');

    // Read the SQL file
    const SQL = fs.readFileSync('/Users/blackhat01/leadripper-marketing/create-blog-schema.sql', 'utf8');

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

    if (response.ok) {
      console.log('\n✅ Blog tables created successfully!');
      console.log('Tables created:');
      console.log('  - blog_posts (with indexes and triggers)');
      console.log('  - blog_categories (7 categories pre-populated)');
      console.log('  - blog_analytics (for tracking)');
      console.log('\nReady for blog posts!');
    } else {
      console.log('\n❌ Failed to create tables');
      console.log('Response:', result);
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

createBlogTables();

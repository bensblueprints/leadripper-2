const fetch = require('node-fetch');

const SUPABASE_URL = 'https://afnikqescveajfempelv.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmbmlrcWVzY3ZlYWpmZW1wZWx2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTQzMDM1MCwiZXhwIjoyMDg1MDA2MzUwfQ.la0AQ7Yd0HRY3FzkmJ1uavWAf8RnSEwxEjn_k33g83M';

async function testSupabaseConnection() {
  try {
    console.log('Testing Supabase connection...\n');

    // Test REST API health
    const healthResponse = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
      }
    });

    console.log('REST API Status:', healthResponse.status);
    console.log('REST API Response:', await healthResponse.text());

    if (healthResponse.status === 200) {
      console.log('\n✅ Supabase project is ACTIVE and accessible!');

      // Test if we can query (try to list tables)
      const tablesResponse = await fetch(`${SUPABASE_URL}/rest/v1/`, {
        headers: {
          'apikey': SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Accept': 'application/json'
        }
      });

      console.log('\nTables query status:', tablesResponse.status);

    } else if (healthResponse.status === 404) {
      console.log('\n❌ Project appears to be PAUSED or DELETED');
      console.log('Action required: Log into https://supabase.com/dashboard and restore the project');
    } else {
      console.log('\n⚠️ Unexpected response - check project status manually');
    }

  } catch (error) {
    console.error('Connection test failed:', error.message);
    console.log('\n❌ Unable to reach Supabase project');
    console.log('Possible causes:');
    console.log('  1. Project is paused (free tier after 7 days inactivity)');
    console.log('  2. Project was deleted');
    console.log('  3. Invalid credentials');
    console.log('\nAction: Log into https://supabase.com/dashboard/project/afnikqescveajfempelv');
  }
}

testSupabaseConnection();

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = 'https://afnikqescveajfempelv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmbmlrcWVzY3ZlYWpmZW1wZWx2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTQzMDM1MCwiZXhwIjoyMDg1MDA2MzUwfQ.la0AQ7Yd0HRY3FzkmJ1uavWAf8RnSEwxEjn_k33g83M';

const supabase = createClient(supabaseUrl, supabaseKey);

async function setupBlogDatabase() {
  console.log('Setting up LeadRipper blog database...\n');

  // Note: Supabase JS client doesn't support executing DDL directly
  // We need to use the REST API with pooler connection or SQL editor

  console.log('📋 Database setup instructions:');
  console.log('1. Go to: https://supabase.com/dashboard/project/afnikqescveajfempelv/sql/new');
  console.log('2. Copy and paste the SQL from: create-blog-schema.sql');
  console.log('3. Click "Run" to execute\n');

  console.log('Alternatively, testing table creation via REST...\n');

  // Test if we can create a simple entry (tables might already exist)
  try {
    const { data, error } = await supabase
      .from('blog_categories')
      .select('count')
      .limit(1);

    if (error) {
      console.log('❌ Tables do not exist yet. Please run SQL manually.');
      console.log('Error:', error.message);
    } else {
      console.log('✅ Tables appear to exist already!');

      // Verify blog_posts table
      const { data: posts, error: postsError } = await supabase
        .from('blog_posts')
        .select('count')
        .limit(1);

      if (postsError) {
        console.log('❌ blog_posts table issue:', postsError.message);
      } else {
        console.log('✅ blog_posts table exists');
      }
    }
  } catch (err) {
    console.error('Connection error:', err.message);
  }

  console.log('\n📝 SQL file location: /Users/blackhat01/leadripper-marketing/create-blog-schema.sql');
}

setupBlogDatabase();

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = 'https://afnikqescveajfempelv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmbmlrcWVzY3ZlYWpmZW1wZWx2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTQzMDM1MCwiZXhwIjoyMDg1MDA2MzUwfQ.la0AQ7Yd0HRY3FzkmJ1uavWAf8RnSEwxEjn_k33g83M';

const supabase = createClient(supabaseUrl, supabaseKey);

async function insertBlogPosts() {
  console.log('Inserting blog posts into Supabase...\n');

  // Read the JSON file
  const postsData = JSON.parse(
    fs.readFileSync('/Users/blackhat01/leadripper-marketing/blog-posts-ready-for-import.json', 'utf8')
  );

  for (const post of postsData) {
    console.log(`Inserting: ${post.title}`);

    // Set to published status and add published_at timestamp
    post.status = 'published';
    post.published_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('blog_posts')
      .insert([post])
      .select();

    if (error) {
      console.error(`  ❌ Error inserting post: ${error.message}`);
    } else {
      console.log(`  ✅ Inserted successfully (ID: ${data[0].id})`);
      console.log(`  🔗 URL: https://leadripper.com/blog/${post.slug}`);
    }
  }

  console.log('\n✅ Blog posts insertion complete!');
  console.log('\nVerifying posts...');

  // Verify posts were inserted
  const { data: posts, error: fetchError } = await supabase
    .from('blog_posts')
    .select('title, slug, status, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (fetchError) {
    console.error('❌ Error fetching posts:', fetchError.message);
  } else {
    console.log(`\n📊 Total published posts: ${posts.length}`);
    posts.forEach((post, i) => {
      console.log(`${i + 1}. ${post.title}`);
      console.log(`   Slug: ${post.slug}`);
      console.log(`   Published: ${new Date(post.published_at).toLocaleString()}`);
    });
  }
}

insertBlogPosts().catch(console.error);

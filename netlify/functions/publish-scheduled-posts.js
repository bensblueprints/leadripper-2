const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://afnikqescveajfempelv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmbmlrcWVzY3ZlYWpmZW1wZWx2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTQzMDM1MCwiZXhwIjoyMDg1MDA2MzUwfQ.la0AQ7Yd0HRY3FzkmJ1uavWAf8RnSEwxEjn_k33g83M';

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Automated Blog Post Publishing Function
 *
 * This function runs hourly via Netlify scheduled function.
 * It checks for posts with status='scheduled' that have a scheduled_for
 * datetime that has passed, and publishes them automatically.
 *
 * Triggered by: Netlify cron (hourly)
 */
exports.handler = async (event, context) => {
  console.log('🚀 Running scheduled blog post publisher...');

  const headers = {
    'Content-Type': 'application/json'
  };

  try {
    const now = new Date().toISOString();

    // Find all scheduled posts that should be published
    const { data: scheduledPosts, error: fetchError } = await supabase
      .from('blog_posts')
      .select('*')
      .eq('status', 'scheduled')
      .lte('scheduled_for', now)
      .order('scheduled_for', { ascending: true });

    if (fetchError) {
      console.error('Error fetching scheduled posts:', fetchError);
      throw fetchError;
    }

    if (!scheduledPosts || scheduledPosts.length === 0) {
      console.log('✅ No posts to publish at this time');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'No posts to publish',
          published: 0
        })
      };
    }

    console.log(`📋 Found ${scheduledPosts.length} post(s) to publish`);

    // Publish each post
    const publishedPosts = [];
    const errors = [];

    for (const post of scheduledPosts) {
      try {
        const { data, error } = await supabase
          .from('blog_posts')
          .update({
            status: 'published',
            published_at: post.scheduled_for,
            updated_at: now
          })
          .eq('id', post.id)
          .select()
          .single();

        if (error) throw error;

        publishedPosts.push({
          id: data.id,
          title: data.title,
          slug: data.slug,
          published_at: data.published_at
        });

        console.log(`✅ Published: "${post.title}" (${post.slug})`);

        // TODO: Send notification email to Ben
        // TODO: Trigger social media sharing
        // TODO: Update sitemap
        // TODO: Ping search engines

      } catch (err) {
        console.error(`❌ Error publishing "${post.title}":`, err);
        errors.push({
          postId: post.id,
          title: post.title,
          error: err.message
        });
      }
    }

    const result = {
      success: true,
      published: publishedPosts.length,
      posts: publishedPosts,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: now
    };

    console.log('📊 Publishing complete:', result);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('❌ Fatal error in scheduled publisher:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to publish scheduled posts',
        message: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};

// For local testing
if (require.main === module) {
  exports.handler({}, {})
    .then(result => {
      console.log('\n=== TEST RESULT ===');
      console.log(JSON.parse(result.body));
      process.exit(0);
    })
    .catch(err => {
      console.error('Test failed:', err);
      process.exit(1);
    });
}

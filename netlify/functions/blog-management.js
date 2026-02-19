const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://afnikqescveajfempelv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmbmlrcWVzY3ZlYWpmZW1wZWx2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTQzMDM1MCwiZXhwIjoyMDg1MDA2MzUwfQ.la0AQ7Yd0HRY3FzkmJ1uavWAf8RnSEwxEjn_k33g83M';

const supabase = createClient(supabaseUrl, supabaseKey);

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const path = event.path.replace('/.netlify/functions/blog-management', '');
    const method = event.httpMethod;

    // GET /blog-posts - List all blog posts
    if (path === '/blog-posts' && method === 'GET') {
      const { status, category, limit = 50, offset = 0 } = event.queryStringParameters || {};

      let query = supabase
        .from('blog_posts')
        .select('*', { count: 'exact' })
        .order('published_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) query = query.eq('status', status);
      if (category) query = query.eq('category', category);

      const { data, error, count } = await query;

      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data,
          total: count,
          limit: parseInt(limit),
          offset: parseInt(offset)
        })
      };
    }

    // GET /blog-posts/:slug - Get single blog post
    if (path.match(/^\/blog-posts\/.+$/) && method === 'GET') {
      const slug = path.split('/')[2];

      const { data, error } = await supabase
        .from('blog_posts')
        .select('*')
        .eq('slug', slug)
        .single();

      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data })
      };
    }

    // POST /blog-posts - Create new blog post
    if (path === '/blog-posts' && method === 'POST') {
      const body = JSON.parse(event.body);

      // Calculate reading time and word count
      const wordCount = body.content.split(/\s+/).length;
      const readingTime = Math.ceil(wordCount / 200); // Average reading speed

      const postData = {
        ...body,
        word_count: wordCount,
        reading_time_minutes: readingTime,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Auto-publish if scheduled_for is in the past
      if (postData.scheduled_for && new Date(postData.scheduled_for) <= new Date()) {
        postData.status = 'published';
        postData.published_at = postData.scheduled_for;
      }

      const { data, error } = await supabase
        .from('blog_posts')
        .insert([postData])
        .select()
        .single();

      if (error) throw error;

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({ success: true, data })
      };
    }

    // PUT /blog-posts/:id - Update blog post
    if (path.match(/^\/blog-posts\/.+$/) && method === 'PUT') {
      const id = path.split('/')[2];
      const body = JSON.parse(event.body);

      const updateData = {
        ...body,
        updated_at: new Date().toISOString()
      };

      // Recalculate reading time if content changed
      if (body.content) {
        const wordCount = body.content.split(/\s+/).length;
        updateData.word_count = wordCount;
        updateData.reading_time_minutes = Math.ceil(wordCount / 200);
      }

      const { data, error } = await supabase
        .from('blog_posts')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data })
      };
    }

    // DELETE /blog-posts/:id - Delete blog post
    if (path.match(/^\/blog-posts\/.+$/) && method === 'DELETE') {
      const id = path.split('/')[2];

      const { error } = await supabase
        .from('blog_posts')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Post deleted' })
      };
    }

    // POST /publish-scheduled - Publish scheduled posts (cron job endpoint)
    if (path === '/publish-scheduled' && method === 'POST') {
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from('blog_posts')
        .update({
          status: 'published',
          published_at: supabase.raw('scheduled_for')
        })
        .eq('status', 'scheduled')
        .lte('scheduled_for', now)
        .select();

      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          published: data.length,
          posts: data
        })
      };
    }

    // GET /analytics/:postId - Get post analytics
    if (path.match(/^\/analytics\/.+$/) && method === 'GET') {
      const postId = path.split('/')[2];
      const { days = 30 } = event.queryStringParameters || {};

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));

      const { data, error } = await supabase
        .from('blog_analytics')
        .select('*')
        .eq('post_id', postId)
        .gte('date', startDate.toISOString().split('T')[0])
        .order('date', { ascending: true });

      if (error) throw error;

      // Also get post summary
      const { data: post } = await supabase
        .from('blog_posts')
        .select('view_count, share_count, title')
        .eq('id', postId)
        .single();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          post,
          analytics: data
        })
      };
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Endpoint not found' })
    };

  } catch (error) {
    console.error('Blog management error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};

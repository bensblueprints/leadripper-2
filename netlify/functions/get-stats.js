const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://eyaitfxwjhsrizsbqcem.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5YWl0Znh3amhzcml6c2JxY2VtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzODk0NDYsImV4cCI6MjA4NTk2NTQ0Nn0.xihzbULV2wrhX3JvB8ZER98wUKPlwX2xzEBuYrJVDNA'
);

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2024';

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }

  try {
    // Get user info using Supabase
    const { data: userData, error: userError } = await supabase
      .from('lr_users')
      .select('id, email, name, company, plan, leads_used, leads_limit')
      .eq('id', decoded.userId)
      .single();

    if (userError) {
      console.error('Error getting user:', userError);
      throw new Error('Failed to get user info');
    }

    const user = userData;

    // Get total leads using Supabase
    const { count: totalLeads, error: leadsError } = await supabase
      .from('lr_leads')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', decoded.userId);

    if (leadsError) {
      console.error('Error counting leads:', leadsError);
    }

    // Get synced leads using Supabase
    const { count: syncedLeads, error: syncedError } = await supabase
      .from('lr_leads')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', decoded.userId)
      .eq('synced_to_ghl', true);

    if (syncedError) {
      console.error('Error counting synced leads:', syncedError);
    }

    // Get scraped cities count using Supabase
    const { data: citiesData, error: citiesError } = await supabase
      .from('lr_leads')
      .select('city')
      .eq('user_id', decoded.userId)
      .not('city', 'is', null);

    const citiesScraped = citiesData ? new Set(citiesData.map(row => row.city)).size : 0;

    // Get recent activity (last 7 days) - Note: Supabase doesn't support GROUP BY directly in REST API
    // We'll fetch the data and process it in JavaScript
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentLeads, error: activityError } = await supabase
      .from('lr_leads')
      .select('scraped_at')
      .eq('user_id', decoded.userId)
      .gte('scraped_at', sevenDaysAgo)
      .order('scraped_at', { ascending: false });

    // Process activity data
    const activityMap = {};
    if (recentLeads) {
      recentLeads.forEach(lead => {
        const date = new Date(lead.scraped_at).toISOString().split('T')[0];
        activityMap[date] = (activityMap[date] || 0) + 1;
      });
    }
    const activity = Object.entries(activityMap).map(([date, count]) => ({ date, count }));

    // Get top industries - fetch and process in JavaScript
    const { data: leadsWithIndustry, error: industriesError } = await supabase
      .from('lr_leads')
      .select('category')
      .eq('user_id', decoded.userId)
      .not('category', 'is', null)
      .neq('category', '');

    // Process industries data
    const industryMap = {};
    if (leadsWithIndustry) {
      leadsWithIndustry.forEach(lead => {
        const industry = lead.category;
        industryMap[industry] = (industryMap[industry] || 0) + 1;
      });
    }
    const topIndustries = Object.entries(industryMap)
      .map(([industry, count]) => ({ industry, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          company: user.company,
          plan: user.plan,
          leadsUsed: user.leads_used,
          leadsLimit: user.leads_limit
        },
        stats: {
          totalLeads: totalLeads || 0,
          syncedLeads: syncedLeads || 0,
          citiesScraped: citiesScraped,
          leadsRemaining: user.leads_limit - user.leads_used
        },
        activity: activity,
        topIndustries: topIndustries
      })
    };
  } catch (error) {
    console.error('Get stats error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to get stats', message: error.message })
    };
  }
};

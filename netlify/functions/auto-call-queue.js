const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
  } catch { return null; }
}

// Check if current time is within business hours
function isWithinBusinessHours(businessHours, timezone = 'America/New_York') {
  if (!businessHours || !businessHours.length) {
    // Default: Mon-Fri 9am-5pm
    const now = new Date();
    const hour = parseInt(now.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }));
    const day = now.toLocaleString('en-US', { timeZone: timezone, weekday: 'short' });
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    return weekdays.includes(day) && hour >= 9 && hour < 17;
  }

  // Parse Google Places style hours
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday
  const currentHour = parseInt(now.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }));
  const currentMinute = parseInt(now.toLocaleString('en-US', { timeZone: timezone, minute: 'numeric' }));
  const currentTime = currentHour * 100 + currentMinute;

  const todayHours = businessHours.find(h => h.day === dayOfWeek);
  if (!todayHours || todayHours.closed) return false;

  return currentTime >= todayHours.open && currentTime <= todayHours.close;
}

// Get business hours from Google Places API
async function getBusinessHours(placeId) {
  if (!GOOGLE_PLACES_API_KEY || !placeId) return null;

  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=opening_hours&key=${GOOGLE_PLACES_API_KEY}`
    );
    const data = await response.json();

    if (data.result?.opening_hours?.periods) {
      return data.result.opening_hours.periods.map(period => ({
        day: period.open.day,
        open: parseInt(period.open.time),
        close: period.close ? parseInt(period.close.time) : 2359
      }));
    }
    return null;
  } catch (error) {
    console.error('Error fetching business hours:', error);
    return null;
  }
}

// Calculate next available call time
function getNextCallTime(businessHours, timezone = 'America/New_York') {
  const now = new Date();

  // Check next 7 days
  for (let i = 0; i < 7; i++) {
    const checkDate = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const dayOfWeek = checkDate.getDay();

    let dayHours;
    if (businessHours && businessHours.length) {
      dayHours = businessHours.find(h => h.day === dayOfWeek);
    } else {
      // Default Mon-Fri 9am-5pm
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        dayHours = { open: 900, close: 1700 };
      }
    }

    if (!dayHours || dayHours.closed) continue;

    // Set call time to opening hour + random 1-3 hours
    const openHour = Math.floor(dayHours.open / 100);
    const callHour = Math.min(openHour + Math.floor(Math.random() * 3) + 1, Math.floor(dayHours.close / 100) - 1);
    const callMinute = Math.floor(Math.random() * 60);

    const callTime = new Date(checkDate);
    callTime.setHours(callHour, callMinute, 0, 0);

    if (callTime > now) {
      return callTime;
    }
  }

  // Fallback: tomorrow 10am
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  tomorrow.setHours(10, 0, 0, 0);
  return tomorrow;
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const userId = decoded.userId;

  try {
    // GET - List call queue
    if (event.httpMethod === 'GET') {
      const status = event.queryStringParameters?.status || 'pending';

      const result = await pool.query(
        `SELECT cq.*, l.business_name, l.phone, l.website, l.city, l.state,
                a.name as agent_name, a.goal as agent_goal
         FROM lr_auto_call_queue cq
         LEFT JOIN lr_leads l ON l.id = cq.lead_id
         LEFT JOIN lr_ai_agents a ON a.id = cq.agent_id
         WHERE cq.user_id = $1 AND cq.status = $2
         ORDER BY cq.scheduled_at ASC
         LIMIT 100`,
        [userId, status]
      );

      // Get stats
      const statsResult = await pool.query(
        `SELECT
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'failed') as failed,
          COUNT(*) FILTER (WHERE outcome = 'email_collected') as emails_collected
         FROM lr_auto_call_queue WHERE user_id = $1`,
        [userId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          queue: result.rows,
          stats: statsResult.rows[0]
        })
      };
    }

    // POST - Add leads to call queue
    if (event.httpMethod === 'POST') {
      const { leadIds, agentId, priority } = JSON.parse(event.body);

      if (!leadIds || !leadIds.length || !agentId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'leadIds and agentId are required' })
        };
      }

      // Verify agent exists and belongs to user
      const agentResult = await pool.query(
        `SELECT id, goal FROM lr_ai_agents WHERE id = $1 AND user_id = $2 AND is_active = true`,
        [agentId, userId]
      );

      if (agentResult.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Agent not found or inactive' })
        };
      }

      // Get leads without email
      const leadsResult = await pool.query(
        `SELECT id, phone, place_id, business_hours FROM lr_leads
         WHERE id = ANY($1) AND user_id = $2 AND phone IS NOT NULL
         AND (email IS NULL OR email = '')`,
        [leadIds, userId]
      );

      if (leadsResult.rows.length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'No valid leads found (must have phone, no email)' })
        };
      }

      const queued = [];

      for (const lead of leadsResult.rows) {
        // Get business hours if we have place_id
        let businessHours = lead.business_hours;
        if (!businessHours && lead.place_id && GOOGLE_PLACES_API_KEY) {
          businessHours = await getBusinessHours(lead.place_id);
          // Store for future use
          if (businessHours) {
            await pool.query(
              `UPDATE lr_leads SET business_hours = $1 WHERE id = $2`,
              [JSON.stringify(businessHours), lead.id]
            );
          }
        }

        // Parse stored business hours if string
        if (typeof businessHours === 'string') {
          try {
            businessHours = JSON.parse(businessHours);
          } catch (e) {
            businessHours = null;
          }
        }

        // Calculate next call time
        const scheduledAt = getNextCallTime(businessHours);

        // Check if already in queue
        const existingResult = await pool.query(
          `SELECT id FROM lr_auto_call_queue
           WHERE lead_id = $1 AND status IN ('pending', 'in_progress')`,
          [lead.id]
        );

        if (existingResult.rows.length > 0) continue;

        // Add to queue
        const insertResult = await pool.query(
          `INSERT INTO lr_auto_call_queue (
            user_id, lead_id, agent_id, phone_number, scheduled_at, priority,
            business_hours, purpose
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'collect_email')
          RETURNING id`,
          [
            userId, lead.id, agentId, lead.phone, scheduledAt,
            priority || 'normal',
            businessHours ? JSON.stringify(businessHours) : null
          ]
        );

        queued.push({
          queueId: insertResult.rows[0].id,
          leadId: lead.id,
          scheduledAt
        });
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: `Added ${queued.length} leads to call queue`,
          queued
        })
      };
    }

    // PUT - Update queue item (reschedule, pause, etc)
    if (event.httpMethod === 'PUT') {
      const { id, scheduledAt, status, priority } = JSON.parse(event.body);

      if (!id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Queue item ID required' })
        };
      }

      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (scheduledAt) {
        updates.push(`scheduled_at = $${paramIndex}`);
        values.push(new Date(scheduledAt));
        paramIndex++;
      }
      if (status) {
        updates.push(`status = $${paramIndex}`);
        values.push(status);
        paramIndex++;
      }
      if (priority) {
        updates.push(`priority = $${paramIndex}`);
        values.push(priority);
        paramIndex++;
      }

      if (updates.length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'No updates provided' })
        };
      }

      values.push(id, userId);

      await pool.query(
        `UPDATE lr_auto_call_queue SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}`,
        values
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Queue item updated' })
      };
    }

    // DELETE - Remove from queue
    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body || '{}');
      const queueId = id || event.queryStringParameters?.id;

      if (!queueId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Queue item ID required' })
        };
      }

      await pool.query(
        `DELETE FROM lr_auto_call_queue WHERE id = $1 AND user_id = $2`,
        [queueId, userId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Removed from queue' })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('Auto-call queue error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', message: error.message })
    };
  }
};

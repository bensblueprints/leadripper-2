const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

  const userId = decoded.userId;

  try {
    // ==========================================
    // GET - Get call logs
    // ==========================================
    if (event.httpMethod === 'GET') {
      const dealId = event.queryStringParameters?.dealId;
      const agentId = event.queryStringParameters?.agentId;
      const limit = parseInt(event.queryStringParameters?.limit) || 50;
      const offset = parseInt(event.queryStringParameters?.offset) || 0;

      let query = `SELECT c.*, a.name as agent_name, d.title as deal_title
                   FROM lr_call_logs c
                   LEFT JOIN lr_ai_agents a ON a.id = c.agent_id
                   LEFT JOIN lr_crm_deals d ON d.id = c.deal_id
                   WHERE c.user_id = $1`;
      const values = [userId];
      let paramIndex = 2;

      if (dealId) {
        query += ` AND c.deal_id = $${paramIndex}`;
        values.push(dealId);
        paramIndex++;
      }

      if (agentId) {
        query += ` AND c.agent_id = $${paramIndex}`;
        values.push(agentId);
        paramIndex++;
      }

      query += ` ORDER BY c.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      values.push(limit, offset);

      const callsResult = await pool.query(query, values);

      // Get total count
      let countQuery = `SELECT COUNT(*) FROM lr_call_logs WHERE user_id = $1`;
      const countValues = [userId];
      if (dealId) {
        countQuery += ` AND deal_id = $2`;
        countValues.push(dealId);
      }
      if (agentId) {
        countQuery += ` AND agent_id = $${countValues.length + 1}`;
        countValues.push(agentId);
      }
      const countResult = await pool.query(countQuery, countValues);

      // Get stats
      const statsResult = await pool.query(
        `SELECT
          COUNT(*) as total_calls,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_calls,
          COUNT(CASE WHEN outcome = 'scheduled' THEN 1 END) as meetings_scheduled,
          AVG(duration_seconds) as avg_duration,
          COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as calls_today
         FROM lr_call_logs WHERE user_id = $1`,
        [userId]
      );

      const stats = statsResult.rows[0];

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          calls: callsResult.rows,
          total: parseInt(countResult.rows[0].count),
          stats: {
            totalCalls: parseInt(stats.total_calls) || 0,
            completedCalls: parseInt(stats.completed_calls) || 0,
            meetingsScheduled: parseInt(stats.meetings_scheduled) || 0,
            avgDuration: Math.round(parseFloat(stats.avg_duration) || 0),
            callsToday: parseInt(stats.calls_today) || 0
          },
          limit,
          offset
        })
      };
    }

    // ==========================================
    // POST - Initiate AI call
    // ==========================================
    if (event.httpMethod === 'POST') {
      const {
        agentId,
        dealId,
        phoneNumber
      } = JSON.parse(event.body);

      if (!agentId || !phoneNumber) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Agent ID and phone number are required' })
        };
      }

      // Get user's ElevenLabs API key
      const settingsResult = await pool.query(
        `SELECT elevenlabs_api_key, ai_calling_enabled FROM lr_user_settings WHERE user_id = $1`,
        [userId]
      );

      if (settingsResult.rows.length === 0 || !settingsResult.rows[0].elevenlabs_api_key) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'ElevenLabs API key not configured. Please add it in Settings.' })
        };
      }

      if (!settingsResult.rows[0].ai_calling_enabled) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'AI calling is not enabled. Please enable it in Settings.' })
        };
      }

      const elevenlabsApiKey = settingsResult.rows[0].elevenlabs_api_key;

      // Get agent details
      const agentResult = await pool.query(
        `SELECT * FROM lr_ai_agents WHERE id = $1 AND user_id = $2 AND is_active = true`,
        [agentId, userId]
      );

      if (agentResult.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'AI agent not found or inactive' })
        };
      }

      const agent = agentResult.rows[0];

      // Get deal info if dealId provided
      let dealInfo = null;
      if (dealId) {
        const dealResult = await pool.query(
          `SELECT d.*, l.business_name, l.website
           FROM lr_crm_deals d
           LEFT JOIN lr_leads l ON l.id = d.lead_id
           WHERE d.id = $1 AND d.user_id = $2`,
          [dealId, userId]
        );
        if (dealResult.rows.length > 0) {
          dealInfo = dealResult.rows[0];
        }
      }

      // Create call log entry (status: initiated)
      const callLogResult = await pool.query(
        `INSERT INTO lr_call_logs (user_id, deal_id, agent_id, phone_number, direction, status)
         VALUES ($1, $2, $3, $4, 'outbound', 'initiated')
         RETURNING *`,
        [userId, dealId || null, agentId, phoneNumber]
      );

      const callLog = callLogResult.rows[0];

      // Build system prompt with deal context
      let contextPrompt = agent.system_prompt || '';
      if (dealInfo) {
        contextPrompt += `\n\nCall context:\n`;
        contextPrompt += `- Contact: ${dealInfo.contact_name || 'Unknown'}\n`;
        contextPrompt += `- Company: ${dealInfo.contact_company || dealInfo.business_name || 'Unknown'}\n`;
        contextPrompt += `- Deal: ${dealInfo.title || 'No title'}\n`;
        if (dealInfo.notes) {
          contextPrompt += `- Notes: ${dealInfo.notes}\n`;
        }
      }

      // Initiate ElevenLabs Conversational AI call
      try {
        const elevenlabsResponse = await fetch('https://api.elevenlabs.io/v1/convai/conversation', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': elevenlabsApiKey
          },
          body: JSON.stringify({
            voice_id: agent.voice_id,
            phone_number: phoneNumber,
            first_message: agent.greeting_script || "Hello, this is a call from LeadRipper.",
            system_prompt: contextPrompt,
            agent_goal: agent.goal || 'schedule_meeting',
            max_duration: agent.max_call_duration || 300,
            webhook_url: `${process.env.URL || 'https://leadripper.com'}/.netlify/functions/elevenlabs-webhook`,
            metadata: {
              call_log_id: callLog.id.toString(),
              user_id: userId.toString(),
              agent_id: agentId.toString()
            }
          })
        });

        const elevenlabsResult = await elevenlabsResponse.json();

        if (!elevenlabsResponse.ok) {
          // Update call log with error
          await pool.query(
            `UPDATE lr_call_logs SET status = 'failed', ended_at = NOW()
             WHERE id = $1`,
            [callLog.id]
          );

          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
              error: 'Failed to initiate call',
              details: elevenlabsResult.detail || elevenlabsResult.message || 'Unknown error'
            })
          };
        }

        // Update call log with ElevenLabs call ID
        await pool.query(
          `UPDATE lr_call_logs SET
            elevenlabs_call_id = $1,
            status = 'ringing',
            started_at = NOW()
           WHERE id = $2`,
          [elevenlabsResult.conversation_id || elevenlabsResult.call_id, callLog.id]
        );

        // Add activity to deal if linked
        if (dealId) {
          await pool.query(
            `INSERT INTO lr_crm_activities (deal_id, user_id, activity_type, subject, content, metadata)
             VALUES ($1, $2, 'call', 'AI Call Initiated', $3, $4)`,
            [
              dealId, userId,
              `AI agent "${agent.name}" initiated call to ${phoneNumber}`,
              JSON.stringify({ callLogId: callLog.id, agentId, phoneNumber })
            ]
          );
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            message: 'Call initiated successfully',
            callLogId: callLog.id,
            elevenlabsCallId: elevenlabsResult.conversation_id || elevenlabsResult.call_id
          })
        };

      } catch (apiError) {
        // Update call log with error
        await pool.query(
          `UPDATE lr_call_logs SET status = 'failed', ended_at = NOW()
           WHERE id = $1`,
          [callLog.id]
        );

        console.error('ElevenLabs API error:', apiError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            error: 'Failed to connect to ElevenLabs API',
            details: apiError.message
          })
        };
      }
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('AI Call error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', message: error.message })
    };
  }
};

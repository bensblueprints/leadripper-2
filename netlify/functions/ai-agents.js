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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
    // GET - List AI agents or get single agent
    // ==========================================
    if (event.httpMethod === 'GET') {
      const agentId = event.queryStringParameters?.id;

      if (agentId) {
        // Get single agent
        const result = await pool.query(
          `SELECT * FROM lr_ai_agents WHERE id = $1 AND user_id = $2`,
          [agentId, userId]
        );

        if (result.rows.length === 0) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'AI agent not found' })
          };
        }

        const agent = result.rows[0];

        // Parse objection handlers if stored as JSON string
        if (agent.objection_handlers && typeof agent.objection_handlers === 'string') {
          try {
            agent.objection_handlers = JSON.parse(agent.objection_handlers);
          } catch (e) {
            agent.objection_handlers = {};
          }
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            agent
          })
        };
      }

      // List all agents
      const result = await pool.query(
        `SELECT id, name, voice_id, goal, is_active, max_call_duration, calendar_link, created_at
         FROM lr_ai_agents WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      );

      // Get call stats for each agent
      const agentsWithStats = await Promise.all(result.rows.map(async (agent) => {
        const statsResult = await pool.query(
          `SELECT
            COUNT(*) as total_calls,
            COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_calls,
            COUNT(CASE WHEN outcome = 'scheduled' THEN 1 END) as meetings_scheduled,
            AVG(duration_seconds) as avg_duration
           FROM lr_call_logs WHERE agent_id = $1`,
          [agent.id]
        );
        const stats = statsResult.rows[0];
        return {
          ...agent,
          stats: {
            totalCalls: parseInt(stats.total_calls) || 0,
            completedCalls: parseInt(stats.completed_calls) || 0,
            meetingsScheduled: parseInt(stats.meetings_scheduled) || 0,
            avgDuration: Math.round(parseFloat(stats.avg_duration) || 0)
          }
        };
      }));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          agents: agentsWithStats
        })
      };
    }

    // ==========================================
    // POST - Create new AI agent
    // ==========================================
    if (event.httpMethod === 'POST') {
      const {
        name,
        voiceId,
        systemPrompt,
        greetingScript,
        objectionHandlers,
        goal, // 'schedule_meeting', 'qualify_lead', 'collect_info'
        calendarLink,
        maxCallDuration
      } = JSON.parse(event.body);

      if (!name) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Agent name is required' })
        };
      }

      // Validate goal
      const validGoals = ['schedule_meeting', 'qualify_lead', 'collect_info', 'collect_email', 'reach_decision_maker'];
      if (goal && !validGoals.includes(goal)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Invalid goal. Must be one of: ${validGoals.join(', ')}` })
        };
      }

      const result = await pool.query(
        `INSERT INTO lr_ai_agents (
          user_id, name, voice_id, system_prompt, greeting_script,
          objection_handlers, goal, calendar_link, max_call_duration
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          userId, name, voiceId || null, systemPrompt || null, greetingScript || null,
          JSON.stringify(objectionHandlers || {}), goal || 'schedule_meeting',
          calendarLink || null, maxCallDuration || 300
        ]
      );

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'AI agent created successfully',
          agent: result.rows[0]
        })
      };
    }

    // ==========================================
    // PUT - Update AI agent
    // ==========================================
    if (event.httpMethod === 'PUT') {
      const {
        id,
        name,
        voiceId,
        systemPrompt,
        greetingScript,
        objectionHandlers,
        goal,
        calendarLink,
        maxCallDuration,
        isActive
      } = JSON.parse(event.body);

      if (!id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Agent ID is required' })
        };
      }

      // Verify ownership
      const ownerCheck = await pool.query(
        `SELECT id FROM lr_ai_agents WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );

      if (ownerCheck.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'AI agent not found' })
        };
      }

      // Build dynamic update query
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramIndex}`);
        values.push(name);
        paramIndex++;
      }
      if (voiceId !== undefined) {
        updates.push(`voice_id = $${paramIndex}`);
        values.push(voiceId);
        paramIndex++;
      }
      if (systemPrompt !== undefined) {
        updates.push(`system_prompt = $${paramIndex}`);
        values.push(systemPrompt);
        paramIndex++;
      }
      if (greetingScript !== undefined) {
        updates.push(`greeting_script = $${paramIndex}`);
        values.push(greetingScript);
        paramIndex++;
      }
      if (objectionHandlers !== undefined) {
        updates.push(`objection_handlers = $${paramIndex}`);
        values.push(JSON.stringify(objectionHandlers));
        paramIndex++;
      }
      if (goal !== undefined) {
        updates.push(`goal = $${paramIndex}`);
        values.push(goal);
        paramIndex++;
      }
      if (calendarLink !== undefined) {
        updates.push(`calendar_link = $${paramIndex}`);
        values.push(calendarLink);
        paramIndex++;
      }
      if (maxCallDuration !== undefined) {
        updates.push(`max_call_duration = $${paramIndex}`);
        values.push(maxCallDuration);
        paramIndex++;
      }
      if (isActive !== undefined) {
        updates.push(`is_active = $${paramIndex}`);
        values.push(isActive);
        paramIndex++;
      }

      if (updates.length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'No fields to update' })
        };
      }

      values.push(id);

      const updateResult = await pool.query(
        `UPDATE lr_ai_agents SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${paramIndex}
         RETURNING *`,
        values
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'AI agent updated successfully',
          agent: updateResult.rows[0]
        })
      };
    }

    // ==========================================
    // DELETE - Delete AI agent
    // ==========================================
    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body || '{}');
      const agentId = id || event.queryStringParameters?.id;

      if (!agentId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Agent ID is required' })
        };
      }

      // Verify ownership
      const ownerCheck = await pool.query(
        `SELECT id FROM lr_ai_agents WHERE id = $1 AND user_id = $2`,
        [agentId, userId]
      );

      if (ownerCheck.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'AI agent not found' })
        };
      }

      // Delete the agent (call logs will remain for history)
      await pool.query(`DELETE FROM lr_ai_agents WHERE id = $1`, [agentId]);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'AI agent deleted successfully'
        })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('AI Agents error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', message: error.message })
    };
  }
};

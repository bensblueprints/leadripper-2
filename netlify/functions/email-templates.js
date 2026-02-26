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
    // GET - List email templates
    // ==========================================
    if (event.httpMethod === 'GET') {
      const templateId = event.queryStringParameters?.id;

      if (templateId) {
        const result = await pool.query(
          `SELECT * FROM lr_email_templates WHERE id = $1 AND user_id = $2`,
          [templateId, userId]
        );

        if (result.rows.length === 0) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Template not found' })
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            template: result.rows[0]
          })
        };
      }

      const result = await pool.query(
        `SELECT * FROM lr_email_templates WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          templates: result.rows
        })
      };
    }

    // ==========================================
    // POST - Create email template
    // ==========================================
    if (event.httpMethod === 'POST') {
      const { name, subject, body, category } = JSON.parse(event.body);

      if (!name || !subject || !body) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Name, subject, and body are required' })
        };
      }

      // Extract merge tags from template
      const variables = [];
      const tagRegex = /{{(\w+)}}/g;
      let match;
      while ((match = tagRegex.exec(subject + body)) !== null) {
        if (!variables.includes(match[1])) {
          variables.push(match[1]);
        }
      }

      const result = await pool.query(
        `INSERT INTO lr_email_templates (user_id, name, subject, body, category, variables)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [userId, name, subject, body, category || 'general', JSON.stringify(variables)]
      );

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Template created successfully',
          template: result.rows[0]
        })
      };
    }

    // ==========================================
    // PUT - Update email template
    // ==========================================
    if (event.httpMethod === 'PUT') {
      const { id, name, subject, body, category, isActive } = JSON.parse(event.body);

      if (!id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Template ID is required' })
        };
      }

      // Verify ownership
      const ownerCheck = await pool.query(
        `SELECT id FROM lr_email_templates WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );

      if (ownerCheck.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Template not found' })
        };
      }

      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramIndex}`);
        values.push(name);
        paramIndex++;
      }
      if (subject !== undefined) {
        updates.push(`subject = $${paramIndex}`);
        values.push(subject);
        paramIndex++;
      }
      if (body !== undefined) {
        updates.push(`body = $${paramIndex}`);
        values.push(body);
        paramIndex++;

        // Re-extract variables
        const variables = [];
        const tagRegex = /{{(\w+)}}/g;
        let match;
        while ((match = tagRegex.exec((subject || '') + body)) !== null) {
          if (!variables.includes(match[1])) {
            variables.push(match[1]);
          }
        }
        updates.push(`variables = $${paramIndex}`);
        values.push(JSON.stringify(variables));
        paramIndex++;
      }
      if (category !== undefined) {
        updates.push(`category = $${paramIndex}`);
        values.push(category);
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

      const result = await pool.query(
        `UPDATE lr_email_templates SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${paramIndex}
         RETURNING *`,
        values
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Template updated successfully',
          template: result.rows[0]
        })
      };
    }

    // ==========================================
    // DELETE - Delete email template
    // ==========================================
    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body || '{}');
      const templateId = id || event.queryStringParameters?.id;

      if (!templateId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Template ID is required' })
        };
      }

      const ownerCheck = await pool.query(
        `SELECT id FROM lr_email_templates WHERE id = $1 AND user_id = $2`,
        [templateId, userId]
      );

      if (ownerCheck.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Template not found' })
        };
      }

      await pool.query(`DELETE FROM lr_email_templates WHERE id = $1`, [templateId]);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Template deleted successfully'
        })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('Email Templates error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', message: error.message })
    };
  }
};

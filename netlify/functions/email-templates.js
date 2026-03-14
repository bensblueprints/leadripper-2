const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
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
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const userId = decoded.userId;

  // GET - List email templates for user
  if (event.httpMethod === 'GET') {
    try {
      const result = await pool.query(
        `SELECT id, user_id, name, subject, body, created_at, updated_at
         FROM lr_email_templates WHERE user_id = $1 ORDER BY updated_at DESC`,
        [userId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, templates: result.rows })
      };
    } catch (error) {
      console.error('List templates error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // POST - Create or update template
  if (event.httpMethod === 'POST') {
    try {
      const { id, name, subject, body: templateBody } = JSON.parse(event.body);

      if (!name || !subject) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Template name and subject are required' }) };
      }

      // Update existing template
      if (id) {
        const result = await pool.query(
          `UPDATE lr_email_templates SET
            name = $1, subject = $2, body = $3, updated_at = NOW()
           WHERE id = $4 AND user_id = $5 RETURNING *`,
          [name, subject, templateBody || '', id, userId]
        );

        if (result.rows.length === 0) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'Template not found' }) };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, template: result.rows[0], message: 'Template updated' })
        };
      }

      // Create new template
      const result = await pool.query(
        `INSERT INTO lr_email_templates (user_id, name, subject, body, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *`,
        [userId, name, subject, templateBody || '']
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, template: result.rows[0], message: 'Template created' })
      };
    } catch (error) {
      console.error('Create/update template error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // PUT - Update template (alias for POST with id)
  if (event.httpMethod === 'PUT') {
    try {
      const { id, name, subject, body: templateBody } = JSON.parse(event.body);
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Template ID required' }) };
      if (!name || !subject) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name and subject required' }) };
      const result = await pool.query(
        'UPDATE lr_email_templates SET name=$1, subject=$2, body=$3, updated_at=NOW() WHERE id=$4 AND user_id=$5 RETURNING *',
        [name, subject, templateBody || '', id, userId]
      );
      if (result.rows.length === 0) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Template not found' }) };
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, template: result.rows[0] }) };
    } catch (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // DELETE - Delete template
  if (event.httpMethod === 'DELETE') {
    try {
      const { id } = JSON.parse(event.body);

      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Template ID is required' }) };
      }

      const result = await pool.query(
        'DELETE FROM lr_email_templates WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId]
      );

      if (result.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Template not found' }) };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Template deleted' })
      };
    } catch (error) {
      console.error('Delete template error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};

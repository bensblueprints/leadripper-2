const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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

/**
 * Batch Email Validation Function
 *
 * Validates all emails for a user that haven't been validated yet
 * Can be called with optional filters
 */
exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
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
    const {
      limit = 100,          // Process max 100 emails per batch
      onlyUnvalidated = true, // Only validate emails that haven't been validated
      checkSMTP = false,     // Skip SMTP check by default for speed
      statsOnly = false      // Just return stats without processing
    } = JSON.parse(event.body || '{}');

    // Get stats first (always needed)
    const statsResult = await pool.query(
      `SELECT
        COUNT(*) as total_leads,
        COUNT(CASE WHEN email_verified = true THEN 1 END) as verified_count,
        COUNT(CASE WHEN is_disposable = true THEN 1 END) as disposable_count,
        COUNT(CASE WHEN is_role_based = true THEN 1 END) as role_based_count,
        ROUND(AVG(CASE WHEN email_score > 0 THEN email_score END), 2) as avg_score
       FROM lr_leads
       WHERE user_id = $1 AND email IS NOT NULL AND email != ''`,
      [decoded.userId]
    );

    const stats = statsResult.rows[0];

    // If stats only, return early
    if (statsOnly || limit === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Email validation stats',
          stats: {
            totalLeads: parseInt(stats.total_leads),
            verifiedEmails: parseInt(stats.verified_count),
            disposableEmails: parseInt(stats.disposable_count),
            roleBasedEmails: parseInt(stats.role_based_count),
            averageScore: parseFloat(stats.avg_score) || 0,
            verificationRate: stats.total_leads > 0
              ? ((parseInt(stats.verified_count) / parseInt(stats.total_leads)) * 100).toFixed(1) + '%'
              : '0%'
          }
        })
      };
    }

    console.log(`Starting batch validation for user ${decoded.userId}`);

    // Build query to get emails to validate
    let emailQuery = `
      SELECT id, email
      FROM lr_leads
      WHERE user_id = $1
        AND email IS NOT NULL
        AND email != ''
    `;

    if (onlyUnvalidated) {
      emailQuery += ` AND (email_validation_date IS NULL OR email_verified = false)`;
    }

    emailQuery += ` LIMIT $2`;

    const emailsResult = await pool.query(emailQuery, [decoded.userId, limit]);
    const emailsToValidate = emailsResult.rows;

    if (emailsToValidate.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'No emails to validate',
          validatedCount: 0,
          totalCount: 0,
          stats: {
            totalLeads: parseInt(stats.total_leads),
            verifiedEmails: parseInt(stats.verified_count),
            disposableEmails: parseInt(stats.disposable_count),
            roleBasedEmails: parseInt(stats.role_based_count),
            averageScore: parseFloat(stats.avg_score) || 0,
            verificationRate: stats.total_leads > 0
              ? ((parseInt(stats.verified_count) / parseInt(stats.total_leads)) * 100).toFixed(1) + '%'
              : '0%'
          }
        })
      };
    }

    console.log(`Found ${emailsToValidate.length} emails to validate`);

    // Validate each email
    let validatedCount = 0;
    let verifiedCount = 0;
    let failedCount = 0;
    const errors = [];

    for (const lead of emailsToValidate) {
      try {
        // Call the validate-email function
        const validateResponse = await fetch(
          `${process.env.URL || 'https://leadripper-2.netlify.app'}/.netlify/functions/validate-email`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: lead.email,
              options: {
                checkSMTP: checkSMTP,
                skipDisposable: true,
                skipRoleBased: false
              }
            })
          }
        );

        if (!validateResponse.ok) {
          throw new Error(`Validation API returned ${validateResponse.status}`);
        }

        const validationResult = await validateResponse.json();

        // Update the lead with validation results
        await pool.query(
          `UPDATE lr_leads SET
            email_verified = $1,
            email_score = $2,
            email_warnings = $3,
            email_validation_date = NOW(),
            is_disposable = $4,
            is_role_based = $5,
            updated_at = NOW()
           WHERE id = $6`,
          [
            validationResult.valid,
            validationResult.score,
            validationResult.warnings.join('; '),
            validationResult.checks.disposable || false,
            validationResult.checks.roleBased || false,
            lead.id
          ]
        );

        validatedCount++;
        if (validationResult.valid) {
          verifiedCount++;
        } else {
          failedCount++;
        }

        console.log(`Validated ${lead.email}: score=${validationResult.score}, valid=${validationResult.valid}`);

      } catch (error) {
        console.error(`Failed to validate ${lead.email}:`, error.message);
        errors.push({ leadId: lead.id, email: lead.email, error: error.message });
        failedCount++;
      }
    }

    // Refresh stats after validation
    const updatedStatsResult = await pool.query(
      `SELECT
        COUNT(*) as total_leads,
        COUNT(CASE WHEN email_verified = true THEN 1 END) as verified_count,
        COUNT(CASE WHEN is_disposable = true THEN 1 END) as disposable_count,
        COUNT(CASE WHEN is_role_based = true THEN 1 END) as role_based_count,
        ROUND(AVG(CASE WHEN email_score > 0 THEN email_score END), 2) as avg_score
       FROM lr_leads
       WHERE user_id = $1 AND email IS NOT NULL AND email != ''`,
      [decoded.userId]
    );

    const updatedStats = updatedStatsResult.rows[0];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Batch validation complete`,
        batch: {
          processed: validatedCount,
          verified: verifiedCount,
          failed: failedCount,
          errors: errors.slice(0, 10) // Only return first 10 errors
        },
        stats: {
          totalLeads: parseInt(updatedStats.total_leads),
          verifiedEmails: parseInt(updatedStats.verified_count),
          disposableEmails: parseInt(updatedStats.disposable_count),
          roleBasedEmails: parseInt(updatedStats.role_based_count),
          averageScore: parseFloat(updatedStats.avg_score) || 0,
          verificationRate: updatedStats.total_leads > 0
            ? ((parseInt(updatedStats.verified_count) / parseInt(updatedStats.total_leads)) * 100).toFixed(1) + '%'
            : '0%'
        }
      })
    };

  } catch (error) {
    console.error('Batch validation error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Batch validation failed',
        message: error.message
      })
    };
  }
};

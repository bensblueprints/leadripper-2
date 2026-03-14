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

// Map ElevenLabs conversation status to our status
function mapStatus(elStatus) {
  const statusMap = {
    'processing': 'in_progress',
    'in_progress': 'in_progress',
    'done': 'completed',
    'completed': 'completed',
    'failed': 'failed',
    'no_answer': 'no_answer',
    'busy': 'busy',
    'voicemail': 'voicemail'
  };
  return statusMap[elStatus] || elStatus || 'unknown';
}

// Try to extract email from transcript text
function extractEmail(transcript) {
  if (!transcript) return null;
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = transcript.match(emailRegex);
  return matches && matches.length > 0 ? matches[0] : null;
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

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const userId = decoded.userId;

  try {
    // Get user's ElevenLabs API key
    const settingsResult = await pool.query(
      'SELECT elevenlabs_api_key FROM lr_user_settings WHERE user_id = $1',
      [userId]
    );

    if (settingsResult.rows.length === 0 || !settingsResult.rows[0].elevenlabs_api_key) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'ElevenLabs API key not configured.' })
      };
    }

    const elevenlabsApiKey = settingsResult.rows[0].elevenlabs_api_key;

    // Parse optional conversation IDs from body
    let conversationIds = null;
    try {
      const body = JSON.parse(event.body || '{}');
      conversationIds = body.conversationIds;
    } catch (e) {
      // No body or invalid JSON, sync all pending
    }

    // Find pending call logs
    let pendingQuery = `
      SELECT id, elevenlabs_conversation_id
      FROM lr_call_logs
      WHERE user_id = $1
        AND elevenlabs_conversation_id IS NOT NULL
        AND status IN ('initiated', 'in_progress')
    `;
    const pendingValues = [userId];

    if (conversationIds && Array.isArray(conversationIds) && conversationIds.length > 0) {
      pendingQuery += ` AND elevenlabs_conversation_id = ANY($2)`;
      pendingValues.push(conversationIds);
    }

    const pendingResult = await pool.query(pendingQuery, pendingValues);

    if (pendingResult.rows.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'No pending calls to sync', updated: 0 })
      };
    }

    const results = [];
    let updatedCount = 0;
    let errorCount = 0;

    for (const callLog of pendingResult.rows) {
      try {
        // Fetch conversation details from ElevenLabs
        const convRes = await fetch(
          `https://api.elevenlabs.io/v1/convai/conversations/${callLog.elevenlabs_conversation_id}`,
          {
            method: 'GET',
            headers: { 'xi-api-key': elevenlabsApiKey }
          }
        );

        if (!convRes.ok) {
          results.push({
            id: callLog.id,
            conversationId: callLog.elevenlabs_conversation_id,
            error: `ElevenLabs API returned ${convRes.status}`
          });
          errorCount++;
          continue;
        }

        const convData = await convRes.json();

        // Extract transcript from conversation data
        let transcriptText = null;
        if (convData.transcript) {
          if (typeof convData.transcript === 'string') {
            transcriptText = convData.transcript;
          } else if (Array.isArray(convData.transcript)) {
            transcriptText = convData.transcript
              .map(t => `${t.role || 'unknown'}: ${t.message || t.text || ''}`)
              .join('\n');
          }
        }

        // Map status
        const newStatus = mapStatus(convData.status);

        // Calculate duration
        const duration = convData.metadata?.call_duration_secs
          || convData.call_duration_secs
          || convData.duration
          || 0;

        // Extract outcome from conversation analysis if available
        const outcome = convData.analysis?.outcome
          || convData.analysis?.call_successful
          || convData.outcome
          || null;

        // Try to extract email from transcript
        const emailCollected = extractEmail(transcriptText)
          || convData.analysis?.email
          || convData.collected_data?.email
          || null;

        // Try to get recording URL
        let recordingUrl = null;
        try {
          const audioRes = await fetch(
            `https://api.elevenlabs.io/v1/convai/conversations/${callLog.elevenlabs_conversation_id}/audio`,
            {
              method: 'GET',
              headers: { 'xi-api-key': elevenlabsApiKey }
            }
          );

          if (audioRes.ok) {
            const audioData = await audioRes.json();
            recordingUrl = audioData.url || audioData.audio_url || null;
          }
        } catch (audioErr) {
          // Recording not available yet, that's okay
        }

        // Update the call log
        await pool.query(
          `UPDATE lr_call_logs SET
            status = $1,
            duration = $2,
            transcript = COALESCE($3, transcript),
            outcome = COALESCE($4, outcome),
            email_collected = COALESCE($5, email_collected),
            recording_url = COALESCE($6, recording_url),
            updated_at = NOW()
           WHERE id = $7`,
          [newStatus, duration, transcriptText, outcome, emailCollected, recordingUrl, callLog.id]
        );

        results.push({
          id: callLog.id,
          conversationId: callLog.elevenlabs_conversation_id,
          status: newStatus,
          duration,
          hasTranscript: !!transcriptText,
          hasRecording: !!recordingUrl,
          emailCollected
        });
        updatedCount++;
      } catch (syncError) {
        results.push({
          id: callLog.id,
          conversationId: callLog.elevenlabs_conversation_id,
          error: syncError.message
        });
        errorCount++;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Synced ${updatedCount} call(s), ${errorCount} error(s)`,
        updated: updatedCount,
        errors: errorCount,
        total: pendingResult.rows.length,
        results
      })
    };
  } catch (error) {
    console.error('Sync call results error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};

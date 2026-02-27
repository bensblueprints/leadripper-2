const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

// This is a scheduled function that runs every 5 minutes
// Configure in netlify.toml: [functions."process-call-queue"] schedule = "*/5 * * * *"

exports.handler = async (event, context) => {
  console.log('Processing call queue...');

  try {
    // Get pending calls that are due
    const pendingCalls = await pool.query(
      `SELECT cq.*, l.business_name, l.phone, l.website, l.email as existing_email,
              a.voice_id, a.system_prompt, a.greeting_script, a.max_call_duration, a.calendar_link,
              us.elevenlabs_api_key, us.calendar_timezone
       FROM lr_auto_call_queue cq
       JOIN lr_leads l ON l.id = cq.lead_id
       JOIN lr_ai_agents a ON a.id = cq.agent_id
       JOIN lr_user_settings us ON us.user_id = cq.user_id
       WHERE cq.status = 'pending'
         AND cq.scheduled_at <= NOW()
         AND cq.attempts < 3
         AND us.elevenlabs_api_key IS NOT NULL
         AND us.ai_calling_enabled = true
       ORDER BY
         CASE cq.priority
           WHEN 'high' THEN 1
           WHEN 'normal' THEN 2
           WHEN 'low' THEN 3
         END,
         cq.scheduled_at ASC
       LIMIT 10`
    );

    console.log(`Found ${pendingCalls.rows.length} calls to process`);

    for (const call of pendingCalls.rows) {
      try {
        // Update status to in_progress
        await pool.query(
          `UPDATE lr_auto_call_queue SET
            status = 'in_progress',
            last_attempt_at = NOW(),
            attempts = attempts + 1
           WHERE id = $1`,
          [call.id]
        );

        // Build context-aware system prompt for email collection
        let systemPrompt = call.system_prompt || '';

        if (call.purpose === 'collect_email') {
          systemPrompt = `${systemPrompt}

IMPORTANT CONTEXT:
- You are calling ${call.business_name || 'a business'}.
- Your PRIMARY GOAL is to collect their email address.
- Be professional, friendly, and brief.
- If they provide an email, confirm it by spelling it back.
- After collecting the email, ask if you can speak with the decision maker or schedule a meeting.
- If you reach voicemail, leave a brief professional message and note to call back.

CALL FLOW:
1. Greet professionally, introduce yourself
2. Explain you're reaching out about [relevant topic]
3. Ask for their email to send more information
4. Once you have the email, ask about decision makers
5. Try to schedule a meeting or get transferred
6. Thank them and end professionally

EXTRACTED DATA FORMAT:
When you collect information, format it as:
EMAIL: [email address]
DECISION_MAKER: [name if provided]
MEETING_SCHEDULED: [yes/no]
NOTES: [any relevant notes]`;
        }

        // Create call log
        const callLogResult = await pool.query(
          `INSERT INTO lr_call_logs (
            user_id, agent_id, phone_number, direction, status,
            metadata
          ) VALUES ($1, $2, $3, 'outbound', 'initiated', $4)
          RETURNING *`,
          [
            call.user_id,
            call.agent_id,
            call.phone_number,
            JSON.stringify({
              queueId: call.id,
              leadId: call.lead_id,
              purpose: call.purpose,
              businessName: call.business_name
            })
          ]
        );

        const callLog = callLogResult.rows[0];

        // Initiate ElevenLabs call
        const elevenlabsResponse = await fetch('https://api.elevenlabs.io/v1/convai/conversation', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': call.elevenlabs_api_key
          },
          body: JSON.stringify({
            voice_id: call.voice_id,
            phone_number: call.phone_number,
            first_message: call.greeting_script || `Hello! This is a call regarding ${call.business_name || 'your business'}. Is this a good time to speak?`,
            system_prompt: systemPrompt,
            max_duration: call.max_call_duration || 180,
            webhook_url: `${process.env.URL || 'https://leadripper.com'}/.netlify/functions/elevenlabs-webhook`,
            metadata: {
              call_log_id: callLog.id.toString(),
              queue_id: call.id.toString(),
              user_id: call.user_id.toString(),
              agent_id: call.agent_id.toString(),
              lead_id: call.lead_id.toString(),
              purpose: call.purpose
            }
          })
        });

        const elevenlabsResult = await elevenlabsResponse.json();

        if (!elevenlabsResponse.ok) {
          console.error('ElevenLabs call failed:', elevenlabsResult);

          await pool.query(
            `UPDATE lr_call_logs SET status = 'failed', ended_at = NOW() WHERE id = $1`,
            [callLog.id]
          );

          // If permanent failure, mark queue item as failed
          if (call.attempts >= 2) {
            await pool.query(
              `UPDATE lr_auto_call_queue SET
                status = 'failed',
                error_message = $1
               WHERE id = $2`,
              [elevenlabsResult.detail || 'API error', call.id]
            );
          } else {
            // Reschedule for later
            await pool.query(
              `UPDATE lr_auto_call_queue SET
                status = 'pending',
                scheduled_at = NOW() + INTERVAL '30 minutes'
               WHERE id = $1`,
              [call.id]
            );
          }

          continue;
        }

        // Update call log with ElevenLabs ID
        await pool.query(
          `UPDATE lr_call_logs SET
            elevenlabs_call_id = $1,
            status = 'ringing',
            started_at = NOW()
           WHERE id = $2`,
          [elevenlabsResult.conversation_id || elevenlabsResult.call_id, callLog.id]
        );

        console.log(`Call initiated for queue ${call.id}, call log ${callLog.id}`);

      } catch (callError) {
        console.error(`Error processing queue item ${call.id}:`, callError);

        // Reschedule failed call
        await pool.query(
          `UPDATE lr_auto_call_queue SET
            status = 'pending',
            scheduled_at = NOW() + INTERVAL '30 minutes',
            error_message = $1
           WHERE id = $2`,
          [callError.message, call.id]
        );
      }
    }

    // Clean up old completed/failed queue items (older than 30 days)
    await pool.query(
      `DELETE FROM lr_auto_call_queue
       WHERE status IN ('completed', 'failed')
         AND updated_at < NOW() - INTERVAL '30 days'`
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        processed: pendingCalls.rows.length
      })
    };

  } catch (error) {
    console.error('Call queue processor error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

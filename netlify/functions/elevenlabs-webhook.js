const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

// Extract email from transcript using regex patterns
function extractEmailFromTranscript(transcript) {
  if (!transcript) return null;

  // Look for EMAIL: pattern first (from our structured output)
  const structuredMatch = transcript.match(/EMAIL:\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (structuredMatch) return structuredMatch[1].toLowerCase();

  // Look for common email patterns
  const emailRegex = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/gi;
  const emails = transcript.match(emailRegex);

  if (emails && emails.length > 0) {
    // Filter out obvious non-business emails
    const filteredEmails = emails.filter(email => {
      const lower = email.toLowerCase();
      return !lower.includes('example.com') &&
             !lower.includes('test.com') &&
             !lower.includes('leadripper') &&
             !lower.includes('elevenlabs');
    });
    if (filteredEmails.length > 0) {
      return filteredEmails[0].toLowerCase();
    }
  }

  // Try to reconstruct spelled-out email
  const spelledOutMatch = transcript.match(/(?:email|address)(?:\s+is)?[:\s]+([a-z0-9]+)\s+at\s+([a-z0-9]+)\s+(?:dot|\.)\s+([a-z]{2,})/i);
  if (spelledOutMatch) {
    return `${spelledOutMatch[1]}@${spelledOutMatch[2]}.${spelledOutMatch[3]}`.toLowerCase();
  }

  return null;
}

// Extract decision maker name from transcript
function extractDecisionMaker(transcript) {
  if (!transcript) return null;

  const structuredMatch = transcript.match(/DECISION_MAKER:\s*([^\n]+)/i);
  if (structuredMatch && structuredMatch[1].trim().toLowerCase() !== 'n/a') {
    return structuredMatch[1].trim();
  }

  // Look for common patterns
  const patterns = [
    /speak (?:with|to) ([A-Z][a-z]+ [A-Z][a-z]+)/,
    /(?:owner|manager|director|decision maker) (?:is|named?) ([A-Z][a-z]+ [A-Z][a-z]+)/i,
    /(?:name is|I'm|this is) ([A-Z][a-z]+ [A-Z][a-z]+)/
  ];

  for (const pattern of patterns) {
    const match = transcript.match(pattern);
    if (match) return match[1];
  }

  return null;
}

// Check if meeting was scheduled
function checkMeetingScheduled(transcript) {
  if (!transcript) return false;

  const structuredMatch = transcript.match(/MEETING_SCHEDULED:\s*(yes|true)/i);
  if (structuredMatch) return true;

  const lower = transcript.toLowerCase();
  return (lower.includes('scheduled') || lower.includes('booked')) &&
         (lower.includes('meeting') || lower.includes('appointment') || lower.includes('call'));
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
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

  try {
    const payload = JSON.parse(event.body);
    console.log('ElevenLabs webhook received:', JSON.stringify(payload, null, 2));

    const {
      event_type, // 'call.started', 'call.ended', 'call.answered', 'transcript.update', etc.
      conversation_id,
      call_id,
      metadata,
      data
    } = payload;

    const callLogId = metadata?.call_log_id;
    const elevenlabsCallId = conversation_id || call_id;

    if (!callLogId && !elevenlabsCallId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing call identification' })
      };
    }

    // Find the call log
    let callLog;
    if (callLogId) {
      const result = await pool.query(
        `SELECT * FROM lr_call_logs WHERE id = $1`,
        [callLogId]
      );
      callLog = result.rows[0];
    } else if (elevenlabsCallId) {
      const result = await pool.query(
        `SELECT * FROM lr_call_logs WHERE elevenlabs_call_id = $1`,
        [elevenlabsCallId]
      );
      callLog = result.rows[0];
    }

    if (!callLog) {
      console.log('Call log not found for:', { callLogId, elevenlabsCallId });
      return {
        statusCode: 200, // Return 200 to prevent retries
        headers,
        body: JSON.stringify({ message: 'Call log not found, ignoring webhook' })
      };
    }

    // Process different event types
    switch (event_type) {
      case 'call.started':
      case 'call.ringing':
        await pool.query(
          `UPDATE lr_call_logs SET status = 'ringing', started_at = COALESCE(started_at, NOW())
           WHERE id = $1`,
          [callLog.id]
        );
        break;

      case 'call.answered':
        await pool.query(
          `UPDATE lr_call_logs SET status = 'in_progress'
           WHERE id = $1`,
          [callLog.id]
        );
        break;

      case 'call.ended':
      case 'conversation.ended':
        const duration = data?.duration_seconds || data?.duration || 0;
        const transcript = data?.transcript || data?.full_transcript || null;
        const recordingUrl = data?.recording_url || null;

        // Extract structured data from transcript
        const extractedEmail = extractEmailFromTranscript(transcript);
        const decisionMaker = extractDecisionMaker(transcript);
        const meetingScheduled = checkMeetingScheduled(transcript);

        // Analyze outcome from transcript or data
        let outcome = 'unknown';
        let sentiment = 'neutral';

        if (data?.outcome) {
          outcome = data.outcome;
        } else if (extractedEmail) {
          outcome = 'email_collected';
        } else if (meetingScheduled) {
          outcome = 'scheduled';
        } else if (transcript) {
          const lowerTranscript = transcript.toLowerCase();
          if (lowerTranscript.includes('schedule') || lowerTranscript.includes('book') || lowerTranscript.includes('appointment')) {
            outcome = 'scheduled';
          } else if (lowerTranscript.includes('not interested') || lowerTranscript.includes('no thank')) {
            outcome = 'not_interested';
          } else if (lowerTranscript.includes('call back') || lowerTranscript.includes('later')) {
            outcome = 'callback';
          } else if (lowerTranscript.includes('voicemail')) {
            outcome = 'voicemail';
          }
        }

        if (data?.sentiment) {
          sentiment = data.sentiment;
        }

        // Determine status
        let status = 'completed';
        if (data?.call_status === 'no_answer' || data?.status === 'no_answer') {
          status = 'no_answer';
          outcome = 'no_answer';
        } else if (data?.call_status === 'busy' || data?.status === 'busy') {
          status = 'failed';
          outcome = 'busy';
        } else if (data?.call_status === 'failed' || data?.status === 'failed') {
          status = 'failed';
          outcome = 'failed';
        }

        // Store extracted data in call log
        const extractedData = {
          email: extractedEmail,
          decisionMaker,
          meetingScheduled
        };

        await pool.query(
          `UPDATE lr_call_logs SET
            status = $1,
            duration_seconds = $2,
            transcript = $3,
            recording_url = $4,
            sentiment = $5,
            outcome = $6,
            extracted_data = $7,
            ended_at = NOW()
           WHERE id = $8`,
          [status, duration, transcript, recordingUrl, sentiment, outcome, JSON.stringify(extractedData), callLog.id]
        );

        // Get queue info and lead ID from metadata
        const queueId = metadata?.queue_id;
        const leadId = metadata?.lead_id;
        const purpose = metadata?.purpose;

        // If email was collected, update the lead record
        if (extractedEmail && leadId) {
          await pool.query(
            `UPDATE lr_leads SET
              email = $1,
              email_source = 'ai_call',
              email_collected_at = NOW(),
              decision_maker_name = COALESCE($2, decision_maker_name),
              updated_at = NOW()
             WHERE id = $3 AND (email IS NULL OR email = '')`,
            [extractedEmail, decisionMaker, leadId]
          );
          console.log(`Email ${extractedEmail} collected and saved to lead ${leadId}`);
        }

        // Update auto-call queue if this was from the queue
        if (queueId) {
          let queueStatus = 'completed';
          let queueOutcome = outcome;

          if (status === 'no_answer' || status === 'failed') {
            // Check if we should retry
            const queueResult = await pool.query(
              `SELECT attempts FROM lr_auto_call_queue WHERE id = $1`,
              [queueId]
            );

            if (queueResult.rows.length > 0 && queueResult.rows[0].attempts < 3) {
              queueStatus = 'pending';
              // Reschedule for later
              await pool.query(
                `UPDATE lr_auto_call_queue SET
                  status = 'pending',
                  scheduled_at = NOW() + INTERVAL '2 hours',
                  outcome = $1,
                  call_log_id = $2
                 WHERE id = $3`,
                [queueOutcome, callLog.id, queueId]
              );
            } else {
              queueStatus = 'failed';
            }
          }

          if (queueStatus !== 'pending') {
            await pool.query(
              `UPDATE lr_auto_call_queue SET
                status = $1,
                outcome = $2,
                call_log_id = $3,
                email_collected = $4,
                completed_at = NOW()
               WHERE id = $5`,
              [queueStatus, queueOutcome, callLog.id, extractedEmail, queueId]
            );
          }

          // If email collected and purpose was collect_email, optionally schedule follow-up
          if (extractedEmail && purpose === 'collect_email' && !meetingScheduled) {
            // Get user settings to see if auto-follow-up is enabled
            const settingsResult = await pool.query(
              `SELECT auto_followup_enabled, followup_agent_id FROM lr_user_settings WHERE user_id = $1`,
              [callLog.user_id]
            );

            if (settingsResult.rows.length > 0 && settingsResult.rows[0].auto_followup_enabled) {
              const followupAgentId = settingsResult.rows[0].followup_agent_id;

              if (followupAgentId) {
                // Schedule a follow-up call to reach decision maker
                await pool.query(
                  `INSERT INTO lr_auto_call_queue (
                    user_id, lead_id, agent_id, phone_number, scheduled_at,
                    priority, purpose
                  ) SELECT $1, $2, $3, phone_number, NOW() + INTERVAL '1 day', 'normal', 'reach_decision_maker'
                  FROM lr_auto_call_queue WHERE id = $4`,
                  [callLog.user_id, leadId, followupAgentId, queueId]
                );
              }
            }
          }
        }

        // Add activity to deal if linked
        if (callLog.deal_id) {
          const outcomeText = outcome === 'scheduled' ? '📅 Meeting scheduled!' :
                              outcome === 'callback' ? '📞 Callback requested' :
                              outcome === 'not_interested' ? '❌ Not interested' :
                              outcome === 'voicemail' ? '📧 Left voicemail' :
                              outcome === 'no_answer' ? '📵 No answer' :
                              '📞 Call completed';

          await pool.query(
            `INSERT INTO lr_crm_activities (deal_id, user_id, activity_type, subject, content, metadata)
             VALUES ($1, $2, 'call', $3, $4, $5)`,
            [
              callLog.deal_id,
              callLog.user_id,
              outcomeText,
              `AI call completed. Duration: ${Math.round(duration)}s. Outcome: ${outcome}`,
              JSON.stringify({
                callLogId: callLog.id,
                duration,
                outcome,
                sentiment
              })
            ]
          );

          // Update deal's last activity
          await pool.query(
            `UPDATE lr_crm_deals SET last_activity_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [callLog.deal_id]
          );
        }

        // If meeting was scheduled, try to extract the time
        if (outcome === 'scheduled' && data?.scheduled_time) {
          await pool.query(
            `UPDATE lr_call_logs SET scheduled_meeting_at = $1
             WHERE id = $2`,
            [data.scheduled_time, callLog.id]
          );

          // Create calendar event if deal is linked
          if (callLog.deal_id) {
            // Get deal and user info for calendar event
            const dealResult = await pool.query(
              `SELECT d.*, l.business_name, l.email, l.phone
               FROM lr_crm_deals d
               LEFT JOIN lr_leads l ON l.id = d.lead_id
               WHERE d.id = $1`,
              [callLog.deal_id]
            );

            if (dealResult.rows.length > 0) {
              const deal = dealResult.rows[0];
              const meetingTime = new Date(data.scheduled_time);
              const endTime = new Date(meetingTime.getTime() + 30 * 60000); // 30 min meeting

              await pool.query(
                `INSERT INTO lr_calendar_events (
                  user_id, deal_id, title, description,
                  start_time, end_time, attendee_email, attendee_phone, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled')`,
                [
                  callLog.user_id,
                  callLog.deal_id,
                  `Meeting: ${deal.title || deal.business_name || 'Scheduled Call'}`,
                  `Meeting scheduled via AI call.\nDeal: ${deal.title || 'N/A'}\nCompany: ${deal.contact_company || deal.business_name || 'N/A'}`,
                  meetingTime,
                  endTime,
                  deal.contact_email || deal.email,
                  deal.contact_phone || deal.phone
                ]
              );
            }
          }
        }
        break;

      case 'transcript.update':
        // Optional: Store partial transcripts
        if (data?.transcript) {
          await pool.query(
            `UPDATE lr_call_logs SET transcript = $1
             WHERE id = $2`,
            [data.transcript, callLog.id]
          );
        }
        break;

      default:
        console.log('Unhandled ElevenLabs webhook event:', event_type);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Webhook processed' })
    };

  } catch (error) {
    console.error('ElevenLabs webhook error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', message: error.message })
    };
  }
};

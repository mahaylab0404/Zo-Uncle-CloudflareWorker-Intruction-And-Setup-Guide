# Project Context: Voicemail Notification Agent

## What We're Building

A Cloudflare Worker that receives a webhook from an ElevenLabs Conversational AI voicemail agent, then sends a high-priority email (via Resend) and an SMS (via Twilio) to notify the phone's owner about the missed call.

## Architecture

```
Phone call → ElevenLabs AI agent → Webhook POST to Cloudflare Worker → Resend (email) + Twilio (SMS) → Owner gets notified
```

There is ONE Cloudflare Worker with ONE endpoint: `POST /send-notification`

## Who This Is For

A high school AP Biology teacher at Coconut Creek High School in Fort Lauderdale, FL. Key constraints:
- He wakes up around 6am and goes to sleep by 5-6pm
- NO callbacks should be scheduled after 5pm
- He likes detailed information — the email should be thorough and contextual, not just bullet points
- This is personal voicemail, not a business line
- Callers may be parents, students, colleagues, admin, or personal contacts

## Tech Stack Decisions

| Use | Service | Why |
|-----|---------|-----|
| Webhook/backend | Cloudflare Workers | Free, fast, zero maintenance, perfect for webhooks |
| Email | Resend | Simple API key auth, no OAuth, free tier (100/day) |
| SMS | Twilio | Industry standard, simple API, reliable |
| Voice agent | ElevenLabs Conversational AI | Handles the phone call and conversation |

### DO NOT USE
- Google OAuth / Gmail API / Google Calendar API — the owner cannot set up OAuth credentials
- Any service requiring OAuth token refresh flows
- Any calendar integration — the agent just asks the caller their preferred callback time and reports it

## Project Structure

```
voicemail-worker/
├── worker.js          # The Cloudflare Worker
├── wrangler.toml      # Cloudflare configuration
├── package.json       # Project metadata
└── .gitignore
```

Additionally, in the ElevenLabs dashboard:
- System prompt (configured in the agent settings)
- Tool definition JSON (configured in the agent tools section)

## Worker Endpoint Specification

### `POST /send-notification`

**Request body (from ElevenLabs):**

```json
{
  "caller_name": "string (required)",
  "caller_phone": "string (required)",
  "reason": "string (required) — detailed reason for calling",
  "urgency": "string (required) — enum: high, medium, low",
  "wants_callback": "boolean (required)",
  "preferred_callback_day": "string (optional) — e.g. 'Monday', 'tomorrow'",
  "preferred_callback_time": "string (optional) — e.g. 'morning', 'after 2pm'",
  "additional_notes": "string (optional)"
}
```

IMPORTANT: ElevenLabs sometimes wraps parameters in a `parameters` key. Always handle both formats:
```javascript
const body = await request.json();
const data = body.parameters || body;
```

**Actions to perform:**
1. Send a HIGH-PRIORITY email via Resend containing all caller details (HTML formatted, styled, color-coded urgency)
2. Send an SMS via Twilio with a concise summary
3. Return JSON: `{ "success": true/false, "message": "..." }`

**Both actions should run in parallel using `Promise.allSettled()` so one failure doesn't block the other.**

## API Patterns

### Resend (Send Email)

```javascript
const response = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${env.RESEND_API_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    from: env.FROM_EMAIL,
    to: env.NOTIFICATION_EMAIL,
    subject: `Missed Call from ${caller_name} - ${urgency.toUpperCase()} Priority`,
    html: htmlContent,
    headers: {
      "X-Priority": "1",
      "X-MSMail-Priority": "High",
      "Importance": "high"
    }
  })
});
```

- Auth: Bearer token with API key
- Content-Type: application/json
- The `headers` field inside the body sets email priority flags
- Free test sender: `onboarding@resend.dev` (works without domain verification)

### Twilio (Send SMS)

```javascript
const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);

const response = await fetch(
  `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
  {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      From: env.TWILIO_PHONE_NUMBER,
      To: env.NOTIFICATION_PHONE,
      Body: smsBody
    })
  }
);
```

- Auth: Basic auth (SID:TOKEN base64 encoded)
- Content-Type: application/x-www-form-urlencoded (NOT JSON)
- Body is sent as URLSearchParams (NOT JSON.stringify)
- Phone numbers must be E.164 format: +1XXXXXXXXXX

## Environment Variables and Secrets

### wrangler.toml [vars] (non-sensitive)
- `NOTIFICATION_EMAIL` — owner's email address
- `NOTIFICATION_PHONE` — owner's phone number for SMS (+1XXXXXXXXXX format)
- `FROM_EMAIL` — sender email (e.g., `Voicemail <onboarding@resend.dev>`)

### Secrets (set via `wrangler secret put`)
- `RESEND_API_KEY` — from Resend dashboard
- `TWILIO_ACCOUNT_SID` — from Twilio console
- `TWILIO_AUTH_TOKEN` — from Twilio console
- `TWILIO_PHONE_NUMBER` — the Twilio number that sends SMS (+1XXXXXXXXXX)

## Worker Requirements

1. Handle CORS preflight (OPTIONS method → return 204 with CORS headers)
2. Only accept POST to `/send-notification` (return 404 for other paths, 405 for other methods)
3. Parse body with the ElevenLabs quirk handled (`body.parameters || body`)
4. Build styled HTML email:
   - Color-coded urgency badge (red for high, orange for medium, green for low)
   - All caller info clearly displayed
   - Callback preferences section (only shown if wants_callback is true)
   - Additional notes section (only shown if provided)
   - Timestamp of when the call came in
5. Build concise SMS: "Voicemail from [Name] ([Phone]) - [URGENCY]. Reason: [brief]. Callback: [day/time or 'not requested']. Check email for details."
6. Fire email and SMS in parallel with `Promise.allSettled()`
7. Return appropriate status codes (200 success, 400 bad request, 500 server error)
8. Log errors clearly for debugging via `wrangler tail`

## ElevenLabs Tool Schema

The tool definition to add in the ElevenLabs dashboard:

```json
{
  "type": "webhook",
  "name": "send_notification",
  "description": "Send a notification email and text message to the phone owner with the caller's information, reason for calling, urgency level, and callback preferences. Call this tool at the END of every conversation after you have collected all available information from the caller.",
  "api_schema": {
    "url": "https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev/send-notification",
    "method": "POST",
    "request_body_schema": {
      "type": "object",
      "properties": {
        "caller_name": {
          "type": "string",
          "description": "The caller's full name. Use 'Unknown' if they declined to share."
        },
        "caller_phone": {
          "type": "string",
          "description": "The caller's phone number for callback purposes."
        },
        "reason": {
          "type": "string",
          "description": "A detailed summary of why they are calling. Include as much context as possible."
        },
        "urgency": {
          "type": "string",
          "enum": ["high", "medium", "low"],
          "description": "How urgent the call is. High: time-sensitive, safety concern, or deadline-driven. Medium: needs attention within a day or two. Low: general inquiry, can wait."
        },
        "wants_callback": {
          "type": "boolean",
          "description": "Whether the caller would like to receive a callback."
        },
        "preferred_callback_day": {
          "type": "string",
          "description": "The day the caller prefers for a callback (e.g., 'Monday', 'tomorrow', 'this week'). Only provided if wants_callback is true."
        },
        "preferred_callback_time": {
          "type": "string",
          "description": "The time of day the caller prefers (e.g., 'morning', 'after 2pm', 'anytime before 5'). Only if wants_callback is true. Note: no callbacks after 5pm."
        },
        "additional_notes": {
          "type": "string",
          "description": "Any other relevant details, context, or information from the conversation that would be helpful."
        }
      },
      "required": ["caller_name", "caller_phone", "reason", "urgency", "wants_callback"]
    }
  }
}
```

## System Prompt Guidelines

The system prompt for the ElevenLabs agent should:

1. **Identity:** Name the agent, explain whose voicemail this is (without giving too much personal info to strangers)
2. **Greeting:** Warm but professional. "Hi, you've reached [name]'s voicemail. He's not available right now, but I can help make sure he gets your message."
3. **Collection flow (one question at a time):**
   - Who is calling? (name + phone number)
   - What are they calling about? (get detailed context)
   - How urgent is this? (or assess from context)
   - Would they like a callback?
   - If yes: what day works? What time of day? (mention: he's available before 5pm)
4. **Speech style:** Natural, conversational, one question per turn, short sentences
5. **Tool instruction:** "At the end of EVERY call, use the send_notification tool with all collected information."
6. **Edge cases:**
   - Caller won't give name → use "Unknown," still collect everything else
   - Caller is rude → stay professional, end call gracefully, still send notification
   - Caller asks personal questions about the owner → deflect politely

## Urgency Assessment Guidelines

- **HIGH:** Emergency, safety concern, time-sensitive deadline (grades due tomorrow, doctor's office calling, school emergency)
- **MEDIUM:** Needs attention soon but not immediately (parent wanting to discuss grades, colleague about a meeting, scheduling something this week)
- **LOW:** General inquiry, no time pressure (asking about class schedule, community event invite, non-urgent personal matter)

## Email Design

The HTML email should be:
- Clean, scannable, detailed
- Color-coded urgency at the top (big, visible)
- All info clearly labeled
- Callback section conditional (only show if requested)
- Include a timestamp
- Designed for the recipient who "likes details and context" — don't be sparse

## Testing

1. Run `npx wrangler dev` for local testing
2. Send a test POST with curl to verify email + SMS arrive
3. Check email arrives with HIGH PRIORITY flag (look for the ! icon in email clients)
4. Check SMS arrives on the correct phone
5. Deploy with `npx wrangler deploy`
6. Test end-to-end: call the ElevenLabs agent phone number, have a conversation, verify notifications arrive

## Commands Reference

```bash
npm install --save-dev wrangler     # Install Wrangler
npx wrangler login                  # Authenticate with Cloudflare
npx wrangler dev                    # Local development server
npx wrangler deploy                 # Deploy to production
npx wrangler secret put KEY_NAME    # Add a secret
npx wrangler tail                   # Stream live logs
```

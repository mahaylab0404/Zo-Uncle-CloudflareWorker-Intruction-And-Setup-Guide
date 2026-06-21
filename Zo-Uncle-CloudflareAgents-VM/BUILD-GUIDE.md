# Build Guide: Voicemail Notification Agent

This guide teaches you how to build a voicemail agent that answers phone calls, collects information from callers, and notifies you via email and text message. By the end, you'll understand every piece of the architecture and be able to build it yourself.

---

## Table of Contents

1. [What We're Building](#what-were-building)
2. [Why Cloudflare Workers](#why-cloudflare-workers)
3. [The Full Architecture](#the-full-architecture)
4. [The Services We're Using](#the-services-were-using)
5. [How Cloudflare Workers Work](#how-cloudflare-workers-work)
6. [How ElevenLabs Tools Work](#how-elevenlabs-tools-work)
7. [How Resend Works (Email)](#how-resend-works-email)
8. [How Twilio Works (SMS)](#how-twilio-works-sms)
9. [Building the Worker Step by Step](#building-the-worker-step-by-step)
10. [Writing the System Prompt](#writing-the-system-prompt)
11. [Deploying and Connecting Everything](#deploying-and-connecting-everything)
12. [Testing and Debugging](#testing-and-debugging)

---

## What We're Building

A voicemail system that:

1. **Answers calls** via an AI voice agent (ElevenLabs)
2. **Collects info** — who's calling, why, how urgent, callback preference
3. **Sends notifications** — a detailed email (flagged high priority) AND a text message

The caller talks to the AI agent. When the conversation ends, the agent triggers your Cloudflare Worker, which fires off the email and SMS.

---

## Why Cloudflare Workers

This is the key piece you'll want to understand. Here's what a Cloudflare Worker actually is:

### What it is

A Cloudflare Worker is a small piece of JavaScript that runs on Cloudflare's servers whenever someone makes a request to your URL. Think of it like this:

- You write a function
- You deploy it to Cloudflare
- Cloudflare gives you a URL (like `my-worker.your-name.workers.dev`)
- Anytime someone sends a request to that URL, your function runs

That's it. No server to manage. No VM to SSH into. No Docker containers. No nginx. No "is my server still running?" at 2am.

### Why they're great for this project

**Free tier is generous.** 100,000 requests per day. For a voicemail agent that might get 5-20 calls a day, you'll never pay a cent.

**Zero cold start.** Unlike AWS Lambda which can take 500ms-2s to wake up from sleep, Workers start in under 5ms. When ElevenLabs calls your endpoint after a phone call, it responds instantly.

**Global by default.** Your code runs on 300+ data centers worldwide. The request gets handled by whichever server is closest. For a webhook that ElevenLabs calls from their infrastructure, this means minimum latency.

**Stupid simple deployment.** One command: `wrangler deploy`. Done. Your code is live globally in seconds.

**No infrastructure.** There is no server. There is no operating system. There are no security patches. There's no "disk full" or "out of memory" or "process crashed." You write a function, it runs when called, Cloudflare handles literally everything else.

### When to use Workers

Workers are perfect when you need:

- **A webhook endpoint** (exactly what we need — ElevenLabs calls us after each call)
- **An API that calls other APIs** (we receive data, then call Resend + Twilio)
- **Something lightweight** (our logic is: receive JSON → send email → send SMS → done)
- **Something that should just work forever without maintenance**

Workers are NOT ideal for:
- Long-running processes (there's a CPU time limit — 10ms on free, 30s on paid)
- Heavy computation (image processing, ML inference)
- Applications that need persistent connections (WebSockets have limits)

For our use case — receive a webhook, call two APIs, return a response — Workers are the perfect tool.

### How it compares to what you might know

| If you know... | A Worker is like... |
|---|---|
| Express.js | A single route handler, but globally distributed with no `app.listen()` |
| AWS Lambda | Similar concept, but faster cold starts and simpler deployment |
| Flask/FastAPI | One endpoint function, but you never think about hosting |
| Firebase Functions | Very similar, but on Cloudflare's faster edge network |

---

## The Full Architecture

Here's how everything connects:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        THE FLOW OF A CALL                            │
└─────────────────────────────────────────────────────────────────────┘

   Caller dials              ElevenLabs AI agent         Your Cloudflare
   uncle's number ──────────► answers the call           Worker (webhook)
                              │                              │
                              │ Collects:                    │
                              │  - Name                      │
                              │  - Phone                     │
                              │  - Reason                    │
                              │  - Urgency                   │
                              │  - Callback pref             │
                              │                              │
                              │ Call ends, agent fires       │
                              │ the "send_notification"      │
                              │ tool ────────────────────────►│
                              │                              │
                              │                              ├──► Resend API
                              │                              │     (sends email)
                              │                              │
                              │                              ├──► Twilio API
                              │                              │     (sends SMS)
                              │                              │
                              │                              │ Uncle gets:
                              │                              │  📧 High-priority email
                              │                              │  📱 Text message
```

**Key insight:** Your Cloudflare Worker is the bridge between ElevenLabs and the notification services. ElevenLabs calls your Worker's URL. Your Worker calls Resend and Twilio. That's the entire backend.

---

## The Services We're Using

### ElevenLabs Conversational AI
**What:** An AI voice agent that answers phone calls and has natural conversations.
**Role:** Handles the actual phone call. Talks to the caller, asks questions, collects information.
**Why:** It gives you a phone number that routes to an AI agent — no phone system to build.

### Cloudflare Workers
**What:** Serverless functions that run on Cloudflare's edge network.
**Role:** Receives the data from ElevenLabs and sends notifications.
**Why:** Free, fast, zero maintenance, perfect for webhooks.

### Resend (Email)
**What:** An email sending API. You make a POST request, it sends an email.
**Role:** Sends the detailed notification email to your uncle.
**Why:** Dead simple. One API key, one HTTP request, email sent. No OAuth, no token refreshing, no complex setup. Free tier gives you 100 emails/day.

### Twilio (SMS)
**What:** A communications API for SMS, voice, etc.
**Role:** Sends the text message notification.
**Why:** Industry standard for SMS. Simple API. You get a phone number that can send texts.

### Why NOT Google OAuth / Gmail API / Google Calendar?

Google's APIs require OAuth 2.0 — a complex authentication flow where you get a token, refresh it periodically, handle expiration, store credentials securely. It's powerful but way overkill for "send an email when someone calls."

Resend + Twilio use simple API keys. One string. Put it in your Worker's secrets. Done. Same result, 90% less complexity.

---

## How Cloudflare Workers Work

### The basics

Every Worker is a JavaScript file with one job: handle incoming HTTP requests.

The simplest Worker looks like this:

```javascript
export default {
  async fetch(request, env) {
    return new Response("Hello world");
  }
};
```

That's a complete, deployable Worker. When someone hits your URL, it returns "Hello world."

### The `request` object

The `request` parameter contains everything about the incoming HTTP request:
- `request.method` — GET, POST, PUT, etc.
- `request.url` — the full URL that was hit
- `request.headers` — HTTP headers
- `request.json()` — parses the body as JSON (async)

### The `env` object

The `env` parameter contains your environment variables and secrets:
- Env vars (non-sensitive config like `NOTIFICATION_EMAIL`)
- Secrets (sensitive things like `RESEND_API_KEY`)

You set these in your `wrangler.toml` file or via the CLI.

### Routing

Workers don't have a built-in router like Express. You handle routing yourself:

```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/send-notification" && request.method === "POST") {
      // Handle the notification
      return new Response(JSON.stringify({ success: true }));
    }

    return new Response("Not found", { status: 404 });
  }
};
```

### The project files

A Worker project has two key files:

**`worker.js`** — your actual code (the fetch handler above)

**`wrangler.toml`** — configuration file that tells Cloudflare:
- What your Worker is named
- Which account to deploy to
- What env vars to include
- What compatibility settings to use

### The CLI tool: Wrangler

Wrangler is Cloudflare's CLI for managing Workers:

- `wrangler dev` — runs your Worker locally for testing
- `wrangler deploy` — deploys to production (live on the internet)
- `wrangler secret put SECRET_NAME` — securely adds a secret
- `wrangler tail` — streams live logs from your deployed Worker

Install it with: `npm install -g wrangler`

---

## How ElevenLabs Tools Work

### What's a "tool" in ElevenLabs?

In the ElevenLabs Conversational AI dashboard, a "tool" is an action the agent can take during or after a conversation. You define:

1. **When** to use it (described in the system prompt)
2. **What data** to send (a JSON schema of parameters)
3. **Where** to send it (a webhook URL — your Worker!)

### How it works under the hood

1. The AI agent has a conversation with the caller
2. Based on the system prompt instructions, it decides to call the `send_notification` tool
3. ElevenLabs packages up the parameters (caller_name, reason, urgency, etc.) into a JSON body
4. ElevenLabs makes a POST request to your webhook URL
5. Your Worker receives that POST, processes it, and returns a response

### The tool definition

You configure tools in the ElevenLabs dashboard as JSON. Here's what the schema looks like:

```json
{
  "type": "webhook",
  "name": "send_notification",
  "description": "Send notification with caller info",
  "api_schema": {
    "url": "https://your-worker.workers.dev/send-notification",
    "method": "POST",
    "request_body_schema": {
      "type": "object",
      "properties": {
        "caller_name": { "type": "string" },
        "reason": { "type": "string" }
      }
    }
  }
}
```

The `description` helps the AI decide WHEN to use the tool. The `properties` define WHAT data it sends. The `url` is WHERE it sends it.

### Important quirk: the request body format

When ElevenLabs calls your webhook, it sometimes wraps the parameters inside a `parameters` key:

```json
{
  "parameters": {
    "caller_name": "John",
    "reason": "About grades"
  }
}
```

Other times it sends them flat. So in your Worker, always handle both:

```javascript
const body = await request.json();
const data = body.parameters || body;
```

---

## How Resend Works (Email)

### The concept

Resend is an email API. You send it a POST request with the email details, it delivers the email. That's it.

### Sending an email

```javascript
await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    from: "Voicemail <notifications@yourdomain.com>",
    to: "uncle@email.com",
    subject: "Missed Call - High Priority",
    html: "<h1>You missed a call</h1><p>...</p>",
    headers: {
      "X-Priority": "1",
      "Importance": "high"
    }
  })
});
```

### Key points

- **Authentication:** Just an API key in the `Authorization` header. No OAuth flow.
- **High priority flag:** The `headers` field lets you set email priority headers. Most email clients will flag these.
- **HTML content:** You can send styled HTML emails (bold, colors, tables, etc.)
- **Free tier:** 100 emails/day, 3,000/month. More than enough for a voicemail agent.
- **Test sender:** Before verifying a domain, you can use `onboarding@resend.dev` as the sender.

### Why not Gmail API?

Gmail API requires:
1. Creating a Google Cloud project
2. Enabling the Gmail API
3. Setting up OAuth consent screen
4. Getting OAuth credentials
5. Running an OAuth flow to get a refresh token
6. Writing code to refresh the token when it expires
7. Storing credentials securely

Resend requires:
1. Sign up
2. Copy API key
3. Make a POST request

Same result. 90% less work.

---

## How Twilio Works (SMS)

### The concept

Twilio gives you a phone number that can send and receive SMS. You make an API call, they send the text.

### Sending an SMS

```javascript
const auth = btoa(`${ACCOUNT_SID}:${AUTH_TOKEN}`);

await fetch(
  `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
  {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      From: "+1234567890",  // Your Twilio number
      To: "+1987654321",    // Uncle's number
      Body: "Missed call from John - HIGH urgency. Check email."
    })
  }
);
```

### Key points

- **Authentication:** Basic auth (account SID + auth token, base64 encoded). No OAuth.
- **Phone number:** You need a Twilio phone number (~$1/month) that has SMS capability.
- **Cost:** About $0.0079 per outbound SMS. Pennies.
- **Body format:** `application/x-www-form-urlencoded` (not JSON!) — use `URLSearchParams`.
- **Phone format:** Numbers must be in E.164 format: `+1XXXXXXXXXX`

---

## Building the Worker Step by Step

### Step 1: Set up the project

```bash
mkdir voicemail-worker
cd voicemail-worker
npm init -y
npm install --save-dev wrangler
```

### Step 2: Create wrangler.toml

This is your config file. It tells Cloudflare about your Worker:

```toml
name = "voicemail-notification-worker"
main = "worker.js"
compatibility_date = "2025-01-01"

[vars]
NOTIFICATION_EMAIL = "uncle@email.com"
NOTIFICATION_PHONE = "+1XXXXXXXXXX"
FROM_EMAIL = "Voicemail <onboarding@resend.dev>"
```

Non-sensitive values go in `[vars]`. Sensitive values (API keys) go as secrets via the CLI.

### Step 3: Write the Worker

Your `worker.js` needs to:

1. Handle CORS (preflight OPTIONS requests)
2. Route POST requests to `/send-notification`
3. Parse the request body (handle ElevenLabs' format quirk)
4. Build an HTML email with all caller details
5. Send the email via Resend
6. Send the SMS via Twilio
7. Return success/failure

See `reference/worker-example.js` for the full annotated code.

### Step 4: Add secrets

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler secret put TWILIO_PHONE_NUMBER
```

Each command will prompt you to paste the value. These are stored encrypted by Cloudflare — they never appear in your code or config files.

### Step 5: Test locally

```bash
npx wrangler dev
```

This starts a local server (usually `http://localhost:8787`). You can test with curl:

```bash
curl -X POST http://localhost:8787/send-notification \
  -H "Content-Type: application/json" \
  -d '{"caller_name":"Test","caller_phone":"+15551234567","reason":"Testing","urgency":"low","wants_callback":false}'
```

### Step 6: Deploy

```bash
npx wrangler deploy
```

Cloudflare gives you a URL like: `https://voicemail-notification-worker.your-subdomain.workers.dev`

That URL is what you'll put in the ElevenLabs tool configuration.

---

## Writing the System Prompt

The system prompt tells the ElevenLabs agent how to behave. It's the personality, the rules, and the conversation flow.

### Key sections to include

**Identity:** Who the agent is, whose voicemail this is.

**Conversation flow:** The step-by-step of what to ask:
1. Greet the caller, explain the person is unavailable
2. Ask who's calling (name and phone number)
3. Ask why they're calling (get detail)
4. Assess urgency
5. Ask if they'd like a callback
6. If yes — ask what day and time works (remind: no calls after 5pm)
7. Wrap up and trigger the notification tool

**Speech guidelines:**
- One question at a time (don't barrage the caller)
- Use natural language (contractions, short sentences)
- Spell out numbers digit by digit for clarity
- Say times naturally ("three thirty" not "15:30")

**Tool instructions:** Tell the agent WHEN to call `send_notification` — at the end of every call, after collecting all available information.

See `reference/system-prompt-example.md` for a full example tailored to this project.

---

## Deploying and Connecting Everything

Once your Worker is deployed, here's how to wire it all up:

### 1. Get your Worker URL
After `wrangler deploy`, you'll see something like:
```
Published voicemail-notification-worker
  https://voicemail-notification-worker.zo.workers.dev
```

### 2. Configure the ElevenLabs tool
In the ElevenLabs dashboard:
- Go to your agent → Tools
- Add a new webhook tool
- Paste the tool JSON from `reference/tool-schema-example.json`
- Replace the URL with your actual Worker URL

### 3. Set the system prompt
- Go to your agent → System Prompt
- Paste your system prompt (adapted from `reference/system-prompt-example.md`)

### 4. Connect a phone number
- In ElevenLabs, assign a phone number to your agent
- This is the number callers will dial

---

## Testing and Debugging

### Test the Worker directly

Use curl or Postman to send a POST to your deployed Worker URL. You should receive the email and SMS.

### Test the full flow

Call the ElevenLabs phone number. Have a conversation. Hang up. Verify email + SMS arrive.

### Check Worker logs

```bash
npx wrangler tail
```

This streams real-time logs from your deployed Worker. You'll see every request that comes in and any errors.

### Common issues

| Problem | Likely cause | Fix |
|---------|-------------|-----|
| Worker returns 500 | Missing secret (API key not set) | Run `wrangler secret put` for all keys |
| Email not arriving | Wrong `to` address, or check spam | Verify NOTIFICATION_EMAIL env var |
| SMS not arriving | Twilio phone number can't send SMS | Check number capabilities in Twilio console |
| ElevenLabs not calling Worker | Wrong URL in tool config | Copy exact URL from `wrangler deploy` output |
| Tool not triggering | System prompt doesn't mention when to use it | Add explicit instruction to use tool at end of call |
| CORS error in logs | Not handling OPTIONS | Add preflight handler (see example code) |

### Checking API responses

When debugging, log the responses from Resend and Twilio in your Worker:

```javascript
const emailResponse = await fetch("https://api.resend.com/emails", { ... });
console.log("Resend status:", emailResponse.status);
console.log("Resend body:", await emailResponse.text());
```

You'll see these in `wrangler tail` output.

---

## Quick Reference

| Service | Dashboard | Docs |
|---------|-----------|------|
| Cloudflare Workers | dash.cloudflare.com | developers.cloudflare.com/workers |
| Resend | resend.com/dashboard | resend.com/docs |
| Twilio | console.twilio.com | twilio.com/docs/sms |
| ElevenLabs | elevenlabs.io/app | docs.elevenlabs.io |

---

That's everything. Start with `INFO-YOU-NEED.md` to gather your accounts and keys, then use `CLAUDE.md` to have Claude help you write the actual code.

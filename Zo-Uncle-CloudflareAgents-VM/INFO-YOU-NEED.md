# Info You Need Before Starting

Gather all of this before you start building. You'll need these values when you write your config and set up secrets.

---

## Accounts to Create

### 1. Cloudflare (free)
- **Sign up:** https://dash.cloudflare.com/sign-up
- **What you need from it:** Your account ID (found in the dashboard URL or Workers overview page)
- **Install Wrangler CLI:** `npm install -g wrangler` then `wrangler login`

### 2. Resend (free tier — 100 emails/day)
- **Sign up:** https://resend.com
- **What you need from it:** Your API key (Dashboard → API Keys → Create)
- **Optional:** Verify a custom domain if you want emails to come from your own domain. Otherwise use `onboarding@resend.dev` for testing.

### 3. Twilio (pay-as-you-go — ~$1/month for number + pennies per SMS)
- **Sign up:** https://www.twilio.com/try-twilio
- **What you need from it:**
  - Account SID (on your Twilio Console dashboard)
  - Auth Token (on your Twilio Console dashboard — click to reveal)
  - A phone number with SMS capability (Console → Phone Numbers → Buy a Number)
  - The phone number in +1XXXXXXXXXX format

### 4. ElevenLabs (you probably already have this)
- **Sign up:** https://elevenlabs.io
- **What you need from it:** Access to Conversational AI agents in the dashboard

---

## Info About Your Uncle

Fill these in — you'll put them in your Worker config:

| Field | Value | Where it goes |
|-------|-------|---------------|
| Uncle's email address | _______________ | `NOTIFICATION_EMAIL` in wrangler.toml |
| Uncle's phone number | +1_____________ | `NOTIFICATION_PHONE` in wrangler.toml |

---

## Credentials You'll Add as Secrets

These get added via `wrangler secret put` — never put them in code or config files:

| Secret | Where to find it |
|--------|-----------------|
| `RESEND_API_KEY` | Resend Dashboard → API Keys |
| `TWILIO_ACCOUNT_SID` | Twilio Console → Dashboard (top of page) |
| `TWILIO_AUTH_TOKEN` | Twilio Console → Dashboard (click "Show" next to Auth Token) |
| `TWILIO_PHONE_NUMBER` | Twilio Console → Phone Numbers (the number you bought, +1XXXXXXXXXX format) |

---

## Decisions to Make

- [ ] **Agent name:** What should the voicemail assistant call itself? (e.g., "Hey, I'm [Name], [uncle's name]'s voicemail assistant...")
- [ ] **Agent voice:** Pick a voice in ElevenLabs that sounds right for a voicemail assistant
- [ ] **Uncle's name:** What name does the agent use when greeting? ("You've reached [Name]'s voicemail...")
- [ ] **From email:** Do you want to verify a custom domain in Resend, or just use the test sender `onboarding@resend.dev` for now?

---

## Quick Checklist

Before you start building, confirm you have:

- [ ] Cloudflare account created
- [ ] Wrangler CLI installed (`npm install -g wrangler`)
- [ ] Wrangler authenticated (`wrangler login`)
- [ ] Resend account created + API key copied
- [ ] Twilio account created + SID, auth token, and phone number ready
- [ ] ElevenLabs account with Conversational AI access
- [ ] Uncle's email address
- [ ] Uncle's phone number in +1XXXXXXXXXX format
- [ ] Agent name decided
- [ ] Node.js installed on your machine (v18+ recommended)

---

Once you have everything checked off, open Claude, give it the `CLAUDE.md` file from this repo, and say:

> "I have all my credentials ready. Help me build the Cloudflare Worker for this voicemail notification system. Let's start with the project setup."

Claude will have all the context it needs to guide you through the implementation step by step.

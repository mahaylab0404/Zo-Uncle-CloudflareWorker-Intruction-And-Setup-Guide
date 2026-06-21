// ============================================================
// VOICEMAIL NOTIFICATION WORKER — ANNOTATED EXAMPLE
// ============================================================
// This is a reference implementation. Read through it to understand
// how each piece works, then build your own version.
// ============================================================

export default {
  // This function runs every time someone makes a request to your Worker URL.
  // `request` = the incoming HTTP request
  // `env` = your environment variables and secrets from wrangler.toml
  async fetch(request, env) {
    const url = new URL(request.url);

    // --- CORS HANDLING ---
    // Browsers (and some services) send an OPTIONS request first to check
    // if the server accepts cross-origin requests. We allow everything.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // --- ROUTING ---
    // We only have one endpoint. Reject anything else.
    if (url.pathname !== "/send-notification") {
      return jsonResponse({ error: "Not found" }, 404);
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // --- PARSE THE REQUEST BODY ---
    let data;
    try {
      const body = await request.json();
      // ElevenLabs sometimes wraps tool parameters in a "parameters" key.
      // Handle both formats.
      data = body.parameters || body;
    } catch (err) {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    // --- EXTRACT FIELDS ---
    const {
      caller_name = "Unknown",
      caller_phone = "Not provided",
      reason = "No reason given",
      urgency = "medium",
      wants_callback = false,
      preferred_callback_day = "",
      preferred_callback_time = "",
      additional_notes = "",
    } = data;

    // --- SEND NOTIFICATIONS IN PARALLEL ---
    // Promise.allSettled runs both at the same time and waits for both
    // to finish. Unlike Promise.all, it won't fail if one of them fails.
    const [emailResult, smsResult] = await Promise.allSettled([
      sendEmail(env, { caller_name, caller_phone, reason, urgency, wants_callback, preferred_callback_day, preferred_callback_time, additional_notes }),
      sendSMS(env, { caller_name, caller_phone, reason, urgency, wants_callback, preferred_callback_day, preferred_callback_time }),
    ]);

    // --- CHECK RESULTS ---
    const emailOk = emailResult.status === "fulfilled";
    const smsOk = smsResult.status === "fulfilled";

    if (!emailOk) console.error("Email failed:", emailResult.reason);
    if (!smsOk) console.error("SMS failed:", smsResult.reason);

    if (emailOk && smsOk) {
      return jsonResponse({ success: true, message: "Email and SMS sent successfully" });
    } else if (emailOk || smsOk) {
      return jsonResponse({
        success: true,
        message: `Partial success: email ${emailOk ? "sent" : "failed"}, SMS ${smsOk ? "sent" : "failed"}`,
      });
    } else {
      return jsonResponse({ success: false, error: "Both email and SMS failed" }, 500);
    }
  },
};

// ============================================================
// SEND EMAIL VIA RESEND
// ============================================================
async function sendEmail(env, data) {
  const { caller_name, caller_phone, reason, urgency, wants_callback, preferred_callback_day, preferred_callback_time, additional_notes } = data;

  // Build the HTML email body
  const html = buildEmailHTML(data);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: env.NOTIFICATION_EMAIL,
      subject: `📞 Missed Call from ${caller_name} — ${urgency.toUpperCase()} Priority`,
      html: html,
      // These headers flag the email as HIGH PRIORITY in email clients
      headers: {
        "X-Priority": "1",
        "X-MSMail-Priority": "High",
        "Importance": "high",
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Resend API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

// ============================================================
// SEND SMS VIA TWILIO
// ============================================================
async function sendSMS(env, data) {
  const { caller_name, caller_phone, reason, urgency, wants_callback, preferred_callback_day, preferred_callback_time } = data;

  // Build a concise SMS body (SMS has a 160 char limit for single message,
  // but Twilio handles longer messages by splitting them automatically)
  let smsBody = `Voicemail from ${caller_name} (${caller_phone}) - ${urgency.toUpperCase()}. Reason: ${reason.substring(0, 80)}`;

  if (wants_callback) {
    smsBody += `. Callback requested: ${preferred_callback_day || "any day"} ${preferred_callback_time || "any time"}`;
  }

  smsBody += ". Check email for full details.";

  // Twilio uses Basic Auth: base64 encode "SID:TOKEN"
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        // IMPORTANT: Twilio expects form-encoded data, NOT JSON
        "Content-Type": "application/x-www-form-urlencoded",
      },
      // URLSearchParams encodes the data as key=value&key=value format
      body: new URLSearchParams({
        From: env.TWILIO_PHONE_NUMBER,
        To: env.NOTIFICATION_PHONE,
        Body: smsBody,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twilio API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

// ============================================================
// BUILD HTML EMAIL
// ============================================================
function buildEmailHTML(data) {
  const { caller_name, caller_phone, reason, urgency, wants_callback, preferred_callback_day, preferred_callback_time, additional_notes } = data;

  // Color coding for urgency
  const urgencyColors = {
    high: { bg: "#fde8e8", text: "#e74c3c", label: "HIGH" },
    medium: { bg: "#fef3e2", text: "#f39c12", label: "MEDIUM" },
    low: { bg: "#e8f8f0", text: "#27ae60", label: "LOW" },
  };

  const color = urgencyColors[urgency] || urgencyColors.medium;
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

  // Callback section — only shown if the caller wants a callback
  const callbackSection = wants_callback
    ? `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #eee; font-weight: bold; color: #555;">Callback Requested</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">
        Yes — <strong>${preferred_callback_day || "any day"}</strong>, <strong>${preferred_callback_time || "any time"}</strong>
        <br><em style="color: #888; font-size: 13px;">Reminder: no callbacks after 5pm</em>
      </td>
    </tr>`
    : `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #eee; font-weight: bold; color: #555;">Callback Requested</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">No</td>
    </tr>`;

  // Additional notes — only shown if provided
  const notesSection = additional_notes
    ? `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #eee; font-weight: bold; color: #555;">Additional Notes</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">${additional_notes}</td>
    </tr>`
    : "";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">

  <div style="background: ${color.bg}; border-left: 4px solid ${color.text}; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
    <span style="font-size: 18px; font-weight: bold; color: ${color.text};">
      ${color.label} PRIORITY
    </span>
    <span style="color: #666; margin-left: 12px;">Missed call at ${timestamp}</span>
  </div>

  <h2 style="margin: 0 0 16px 0; color: #222;">Missed Call from ${caller_name}</h2>

  <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #eee; font-weight: bold; color: #555; width: 160px;">Caller Name</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">${caller_name}</td>
    </tr>
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #eee; font-weight: bold; color: #555;">Phone Number</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee;"><a href="tel:${caller_phone}" style="color: #2563eb;">${caller_phone}</a></td>
    </tr>
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #eee; font-weight: bold; color: #555;">Reason for Calling</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">${reason}</td>
    </tr>
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #eee; font-weight: bold; color: #555;">Urgency</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">
        <span style="background: ${color.bg}; color: ${color.text}; padding: 4px 10px; border-radius: 12px; font-weight: bold; font-size: 13px;">
          ${color.label}
        </span>
      </td>
    </tr>
    ${callbackSection}
    ${notesSection}
  </table>

  <p style="color: #888; font-size: 13px; border-top: 1px solid #eee; padding-top: 16px;">
    This notification was sent automatically by your voicemail assistant.
  </p>

</body>
</html>`;
}

// ============================================================
// HELPER: Return a JSON response with proper headers
// ============================================================
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

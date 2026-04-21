import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

// Disable Vercel's body parser so we can read the raw bytes for signature verification
export const config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;

  // Header format: "t=<timestamp>,v1=<hex-hmac-sha256>"
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => p.split('='))
  );
  const { t: timestamp, v1: signature } = parts;
  if (!timestamp || !signature) return false;

  // Reject requests older than 30 minutes
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 1800) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const signatureHeader = req.headers['elevenlabs-signature'];
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;

  if (!secret || !verifySignature(rawBody, signatureHeader, secret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const body = JSON.parse(rawBody.toString('utf8'));
  const { transcript } = body;
  if (!transcript) {
    return res.status(400).json({ error: 'transcript is required' });
  }

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Extract the following from this call transcript and respond in exactly this format:

Caller Name: [name or "Unknown"]
Phone Number: [phone or "Not provided"]
Reason for Call: [1-2 sentence summary]
Action Items:
- [item 1]
- [item 2]

Transcript:
${transcript}`,
      },
    ],
  });

  const summary = message.content[0].text;

  const now = new Date();
  const dateStr = now.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZoneName: 'short',
  });

  await resend.emails.send({
    from: 'Uldrix <noreply@uldrix.com>',
    to: 'john@uldrix.com',
    subject: `New Call Summary — ${dateStr}`,
    text: `Call Summary\n${dateStr}\n\n${summary}`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="font-size:20px;font-weight:700;margin-bottom:4px">Call Summary</h2>
  <p style="color:#888;font-size:14px;margin-bottom:24px">${dateStr}</p>
  <pre style="font-family:sans-serif;font-size:15px;line-height:1.7;white-space:pre-wrap">${summary}</pre>
</div>`,
  });

  return res.status(200).json({ success: true });
}

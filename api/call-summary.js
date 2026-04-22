// import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import twilio from 'twilio';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// // Disable Vercel's body parser so we can read the raw bytes for signature verification
// export const config = { api: { bodyParser: false } };

// function getRawBody(req) {
//   return new Promise((resolve, reject) => {
//     const chunks = [];
//     req.on('data', (chunk) => chunks.push(chunk));
//     req.on('end', () => resolve(Buffer.concat(chunks)));
//     req.on('error', reject);
//   });
// }

// function verifySignature(rawBody, signatureHeader, secret) {
//   if (!signatureHeader) return false;
//   const parts = Object.fromEntries(
//     signatureHeader.split(',').map((p) => p.split('='))
//   );
//   const { t: timestamp, v1: signature } = parts;
//   if (!timestamp || !signature) return false;
//   const age = Math.abs(Date.now() / 1000 - Number(timestamp));
//   if (age > 1800) return false;
//   const expected = crypto
//     .createHmac('sha256', secret)
//     .update(`${timestamp}.${rawBody.toString('utf8')}`)
//     .digest('hex');
//   return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
// }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // const rawBody = await getRawBody(req);
  // const signatureHeader = req.headers['elevenlabs-signature'];
  // const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  // if (!secret || !verifySignature(rawBody, signatureHeader, secret)) {
  //   return res.status(401).json({ error: 'Invalid signature' });
  // }

  // const body = JSON.parse(rawBody.toString('utf8'));
  console.log('ElevenLabs webhook body:', JSON.stringify(req.body, null, 2));
  console.log('ElevenLabs webhook data:', JSON.stringify(req.body.data, null, 2));

  const data = req.body.data;
  if (!data) {
    return res.status(400).json({ error: 'data is required' });
  }

  if (data.metadata?.conversation_initiation_source !== 'twilio') {
    console.log('Not a Twilio call, skipping. Source:', data.metadata?.conversation_initiation_source);
    return res.status(200).json({ success: true });
  }

  const transcript = data.transcript;
  if (!transcript) {
    return res.status(400).json({ error: 'transcript is required' });
  }

  const transcriptText = transcript
    .map(t => `${t.role === 'agent' ? 'Agent' : 'Caller'}: ${t.message || ''}`)
    .filter(line => !line.endsWith(': '))
    .join('\n');

  let message;
  try {
    message = await anthropic.messages.create({
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
${transcriptText}`,
        },
      ],
    });
  } catch (err) {
    console.error('Anthropic error:', err);
    return res.status(500).json({ error: 'Failed to summarize transcript' });
  }

  const summary = message.content[0].text;

  const now = new Date();
  const dateStr = now.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZoneName: 'short',
  });

  try {
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
  } catch (err) {
    console.error('Resend error:', err);
    return res.status(500).json({ error: 'Failed to send email' });
  }

  const callerNumber = req.body.data?.metadata?.phone_call?.external_number;
  if (callerNumber) {
    try {
      await twilioClient.messages.create({
        body: 'Hi, thanks for calling! We received your message and will follow up with you shortly. - Uldrix',
        from: process.env.TWILIO_PHONE_NUMBER,
        to: callerNumber,
      });
    } catch (err) {
      console.error('Twilio error:', err);
    }
  } else {
    console.log('No caller phone number found, skipping SMS');
  }

  return res.status(200).json({ success: true });
}

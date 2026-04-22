import { google } from 'googleapis';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { client_id, date, time, caller_name, caller_phone, service_description } = req.body;
  if (!client_id || !date || !time) {
    return res.status(400).json({ error: 'client_id, date, and time are required' });
  }

  const raw = await redis.get(`client:${client_id}:tokens`);
  if (!raw) {
    return res.status(404).json({ error: `No tokens found for client: ${client_id}` });
  }

  const tokens = typeof raw === 'string' ? JSON.parse(raw) : raw;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials(tokens);

  oauth2Client.on('tokens', async (updated) => {
    const merged = { ...tokens, ...updated };
    await redis.set(`client:${client_id}:tokens`, JSON.stringify(merged));
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const startTime = new Date(`${date}T${time}`);
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1-hour default

  const description = [
    caller_phone ? `Phone: ${caller_phone}` : null,
    service_description ? `Service: ${service_description}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  let event;
  try {
    const { data } = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: caller_name ? `Appointment — ${caller_name}` : 'Appointment',
        description: description || undefined,
        start: { dateTime: startTime.toISOString() },
        end: { dateTime: endTime.toISOString() },
      },
    });
    event = data;
  } catch (err) {
    console.error('Google Calendar insert error:', err);
    return res.status(500).json({ error: 'Failed to create calendar event' });
  }

  return res.status(200).json({
    success: true,
    event_id: event.id,
    event_link: event.htmlLink,
    start: event.start.dateTime,
    end: event.end.dateTime,
  });
}

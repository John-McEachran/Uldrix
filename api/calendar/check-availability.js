import { google } from 'googleapis';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { client_id, date, duration_minutes = 30 } = req.body;
  if (!client_id || !date) {
    return res.status(400).json({ error: 'client_id and date are required' });
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

  // Refresh and persist updated tokens if needed
  oauth2Client.on('tokens', async (updated) => {
    const merged = { ...tokens, ...updated };
    await redis.set(`client:${client_id}:tokens`, JSON.stringify(merged));
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);

  let busyPeriods;
  try {
    const { data } = await calendar.freebusy.query({
      requestBody: {
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        items: [{ id: 'primary' }],
      },
    });
    busyPeriods = data.calendars.primary.busy;
  } catch (err) {
    console.error('Google Calendar freebusy error:', err);
    return res.status(500).json({ error: 'Failed to fetch calendar availability' });
  }

  // Build available slots in 9am–5pm window
  const slots = [];
  const slotMs = duration_minutes * 60 * 1000;
  let cursor = new Date(`${date}T09:00:00`);
  const windowEnd = new Date(`${date}T17:00:00`);

  while (cursor.getTime() + slotMs <= windowEnd.getTime()) {
    const slotEnd = new Date(cursor.getTime() + slotMs);
    const overlaps = busyPeriods.some(
      (b) => new Date(b.start) < slotEnd && new Date(b.end) > cursor
    );
    if (!overlaps) {
      slots.push({
        start: cursor.toISOString(),
        end: slotEnd.toISOString(),
      });
    }
    cursor = new Date(cursor.getTime() + slotMs);
  }

  return res.status(200).json({ available_slots: slots });
}

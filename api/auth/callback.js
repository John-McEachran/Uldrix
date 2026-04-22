import { google } from 'googleapis';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  const { code, state: client_id, error } = req.query;

  if (error) {
    console.error('OAuth error:', error);
    return res.status(400).json({ error: `OAuth error: ${error}` });
  }

  if (!code || !client_id) {
    return res.status(400).json({ error: 'Missing code or state (client_id)' });
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_BASE_URL || `https://${req.headers.host}`}/api/auth/callback`
  );

  let tokens;
  try {
    const { tokens: t } = await oauth2Client.getToken(code);
    tokens = t;
  } catch (err) {
    console.error('Token exchange error:', err);
    return res.status(500).json({ error: 'Failed to exchange authorization code' });
  }

  await redis.set(`client:${client_id}:tokens`, JSON.stringify(tokens));
  console.log(`Stored tokens for client: ${client_id}`);

  return res.redirect('/public/connected.html');
}

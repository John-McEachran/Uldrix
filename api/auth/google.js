import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
];

export default function handler(req, res) {
  const { client_id } = req.query;
  if (!client_id) {
    return res.status(400).json({ error: 'client_id query parameter is required' });
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_BASE_URL || `https://${req.headers.host}`}/api/auth/callback`
  );

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: client_id,
  });

  return res.redirect(url);
}

import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db';
import { getBotTranscript, TranscriptEntry } from './recall';

interface Contact {
  id: string;
  name: string;
  email: string;
  profile_summary: string | null;
}

export async function updateAttendeeProfiles(googleEventId: string): Promise<void> {
  const db = getDb();

  // Get attendees for this meeting
  const attendees = db.prepare(
    'SELECT c.id, c.name, c.email, c.profile_summary FROM meeting_attendees ma JOIN contacts c ON ma.contact_id = c.id WHERE ma.google_event_id = ?'
  ).all(googleEventId) as Contact[];

  if (attendees.length === 0) return;

  // Get bot ID and fetch transcript
  const botRow = db.prepare('SELECT recall_bot_id FROM meeting_bots WHERE google_event_id = ?').get(googleEventId) as
    | { recall_bot_id: string } | undefined;

  if (!botRow?.recall_bot_id) return;

  let transcript: TranscriptEntry[];
  try {
    transcript = await getBotTranscript(botRow.recall_bot_id);
  } catch {
    return;
  }

  if (transcript.length === 0) return;

  // Build full transcript text
  const transcriptText = transcript.map((entry) => {
    const speaker = entry.participant?.name || 'Unknown';
    const text = entry.words.map((w) => w.text).join(' ');
    return `${speaker}: ${text}`;
  }).join('\n');

  // Get speaker names from transcript
  const speakerNames = new Set(transcript.map((e) => (e.participant?.name || '').toLowerCase()));

  const client = new Anthropic();

  for (const attendee of attendees) {
    // Check if attendee spoke in the meeting (fuzzy match)
    const nameParts = attendee.name.toLowerCase().split(' ');
    const spokeInMeeting = [...speakerNames].some((speaker) =>
      nameParts.some((part) => part.length > 2 && speaker.includes(part))
    );

    if (!spokeInMeeting) continue;

    try {
      const response = await client.messages.create({
        model: process.env.ANTHROPIC_CHAT_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: 200,
        system: 'You update professional profiles based on meeting transcripts. Output ONLY the updated profile summary (2-3 sentences). Focus on: their role, concerns, communication style, and key topics they discussed. If an existing profile is provided, integrate new information with it.',
        messages: [{
          role: 'user',
          content: `Person: ${attendee.name} (${attendee.email})
${attendee.profile_summary ? `Existing profile: ${attendee.profile_summary}` : 'No existing profile.'}

Meeting transcript:
${transcriptText.substring(0, 3000)}

Write an updated profile summary for ${attendee.name}:`,
        }],
      });

      let profileText = '';
      for (const block of response.content) {
        if (block.type === 'text') profileText += block.text;
      }

      if (profileText.trim()) {
        db.prepare("UPDATE contacts SET profile_summary = ?, updated_at = datetime('now') WHERE id = ?")
          .run(profileText.trim(), attendee.id);
        console.log(`[profile] Updated profile for ${attendee.name}`);
      }
    } catch (err: unknown) {
      console.error(`[profile] Failed to update ${attendee.name}:`, (err as Error).message);
    }
  }
}

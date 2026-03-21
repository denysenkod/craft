import { google, calendar_v3 } from 'googleapis';
import { getAuthenticatedClient } from './google-auth';

async function getCalendarClient(): Promise<calendar_v3.Calendar> {
  const auth = await getAuthenticatedClient();
  return google.calendar({ version: 'v3', auth });
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  attendees: Array<{ email: string; responseStatus: string }>;
  meetingUrl: string | null;
  status: string;
  htmlLink: string;
}

function extractMeetingUrl(event: calendar_v3.Schema$Event): string | null {
  // Check conferenceData for Meet/Zoom links
  if (event.conferenceData?.entryPoints) {
    const videoEntry = event.conferenceData.entryPoints.find(
      (ep) => ep.entryPointType === 'video'
    );
    if (videoEntry?.uri) return videoEntry.uri;
  }
  // Fallback: check hangoutLink
  if (event.hangoutLink) return event.hangoutLink;
  return null;
}

function mapEvent(event: calendar_v3.Schema$Event): CalendarEvent {
  return {
    id: event.id || '',
    summary: event.summary || '(No title)',
    description: event.description || '',
    start: event.start?.dateTime || event.start?.date || '',
    end: event.end?.dateTime || event.end?.date || '',
    attendees: (event.attendees || []).map((a) => ({
      email: a.email || '',
      responseStatus: a.responseStatus || 'needsAction',
    })),
    meetingUrl: extractMeetingUrl(event),
    status: event.status || 'confirmed',
    htmlLink: event.htmlLink || '',
  };
}

export async function listEvents(timeMin?: string, timeMax?: string): Promise<CalendarEvent[]> {
  const calendar = await getCalendarClient();
  const now = new Date();

  const defaultMin = new Date(now);
  defaultMin.setDate(defaultMin.getDate() - 7);

  const defaultMax = new Date(now);
  defaultMax.setDate(defaultMax.getDate() + 30);

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: timeMin || defaultMin.toISOString(),
    timeMax: timeMax || defaultMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 100,
  });

  return (res.data.items || []).map(mapEvent);
}

export async function createEvent(params: {
  title: string;
  description?: string;
  attendees: string[];
  startDateTime: string;
  endDateTime: string;
  timeZone?: string;
}): Promise<CalendarEvent> {
  const calendar = await getCalendarClient();

  const tz = params.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const res = await calendar.events.insert({
    calendarId: 'primary',
    conferenceDataVersion: 1,
    sendUpdates: 'all',
    requestBody: {
      summary: params.title,
      description: params.description || '',
      start: { dateTime: params.startDateTime, timeZone: tz },
      end: { dateTime: params.endDateTime, timeZone: tz },
      attendees: params.attendees.filter(Boolean).map((email) => ({ email: email.trim() })),
      conferenceData: {
        createRequest: {
          requestId: `craft-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    },
  });

  return mapEvent(res.data);
}

export async function getEvent(eventId: string): Promise<CalendarEvent> {
  const calendar = await getCalendarClient();

  const res = await calendar.events.get({
    calendarId: 'primary',
    eventId,
  });

  return mapEvent(res.data);
}

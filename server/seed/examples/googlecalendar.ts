import type { BaseCodeExample } from './types';

export const googlecalendarExamples: BaseCodeExample[] = [
	{
		description:
			'Create a Google Calendar event on the primary calendar with a title, description, start and end times, timezone, and optional attendees. Sends email notifications to invited attendees.',
		code: `async function main() {
  const event = await corsair.googlecalendar.api.events.create({
    calendarId: 'primary',
    event: {
      summary: 'Q2 Planning Kickoff',
      description: 'Initial planning session for Q2 roadmap. Agenda: OKRs, resource allocation, milestone review.',
      start: {
        dateTime: '2026-03-01T10:00:00-08:00',
        timeZone: 'America/Los_Angeles',
      },
      end: {
        dateTime: '2026-03-01T11:00:00-08:00',
        timeZone: 'America/Los_Angeles',
      },
      attendees: [
        { email: 'teammate@example.com' },
        { email: 'manager@example.com' },
      ],
    },
    sendNotifications: true,
  });

  console.log('Calendar event created:', {
    id: event.id,
    summary: event.summary,
    htmlLink: event.htmlLink,
    start: event.start,
    end: event.end,
  });
}
main().catch(console.error);`,
	},
	{
		description:
			'List upcoming Google Calendar events within a date range. Logs event titles, times, attendees, and links. Use this to see what is on the calendar before scheduling a meeting or checking availability.',
		code: `async function main() {
  const now = new Date();
  const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const response = await corsair.googlecalendar.api.events.getMany({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: oneWeekFromNow.toISOString(),
    maxResults: 20,
    orderBy: 'startTime',
    singleEvents: true,
  });

  if (!response.items?.length) {
    console.log('No events found in the next 7 days.');
    return;
  }

  const events = response.items.map((event) => ({
    id: event.id,
    summary: event.summary,
    start: event.start?.dateTime ?? event.start?.date,
    end: event.end?.dateTime ?? event.end?.date,
    attendees: event.attendees?.map((a) => a.email),
    link: event.htmlLink,
  }));

  console.log('Upcoming events:', events);
}
main().catch(console.error);`,
	},
	{
		description:
			'Check Google Calendar availability (free/busy) for one or more email addresses within a time window. Use this before scheduling a meeting to confirm everyone is free at the proposed time.',
		code: `async function main() {
  const attendees = [
    'alice@example.com',
    'bob@example.com',
  ];

  const startTime = '2026-03-03T09:00:00-08:00'; // Proposed meeting start
  const endTime = '2026-03-03T10:00:00-08:00';   // Proposed meeting end

  const availability = await corsair.googlecalendar.api.calendar.getAvailability({
    timeMin: startTime,
    timeMax: endTime,
    items: attendees.map((email) => ({ id: email })),
  });

  console.log('Availability result:', JSON.stringify(availability, null, 2));

  // Check each attendee's busy periods
  for (const attendee of attendees) {
    const busySlots = availability.calendars?.[attendee]?.busy ?? [];
    if (busySlots.length > 0) {
      console.log(\`\${attendee} is BUSY during the proposed time:\`, busySlots);
    } else {
      console.log(\`\${attendee} is FREE during the proposed time.\`);
    }
  }
}
main().catch(console.error);`,
	},
	{
		description:
			'Update an existing Google Calendar event — change the title, time, description, or attendees. First lists upcoming events to find the event ID, then applies the update.',
		code: `async function main() {
  const eventSummary = 'Q2 Planning Kickoff'; // Event to find — ask the user if unsure

  // List events to find the one to update
  const now = new Date();
  const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const response = await corsair.googlecalendar.api.events.getMany({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: twoWeeksFromNow.toISOString(),
    singleEvents: true,
  });

  const event = response.items?.find((e) => e.summary === eventSummary);

  if (!event) {
    console.log(
      \`Event "\${eventSummary}" not found. Upcoming events:\`,
      response.items?.map((e) => ({ id: e.id, summary: e.summary, start: e.start?.dateTime })),
    );
    return;
  }

  console.log('Updating event:', { id: event.id, summary: event.summary });

  const updated = await corsair.googlecalendar.api.events.update({
    calendarId: 'primary',
    eventId: event.id!,
    event: {
      ...event,
      summary: event.summary,
      description: 'UPDATED: Added agenda items. Please review the pre-read doc before joining.',
      // Reschedule by 1 hour later
      start: {
        dateTime: '2026-03-01T11:00:00-08:00',
        timeZone: 'America/Los_Angeles',
      },
      end: {
        dateTime: '2026-03-01T12:00:00-08:00',
        timeZone: 'America/Los_Angeles',
      },
    },
    sendNotifications: true,
  });

  console.log('Event updated:', {
    id: updated.id,
    summary: updated.summary,
    start: updated.start,
  });
}
main().catch(console.error);`,
	},
	{
		description:
			'Delete a Google Calendar event. Looks up the event by title from upcoming events, confirms its details, then deletes it. Sends cancellation notifications to attendees.',
		code: `async function main() {
  const eventSummary = 'Q2 Planning Kickoff'; // Ask the user to confirm the event name

  const now = new Date();
  const oneMonthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const response = await corsair.googlecalendar.api.events.getMany({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: oneMonthFromNow.toISOString(),
    singleEvents: true,
  });

  const event = response.items?.find((e) => e.summary === eventSummary);

  if (!event) {
    console.log(
      \`Event "\${eventSummary}" not found. Upcoming events:\`,
      response.items?.map((e) => ({ id: e.id, summary: e.summary, start: e.start?.dateTime })),
    );
    return;
  }

  console.log('Deleting event:', {
    id: event.id,
    summary: event.summary,
    start: event.start?.dateTime,
    attendees: event.attendees?.map((a) => a.email),
  });

  await corsair.googlecalendar.api.events.delete({
    calendarId: 'primary',
    eventId: event.id!,
    sendNotifications: true,
  });

  console.log(\`Event "\${eventSummary}" deleted successfully. Attendees have been notified.\`);
}
main().catch(console.error);`,
	},
];

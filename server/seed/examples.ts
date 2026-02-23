// ─────────────────────────────────────────────────────────────────────────────
// Code examples for the agent
//
// Each example has:
// - plugin: The plugin/service name (e.g. "slack", "github")
// - description: A natural language description of what the code does
// - code: The TypeScript code example
// ─────────────────────────────────────────────────────────────────────────────

export type { CodeExample } from './examples/types';

import { discordExamples } from './examples/discord';
import { githubExamples } from './examples/github';
import { gmailExamples } from './examples/gmail';
import { googlecalendarExamples } from './examples/googlecalendar';
import { googledriveExamples } from './examples/googledrive';
import { googlesheetsExamples } from './examples/googlesheets';
import { hubspotExamples } from './examples/hubspot';
import { linearExamples } from './examples/linear';
import { posthogExamples } from './examples/posthog';
import { resendExamples } from './examples/resend';
import { slackExamples } from './examples/slack';
import { tavilyExamples } from './examples/tavily';

export const codeExamples = [
	...slackExamples.map((e) => ({ ...e, plugin: 'slack' })),
	...githubExamples.map((e) => ({ ...e, plugin: 'github' })),
	...linearExamples.map((e) => ({ ...e, plugin: 'linear' })),
	...gmailExamples.map((e) => ({ ...e, plugin: 'gmail' })),
	...hubspotExamples.map((e) => ({ ...e, plugin: 'hubspot' })),
	...resendExamples.map((e) => ({ ...e, plugin: 'resend' })),
	...posthogExamples.map((e) => ({ ...e, plugin: 'posthog' })),
	...googledriveExamples.map((e) => ({ ...e, plugin: 'googledrive' })),
	...googlesheetsExamples.map((e) => ({ ...e, plugin: 'googlesheets' })),
	...googlecalendarExamples.map((e) => ({ ...e, plugin: 'googlecalendar' })),
	...tavilyExamples.map((e) => ({ ...e, plugin: 'tavily' })),
	...discordExamples.map((e) => ({ ...e, plugin: 'discord' })),
];

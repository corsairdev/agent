// ─────────────────────────────────────────────────────────────────────────────
// Code examples for the agent
//
// Each example has:
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
	...slackExamples,
	...githubExamples,
	...linearExamples,
	...gmailExamples,
	...hubspotExamples,
	...resendExamples,
	...posthogExamples,
	...googledriveExamples,
	...googlesheetsExamples,
	...googlecalendarExamples,
	...tavilyExamples,
	...discordExamples,
];

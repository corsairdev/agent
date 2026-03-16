import 'dotenv/config';
import { corsair } from '../server/corsair'; // imported for type safety — injected at runtime
import { workflow } from '../server/sdk';

await workflow.webhook({
	id: 'forwardSlackMessageToSdkTest',
	description: 'Forwards every Slack message to #sdk-test',
	trigger: { plugin: 'slack', action: 'messages.message' },
	handler: async (event: any) => {
		if (!event?.text || event?.channel === 'C0A3ZTB9X7X') return;
		await corsair.slack.api.messages.post({
			channel: 'C0A3ZTB9X7X',
			text: `[forwarded] <@${event.user}>: ${event.text}`,
		});
	},
});

const workflows = await workflow.list('webhook');
console.table(workflows.map((w) => ({ name: w.name, trigger: JSON.stringify(w.triggerConfig), status: w.status })));

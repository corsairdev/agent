import 'dotenv/config';
import { corsair } from '../server/corsair'; // imported for type safety — injected at runtime
import { workflow } from '../server/sdk';

await workflow.cron({
	id: 'morningSlackReport',
	description: 'Posts a morning message to #sdk-test every weekday at 9am',
	schedule: '0 9 * * 1-5',
	handler: async () => {
		await corsair.slack.api.messages.post({
			channel: 'C0A3ZTB9X7X',
			text: 'Good morning! Your daily report is ready.',
		});
	},
});

const workflows = await workflow.list('cron');
console.table(workflows.map((w) => ({ name: w.name, schedule: (w.triggerConfig as any)?.cron, status: w.status })));

import { corsair } from './corsair';

const main = async () => {
	const res = await corsair.slack.keys.get_api_key();
	const res2 = await corsair.slack.keys.get_webhook_signature();
	const res3 = await corsair.linear.keys.get_api_key();
	const res4 = await corsair.linear.keys.get_webhook_signature();

	const command = `
echo 'SLACK_BOT_TOKEN=${res}' >> /Users/devjain/Projects/corsair/main/testing/corsair-1/.env
echo 'SLACK_SIGNING_SECRET=${res2}' >> /Users/devjain/Projects/corsair/main/testing/corsair-1/.env
echo 'LINEAR_API_KEY=${res3}' >> /Users/devjain/Projects/corsair/main/testing/corsair-1/.env
echo 'LINEAR_SIGNING_SECRET=${res4}' >> /Users/devjain/Projects/corsair/main/testing/corsair-1/.env
    `;

	console.log(command);
};

main();

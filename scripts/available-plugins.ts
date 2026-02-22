#!/usr/bin/env tsx
import * as Corsair from 'corsair';

const av_plugins = Object.keys(Corsair).filter(
	(p) => !['processWebhook', 'createCorsair'].includes(p),
);

console.log(av_plugins.join('\n'));

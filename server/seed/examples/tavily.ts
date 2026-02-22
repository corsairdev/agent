import type { CodeExample } from './types';

export const tavilyExamples: CodeExample[] = [
	{
		description:
			'Search the web using Tavily to get up-to-date information on any topic. Returns a list of relevant results with URLs, titles, and content snippets. Use this when you need current information that is not in your training data.',
		code: `async function main() {
  const query = 'latest TypeScript 5.8 release notes'; // Replace with the user's search query

  const results = await corsair.tavily.api.search({
    query,
    searchDepth: 'basic', // 'basic' is faster; 'advanced' is more thorough
    maxResults: 5,
    includeAnswer: true, // Get an AI-synthesized answer in addition to raw results
  });

  console.log('Tavily search query:', query);
  console.log('AI Answer:', results.answer);
  console.log(
    'Results:',
    results.results?.map((r) => ({
      title: r.title,
      url: r.url,
      score: r.score,
      content: r.content?.slice(0, 200) + '...', // Truncate for readability
    })),
  );
}
main().catch(console.error);`,
	},
	{
		description:
			'Search the web with Tavily using advanced depth for more comprehensive results. Use this when basic search does not return enough detail — for example, when researching technical documentation, pricing, or recent news.',
		code: `async function main() {
  const query = 'PostHog vs Mixpanel vs Amplitude feature comparison 2026';

  const results = await corsair.tavily.api.search({
    query,
    searchDepth: 'advanced', // More comprehensive crawl — slower but better for research
    maxResults: 8,
    includeAnswer: true,
    includeDomains: [], // Optionally restrict to specific domains e.g. ['docs.posthog.com']
    excludeDomains: [], // Optionally exclude domains
  });

  console.log('Search query:', query);
  console.log('AI-synthesized answer:', results.answer);

  console.log('Top sources:');
  results.results?.forEach((result, index) => {
    console.log(\`\${index + 1}. \${result.title}\`);
    console.log(\`   URL: \${result.url}\`);
    console.log(\`   Relevance score: \${result.score}\`);
    console.log(\`   Snippet: \${result.content?.slice(0, 300)}\`);
    console.log('');
  });
}
main().catch(console.error);`,
	},
	{
		description:
			'Search the web with Tavily filtered to specific trusted domains. Use this when you want to pull information from authoritative sources only, such as official documentation sites, GitHub, or specific news outlets.',
		code: `async function main() {
  const query = 'how to configure rate limiting in Next.js';

  const results = await corsair.tavily.api.search({
    query,
    searchDepth: 'advanced',
    maxResults: 5,
    includeAnswer: true,
    includeDomains: ['nextjs.org', 'vercel.com', 'github.com'], // Only trusted domains
  });

  console.log('Query:', query);
  console.log('Answer:', results.answer);
  console.log(
    'Results from trusted domains:',
    results.results?.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content?.slice(0, 250),
    })),
  );
}
main().catch(console.error);`,
	},
];

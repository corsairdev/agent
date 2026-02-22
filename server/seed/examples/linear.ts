import type { CodeExample } from './types';

export const linearExamples: CodeExample[] = [
	{
		description:
			'Create a new Linear issue in a team. Lists all teams first — if multiple teams exist, logs them and asks the user to specify which one. Sets title, description, and priority (1=urgent, 2=high, 3=medium, 4=low).',
		code: `async function main() {
  const allTeams = await corsair.linear.api.teams.list({});

  const teams = allTeams.nodes.map((team) => ({
    teamId: team.id,
    teamName: team.name,
  }));

  if (teams.length === 0) {
    console.log('No Linear teams found.');
    return;
  }

  if (teams.length > 1) {
    console.log(
      'Multiple teams found — which team should this issue go into?',
      teams.map((t) => t.teamName),
    );
    return;
  }

  const team = teams[0]!;

  const issue = await corsair.linear.api.issues.create({
    teamId: team.teamId,
    title: 'Fix: Dashboard data not refreshing on tab switch',
    description: 'When switching tabs and coming back, the dashboard data is stale and requires a manual page refresh to update.',
    priority: 2, // 1=urgent, 2=high, 3=medium, 4=low — set based on user input
  });

  console.log('Linear issue created:', { id: issue.id, url: issue.url });
}
main().catch(console.error);`,
	},
	{
		description:
			'List all Linear issues for a team and inspect their current states, priorities, and assignees. Use this to review the backlog or find a specific issue before updating it.',
		code: `async function main() {
  const allTeams = await corsair.linear.api.teams.list({});
  const teams = allTeams.nodes;

  if (teams.length === 0) {
    console.log('No Linear teams found.');
    return;
  }

  if (teams.length > 1) {
    console.log(
      'Multiple teams — which team issues do you want to see?',
      teams.map((t) => ({ id: t.id, name: t.name })),
    );
    return;
  }

  const issues = await corsair.linear.api.issues.list({});

  const summary = issues.nodes.map((issue) => ({
    id: issue.id,
    title: issue.title,
    state: issue.state?.name,
    priority: issue.priority,
    assignee: issue.assignee?.name,
    url: issue.url,
  }));

  console.log('Linear issues:', summary);
}
main().catch(console.error);`,
	},
	{
		description:
			'Update an existing Linear issue — change its priority, title, or state. First lists issues to find the right issue ID, then applies the update. Use this when the user wants to reprioritize, rename, or close an issue.',
		code: `async function main() {
  // First, list issues to find the one to update
  const issues = await corsair.linear.api.issues.list({});

  console.log(
    'Existing issues:',
    issues.nodes.map((i) => ({ id: i.id, title: i.title, state: i.state?.name })),
  );

  // Find the issue you want to update (by title match or user-provided ID)
  const targetTitle = 'Fix: Dashboard data not refreshing on tab switch';
  const issue = issues.nodes.find((i) => i.title === targetTitle);

  if (!issue) {
    console.log(
      \`Issue "\${targetTitle}" not found. Available issues:\`,
      issues.nodes.map((i) => i.title),
    );
    return;
  }

  const updated = await corsair.linear.api.issues.update({
    id: issue.id,
    priority: 1, // Escalating to urgent
    title: issue.title, // Keep existing title
  });

  console.log('Issue updated:', updated);
}
main().catch(console.error);`,
	},
	{
		description:
			'Add a comment to an existing Linear issue. Finds the issue by listing all issues and matching the title or ID, then posts the comment body. Use this when the user wants to update stakeholders or provide context on an issue.',
		code: `async function main() {
  const issueId = 'ISSUE_ID_HERE'; // Replace with the actual issue ID or find by listing

  // List issues to confirm the issue exists and get its title
  const issues = await corsair.linear.api.issues.list({});
  const issue = issues.nodes.find((i) => i.id === issueId);

  if (!issue) {
    console.log(
      \`Issue with ID "\${issueId}" not found. Here are all issues:\`,
      issues.nodes.map((i) => ({ id: i.id, title: i.title })),
    );
    return;
  }

  console.log('Adding comment to:', { id: issue.id, title: issue.title });

  const comment = await corsair.linear.api.comments.create({
    issueId: issue.id,
    body: 'Investigated this. The root cause is the component not subscribing to the cache invalidation event. Will push a fix today.',
  });

  console.log('Comment created:', comment);
}
main().catch(console.error);`,
	},
	{
		description:
			'Create a new Linear project for a team with a name and description. Lists teams first to find the correct team ID. Use this when the user wants to organize a set of related issues into a project.',
		code: `async function main() {
  const allTeams = await corsair.linear.api.teams.list({});
  const teams = allTeams.nodes;

  if (teams.length === 0) {
    console.log('No Linear teams found.');
    return;
  }

  if (teams.length > 1) {
    console.log(
      'Multiple teams found — which team should this project belong to?',
      teams.map((t) => ({ id: t.id, name: t.name })),
    );
    return;
  }

  const team = teams[0]!;

  const project = await corsair.linear.api.projects.create({
    name: 'Q2 Performance Initiative',
    teamIds: [team.id],
    description: 'Tracks all performance improvements planned for Q2, including load time, bundle size reduction, and database query optimization.',
  });

  console.log('Linear project created:', project);
}
main().catch(console.error);`,
	},
	{
		description:
			'List all Linear projects to see what projects currently exist, their states, and progress. Use this to give the user an overview of active projects or to find a project ID before updating it.',
		code: `async function main() {
  const projects = await corsair.linear.api.projects.list({});

  if (projects.nodes.length === 0) {
    console.log('No Linear projects found.');
    return;
  }

  const summary = projects.nodes.map((project) => ({
    id: project.id,
    name: project.name,
    state: project.state,
    progress: project.progress,
    description: project.description,
  }));

  console.log('Linear projects:', summary);
}
main().catch(console.error);`,
	},
];

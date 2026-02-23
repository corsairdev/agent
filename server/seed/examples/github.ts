import type { BaseCodeExample } from './types';

export const githubExamples: BaseCodeExample[] = [
	{
		description:
			'List all GitHub repositories accessible to the authenticated user or organization. Logs repository names, visibility, and default branches. Use this to discover available repos before creating issues or pull requests.',
		code: `async function main() {
  const repos = await corsair.github.api.repositories.list({});

  const summary = repos.map((repo) => ({
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private,
    defaultBranch: repo.default_branch,
    description: repo.description,
  }));

  console.log('GitHub repositories:', summary);
}
main().catch(console.error);`,
	},
	{
		description:
			'List all open pull requests for a specific GitHub repository. Logs PR number, title, author, and branch names. Use this to inspect current PRs before creating a review or checking merge status.',
		code: `async function main() {
  const owner = 'myorg'; // Replace with the GitHub org or user
  const repo = 'myrepo'; // Replace with the repo name — ask the user if unsure

  // First verify the repo exists by listing repos
  const repos = await corsair.github.api.repositories.list({});
  const repoNames = repos.map((r) => r.full_name);
  console.log('Available repos:', repoNames);

  const prs = await corsair.github.api.pullRequests.list({
    owner,
    repo,
    state: 'open',
  });

  if (prs.length === 0) {
    console.log(\`No open pull requests found in \${owner}/\${repo}\`);
    return;
  }

  const summary = prs.map((pr) => ({
    number: pr.number,
    title: pr.title,
    author: pr.user?.login,
    headBranch: pr.head?.ref,
    baseBranch: pr.base?.ref,
    url: pr.html_url,
  }));

  console.log('Open pull requests:', summary);
}
main().catch(console.error);`,
	},
	{
		description:
			'Create a new GitHub issue in a repository with a title, description body, and optional labels. First lists available repositories to confirm the target repo exists, then creates the issue and logs the resulting issue URL.',
		code: `async function main() {
  const owner = 'myorg'; // GitHub org or username
  const repo = 'myrepo'; // Repository name — do not assume, ask the user

  // Verify repo exists
  const repos = await corsair.github.api.repositories.list({});
  const exists = repos.some((r) => r.full_name === \`\${owner}/\${repo}\`);

  if (!exists) {
    console.log(
      \`Repo "\${owner}/\${repo}" not found. Available repos:\`,
      repos.map((r) => r.full_name),
    );
    return;
  }

  const issue = await corsair.github.api.issues.create({
    owner,
    repo,
    title: 'Bug: Login button not working on mobile',
    body: '## Description\\n\\nThe login button on mobile Safari fails silently.\\n\\n## Steps to reproduce\\n1. Open app on iOS Safari\\n2. Tap login button\\n3. Nothing happens',
    labels: ['bug', 'mobile'],
  });

  console.log('Issue created:', {
    number: issue.number,
    url: issue.html_url,
    title: issue.title,
  });
}
main().catch(console.error);`,
	},
	{
		description:
			'List all open GitHub issues for a repository filtered by state. Logs issue numbers, titles, labels, and authors. Use this to review the current backlog or find a specific issue before commenting or updating it.',
		code: `async function main() {
  const owner = 'myorg';
  const repo = 'myrepo';

  const issues = await corsair.github.api.issues.list({
    owner,
    repo,
    state: 'open',
  });

  if (issues.length === 0) {
    console.log(\`No open issues in \${owner}/\${repo}\`);
    return;
  }

  const summary = issues.map((issue) => ({
    number: issue.number,
    title: issue.title,
    labels: issue.labels?.map((l) => l.name),
    author: issue.user?.login,
    url: issue.html_url,
  }));

  console.log('Open issues:', summary);
}
main().catch(console.error);`,
	},
	{
		description:
			'Submit a review on a GitHub pull request — approve, request changes, or leave a comment. First lists open PRs to confirm the PR number, then submits the review with an optional body message.',
		code: `async function main() {
  const owner = 'myorg';
  const repo = 'myrepo';
  const pullNumber = 42; // Ask the user for the PR number if unsure

  // List open PRs to verify the PR exists
  const prs = await corsair.github.api.pullRequests.list({
    owner,
    repo,
    state: 'open',
  });

  const pr = prs.find((p) => p.number === pullNumber);

  if (!pr) {
    console.log(
      \`PR #\${pullNumber} not found. Open PRs:\`,
      prs.map((p) => ({ number: p.number, title: p.title })),
    );
    return;
  }

  console.log('Reviewing PR:', { number: pr.number, title: pr.title });

  const review = await corsair.github.api.pullRequests.createReview({
    owner,
    repo,
    pull_number: pullNumber,
    event: 'APPROVE', // 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
    body: 'LGTM! Great work on this PR.',
  });

  console.log('Review submitted:', review);
}
main().catch(console.error);`,
	},
	{
		description:
			'List recent GitHub Actions workflow runs for a repository to check CI/CD status. Logs run IDs, workflow names, statuses, and conclusions. Use this to monitor deployments or diagnose failed builds.',
		code: `async function main() {
  const owner = 'myorg';
  const repo = 'myrepo';

  // First see what workflows exist
  const workflows = await corsair.github.api.workflows.list({ owner, repo });
  console.log(
    'Available workflows:',
    workflows.workflows?.map((w) => ({ id: w.id, name: w.name, path: w.path })),
  );

  if (!workflows.workflows?.length) {
    console.log('No workflows found in this repository.');
    return;
  }

  // Get runs for the first workflow (or a specific one by name)
  const targetWorkflow = workflows.workflows[0];

  const runs = await corsair.github.api.workflows.listRuns({
    owner,
    repo,
    workflow_id: targetWorkflow.id,
  });

  const summary = runs.workflow_runs?.slice(0, 10).map((run) => ({
    id: run.id,
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    branch: run.head_branch,
    triggeredBy: run.triggering_actor?.login,
    createdAt: run.created_at,
  }));

  console.log(\`Recent runs for "\${targetWorkflow.name}":\`, summary);
}
main().catch(console.error);`,
	},
	{
		description:
			'Create a comment on an existing GitHub issue. Looks up the issue by number first to confirm it exists, then posts the comment body and logs the comment URL.',
		code: `async function main() {
  const owner = 'myorg';
  const repo = 'myrepo';
  const issueNumber = 15; // Ask the user for the issue number if unsure
  const commentBody = 'I can reproduce this on the latest main branch. Investigating now.';

  // Verify the issue exists
  const issue = await corsair.github.api.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  console.log('Commenting on issue:', {
    number: issue.number,
    title: issue.title,
    state: issue.state,
  });

  const comment = await corsair.github.api.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: commentBody,
  });

  console.log('Comment posted:', { id: comment.id, url: comment.html_url });
}
main().catch(console.error);`,
	},
	{
		description:
			'List releases for a GitHub repository and inspect version history. Logs release tag names, names, publish dates, and whether they are pre-releases. Use this before creating a new release to check existing versions.',
		code: `async function main() {
  const owner = 'myorg';
  const repo = 'myrepo';

  const releases = await corsair.github.api.releases.list({ owner, repo });

  if (releases.length === 0) {
    console.log(\`No releases found for \${owner}/\${repo}\`);
    return;
  }

  const summary = releases.map((release) => ({
    tag: release.tag_name,
    name: release.name,
    prerelease: release.prerelease,
    draft: release.draft,
    publishedAt: release.published_at,
    url: release.html_url,
  }));

  console.log('Releases:', summary);

  // Latest release
  console.log('Latest release:', summary[0]);
}
main().catch(console.error);`,
	},
];

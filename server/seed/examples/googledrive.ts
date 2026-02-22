import type { CodeExample } from './types';

export const googledriveExamples: CodeExample[] = [
	{
		description:
			'List files in Google Drive and inspect their names, types, and IDs. Use this to discover what files are available before reading, downloading, or sharing them.',
		code: `async function main() {
  const response = await corsair.googledrive.api.files.list({
    pageSize: 20,
  });

  if (!response.files?.length) {
    console.log('No files found in Google Drive.');
    return;
  }

  const files = response.files.map((file) => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    size: file.size,
  }));

  console.log('Google Drive files:', files);
}
main().catch(console.error);`,
	},
	{
		description:
			'Search for files or folders in Google Drive by name, type, or content. Logs matching file IDs and names. Use this to find a specific document before sharing it, reading it, or moving it to a folder.',
		code: `async function main() {
  const searchQuery = 'Q1 Report'; // Search term — ask the user if unsure

  const results = await corsair.googledrive.api.search.filesAndFolders({
    query: searchQuery,
  });

  if (!results.files?.length) {
    console.log(\`No files found matching "\${searchQuery}" in Google Drive.\`);
    return;
  }

  const matches = results.files.map((file) => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
  }));

  console.log(\`Files matching "\${searchQuery}":\`, matches);

  if (matches.length > 1) {
    console.log('Multiple files found — which one did you mean?', matches.map((f) => f.name));
    return;
  }

  console.log('Found file:', matches[0]);
}
main().catch(console.error);`,
	},
	{
		description:
			'Create a new plain text document in Google Drive from a string of content. Logs the new file ID and URL. Use this to generate reports, notes, or data dumps as Drive documents.',
		code: `async function main() {
  const fileName = 'Weekly Status Report - Feb 21 2026';
  const content = [
    '# Weekly Status Report',
    '',
    '## Completed this week',
    '- Shipped new onboarding flow',
    '- Fixed login bug on mobile Safari',
    '- Updated API documentation',
    '',
    '## In progress',
    '- Performance optimization initiative',
    '- Q2 roadmap planning',
    '',
    '## Blockers',
    '- Waiting on design review for checkout redesign',
  ].join('\\n');

  const file = await corsair.googledrive.api.files.createFromText({
    name: fileName,
    content,
    mimeType: 'text/plain',
  });

  console.log('Google Drive file created:', {
    id: file.id,
    name: file.name,
    webViewLink: file.webViewLink,
  });
}
main().catch(console.error);`,
	},
	{
		description:
			'Create a new folder in Google Drive to organize files. Logs the folder ID on success. Use this before uploading files when you want to place them in a specific folder.',
		code: `async function main() {
  const folderName = 'Q2 2026 Planning Documents';

  // Check if a folder with this name already exists
  const existing = await corsair.googledrive.api.search.filesAndFolders({
    query: folderName,
  });

  const existingFolder = existing.files?.find(
    (f) =>
      f.name === folderName &&
      f.mimeType === 'application/vnd.google-apps.folder',
  );

  if (existingFolder) {
    console.log('Folder already exists:', {
      id: existingFolder.id,
      name: existingFolder.name,
    });
    return;
  }

  const folder = await corsair.googledrive.api.folders.create({
    name: folderName,
  });

  console.log('Google Drive folder created:', {
    id: folder.id,
    name: folder.name,
  });
}
main().catch(console.error);`,
	},
	{
		description:
			'Share a Google Drive file or folder with a specific user by email. Sets the permission role (reader, commenter, or writer). Logs the permission ID when sharing is successful.',
		code: `async function main() {
  const fileName = 'Q1 Report'; // File to share — ask the user if unsure
  const recipientEmail = 'colleague@example.com';
  const role = 'reader'; // 'reader' | 'commenter' | 'writer'

  // Search for the file
  const results = await corsair.googledrive.api.search.filesAndFolders({
    query: fileName,
  });

  if (!results.files?.length) {
    console.log(\`File "\${fileName}" not found in Google Drive.\`);
    return;
  }

  if (results.files.length > 1) {
    console.log(
      \`Multiple files named "\${fileName}" found. Which one?\`,
      results.files.map((f) => ({ id: f.id, name: f.name, modified: f.modifiedTime })),
    );
    return;
  }

  const file = results.files[0]!;
  console.log('Sharing file:', { id: file.id, name: file.name });

  const permission = await corsair.googledrive.api.files.share({
    fileId: file.id!,
    email: recipientEmail,
    role,
  });

  console.log(
    \`File "\${file.name}" shared with \${recipientEmail} as \${role}:\`,
    permission,
  );
}
main().catch(console.error);`,
	},
];

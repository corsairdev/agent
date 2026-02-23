import type { BaseCodeExample } from './types';

export const googlesheetsExamples: BaseCodeExample[] = [
	{
		description:
			'Read rows from a Google Sheet by spreadsheet ID and range. Logs the raw cell values returned. Use this to inspect the current contents of a sheet before writing or updating rows.',
		code: `async function main() {
  // The spreadsheet ID is in the URL: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
  const spreadsheetId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms';
  const range = 'Sheet1!A1:E10'; // Adjust range as needed — A:Z for all columns

  const response = await corsair.googlesheets.api.sheets.getRows({
    spreadsheetId,
    range,
  });

  console.log('Spreadsheet ID:', spreadsheetId);
  console.log('Range:', range);
  console.log('Rows returned:', response.values?.length ?? 0);
  console.log('Data:', response.values);

  if (!response.values?.length) {
    console.log('No data found in the specified range.');
    return;
  }

  // Treat first row as headers
  const [headers, ...rows] = response.values;
  const records = rows.map((row) =>
    Object.fromEntries(headers!.map((header, i) => [header, row[i] ?? ''])),
  );

  console.log('Parsed records:', records);
}
main().catch(console.error);`,
	},
	{
		description:
			'Append a new row to a Google Sheet. Adds the data after the last existing row in the specified range. Use this to log entries, record form submissions, or add new data records to a sheet.',
		code: `async function main() {
  const spreadsheetId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms';
  const range = 'Sheet1'; // Sheet name — appends after the last row

  // First inspect existing data
  const existing = await corsair.googlesheets.api.sheets.getRows({
    spreadsheetId,
    range: 'Sheet1!A1:Z1',
  });
  console.log('Column headers:', existing.values?.[0]);

  // Values must match column order
  const newRow = [
    new Date().toISOString(), // Timestamp
    'Jane Smith',             // Name
    'jane@example.com',       // Email
    'Pro',                    // Plan
    '49.00',                  // Amount
  ];

  const result = await corsair.googlesheets.api.sheets.appendRow({
    spreadsheetId,
    range,
    values: [newRow], // Array of rows (each row is an array of cell values)
  });

  console.log('Row appended:', {
    updatedRange: result.updates?.updatedRange,
    updatedRows: result.updates?.updatedRows,
    updatedCells: result.updates?.updatedCells,
  });
}
main().catch(console.error);`,
	},
	{
		description:
			'Create a new Google Spreadsheet with a given title. Logs the new spreadsheet ID and URL. Use this when the user needs a new sheet to track data, reports, or logs.',
		code: `async function main() {
  const title = 'Sales Pipeline Tracker - Q2 2026';

  const spreadsheet = await corsair.googlesheets.api.spreadsheets.create({
    title,
  });

  console.log('Google Spreadsheet created:', {
    id: spreadsheet.spreadsheetId,
    title: spreadsheet.properties?.title,
    url: spreadsheet.spreadsheetUrl,
    sheets: spreadsheet.sheets?.map((s) => s.properties?.title),
  });

  // Now add headers to the first sheet
  const headersResult = await corsair.googlesheets.api.sheets.appendRow({
    spreadsheetId: spreadsheet.spreadsheetId!,
    range: 'Sheet1',
    values: [['Deal Name', 'Contact', 'Stage', 'Amount', 'Close Date', 'Owner']],
  });

  console.log('Headers added:', headersResult.updates?.updatedRange);
}
main().catch(console.error);`,
	},
	{
		description:
			'Update a specific row in a Google Sheet by row number. Use this to modify an existing record such as updating a deal stage, changing a status, or correcting a value in place.',
		code: `async function main() {
  const spreadsheetId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms';

  // First read the sheet to find the row we want to update
  const existing = await corsair.googlesheets.api.sheets.getRows({
    spreadsheetId,
    range: 'Sheet1!A:F',
  });

  console.log('Current data:', existing.values);

  if (!existing.values?.length) {
    console.log('Sheet is empty.');
    return;
  }

  // Find row index by matching a value (e.g. find by email in column C)
  const headers = existing.values[0]!;
  const rows = existing.values.slice(1);
  const targetEmail = 'jane@example.com';
  const rowIndex = rows.findIndex((row) => row[2] === targetEmail);

  if (rowIndex === -1) {
    console.log(
      \`No row found with email "\${targetEmail}". Existing emails:\`,
      rows.map((r) => r[2]),
    );
    return;
  }

  // Row index + 2 (1-indexed, offset by header row)
  const sheetRowNumber = rowIndex + 2;
  const range = \`Sheet1!A\${sheetRowNumber}:F\${sheetRowNumber}\`;

  console.log(\`Updating row \${sheetRowNumber}:\`, rows[rowIndex]);

  const updatedRow = [
    rows[rowIndex]![0], // Keep timestamp
    rows[rowIndex]![1], // Keep name
    targetEmail,
    'Enterprise', // Updated plan
    '99.00',      // Updated amount
  ];

  const result = await corsair.googlesheets.api.sheets.updateRow({
    spreadsheetId,
    range,
    values: [updatedRow],
  });

  console.log('Row updated:', result);
}
main().catch(console.error);`,
	},
	{
		description:
			'Append a row to a Google Sheet or update it if a matching row already exists (upsert). Use this to avoid duplicates when syncing data to a sheet from an external source like a CRM or database.',
		code: `async function main() {
  const spreadsheetId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms';
  const range = 'Sheet1';

  // The key to match on (e.g. email in column 2, 0-indexed)
  const keyColumn = 1; // Column B = index 1
  const keyValue = 'bob@example.com';

  const newRowData = [
    new Date().toISOString(),
    keyValue,
    'Bob Jones',
    'Pro',
    '49.00',
  ];

  const result = await corsair.googlesheets.api.sheets.appendOrUpdateRow({
    spreadsheetId,
    range,
    keyColumn,
    keyValue,
    values: newRowData,
  });

  console.log('Upsert result:', result);
}
main().catch(console.error);`,
	},
];

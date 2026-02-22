import type { CodeExample } from './types';

export const hubspotExamples: CodeExample[] = [
	{
		description:
			'Search for a HubSpot contact by email address. Logs the contact details including name, company, and lifecycle stage. Use this to check if a contact already exists before creating a new one.',
		code: `async function main() {
  const email = 'john.doe@example.com'; // Ask the user for the email if not provided

  const results = await corsair.hubspot.api.contacts.search({
    filterGroups: [
      {
        filters: [
          {
            propertyName: 'email',
            operator: 'EQ',
            value: email,
          },
        ],
      },
    ],
    properties: ['firstname', 'lastname', 'email', 'company', 'lifecyclestage'],
  });

  if (results.total === 0) {
    console.log(\`No HubSpot contact found with email "\${email}"\`);
    return;
  }

  const contact = results.results[0];
  console.log('Found HubSpot contact:', {
    id: contact.id,
    name: \`\${contact.properties?.firstname} \${contact.properties?.lastname}\`,
    email: contact.properties?.email,
    company: contact.properties?.company,
    lifecycleStage: contact.properties?.lifecyclestage,
  });
}
main().catch(console.error);`,
	},
	{
		description:
			'Create or update a HubSpot contact by email address. If a contact with that email already exists, it is updated. Otherwise a new contact is created. Use this to upsert contact records from form submissions or external data.',
		code: `async function main() {
  const contactData = {
    email: 'jane.smith@acmecorp.com',
    firstname: 'Jane',
    lastname: 'Smith',
    company: 'Acme Corp',
    phone: '+1-555-0100',
    lifecyclestage: 'lead', // lead, marketingqualifiedlead, salesqualifiedlead, customer
  };

  const result = await corsair.hubspot.api.contacts.createOrUpdate({
    email: contactData.email,
    properties: {
      firstname: contactData.firstname,
      lastname: contactData.lastname,
      company: contactData.company,
      phone: contactData.phone,
      lifecyclestage: contactData.lifecyclestage,
    },
  });

  console.log('HubSpot contact upserted:', {
    vid: result.vid,
    isNew: result.isNew,
    properties: result.properties,
  });
}
main().catch(console.error);`,
	},
	{
		description:
			'Find a HubSpot company by domain name to check if it already exists in the CRM. Logs company details including name, industry, and associated contacts. Use this before creating a new company record.',
		code: `async function main() {
  const domain = 'acmecorp.com'; // Company domain to search for

  const results = await corsair.hubspot.api.companies.searchByDomain({
    domain,
    properties: ['name', 'domain', 'industry', 'numberofemployees', 'city', 'country'],
  });

  if (!results.results?.length) {
    console.log(\`No HubSpot company found with domain "\${domain}"\`);
    return;
  }

  const companies = results.results.map((company) => ({
    id: company.companyId,
    name: company.properties?.name?.value,
    industry: company.properties?.industry?.value,
    employees: company.properties?.numberofemployees?.value,
    location: \`\${company.properties?.city?.value}, \${company.properties?.country?.value}\`,
  }));

  console.log('Found companies:', companies);
}
main().catch(console.error);`,
	},
	{
		description:
			'Create a new HubSpot deal and associate it with a contact or company. Logs the deal ID and pipeline stage on success. Use this to track sales opportunities when a lead progresses to a deal.',
		code: `async function main() {
  // First find the contact to associate with this deal
  const contactEmail = 'jane.smith@acmecorp.com';
  const contactSearch = await corsair.hubspot.api.contacts.search({
    filterGroups: [
      {
        filters: [
          { propertyName: 'email', operator: 'EQ', value: contactEmail },
        ],
      },
    ],
    properties: ['firstname', 'lastname', 'email'],
  });

  if (contactSearch.total === 0) {
    console.log(\`Contact "\${contactEmail}" not found in HubSpot. Create the contact first.\`);
    return;
  }

  const contact = contactSearch.results[0];
  console.log('Creating deal for contact:', contact.properties?.email);

  const deal = await corsair.hubspot.api.deals.create({
    properties: {
      dealname: 'Acme Corp - Enterprise Plan',
      amount: '24000',
      closedate: '2026-03-31',
      dealstage: 'appointmentscheduled', // pipeline stage — ask user if unsure
      pipeline: 'default',
      hubspot_owner_id: '', // optionally set the owner
    },
    associations: [
      {
        to: { id: contact.id },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
      },
    ],
  });

  console.log('Deal created:', { id: deal.id, properties: deal.properties });
}
main().catch(console.error);`,
	},
	{
		description:
			'Create a HubSpot support ticket for a contact. Looks up the contact first, then creates a ticket in the helpdesk pipeline with a subject, description, and priority. Use this when a customer reports an issue that needs tracking.',
		code: `async function main() {
  const contactEmail = 'john.doe@example.com';

  // Find the contact
  const contactSearch = await corsair.hubspot.api.contacts.search({
    filterGroups: [
      {
        filters: [
          { propertyName: 'email', operator: 'EQ', value: contactEmail },
        ],
      },
    ],
    properties: ['firstname', 'lastname'],
  });

  if (contactSearch.total === 0) {
    console.log(\`Contact "\${contactEmail}" not found. Ticket will be unassociated.\`);
  }

  const contact = contactSearch.results[0];

  const ticket = await corsair.hubspot.api.tickets.create({
    properties: {
      subject: 'Login page returns 500 error intermittently',
      content: 'The customer reports they are unable to log in about 30% of the time. Error appears in their browser console: 500 Internal Server Error.',
      hs_ticket_priority: 'HIGH', // LOW, MEDIUM, HIGH
      hs_pipeline: '0', // default support pipeline
      hs_pipeline_stage: '1', // new / open
    },
    ...(contact
      ? {
          associations: [
            {
              to: { id: contact.id },
              types: [
                { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 15 },
              ],
            },
          ],
        }
      : {}),
  });

  console.log('HubSpot ticket created:', {
    id: ticket.id,
    subject: ticket.properties?.subject,
    priority: ticket.properties?.hs_ticket_priority,
  });
}
main().catch(console.error);`,
	},
	{
		description:
			'Get recently created HubSpot contacts to see new leads. Logs contact names and email addresses sorted by creation date. Use this for lead review or when syncing new contacts with other systems.',
		code: `async function main() {
  const recentContacts = await corsair.hubspot.api.contacts.getRecentlyCreated({
    count: 10,
    property: ['firstname', 'lastname', 'email', 'company', 'createdate'],
  });

  if (!recentContacts.contacts?.length) {
    console.log('No recently created contacts found.');
    return;
  }

  const summary = recentContacts.contacts.map((contact) => ({
    vid: contact.vid,
    name: \`\${contact.properties?.firstname?.value ?? ''} \${contact.properties?.lastname?.value ?? ''}\`.trim(),
    email: contact.properties?.email?.value,
    company: contact.properties?.company?.value,
    createdAt: contact.properties?.createdate?.value,
  }));

  console.log('Recently created contacts:', summary);
}
main().catch(console.error);`,
	},
];

import { corsair } from './server/corsair';

async function main() {
  const allTeams = await corsair.linear.api.teams.list({});
  const teams = allTeams.nodes;

  if (teams.length === 0) {
    console.log('No Linear teams found.');
    return;
  }

  const team = teams[0]!;

  const issue = await corsair.linear.api.issues.create({
    teamId: team.id,
    title: 'test 10',
  });

  console.log('Linear issue created:', { id: issue.id, url: issue.url });
}
main().catch(console.error);

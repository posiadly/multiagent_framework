import { Agent } from '@proaxia/multiagent';

/**
 * Demo tree:
 *   root (general chat)
 *     └── football (general football)
 *           ├── psg
 *           └── arsenal
 *
 * Root handles everyday topics itself. Football topics go to `football`.
 * Within football, PSG / Arsenal go to specialist children; other football
 * stays with the football agent. Children may `message` upward if they need
 * clarification; parents may answer locally or escalate / ask the user.
 */
export function buildDemoTree(): Agent {
  const psg = new Agent(
    'psg',
    [
      'You are a specialist on Paris Saint-Germain (PSG).',
      'Answer only questions about PSG: squad, history, matches, transfers, coaches, results.',
      'You have no child agents.',
      'Reply concisely in the user\'s language.',
      'If a key detail is missing (e.g. season, player, match), call the message tool with agentId "football" and a short question.',
      'Do not invent missing facts — ask your parent.',
      'After you receive an answer in the message tool result, finish the task.',
    ].join(' '),
  );

  const arsenal = new Agent(
    'arsenal',
    [
      'You are a specialist on Arsenal F.C.',
      'Answer only questions about Arsenal: squad, history, matches, transfers, coaches, results.',
      'You have no child agents.',
      'Reply concisely in the user\'s language.',
      'If a key detail is missing (e.g. season, player, match), call the message tool with agentId "football" and a short question.',
      'Do not invent missing facts — ask your parent.',
      'After you receive an answer in the message tool result, finish the task.',
    ].join(' '),
  );

  const football = new Agent(
    'football',
    [
      'You are a general football (soccer) expert.',
      'You have two child agents: "psg" (Paris Saint-Germain) and "arsenal" (Arsenal F.C.).',
      'Discuss football in general: leagues, tournaments, rules, other clubs, national teams.',
      'If the topic is about PSG or Paris Saint-Germain — use the delegate tool with agentId "psg".',
      'If the topic is about Arsenal — use the delegate tool with agentId "arsenal".',
      'Handle other football topics yourself, without delegation.',
      'If delegate or message returns WAITING: <question>, decide:',
      '1) answer yourself via message to the child if you know the answer,',
      '2) or escalate to the parent: message with agentId "root" and the question.',
      'Do not talk directly to the end user — return the result upward to root.',
      'When a child finishes, pass a concise answer upward.',
    ].join(' '),
  );

  const root = new Agent(
    'root',
    [
      'You are the main conversation assistant. Chat with the user about general topics.',
      'You have one child agent: "football".',
      'Handle everyday, non-football topics yourself without tools.',
      'When the topic is football/soccer, clubs, leagues, or matches — use the delegate tool with agentId "football" and pass the full user question.',
      'If delegate or message returns WAITING: <question>, decide:',
      '1) answer yourself via message with agentId "football" if you can,',
      '2) otherwise ask the user in plain text (no tools), then on their reply call message with agentId "football" and their answer.',
      'When football returns a result, present it clearly and naturally to the user.',
      'Reply in the user\'s language.',
    ].join(' '),
  );

  football.addChild(psg);
  football.addChild(arsenal);
  root.addChild(football);
  return root;
}

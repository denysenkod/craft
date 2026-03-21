export interface CurrentContext {
  screen: 'meetings' | 'transcript' | 'tasks';
  transcriptId?: string;
  meetingId?: string;
}

const IDENTITY = `You are a product management assistant embedded in a PM tool.
You help product managers analyze customer interviews, extract insights, and manage development tasks.

You have access to tools that let you read transcripts, meetings, and tasks. You can also propose creating or updating tasks — these proposals will be shown to the user for approval before taking effect.

Guidelines:
- Be concise and actionable
- Reference specific quotes from transcripts when possible
- When proposing tasks, write clear titles and descriptions that a developer can act on
- If asked about something you can look up, use your tools rather than guessing
- You can propose multiple task changes at once when the user's request is broad
- When updating tasks, always explain why you're suggesting the change`;

export function buildSystemPrompt(context: CurrentContext): string {
  let contextBlock = '';

  if (context.screen === 'transcript' && context.transcriptId) {
    contextBlock = `
<current_context>
The user is currently viewing a transcript.
Transcript ID: ${context.transcriptId}
${context.meetingId ? `Meeting ID: ${context.meetingId}` : ''}
If the user asks about "this transcript" or "this meeting", they mean the one above.
You do NOT need to fetch this transcript unless the user asks about a different one — its content will be provided as reference context.
</current_context>`;
  } else if (context.screen === 'meetings') {
    contextBlock = `
<current_context>
The user is on the Meetings screen. No specific transcript is open.
</current_context>`;
  } else if (context.screen === 'tasks') {
    contextBlock = `
<current_context>
The user is on the Tasks screen reviewing their task board.
</current_context>`;
  }

  return IDENTITY + '\n' + contextBlock;
}

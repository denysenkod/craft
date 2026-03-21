import Anthropic from '@anthropic-ai/sdk';

type Tool = Anthropic.Tool;

export const AGENT_TOOLS: Tool[] = [
  {
    name: 'get_transcript',
    description: 'Fetch a transcript by ID with its raw text and structured analysis.',
    input_schema: {
      type: 'object' as const,
      properties: {
        transcript_id: { type: 'string', description: 'The transcript UUID' },
      },
      required: ['transcript_id'],
    },
  },
  {
    name: 'search_transcripts',
    description: 'Full-text search across all transcript content. Returns matching excerpts with their transcript and meeting context.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query to match against transcript text' },
        limit: { type: 'number', description: 'Max results to return (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_meeting',
    description: 'Fetch metadata for a specific meeting.',
    input_schema: {
      type: 'object' as const,
      properties: {
        meeting_id: { type: 'string', description: 'The meeting UUID' },
      },
      required: ['meeting_id'],
    },
  },
  {
    name: 'list_meetings',
    description: 'List meetings, optionally filtered by status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['pending', 'recording', 'done', 'failed'], description: 'Filter by meeting status' },
        limit: { type: 'number', description: 'Max results to return (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'get_task',
    description: 'Fetch a specific task/issue by ID from the connected project management platform (Linear, Jira, etc.).',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'The task/issue ID' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks/issues from the connected project management platform (Linear, Jira, etc.). Use this when the user asks about their tasks, backlog, todo items, or issues.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled', 'Duplicate'], description: 'Filter by workflow status' },
        limit: { type: 'number', description: 'Max results to return (default 50)' },
      },
      required: [],
    },
  },
  {
    name: 'create_task',
    description: 'Propose creating a new task. This returns a proposal that the user must approve before it is saved to the connected platform. Use this when the user asks to create a task or when you identify actionable work from a transcript.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Clear, actionable task title a developer can act on' },
        description: { type: 'string', description: 'Detailed description with context and acceptance criteria' },
        transcript_id: { type: 'string', description: 'Source transcript ID (if applicable)' },
      },
      required: ['title', 'description'],
    },
  },
  {
    name: 'update_task',
    description: 'Propose updating an existing task. Returns a proposal showing the diff of changes for user review. The update is applied to the connected platform after approval.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'The task/issue ID to update' },
        title: { type: 'string', description: 'New title (if changing)' },
        description: { type: 'string', description: 'New description (if changing)' },
        status: { type: 'string', enum: ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled', 'Duplicate'], description: 'New workflow status' },
        reason: { type: 'string', description: 'Why this update is suggested' },
      },
      required: ['task_id', 'reason'],
    },
  },
];

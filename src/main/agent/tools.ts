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
    description: 'Fetch a specific task with its full details and the title of the meeting it originated from.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'The task UUID' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks with optional filters by status or source transcript.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['draft', 'approved', 'rejected', 'pushed'], description: 'Filter by task status' },
        transcript_id: { type: 'string', description: 'Filter to tasks from a specific transcript' },
        limit: { type: 'number', description: 'Max results to return (default 50)' },
      },
      required: [],
    },
  },
  {
    name: 'create_task',
    description: 'Propose creating a new task. This returns a proposal that the user must approve before it is saved. Use this when the user asks to create a task or when you identify actionable work from a transcript.',
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
    description: 'Propose updating an existing task. Returns a proposal showing the diff of changes for user review.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'The task UUID to update' },
        title: { type: 'string', description: 'New title (if changing)' },
        description: { type: 'string', description: 'New description (if changing)' },
        reason: { type: 'string', description: 'Why this update is suggested' },
      },
      required: ['task_id', 'reason'],
    },
  },
];

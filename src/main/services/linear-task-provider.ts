import { getLinearClient } from '../ipc/linear';
import { TaskProvider, TaskItem, CreateTaskInput, UpdateTaskInput, CreatedTask } from './task-provider';

export class LinearTaskProvider implements TaskProvider {
  readonly name = 'linear';

  private async getDefaultTeamId(): Promise<string> {
    const client = await getLinearClient();
    const teams = await client.teams();
    if (teams.nodes.length === 0) throw new Error('No Linear teams found. Is Linear connected?');
    return teams.nodes[0].id;
  }

  async list(filters?: { status?: string; limit?: number }): Promise<TaskItem[]> {
    const client = await getLinearClient();
    const teamId = await this.getDefaultTeamId();
    const team: any = await client.team(teamId);
    const limit = filters?.limit || 50;

    const issues = await team.issues({ first: limit, orderBy: 'updatedAt' });
    const results: TaskItem[] = [];

    for (const issue of issues.nodes) {
      const state = await issue.state;
      const stateName = state?.name || 'Unknown';

      if (filters?.status && stateName.toLowerCase() !== filters.status.toLowerCase()) continue;

      const assignee = await issue.assignee;
      results.push({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description?.substring(0, 500) || '',
        status: stateName,
        priority: issue.priority,
        priorityLabel: issue.priorityLabel,
        assignee: assignee ? { name: assignee.name, email: assignee.email } : null,
        url: issue.url,
        createdAt: issue.createdAt.toISOString(),
        updatedAt: issue.updatedAt.toISOString(),
      });
    }

    return results;
  }

  async get(taskId: string): Promise<TaskItem | null> {
    try {
      const client: any = await getLinearClient();
      const issue = await client.issue(taskId);
      if (!issue) return null;

      const state = await issue.state;
      const assignee = await issue.assignee;

      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description || '',
        status: state?.name || 'Unknown',
        priority: issue.priority,
        priorityLabel: issue.priorityLabel,
        assignee: assignee ? { name: assignee.name, email: assignee.email } : null,
        url: issue.url,
        createdAt: issue.createdAt.toISOString(),
        updatedAt: issue.updatedAt.toISOString(),
      };
    } catch {
      return null;
    }
  }

  async create(input: CreateTaskInput): Promise<CreatedTask> {
    const client: any = await getLinearClient();

    let teamId = input.teamId;
    if (!teamId) {
      teamId = await this.getDefaultTeamId();
    }

    const result = await client.createIssue({
      title: input.title,
      description: input.description,
      teamId,
    });
    const issue = await result.issue;
    if (!issue) throw new Error('Failed to create Linear issue');

    return {
      id: issue.id,
      identifier: issue.identifier,
      url: issue.url,
    };
  }

  async update(input: UpdateTaskInput): Promise<{ id: string }> {
    const client: any = await getLinearClient();
    const updates: Record<string, string> = {};
    if (input.title) updates.title = input.title;
    if (input.description) updates.description = input.description;

    // Resolve status name to Linear state ID
    if (input.status) {
      const teamId = await this.getDefaultTeamId();
      const team: any = await client.team(teamId);
      const states = await team.states();
      const match = states.nodes.find(
        (s: any) => s.name.toLowerCase() === input.status!.toLowerCase()
      );
      if (match) {
        updates.stateId = match.id;
      }
    }

    await client.updateIssue(input.taskId, updates);
    return { id: input.taskId };
  }
}

declare module '@linear/sdk' {
  export class LinearClient {
    constructor(options: { apiKey?: string; accessToken?: string });
    get viewer(): Promise<{ id: string; name: string; email: string }>;
    teams(): Promise<{ nodes: Array<{ id: string; name: string; key: string }> }>;
    team(id: string): Promise<any>;
    createIssue(input: {
      title: string;
      description?: string;
      teamId: string;
    }): Promise<{ issue: Promise<{ id: string; identifier: string; url: string } | undefined> }>;
  }
}

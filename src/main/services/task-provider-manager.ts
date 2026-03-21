import { getDb } from '../db';
import { TaskProvider } from './task-provider';
import { LinearTaskProvider } from './linear-task-provider';

let cachedProvider: TaskProvider | null = null;
let cachedProviderName: string | null = null;

/**
 * Returns the active TaskProvider based on which platform is connected.
 * Checks the `auth` table for stored credentials.
 */
export function getTaskProvider(): TaskProvider {
  const db = getDb();
  const connected = db.prepare('SELECT provider FROM auth').all() as { provider: string }[];

  const activeProvider = connected.length > 0 ? connected[0].provider : null;

  if (!activeProvider) {
    throw new Error('No task management platform connected. Connect Linear or Jira in Settings.');
  }

  // Return cached provider if the same platform is still active
  if (cachedProvider && cachedProviderName === activeProvider) {
    return cachedProvider;
  }

  switch (activeProvider) {
    case 'linear':
      cachedProvider = new LinearTaskProvider();
      cachedProviderName = 'linear';
      return cachedProvider;
    // case 'jira':
    //   cachedProvider = new JiraTaskProvider();
    //   cachedProviderName = 'jira';
    //   return cachedProvider;
    default:
      throw new Error(`Unsupported task provider: ${activeProvider}`);
  }
}

/**
 * Check if any task provider is currently connected.
 */
export function hasTaskProvider(): boolean {
  try {
    getTaskProvider();
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear cached provider (e.g., after disconnect).
 */
export function clearTaskProviderCache(): void {
  cachedProvider = null;
  cachedProviderName = null;
}

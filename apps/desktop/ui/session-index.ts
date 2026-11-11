import type { ProjectInfo, SessionInfo } from '@wisp/core';
export function indexSessionList(sessions: SessionInfo[], projects: ProjectInfo[]) {
  const active = new Map<string | undefined, SessionInfo[]>(), archived: SessionInfo[] = [];
  const projectNames = new Map<string, string>();
  for (const project of projects) if (!projectNames.has(project.id)) projectNames.set(project.id, project.name);
  for (const session of sessions) {
    if (session.archivedAt) { archived.push(session); continue; }
    // Independent conversations historically include an absent or empty project ID.
    const id = session.projectId || undefined;
    let group = active.get(id);
    if (!group) active.set(id, group = []);
    group.push(session);
  }
  return { active, archived, projectNames };
}

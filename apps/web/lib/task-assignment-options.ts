export interface TaskAssignmentMemberOption {
  id: string;
  name: string;
}

/**
 * Mirrors the Tasks API's assignment ACL for presentation only. The API remains
 * authoritative: leads/owners may assign anyone; members may keep the current
 * assignee, self-assign, or clear the field.
 */
export function taskAssignmentOptions(
  members: readonly TaskAssignmentMemberOption[],
  canAssignOthers: boolean,
  myMemberId: string | null,
  currentAssigneeId: string | null
): TaskAssignmentMemberOption[] {
  if (canAssignOthers) return [...members];
  const allowed = new Set([myMemberId, currentAssigneeId].filter((id): id is string => id !== null));
  return members.filter((member) => allowed.has(member.id));
}

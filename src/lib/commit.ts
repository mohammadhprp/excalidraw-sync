/** Commit-message templating. Pure, no I/O. */

export const DEFAULT_COMMIT_MESSAGE_TEMPLATE =
  "sync({collection}/{board}): {action} from Excalidraw";

export interface CommitMessageVars {
  board: string;
  collection: string;
  action: string;
  timestamp: string;
}

/**
 * Replace `{board}`, `{collection}`, `{action}` and `{timestamp}` in a
 * template. Unknown placeholders are left untouched.
 */
export function renderCommitMessage(
  template: string,
  vars: CommitMessageVars,
): string {
  return template
    .replace(/\{board\}/g, vars.board)
    .replace(/\{collection\}/g, vars.collection)
    .replace(/\{action\}/g, vars.action)
    .replace(/\{timestamp\}/g, vars.timestamp);
}

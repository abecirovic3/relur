import fs from 'node:fs';
import path from 'node:path';
import { parseWorkflowFile, WORKFLOW_FILE, type WorkflowFileRead } from '@shared/workflow-file';

/** Workflow files are small; anything bigger isn't one. */
const MAX_BYTES = 256 * 1024;

/** The workflow file at a skill source's root (spec §13.9); null without one. */
export function readWorkflowFile(dir: string): WorkflowFileRead | null {
  const file = path.join(dir, WORKFLOW_FILE);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  if (stat.size > MAX_BYTES) return { ok: false, message: `${WORKFLOW_FILE} is too big.` };
  try {
    return parseWorkflowFile(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

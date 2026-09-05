import { existsSync } from 'node:fs';
import path from 'node:path';

const COMPASS = '.compass';

export function findRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(dir, COMPASS, 'config.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export const compassDir  = (root) => path.join(root, COMPASS);
export const taskDir     = (root, taskId) => path.join(root, COMPASS, taskId);
export const evidenceDir = (root, taskId) => path.join(root, COMPASS, taskId, 'evidence');
export const specPath    = (root, taskId) => path.join(root, COMPASS, taskId, 'spec.md');
export const gatePath    = (root, taskId) => path.join(root, COMPASS, taskId, 'evidence', 'gate.json');
export const configPath  = (root) => path.join(root, COMPASS, 'config.json');
export const saltPath    = (root) => path.join(root, COMPASS, '.salt');

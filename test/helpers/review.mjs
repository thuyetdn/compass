import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { reviewCommand } from '../../commands/review.mjs';
import { CRITERIA } from '../../lib/findings.mjs';

// Từ CP-78 gate `review` áp cho `feature-s`, và `findings.json` phải có kết luận
// cho cả mười tiêu chí. Các test dùng fixture `feature-s` để đo chuyện khác (khe
// ghi theo repo, cờ --only) cần một người soi giả lập trước `done`. Helper này
// đóng vai đó: nó không đo gì về review, chỉ đưa task qua bước review sạch.

export const FINDINGS_FILE = 'findings.json';

// Kết luận cho mọi tiêu chí. `overrides` thay từng khóa, `null` thì bỏ khóa đó.
export function coverageFor(overrides = {}) {
  const coverage = {};
  for (const { key } of CRITERIA) coverage[key] = { verdict: 'clean' };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete coverage[key];
    else coverage[key] = value;
  }
  return coverage;
}

export function briefIdIn(root, taskId) {
  const brief = readFileSync(path.join(root, '.compass', taskId, 'review-brief.md'), 'utf8');
  return brief.match(/"brief":\s*"([^"]+)"/)?.[1] ?? null;
}

export function writeReview(root, taskId, { findings = [], coverage, brief } = {}) {
  const dir = path.join(root, '.compass', taskId, 'evidence');
  mkdirSync(dir, { recursive: true });
  const body = {
    brief: brief ?? briefIdIn(root, taskId),
    coverage: coverage ?? coverageFor(),
    findings,
  };
  writeFileSync(path.join(dir, FINDINGS_FILE), JSON.stringify(body, null, 2));
}

// Pha một sinh brief, người soi giả lập nộp kết quả sạch, pha hai phán.
export function playReviewer(root, taskId) {
  const first = reviewCommand({ cwd: root, taskId });
  if (first.exitCode !== 1) {
    throw new Error(`pha một của review phải thoát mã 1, được ${first.exitCode}:\n${first.output}`);
  }
  writeReview(root, taskId);
  return reviewCommand({ cwd: root, taskId });
}

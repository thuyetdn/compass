import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findRoot, specPath, taskDir, validateTaskId } from '../lib/paths.mjs';
import { loadConfig } from '../lib/config.mjs';
import { parseContract } from '../lib/design-contract.mjs';
import { decodePng, encodePng } from '../lib/png.mjs';
import { diffImages } from '../lib/image-diff.mjs';
import { findPlaywright } from '../lib/browser.mjs';
import { startDevServer, waitForUrl } from '../lib/dev-server.mjs';
import { writeGate, writeSkip, repoEvidenceDir } from '../lib/gate-store.mjs';
import { hashFile } from '../lib/hash.mjs';
import { pass, fail, hint } from '../lib/report.mjs';
import { hashSource } from '../lib/source-hash.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { rulesFor } from '../lib/task-types.mjs';
import { reposForGate, repoPathError, runBrowserGatePerRepo } from '../lib/gates.mjs';

const CONTRACT_FILE = 'design-contract.json';
const BASELINE_DIR = 'baseline';
const DEFAULT_THRESHOLD = 0.001; // 0.1% of pixels
const CHANNEL_TOLERANCE = 3;     // absorbs anti-aliasing, not real change
// Mặc định 60 giây, đủ cho một dev server bình thường. Dự án nặng có thể
// khai `devTimeoutMs` trong config để nới ra — hoặc siết lại cho test.
const DEV_TIMEOUT_MS = 60000;
const PAGE_TIMEOUT_MS = 30000;

function percent(ratio) {
  return `${(ratio * 100).toFixed(3)}%`;
}

// `repo` và `gateRoot` như gate `ui`: một hợp đồng thiết kế cho cả task, còn dev
// server, Playwright, config và baseline là của từng repo.
export async function visualCommand({ cwd, taskId, repo = null, gateRoot = null }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass visual <id>' };

  const validation = validateTaskId(taskId);
  if (!validation.ok) return { exitCode: 2, output: validation.reason };

  const root = gateRoot ?? findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const file = specPath(root, taskId);
  if (!existsSync(file)) return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };

  // Tên repo đi vào đường dẫn baseline và evidence, nên soi nó trước khi ghi gì.
  const tenHong = repo === null ? null : repoPathError(repo);
  if (tenHong) return { exitCode: 2, output: fail('visual', [tenHong]) };

  const spec = parseSpec(readFileSync(file, 'utf8'));
  const chon = reposForGate(root, spec.scope, repo);
  if (!chon.ok) return { exitCode: 2, output: chon.output };
  if (chon.repos === null) return doVisual({ root, file, taskId, repo: null, repoDir: root, repoConfig: null });
  if (repo !== null) {
    const [r] = chon.repos;
    return doVisual({ root, file, taskId, repo, repoDir: r.dir, repoConfig: r.config });
  }

  return runBrowserGatePerRepo({
    gate: 'visual',
    repos: chon.repos,
    required: rulesFor(spec.type)?.gates.includes('visual') ?? false,
    run: (r) => doVisual({ root, file, taskId, repo: r.name, repoDir: r.dir, repoConfig: r.config }),
    skip: (r) => writeSkip(root, taskId, 'visual', r.name),
  });
}

// Chụp một nơi: gốc khi dự án một repo, thư mục repo khi nhiều repo. Baseline của
// repo nằm ở `baseline/<repo>/` — hai repo cùng viewport `desktop` mà chung một
// baseline thì repo sau bị so với ảnh của repo trước.
async function doVisual({ root, file, taskId, repo, repoDir, repoConfig }) {
  const contractFile = path.join(taskDir(root, taskId), CONTRACT_FILE);

  // Viewports come from the design contract, so a task with no contract has no
  // list of screens worth photographing.
  if (!existsSync(contractFile)) {
    writeGate(root, taskId, {
      gate: 'visual',
      exitCode: 0,
      checkedAt: new Date().toISOString(),
      specHash: hashFile(file),
      sourceHash: hashSource(root),
      shots: 0,
      failedShots: 0,
    }, repo);
    return {
      exitCode: 0,
      output: [
        pass('visual', 'chưa có hợp đồng thiết kế nên chưa biết chụp màn nào'),
        '',
        hint(`Khai viewport trong .compass/${taskId}/${CONTRACT_FILE} để bật gate này.`),
      ].join('\n'),
    };
  }

  const { contract, errors } = parseContract(readFileSync(contractFile, 'utf8'));
  if (!contract) {
    return { exitCode: 2, output: fail('visual', errors) };
  }

  // Một repo: config ở gốc, đọc như cũ. Nhiều repo: config đã gộp của repo đó,
  // kể cả `visualThreshold`.
  let config = repoConfig;
  if (config === null) {
    const cfg = loadConfig(root);
    if (!cfg.ok) return { exitCode: 2, output: cfg.errors.join('\n') };
    config = cfg.config;
  }

  const threshold = config.visualThreshold ?? DEFAULT_THRESHOLD;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0) {
    return {
      exitCode: 2,
      output: fail('visual', ['visualThreshold trong config.json phải là số không âm (tỉ lệ, ví dụ 0.001 cho 0.1%)']),
    };
  }

  const missing = [];
  if (!config.dev) missing.push('"dev"');
  if (!config.devUrl) missing.push('"devUrl"');
  if (missing.length) {
    return {
      exitCode: 2,
      output: [
        fail('visual', [`config.json thiếu ${missing.join(' và ')}${repo === null ? '' : ` cho repo "${repo}"`}`]),
        '',
        hint('Thêm: { "dev": "npm run dev", "devUrl": "http://localhost:5173/" }'),
      ].join('\n'),
    };
  }

  // Tìm từ thư mục repo: mỗi repo tự cài Playwright, không mượn của repo bên cạnh.
  const playwright = await findPlaywright(repoDir);
  if (!playwright.ok) {
    return { exitCode: 2, output: fail('visual', playwright.reason.split('\n')) };
  }

  const repoParts = repo === null ? [] : repo.split('/');
  const baselineDir = path.join(taskDir(root, taskId), BASELINE_DIR, ...repoParts);
  const evidence = repoEvidenceDir(root, taskId, repo);
  // Đường dẫn in cho người đọc, luôn dùng `/` như tên repo.
  const baselineShown = [BASELINE_DIR, ...repoParts].join('/');
  const evidenceShown = repo === null ? 'evidence' : `evidence/repos/${repo}`;
  mkdirSync(baselineDir, { recursive: true });
  mkdirSync(evidence, { recursive: true });

  const server = startDevServer(config.dev, repoDir);
  let browser;

  try {
    const up = await waitForUrl(config.devUrl, { timeoutMs: config.devTimeoutMs ?? DEV_TIMEOUT_MS });
    if (!up.ok) {
      return {
        exitCode: 2,
        output: fail('visual', [
          `Dev server ${up.reason}.`,
          `Lệnh: ${config.dev}`,
          server.output.split('\n').slice(-5).join('\n'),
        ]),
      };
    }

    browser = await playwright.module.chromium.launch();

    const created = [];
    const drifted = [];
    const problems = [];

    for (const viewport of contract.viewports) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
      });
      await page.goto(config.devUrl, { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS });
      const shot = await page.screenshot({ fullPage: true });
      await page.close();

      const baselineFile = path.join(baselineDir, `${viewport.name}.png`);

      // A first run has nothing to compare against. Writing the baseline and
      // saying so is honest; passing silently would look like a check that ran.
      if (!existsSync(baselineFile)) {
        writeFileSync(baselineFile, shot);
        created.push(viewport.name);
        continue;
      }

      let baselineImage;
      try {
        baselineImage = decodePng(readFileSync(baselineFile));
      } catch (err) {
        problems.push(`Baseline ${viewport.name}.png đọc không được: ${err.message}`);
        continue;
      }

      const actualImage = decodePng(shot);
      const result = diffImages(baselineImage, actualImage, { channelTolerance: CHANNEL_TOLERANCE });

      if (result.ratio > threshold) {
        writeFileSync(path.join(evidence, `visual-${viewport.name}-actual.png`), shot);
        if (result.diffPixels) {
          writeFileSync(
            path.join(evidence, `visual-${viewport.name}-diff.png`),
            encodePng(actualImage.width, actualImage.height, result.diffPixels),
          );
        }
        drifted.push({
          viewport: viewport.name,
          ratio: result.ratio,
          pixels: result.differentPixels,
          reason: result.reason,
        });
      }
    }

    const failed = drifted.length + problems.length;
    writeGate(root, taskId, {
      gate: 'visual',
      exitCode: failed > 0 ? 1 : 0,
      checkedAt: new Date().toISOString(),
      specHash: hashFile(file),
      sourceHash: hashSource(root),
      threshold,
      shots: contract.viewports.length,
      createdBaselines: created,
      failedShots: failed,
      drifted: drifted.map((d) => ({ viewport: d.viewport, ratio: d.ratio })),
    }, repo);

    if (failed > 0) {
      const lines = [];
      for (const d of drifted) {
        lines.push(
          d.reason
            ? `${d.viewport}: ${d.reason}`
            : `${d.viewport}: ${percent(d.ratio)} pixel khác (${d.pixels} pixel), ngưỡng ${percent(threshold)}`,
        );
      }
      lines.push(...problems);
      lines.push('', `Ảnh so sánh: .compass/${taskId}/${evidenceShown}/visual-*-diff.png`);
      return {
        exitCode: 1,
        output: [
          fail('visual', lines),
          '',
          hint('Xem ảnh diff. Thay đổi là cố ý thì xóa baseline cũ và chạy lại để chốt baseline mới.'),
        ].join('\n'),
      };
    }

    if (created.length === contract.viewports.length) {
      return {
        exitCode: 0,
        output: [
          pass('visual', `đã tạo baseline cho ${created.length} viewport`),
          '',
          `Baseline: .compass/${taskId}/${baselineShown}/`,
          hint('Lần này chưa so gì cả — xem ảnh, thấy đúng thì commit baseline vào git.'),
        ].join('\n'),
      };
    }

    const detail = created.length
      ? `${contract.viewports.length - created.length} viewport khớp, ${created.length} baseline mới`
      : `${contract.viewports.length} viewport khớp baseline`;
    return { exitCode: 0, output: pass('visual', detail) };
  } catch (err) {
    return { exitCode: 2, output: fail('visual', [`Không chụp được: ${err.message}`]) };
  } finally {
    if (browser) await browser.close().catch(() => {});
    await server.stop();
  }
}

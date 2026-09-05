import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findRoot, specPath, taskDir, evidenceDir, validateTaskId } from '../lib/paths.mjs';
import { loadConfig } from '../lib/config.mjs';
import { parseContract } from '../lib/design-contract.mjs';
import { decodePng, encodePng } from '../lib/png.mjs';
import { diffImages } from '../lib/image-diff.mjs';
import { findPlaywright } from '../lib/browser.mjs';
import { startDevServer, waitForUrl } from '../lib/dev-server.mjs';
import { writeGate } from '../lib/gate-store.mjs';
import { hashFile } from '../lib/hash.mjs';
import { pass, fail, hint } from '../lib/report.mjs';

const CONTRACT_FILE = 'design-contract.json';
const BASELINE_DIR = 'baseline';
const DEFAULT_THRESHOLD = 0.001; // 0.1% of pixels
const CHANNEL_TOLERANCE = 3;     // absorbs anti-aliasing, not real change
const DEV_TIMEOUT_MS = 60000;
const PAGE_TIMEOUT_MS = 30000;

function percent(ratio) {
  return `${(ratio * 100).toFixed(3)}%`;
}

export async function visualCommand({ cwd, taskId }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass visual <id>' };

  const validation = validateTaskId(taskId);
  if (!validation.ok) return { exitCode: 2, output: validation.reason };

  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const file = specPath(root, taskId);
  if (!existsSync(file)) return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };

  const contractFile = path.join(taskDir(root, taskId), CONTRACT_FILE);

  // Viewports come from the design contract, so a task with no contract has no
  // list of screens worth photographing.
  if (!existsSync(contractFile)) {
    writeGate(root, taskId, {
      gate: 'visual',
      exitCode: 0,
      checkedAt: new Date().toISOString(),
      specHash: hashFile(file),
      shots: 0,
      failedShots: 0,
    });
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

  const cfg = loadConfig(root);
  if (!cfg.ok) return { exitCode: 2, output: cfg.errors.join('\n') };

  const threshold = cfg.config.visualThreshold ?? DEFAULT_THRESHOLD;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0) {
    return {
      exitCode: 2,
      output: fail('visual', ['visualThreshold trong config.json phải là số không âm (tỉ lệ, ví dụ 0.001 cho 0.1%)']),
    };
  }

  const missing = [];
  if (!cfg.config.dev) missing.push('"dev"');
  if (!cfg.config.devUrl) missing.push('"devUrl"');
  if (missing.length) {
    return {
      exitCode: 2,
      output: [
        fail('visual', [`config.json thiếu ${missing.join(' và ')}`]),
        '',
        hint('Thêm: { "dev": "npm run dev", "devUrl": "http://localhost:5173/" }'),
      ].join('\n'),
    };
  }

  const playwright = await findPlaywright(root);
  if (!playwright.ok) {
    return { exitCode: 2, output: fail('visual', playwright.reason.split('\n')) };
  }

  const baselineDir = path.join(taskDir(root, taskId), BASELINE_DIR);
  const evidence = evidenceDir(root, taskId);
  mkdirSync(baselineDir, { recursive: true });
  mkdirSync(evidence, { recursive: true });

  const server = startDevServer(cfg.config.dev, root);
  let browser;

  try {
    const up = await waitForUrl(cfg.config.devUrl, { timeoutMs: DEV_TIMEOUT_MS });
    if (!up.ok) {
      return {
        exitCode: 2,
        output: fail('visual', [
          `Dev server ${up.reason}.`,
          `Lệnh: ${cfg.config.dev}`,
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
      await page.goto(cfg.config.devUrl, { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS });
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
      threshold,
      shots: contract.viewports.length,
      createdBaselines: created,
      failedShots: failed,
      drifted: drifted.map((d) => ({ viewport: d.viewport, ratio: d.ratio })),
    });

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
      lines.push('', `Ảnh so sánh: .compass/${taskId}/evidence/visual-*-diff.png`);
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
          `Baseline: .compass/${taskId}/${BASELINE_DIR}/`,
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
    server.stop();
  }
}

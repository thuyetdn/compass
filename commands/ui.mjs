import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findRoot, specPath, taskDir, validateTaskId } from '../lib/paths.mjs';
import { loadConfig } from '../lib/config.mjs';
import { parseContract } from '../lib/design-contract.mjs';
import { compareValue } from '../lib/tolerance.mjs';
import { findPlaywright, buildMeasureScript, pairResults } from '../lib/browser.mjs';
import { startDevServer, waitForUrl, isLocalUrl } from '../lib/dev-server.mjs';
import { writeGate, writeSkip, repoEvidenceDir } from '../lib/gate-store.mjs';
import { hashFile, sha256 } from '../lib/hash.mjs';
import { pass, fail, hint } from '../lib/report.mjs';
import { hashSource } from '../lib/source-hash.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { rulesFor } from '../lib/task-types.mjs';
import { reposForGate, repoPathError, runBrowserGatePerRepo } from '../lib/gates.mjs';

const CONTRACT_FILE = 'design-contract.json';
// Mặc định 60 giây, đủ cho một dev server bình thường. Dự án nặng có thể
// khai `devTimeoutMs` trong config để nới ra — hoặc siết lại cho test.
const DEV_TIMEOUT_MS = 60000;
const PAGE_TIMEOUT_MS = 30000;

function contractPath(root, taskId) {
  return path.join(taskDir(root, taskId), CONTRACT_FILE);
}

function formatDrift(d) {
  const where = `${d.element} > ${d.property}`;
  const detail = d.actual === undefined
    ? 'không đo được'
    : `design ${d.design}   actual ${d.actual}`;
  return `[${d.viewport}] ${where}\n      ${detail}   ${d.reason}`;
}

// `repo` là tên repo cần đo (null nếu dự án một repo, hoặc gọi thẳng từ CLI).
// `gateRoot` là gốc Compass — nơi có spec, hợp đồng thiết kế và sổ gate. Một hợp
// đồng cho cả task, nhưng dev server, Playwright và config là của từng repo.
export async function uiCommand({ cwd, taskId, repo = null, gateRoot = null }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass ui <id>' };

  const validation = validateTaskId(taskId);
  if (!validation.ok) return { exitCode: 2, output: validation.reason };

  const root = gateRoot ?? findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const file = specPath(root, taskId);
  if (!existsSync(file)) return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };

  // Tên repo đi vào đường dẫn evidence, nên soi nó trước khi ghi bất cứ thứ gì.
  const tenHong = repo === null ? null : repoPathError(repo);
  if (tenHong) return { exitCode: 2, output: fail('ui', [tenHong]) };

  const spec = parseSpec(readFileSync(file, 'utf8'));
  const chon = reposForGate(root, spec.scope, repo);
  if (!chon.ok) return { exitCode: 2, output: chon.output };
  if (chon.repos === null) return doUi({ root, file, taskId, repo: null, repoDir: root, repoConfig: null });
  if (repo !== null) {
    const [r] = chon.repos;
    return doUi({ root, file, taskId, repo, repoDir: r.dir, repoConfig: r.config });
  }

  return runBrowserGatePerRepo({
    gate: 'ui',
    repos: chon.repos,
    required: rulesFor(spec.type)?.gates.includes('ui') ?? false,
    run: (r) => doUi({ root, file, taskId, repo: r.name, repoDir: r.dir, repoConfig: r.config }),
    skip: (r) => writeSkip(root, taskId, 'ui', r.name),
  });
}

// Đo một nơi: gốc khi dự án một repo (`repoConfig` null, đọc config như cũ), thư
// mục repo với config đã gộp của repo đó khi nhiều repo. `sourceHash` vẫn băm cả
// gốc, vì `done` băm gốc.
async function doUi({ root, file, taskId, repo, repoDir, repoConfig }) {
  const contractFile = contractPath(root, taskId);

  // A task with no contract has nothing to measure against. That is a normal
  // state for backend work, not a failure.
  if (!existsSync(contractFile)) {
    writeGate(root, taskId, {
      gate: 'ui',
      exitCode: 0,
      checkedAt: new Date().toISOString(),
      specHash: hashFile(file),
      sourceHash: hashSource(root),
      contractHash: null,
      measured: 0,
      driftCount: 0,
    }, repo);
    return {
      exitCode: 0,
      output: [
        pass('ui', 'chưa có hợp đồng thiết kế để đối chiếu'),
        '',
        hint(`Có Figma thì khai số vào .compass/${taskId}/${CONTRACT_FILE} — xem SKILL.md mục Gate ui.`),
      ].join('\n'),
    };
  }

  const source = readFileSync(contractFile, 'utf8');
  const { contract, errors } = parseContract(source);
  if (!contract) {
    return {
      exitCode: 2,
      output: [fail('ui', errors), '', hint(`Sửa ${CONTRACT_FILE} rồi chạy lại.`)].join('\n'),
    };
  }

  // Một repo: config ở gốc, đọc như cũ. Nhiều repo: config đã gộp của repo đó —
  // cùng config mà `check` dùng để quyết định có chạy gate này hay không.
  let config = repoConfig;
  if (config === null) {
    const cfg = loadConfig(root);
    if (!cfg.ok) return { exitCode: 2, output: cfg.errors.join('\n') };
    config = cfg.config;
  }

  const missing = [];
  if (!config.dev) missing.push('"dev" (lệnh khởi động dev server)');
  if (!config.devUrl) missing.push('"devUrl" (địa chỉ trang để đo)');
  if (missing.length && contract.elements.length > 0) {
    return {
      exitCode: 2,
      output: [
        fail('ui', [`config.json thiếu ${missing.join(' và ')}${repo === null ? '' : ` cho repo "${repo}"`}`]),
        '',
        hint('Thêm vào .compass/config.json: { "dev": "npm run dev", "devUrl": "http://localhost:5173/" }'),
      ].join('\n'),
    };
  }

  if (contract.elements.length === 0) {
    writeGate(root, taskId, {
      gate: 'ui',
      exitCode: 0,
      checkedAt: new Date().toISOString(),
      specHash: hashFile(file),
      sourceHash: hashSource(root),
      contractHash: sha256(source),
      measured: 0,
      driftCount: 0,
    }, repo);
    return { exitCode: 0, output: pass('ui', '0 thuộc tính để đo') };
  }

  // Tìm từ thư mục repo: mỗi repo tự cài Playwright, không mượn của repo bên cạnh.
  const playwright = await findPlaywright(repoDir);
  if (!playwright.ok) {
    return { exitCode: 2, output: [fail('ui', playwright.reason.split('\n'))].join('\n') };
  }

  const warnings = [];
  if (!isLocalUrl(config.devUrl)) {
    warnings.push(`devUrl trỏ ra ngoài localhost: ${config.devUrl} — đang đo trang thật, không phải bản dev.`);
  }

  const server = startDevServer(config.dev, repoDir);
  let browser;

  try {
    const up = await waitForUrl(config.devUrl, { timeoutMs: config.devTimeoutMs ?? DEV_TIMEOUT_MS });
    if (!up.ok) {
      return {
        exitCode: 2,
        output: [
          fail('ui', [
            `Dev server ${up.reason}.`,
            `Lệnh: ${config.dev}`,
            `Địa chỉ: ${config.devUrl}`,
            server.output.split('\n').slice(-5).join('\n'),
          ]),
          '',
          hint('Chạy tay lệnh dev xem nó lên không, và devUrl có đúng cổng không.'),
        ].join('\n'),
      };
    }

    browser = await playwright.module.chromium.launch();
    const script = buildMeasureScript(contract.elements);
    const drifts = [];
    let measured = 0;

    for (const viewport of contract.viewports) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
      });
      await page.goto(config.devUrl, { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS });

      const results = await page.evaluate(script);

      for (const { element, result: found } of pairResults(contract.elements, results)) {
        for (const [property, design] of Object.entries(element.properties)) {
          measured += 1;

          if (!found) {
            drifts.push({
              viewport: viewport.name,
              element: element.name,
              property,
              design,
              actual: undefined,
              reason: `không đo được "${element.name}" — trình duyệt không trả kết quả cho phần tử này`,
            });
            continue;
          }

          if (!found.found) {
            drifts.push({
              viewport: viewport.name,
              element: element.name,
              property,
              design,
              actual: undefined,
              reason: `không tìm thấy selector "${element.selector}" trên trang`,
            });
            continue;
          }

          const actual = found.values[property];
          const verdict = compareValue(property, design, actual);
          if (!verdict.ok) {
            drifts.push({
              viewport: viewport.name,
              element: element.name,
              property,
              design,
              actual,
              reason: verdict.reason,
            });
          }
        }
      }

      await page.close();
    }

    const dir = repoEvidenceDir(root, taskId, repo);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'ui.json'), JSON.stringify({ measured, drifts }, null, 2));

    writeGate(root, taskId, {
      gate: 'ui',
      exitCode: drifts.length > 0 ? 1 : 0,
      checkedAt: new Date().toISOString(),
      specHash: hashFile(file),
      sourceHash: hashSource(root),
      contractHash: sha256(source),
      devUrl: config.devUrl,
      measured,
      driftCount: drifts.length,
      outputFile: repo === null ? 'evidence/ui.json' : `evidence/repos/${repo}/ui.json`,
    }, repo);

    if (drifts.length > 0) {
      return {
        exitCode: 1,
        output: [
          fail('ui', [`${drifts.length}/${measured} thuộc tính lệch:`, ...drifts.map(formatDrift)]),
          ...warnings.map((w) => `\n${w}`),
          '',
          hint('Sửa CSS cho khớp số thiết kế. Thiết kế sai thì sửa design-contract.json và báo người.'),
        ].join('\n'),
      };
    }

    const lines = [pass('ui', `${measured} thuộc tính, ${contract.viewports.length} viewport, không lệch`)];
    if (warnings.length) lines.push('', ...warnings);
    return { exitCode: 0, output: lines.join('\n') };
  } catch (err) {
    return {
      exitCode: 2,
      output: [fail('ui', [`Không đo được: ${err.message}`])].join('\n'),
    };
  } finally {
    // The dev server outlives an exception unless it is killed here, and a held
    // port makes the next run hang on a page from the previous one.
    if (browser) await browser.close().catch(() => {});
    await server.stop();
  }
}

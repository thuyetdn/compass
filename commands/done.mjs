import { existsSync, readFileSync } from 'node:fs';
import { findRoot, specPath, configPath } from '../lib/paths.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { rulesFor } from '../lib/task-types.mjs';
import { readGates, verifyAllGates, writeGate, parseSlot } from '../lib/gate-store.mjs';
import { hashFile } from '../lib/hash.mjs';
import { pass, fail, hint } from '../lib/report.mjs';
import { hashSource } from '../lib/source-hash.mjs';
import { IMPLEMENTED_GATES, SOURCE_DEPENDENT_GATES, BROWSER_GATES, LY_DO_KHONG_DEVURL } from '../lib/gates.mjs';

// Một bản ghi "gate không chạy được" mà `done` chấp nhận thay cho bản ghi xanh.
// Hẹp hết mức có thể: chỉ gate cần trình duyệt, và chỉ đúng một lý do — cái duy
// nhất `check` sinh ra. Rộng hơn thì đây thành cửa sau, vì bất kỳ gate nào cũng
// tự khai là không chạy được rồi đi thẳng qua cổng cuối.
//
// `done` KHÔNG đọc `config.json` để tự suy ra lý do. Config là thứ được tin
// (SKILL.md), nên suy từ nó nghĩa là xoá `devUrl` sau một lần `ui` chạy đỏ thì
// gate đỏ đó biến mất. Bản ghi đã ký thì không có cửa đó — chữ ký phủ cả
// `skipReason`, nên sửa lời khai là chữ ký lệch.
//
// Danh tính không kiểm tra ở đây: `verifyAllGates` đã chặn bản ghi sửa tay, chuyển
// khe, hay chép từ task khác trước khi vòng nào chạm tới nó.
function laBoQuaHopLe(record, slot) {
  if (!record || typeof record !== 'object') return false;
  if (record.skipped !== true) return false;
  if (!BROWSER_GATES.includes(parseSlot(slot).gate)) return false;
  return record.skipReason === LY_DO_KHONG_DEVURL;
}



// Lệnh chạy lại đúng cho một gate. `compass check` chỉ chạm gate bắt buộc của
// loại task, nên với gate chạy thêm nó không sửa được gì — bảo người ta chạy nó
// là chỉ họ đâm vào tường, rồi chạy lại, rồi vẫn đỏ y nguyên.
// Khe có thể mang tên repo (`test@be`), nhưng `compass test@be` không phải lệnh.
// Lệnh chạy lại là tên gate; chạy nó sẽ đi qua mọi repo trong phạm vi.
function cachChayLai(name, taskId, batBuoc) {
  const { gate } = parseSlot(name);
  return batBuoc
    ? `Chạy lại: compass check ${taskId}`
    : `Chạy lại: compass ${gate} ${taskId} — hoặc xoá khoá "${name}" trong .compass/${taskId}/evidence/gate.json nếu không cần gate này`;
}

export function doneCommand({ cwd, taskId }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass done <id>' };

  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const file = specPath(root, taskId);
  if (!existsSync(file)) return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };

  const spec = parseSpec(readFileSync(file, 'utf8'));
  const rules = rulesFor(spec.type);
  if (!rules) return { exitCode: 2, output: `Loại task không hợp lệ trong spec: "${spec.type}"` };

  const problems = [];

  // Problem nào đã tự nói cách xử lý thì không cần hint chung ở cuối. Đánh dấu
  // ngay lúc tạo, đừng đoán lại từ chuỗi: đoán từ text hỏi sai câu hỏi, và mọi
  // message viết trước CP-16 đều rơi nhầm nhóm.
  const tuCoLoiKhuyen = new Set();
  const themKemLoiKhuyen = (p) => { problems.push(p); tuCoLoiKhuyen.add(p); };
  const them = (p, batBuoc) => (batBuoc ? problems.push(p) : themKemLoiKhuyen(p));

  const integrity = verifyAllGates(root, taskId);
  if (!integrity.ok) {
    if (integrity.tampered.length) {
      problems.push(`chữ ký không khớp ở gate: ${integrity.tampered.join(', ')} — bản ghi đã bị sửa tay.`);
    }
    if (integrity.misslotted?.length) {
      problems.push(`bản ghi ở gate "${integrity.misslotted.join(', ')}" không thuộc slot này — bị chuyển từ gate khác. Coi như gian lận.`);
    }
    if (integrity.wrongTask?.length) {
      problems.push(`bản ghi ở gate "${integrity.wrongTask.join(', ')}" thuộc task khác — bị copy sang task này. Coi như gian lận.`);
    }
    if (integrity.outdated?.length) {
      problems.push(`bản ghi ở gate "${integrity.outdated.join(', ')}" được ghi từ bản Compass cũ, chưa có taskId — không chứng minh được gì ở bản này. Chạy lại: compass check ${taskId}`);
    }
  }

  let gates;
  try {
    gates = readGates(root, taskId);
  } catch (err) {
    if (err.code === 'COMPASS_GATE_CORRUPT') {
      return {
        exitCode: 2,
        output: `Không thể đọc ledger gate tại ${file.replace(/spec\.md$/, 'evidence/gate.json')}.\nBản ghi có thể bị hỏng. Không thể tin tưởng kết quả gate.`,
      };
    }
    return {
      exitCode: 2,
      output: `Không thể đọc ledger gate tại ${file.replace(/spec\.md$/, 'evidence/gate.json')}.\nLỗi: ${err.message}`,
    };
  }

  const required = rules.gates.filter((g) => IMPLEMENTED_GATES.includes(g));
  const unimplemented = rules.gates.filter((g) => !IMPLEMENTED_GATES.includes(g));

  // Gate bắt buộc mà `check` đã từ chối chạy vì repo không có trang nào để mở.
  // Gom lại để báo cáo cuối nói ra — đóng task với hai gate chưa từng chạy là
  // một sự thật, giấu đi thì cổng cuối nói dối.
  const boQua = [];

  for (const name of required) {
    const record = gates[name];
    if (!record) {
      problems.push(`Gate "${name}" chưa chạy.`);
      continue;
    }
    if (laBoQuaHopLe(record, name)) {
      boQua.push(name);
      continue;
    }
    if (typeof record.exitCode !== 'number') {
      problems.push(`Gate "${name}" có bản ghi không ghi exit code — bản ghi hỏng. ${cachChayLai(name, taskId, true)}`);
    } else if (record.exitCode !== 0) {
      problems.push(`Gate "${name}" chưa pass (exit code ${record.exitCode}).`);
    }
  }

  // Gate chạy thêm ngoài danh sách bắt buộc vẫn phải xanh. Người ta chạy nó vì
  // thấy cần, không phải cho vui — bỏ qua một gate đỏ ở đây đúng là "báo xong
  // khi chưa xong", ngay tại cổng sinh ra để chặn điều đó.
  //
  // Muốn bỏ thì xoá bản ghi, đừng để nó nằm đó đỏ.
  //
  // `done` không nằm trong IMPLEMENTED_GATES nên dòng lọc dưới đã loại nó — không
  // cần kiểm tra riêng.
  //
  // Chỉ đúng lệnh chạy lại được: `compass check --only=<gate>` **từ chối** gate
  // ngoài danh sách loại task, nên bảo người ta chạy nó là bảo họ đâm vào tường.
  // Gọi thẳng `compass <gate> <id>` thì chạy được.
  for (const [name, record] of Object.entries(gates)) {
    // Khe có thể mang tên repo: `convention@be`. So nguyên chuỗi với
    // IMPLEMENTED_GATES thì mọi bản ghi đa repo bị bỏ qua như khoá lạ, và một
    // gate đỏ ở repo nào đó lọt thẳng qua cổng cuối.
    const { gate: ten } = parseSlot(name);
    // Bỏ qua **đúng khe trần** mà vòng bắt buộc đã soi, không bỏ qua mọi khe
    // cùng tên gate. `test@be` rơi giữa hai vòng: vòng kia tra khoá `test`,
    // vòng này thấy `test` nằm trong required rồi đi tiếp — và một gate bắt
    // buộc đỏ ở repo lọt thẳng qua cổng cuối.
    if (name === ten && required.includes(ten)) continue;
    if (!IMPLEMENTED_GATES.includes(ten)) continue;
    // Ba vòng còn lại đều có chốt này; thiếu ở đây thì một khoá `null` trong sổ
    // làm `done` ném TypeError thay vì báo bản ghi hỏng.
    if (!record || typeof record !== "object") {
      themKemLoiKhuyen(`Khoá "${name}" trong sổ gate không phải bản ghi — sổ hỏng. Xoá khoá đó rồi chạy lại: compass ${ten} ${taskId}`);
      continue;
    }
    // Một khe repo bỏ qua hợp lệ. Vòng bắt buộc phía trên chỉ tra khe trần, nên
    // `ui@frontend` rơi xuống đây; không có chốt này thì `exitCode: null` bị đọc
    // là bản ghi hỏng và task đa repo không đóng được.
    if (laBoQuaHopLe(record, name)) {
      boQua.push(name);
      continue;
    }
    if (typeof record.exitCode !== 'number') {
      themKemLoiKhuyen(`Gate "${name}" có bản ghi không ghi exit code — bản ghi hỏng. Chạy lại: compass ${parseSlot(name).gate} ${taskId}`);
    } else if (record.exitCode !== 0) {
      const doDay = `Gate "${name}" đã chạy và đỏ (exit code ${record.exitCode}).`;
      themKemLoiKhuyen(required.includes(ten)
        ? `${doDay}\n    Chạy lại: compass check ${taskId}`
        : `${doDay} Loại task "${spec.type}" không bắt buộc gate này, nhưng đã chạy thì phải xanh.` +
          `\n    Chạy lại: compass ${ten} ${taskId}` +
          `\n    Hoặc bỏ hẳn: xoá khoá "${name}" trong .compass/${taskId}/evidence/gate.json`);
    }
  }

  // Mọi gate đã chạy đều phải soi hash, không riêng gate bắt buộc. Chỉ soi
  // `exitCode` thì một bản ghi xanh từ ba tuần trước vẫn đóng được task — "đỏ
  // thì tin, xanh thì tin luôn cả khi đã mốc".
  const soi = [...new Set([
    ...required,
    // Giữ nguyên tên khe (kèm `@repo`) để đọc đúng bản ghi, nhưng lọc theo
    // phần gate — nếu không thì bản ghi đa repo không bao giờ được soi hash.
    // Lớp thứ hai: vòng CP-16 phía trên đã chặn bản ghi đỏ ở khe repo, nên
    // mutation riêng dòng này sẽ sống sót. Giữ vì nó đúng — bỏ đi thì bản ghi
    // đa repo không bao giờ được soi hash, và một bản ghi xanh mốc lọt qua.
    ...Object.keys(gates).filter((g) => IMPLEMENTED_GATES.includes(parseSlot(g).gate)),
  ])];

  const currentSpecHash = hashFile(file);
  for (const name of soi) {
    const record = gates[name];
    if (record && record.specHash && record.specHash !== currentSpecHash) {
      problems.push(`Spec đã thay đổi sau khi gate "${name}" chạy — phải chạy lại và duyệt lại.`);
    }
  }

  // done đọc sổ cái chứ không chạy lại gate, nên nếu không so mã nguồn thì mọi
  // bằng chứng đều có thể đã nói về code không còn tồn tại: gate xanh xong sửa
  // code, done vẫn đóng. Đây là giới hạn số một trong ba giới hạn SKILL.md nêu.
  //
  // Gate `spec` không đọc code nên không nằm trong danh sách. Các gate còn lại
  // thiếu trường là bản ghi cũ chứ không phải được miễn — cùng luật với
  // configHash, vì `record.sourceHash &&` sẽ âm thầm miễn trừ gate tương lai
  // nào quên ghi.
  const currentSourceHash = hashSource(root);
  for (const name of soi) {
    const record = gates[name];
    // So phần gate, không so nguyên khe: `test@be` không nằm trong danh sách
    // tên gate, nên so nguyên chuỗi thì mọi bản ghi đa repo thoát hết.
    if (!record || !SOURCE_DEPENDENT_GATES.includes(parseSlot(name).gate)) continue;
    if (!record.sourceHash) {
      them(`Gate "${name}" không ghi lại mã nguồn đã kiểm tra — bản ghi từ phiên bản cũ. ${cachChayLai(name, taskId, required.includes(name))}`, required.includes(name));
    } else if (record.sourceHash !== currentSourceHash) {
      them(`Code đã thay đổi sau khi gate "${name}" chạy — bằng chứng nói về bản cũ. ${cachChayLai(name, taskId, required.includes(name))}`, required.includes(name));
    }
  }

  // Gate nào chạy lệnh từ config thì BẮT BUỘC phải ghi configHash. Thiếu là bản
  // ghi cũ, không phải được miễn — dùng `record.configHash &&` sẽ âm thầm miễn
  // trừ mọi gate tương lai nào quên ghi.
  const CONFIG_DEPENDENT_GATES = ['test'];
  const currentConfigHash = hashFile(configPath(root));
  for (const name of soi) {
    const record = gates[name];
    if (!record || !CONFIG_DEPENDENT_GATES.includes(parseSlot(name).gate)) continue;
    if (!record.configHash) {
      them(`Gate "${name}" không ghi lại lệnh test đã dùng — bản ghi từ phiên bản cũ. ${cachChayLai(name, taskId, required.includes(name))}`, required.includes(name));
    } else if (record.configHash !== currentConfigHash) {
      them(`Lệnh test đã đổi kể từ khi gate "${name}" chạy — bằng chứng không còn mô tả đúng lệnh sẽ chạy bây giờ. ${cachChayLai(name, taskId, required.includes(name))}`, required.includes(name));
    }
  }

  if (problems.length) {
    // Chỉ gợi ý `check` khi nó thật sự sửa được gì. Vấn đề nằm hết ở gate ngoài
    // danh sách thì `check` chạy xong vẫn đỏ y nguyên, và người dùng quay vòng.
    const deuTuCoLoiKhuyen = problems.length > 0 && problems.every((p) => tuCoLoiKhuyen.has(p));
    const lines = [fail('done', problems)];
    // Nói cả trên nhánh đỏ. Task tắc vì gate khác vẫn đang thiếu hai lớp đo, và
    // người đọc cần biết ngay — đợi tới lúc mọi thứ xanh mới nói thì họ đã quyết
    // định xong từ lâu.
    if (boQua.length) {
      lines.push('', `Gate ${boQua.join(', ')} chưa từng chạy: ${LY_DO_KHONG_DEVURL}.`);
    }
    if (!deuTuCoLoiKhuyen) lines.push('', hint('Chạy: compass check ' + taskId));
    if (unimplemented.length) {
      lines.push('');
      lines.push(`Ghi chú: Gate ${unimplemented.join(', ')} chưa xây dựng ở giai đoạn này.`);
    }
    return {
      exitCode: 1,
      output: lines.join('\n'),
    };
  }

  // Cổng cuối cũng phải để lại bằng chứng. Không ghi thì `status` không biết
  // task đã đóng, và cổng quyết định "xong hay chưa" là cổng duy nhất không
  // có sổ sách.
  writeGate(root, taskId, {
    gate: 'done',
    exitCode: 0,
    // `gateCount` đếm gate đã đo, không đếm gate bỏ qua. Ai đọc sổ sau này phải
    // thấy đúng số phép đo đứng sau task, và `skipped` nói phần còn thiếu.
    gateCount: soi.length - boQua.length,
    gates: soi,
    skipped: boQua,
    closedAt: new Date().toISOString(),
    specHash: currentSpecHash,
    sourceHash: currentSourceHash,
    configHash: currentConfigHash,
  });

  // Đếm gate thật sự đã đo. Gộp cả gate bỏ qua vào con số này là nói "6 gate đã
  // pass" cho một task chỉ đo được 4 — đúng kiểu báo xong khi chưa xong mà cổng
  // này sinh ra để chặn.
  const daDo = soi.filter((name) => !boQua.includes(name));
  const lines = [pass('done', `${daDo.length} gate đã pass`)];
  if (boQua.length) {
    lines.push(`Gate ${boQua.join(', ')} chưa từng chạy: ${LY_DO_KHONG_DEVURL}. Repo không có trang nào để đo, nên hai lớp này không có bằng chứng nào cả.`);
  }
  if (unimplemented.length) {
    lines.push(`Gate ${unimplemented.join(', ')} chưa xây dựng ở giai đoạn này và không được kiểm tra.`);
  }
  lines.push('', `Task ${taskId} hoàn thành. Bằng chứng: .compass/${taskId}/evidence/`);

  return {
    exitCode: 0,
    output: lines.join('\n'),
  };
}

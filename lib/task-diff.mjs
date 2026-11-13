import { collectDiff, parseScopePaths } from './review-brief.mjs';
import { planUnits, collectUnits } from './workspace-git.mjs';

// Diff của một task: gốc soi, Soi đến, thu hẹp theo Phạm vi, và repo con có git riêng.
// Một chỗ cho `review` và `preflight` (CP-108): hai gate đọc hai khái niệm "diff của task"
// thì sẽ có lúc nói khác nhau về cùng một thay đổi.
//
// Trả `{ ok: false, kind: 'scope', rejected }` khi Phạm vi có mục không dùng làm pathspec
// được (chỉ khi có Soi đến), `{ ok: false, kind: 'plan', errors }` khi lời khai repo con hỏng,
// hay `{ ok: true, nguonGoc, scopeParsed, diffOptions, plan, collect }`.
export function taskDiffSetup(root, spec, cfg) {
  // Spec đè config. `reviewBase` trong config là một giá trị chung cho cả dự án,
  // nên trên nhánh mang nhiều task nó chỉ đúng cho một task: những task còn lại
  // được soi trên diff không chứa code của chúng, agent nộp findings, và gate
  // xanh trên bằng chứng nói về việc của người khác. Gặp thật ở CP-6, CP-10,
  // CP-11, CP-13 — code của chúng nằm cách gốc soi tới 21 commit.
  const khaiTrongSpec = spec.reviewBase !== null && spec.reviewBase !== undefined;
  const baseRef = khaiTrongSpec
    ? spec.reviewBase
    : (cfg.ok ? cfg.config.reviewBase ?? null : null);
  // Nói ra chỗ khai. Ref không phân giải được mà chỉ báo tên ref thì người đọc
  // đi sửa config trong khi lời khai nằm ở spec, hoặc ngược lại.
  //
  // Ba giá trị, không phải hai: không ai khai gì thì Compass tự lần về điểm rẽ,
  // và nói "khai ở config.json" lúc đó là lời khai sai — nó chỉ người đọc tới
  // một file không có dòng nào như vậy.
  //
  // Điều kiện phải TRÙNG với `resolveBase`, chỗ dùng `if (baseRef)`. Dùng
  // `!== null` ở đây thì `reviewBase: 0` bị resolveBase bỏ qua mà brief vẫn khai
  // "khai ở config.json" — lời khai sai về một giá trị chưa từng được dùng.
  const nguonGoc = khaiTrongSpec ? 'spec' : (baseRef ? 'config.json' : null);

  // Nơi việc kết thúc, và diff thu hẹp theo Phạm vi — chỉ khi có Soi đến. Một
  // task ở đỉnh nhánh vẫn được soi trọn, kể cả file nó quên khai (CP-36).
  const khaiCuoi = spec.reviewEnd !== null && spec.reviewEnd !== undefined;
  const scopeParsed = parseScopePaths(spec.scope);
  // `Soi đến (be):` của repo con cũng thu hẹp theo Phạm vi (CP-84).
  const thuHep = khaiCuoi || Object.keys(spec.repoEnds ?? {}).length > 0;
  if (thuHep && scopeParsed.rejected.length) return { ok: false, kind: 'scope', rejected: scopeParsed.rejected };
  const diffOptions = {
    baseRef,
    baseFrom: nguonGoc,
    endRef: khaiCuoi ? spec.reviewEnd : null,
    endFrom: 'spec',
    scopePaths: khaiCuoi ? scopeParsed.paths : [],
    // Đường dẫn `.compass/` khai trong Phạm vi được soi, có hay không có Soi đến (CP-48).
    compassPaths: scopeParsed.paths,
  };

  // Repo con có git riêng (CP-84): mỗi git một diff, gộp vào một brief. Không có
  // repo con nào như vậy thì `units` là null và mọi thứ đi đúng đường cũ.
  const plan = planUnits(root, spec);
  if (!plan.ok) return { ok: false, kind: 'plan', errors: plan.errors };

  const collect = () => (plan.units
    ? collectUnits(root, plan, diffOptions, { scopePaths: scopeParsed.paths })
    : collectDiff(root, diffOptions));
  return { ok: true, nguonGoc, scopeParsed, diffOptions, plan, collect };
}

// Diff của task cho một gate chạy theo repo (`preflight` CP-108, `mutation` CP-109): tính một lần,
// lần đầu có repo cần. Diff rỗng là một diff hợp lệ không có file nào.
// Trả hàm cho `{ ok: true, plan, collected }` hay `{ ok: false, reason }`.
export function lazyTaskDiff(root, spec, cfg) {
  let diff;
  return () => {
    if (diff) return diff;
    const setup = taskDiffSetup(root, spec, cfg);
    if (!setup.ok) {
      diff = { ok: false, reason: setup.kind === 'scope' ? 'Phạm vi có mục không dùng làm pathspec được' : setup.errors.join('; ') };
      return diff;
    }
    const collected = setup.collect();
    diff = collected.ok || collected.ly_do === 'empty'
      ? { ok: true, plan: setup.plan, collected: collected.ok ? collected : { ...collected, files: [], deleted: [], diff: '' } }
      : { ok: false, reason: collected.reason };
    return diff;
  };
}

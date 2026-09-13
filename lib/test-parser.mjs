function escapeForRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Reporters colour their output, and the escape codes sit right where the pass
// mark is expected: Vitest prints "\x1b[32m✓\x1b[39m H5 ...". Matching "^✓"
// against that fails, so a test that passed gets filed as unrecognised.
const ANSI = /\u001b\[[0-9;]*m/g;

function stripAnsi(line) {
  return line.replace(ANSI, '');
}

// Directive TAP nằm sau dấu `#` và **không phân biệt hoa thường** — TAP 13 quy
// định vậy, và một test khai `# skip` bị tính là đã chạy thì gate đo sai.
//
// Chữ SKIP/TODO đứng trong tên test thì khác: `H1 renders skip button` là tên
// tác giả đặt, không phải directive. Nên chỉ nới hoa-thường sau dấu `#`.
const TAP_DIRECTIVE = /#\s*(SKIP|SKIPPED|TODO|PENDING)\b/i;
const CHU_HOA_TRONG_TEN = /\s(SKIP|SKIPPED|TODO|PENDING)\b/;

function laBoQua(line) {
  return TAP_DIRECTIVE.test(line) || CHU_HOA_TRONG_TEN.test(line);
}

function isPassLine(rawLine) {
  const line = stripAnsi(rawLine);
  const trimmed = line.trimStart();
  // Xét dấu hiệu không-pass trước: một dòng `ok` kèm directive skip vẫn là skip.
  if (laBoQua(trimmed)) return false;
  return /^(ok\s+\d+|✔|✓|PASS|PASSED|√)/.test(trimmed);
}

function isNonPassLine(rawLine) {
  const line = stripAnsi(rawLine);
  return /^(not\s+ok|✗|✕|×|FAIL|FAILED|SKIP|SKIPPED|TODO|PENDING)/.test(line.trimStart()) ||
         laBoQua(line) ||
         /^(Error|error:|at\s)/.test(line);
}

// Tiền tố do reporter tự in ra ở đầu dòng: số thứ tự TAP, dấu tick, thanh tiến
// độ. Bỏ chúng đi thì phần còn lại là tên tác giả đặt — kể cả tên suite cha, kể
// cả đường dẫn file, vì reporter in những thứ đó theo cấu hình chứ không tự nghĩ.
//
// Ba vòng soi trước cắt tên **từ ID trở đi** và vứt phần đứng trước. Sai: phần
// đứng trước chính là chỗ phân biệt hai test. Dự án nào đặt ID ở cuối tên
// (`it('parses a config H1')`) thì mọi test đều rút về đúng một chuỗi `H1`, và
// cơ chế phát hiện đụng độ tắt ngấm — sai mà im, đúng thứ task này đi chặn.
// Dài trước ngắn trong mỗi nhóm: JS không quay lui giữa các nhánh alternation,
// nên `PASS|PASSED` khớp `PASS` rồi bỏ lại `ED - …` dính vào đầu tên. Tên hỏng
// là chuyện nhỏ; hậu quả thật là `ownsLine` neo `^` không còn thấy task id ở
// đầu tên nữa, và đường thoát chết hẳn.
const REPORTER_PREFIX = /^[\s|]*(not\s+ok|ok)\s+\d+\s*(-\s*)?|^[\s|]*[✔✓✗✕×√]\s*|^[\s|]*(PASSED|PASS|FAILED|FAIL)\s*[:-]?\s*/i;

// TAP của `node --test` không in tên suite cha trên cùng dòng với test. Nó
// dùng **thụt lề**: mỗi `# Subtest:` mở một tầng, độ thụt cho biết tầng nào.
//
//   # Subtest: outer
//       # Subtest: inner A
//           # Subtest: T2 shared
//           ok 1 - T2 shared
//
// Không đọc thụt lề thì `outer > inner A > T2` và `outer > inner B > T2` cùng
// rút về một chuỗi, và hai test khác nhau gộp làm một.
const TAP_SUBTEST = /^(\s*)# Subtest:\s*(.+)$/;

// Jest `--verbose` báo ngữ cảnh theo cách khác: một dòng `PASS <file>` ở lề 0,
// rồi các test thụt vào dưới nó. Không đọc dòng này thì hai test cùng tên ở hai
// file rút về cùng một khoá và đụng độ biến mất — cơ chế chỉ sống với `node
// --test`, dù README hứa cả ba reporter như nhau.
// Đòi phần sau trông **giống đường dẫn file test**: có `/` hoặc `\`, hoặc đuôi
// `.test.js` / `.spec.ts`… Không đòi thì `PASS H1 my test` — một dòng test bình
// thường của reporter khác — bị nuốt thành tên file và test biến mất hẳn.
// Dòng phân cách repo, do gate chèn khi gộp output nhiều repo. Không nhận ra
// thì hai repo nằm chung một khối: hai test **khác nhau** trùng tên ở hai repo
// rút về cùng khoá, dedup thành một, và ID tính là đã chạy — đúng lỗ INV-2 quay
// lại qua đường multi-repo.
// Tên repo là khóa trong config.json — không có luật nào cấm khoảng trắng, và
// `my app/` là thư mục bình thường. Đòi một token thì dòng phân cách trượt,
// hai repo gộp làm một, và cơ chế tắt hẳn theo cả hai chiều: đụng độ thật lọt
// lưới, còn task đa repo đặt tên đúng chuẩn thì đỏ oan.
const REPO_MARK = /^#\s+repo\s+(.+?)\s*$/;

const JEST_FILE = /^(PASS|FAIL)\s+(\S*(?:[/\\]|\.(?:test|spec)\.)\S*)\s*$/;

// Vitest `--reporter=tap` không dùng `# Subtest:` mà lồng bằng ngoặc nhọn:
//
//   ok 1 - t/a.test.js # time=3.14ms {
//       ok 1 - H1 handling # time=2.07ms {
//           ok 1 - H1 covers it # time=1.62ms
//       }
//   }
//
// Dòng mở khối là **cái chứa**, không phải test: tên file, tên `describe`. Tính
// nó thành một mục thì file tên `H1.test.js` chứa đúng một test cũng bị báo
// đụng độ.
//
// Đòi cả chú thích `# time=…` **lẫn** dấu `{` cuối dòng — đó là dạng Vitest in
// ra, và hai thứ cùng lúc thì tên test khó trùng được. Chỉ soi dấu `{` thì một
// test tên `H1 parses a block {` cũng bị coi là khối chứa, và nó không bao giờ
// vào sổ đụng độ — sai mà im, đúng thứ task này đi chặn.
const TAP_CONTAINER = /\s#\s*time=\S+\s*\{$/;

// Danh tính một test: đường dẫn suite cộng tên. Dùng mảng đem JSON hoá chứ
// không ghép bằng ` > ` — dấu đó cũng là dấu phân cấp reporter khác in ra, nên
// ghép rồi thì một test tên `a > b` lẫn với test `b` nằm trong suite `a`.
//
// `block` là thứ tự khối lề 0 đang mở. TAP không in tên file, nên hai test
// **cùng tên ở hai file** cho hai đường dẫn y hệt; thứ phân biệt chúng là
// chúng nằm trong hai khối lề 0 khác nhau. Chính suite này có bốn cặp như vậy,
// hai cặp mang test ID.
function pathKey(block, stack, name) {
  return JSON.stringify([block, ...stack, name]);
}

// Chú thích TAP ở cuối dòng: `# time=1.62ms`, `# todo`. Máy in ra, không phải
// tên tác giả đặt, và con số đổi mỗi lần chạy.
//
// Bóc nó thì an toàn, khác hẳn ba vòng trước cố đoán thời gian trong tên trần:
// ở đây có dấu hiệu rõ ràng — dấu `#` sau khoảng trắng. Tên test chứa `#` thì
// hiếm, và nếu có thì nó vẫn còn nguyên phần trước dấu.
// Đòi đúng dạng máy in: `# time=…`, `# SKIP`, `# TODO`. Bắt mọi `#` thì
// `H1 handles # hash` và `H1 handles # pound` cùng cụt thành `H1 handles`, hai
// test khác nhau gộp làm một — và Jest in `#` trong tên mà không escape.
// Cờ `i` đúng luật TAP: directive không phân biệt hoa thường. `isPassLine` đã
// chặn `# skip` chữ thường rồi, nên hai chỗ khớp nhau — trước đây chúng lệch,
// và khoảng lệch đó cho một test bị skip được tính là đã chạy.
// Số đo `time=` thì chỉ máy in, luôn dạng đó.
//
// Cờ `i` ở đây thừa hôm nay: `isPassLine` đã loại dòng mang directive skip/todo
// trước khi tới đây, nên chỉ còn `time=` cần bóc. Giữ vì nó đúng luật TAP, và
// vì để hai chỗ lệch nhau chính là cách lỗ cũ sinh ra.
const TAP_COMMENT = /\s+#\s*(time=\S+|(SKIP|TODO)\b.*)$/i;

function testNameOn(line) {
  return line.replace(REPORTER_PREFIX, '').replace(TAP_COMMENT, '').trim();
}

// Task này có nhận test đó là của mình không.
//
// Tên test do tác giả tự đặt, nên chỗ nào trong đó cũng có thể nhắc tới task id:
// `H1 wrote CP-15.log`, `H1 related to CP-15 ticket`, `.compass/CP-15/H1.log`
// — không cái nào là lời khai sở hữu. Mỗi lần nới điều kiện ra một chút thì lại
// lọt thêm một kiểu, đó là cách lỗ INV-2 mở lại.
//
// Chỉ hai chỗ tính: đầu tên, hoặc ngay sau dấu phân cấp suite (`>`, `›`, `»`) —
// reporter dùng chúng để nối `file > suite > test`, và phần cuối cùng vẫn là
// tên tác giả đặt. Nhận `CP-15-H1`, `CP-15: H1`, `[CP-15] H1`, `CP-15 — H1`,
// `file > CP-15-H1 …`.
//
// Không nhận sau `:`, `|`, hay dấu gạch: những dấu đó nằm giữa câu văn bình
// thường, nên `H1 warns: CP-15-H1 was renamed` là lời **nhắc** tới task khác,
// không phải lời **khai** sở hữu. Nới ra một chút là mở lại lỗ INV-2.
//
// Biên đuôi `([^A-Za-z0-9]|$)` hôm nay là thừa: hàm chỉ được gọi sau khi ID đã
// khớp trên dòng, mà phép khớp đó đã kiểm tra biên rồi. Giữ lại để hàm tự nó đúng,
// không phụ thuộc nơi gọi — đổi phép khớp kia mà quên chỗ này thì mở lại lỗ.
// Tên test có khai chủ hay không, bất kể chủ là ai. Dạng khai giống hệt
// `ownsLine`, chỉ khác là task id để mở.
//
// Cần nó để phân biệt hai case rất khác nhau: "nhiều test cùng ID, không rõ của
// ai" (đụng độ thật) với "mọi test mang ID này đều của task khác" (task này
// đơn giản là chưa viết test — phải báo thiếu, không báo đụng độ).
function khaiChuNaoDo(name, id, knownTasks) {
  // Đối chiếu với danh sách task thật, không nhận mọi thứ dạng `CHỮ-SỐ`.
  //
  // `UTF-8 H1 decodes`, `HTTP-2 H1 …`, `RFC-3339 H1 …` đều khớp mẫu đó nhưng
  // không phải lời khai sở hữu của ai. Nhận bừa thì gate báo "test này của
  // task khác" rồi khuyên đi viết đúng cái test vừa viết xong.
  //
  // Không biết danh sách thì không đoán: trả false, và case này rơi về nhánh
  // đụng độ bình thường.
  if (!knownTasks || knownTasks.length === 0) return false;
  return knownTasks.some((t) => ownsLine(name, t, id));
}

function ownsLine(name, taskId, id) {
  const pattern = new RegExp(
    `(^|[>›»]\\s*)[[({<]?\\s*${escapeForRegex(taskId)}[^A-Za-z0-9]{0,4}${escapeForRegex(id)}([^A-Za-z0-9]|$)`,
  );
  return pattern.test(name);
}

export function extractRanIds(output, knownIds, { taskId = null, knownTasks = null, repoNames = null } = {}) {
  const ran = new Set();
  const seenOnNonPassLines = new Set();
  const seenOnUnknownLines = new Set();
  const seenOnSharedLines = new Set();
  const seenOnOtherTasks = new Set();
  const passingLines = new Map();

  // Tách theo cả hai kiểu xuống dòng. Bỏ `\r` sót lại thì mọi regex neo bằng
  // `$` đều trượt trên output Windows — đúng lớp lỗi đã vá ở investigation
  // parser, và nó tái phát ở đây vì `split('\n')` trông vô hại.
  const lines = output.split(/\r?\n/);
  // Ngăn xếp suite của TAP, đánh theo thụt lề: `stack[n]` là tên của tầng thụt
  // n mức. `block` đếm số khối lề 0 đã mở, để hai file in ra hai khối giống hệt
  // vẫn tách được.
  const stack = [];
  let block = 0;
  let repoDangChay = null;
  for (const line of lines) {
    const bare = stripAnsi(line);

    const repoMark = REPO_MARK.exec(bare);
    // Chỉ tin dòng phân cách khi tên khớp một repo đã khai. Không đối chiếu thì
    // một dòng test tự in ra `# repo compass at rev abc` cũng mở khối mới, và
    // hai test cùng ID của cùng task thoát khỏi vòng đụng độ.
    if (repoMark && (repoNames === null || repoNames.includes(repoMark[1]))) {
      block += 1;
      stack.length = 0;
      repoDangChay = repoMark[1];
      continue;
    }

    const subtest = TAP_SUBTEST.exec(bare);
    if (subtest) {
      const depth = subtest[1].length;
      if (depth === 0) block += 1;
      stack.length = depth;
      stack[depth] = subtest[2].trim();
      continue;
    }

    const jestFile = JEST_FILE.exec(bare);
    if (jestFile) {
      block += 1;
      // Thừa hôm nay — `block` mới đã đủ tách hai file. Giữ vì nó đúng: sang
      // file khác thì suite của file cũ hết hiệu lực.
      stack.length = 0;
      continue;
    }

    // Dòng mở khối của Vitest tap là cái chứa, không phải test: nó vào ngăn xếp
    // suite, không vào sổ đụng độ.
    //
    // Không đòi `isPassLine`: Vitest in container là `not ok` bất cứ khi nào có
    // test con đỏ. Đòi pass thì đúng lúc suite đỏ — case spec bảo phải báo cả hai —
    // là lúc cơ chế tắt ngấm. Container là container, xanh hay đỏ không đổi việc
    // nó chứa test khác.
    if (TAP_CONTAINER.test(bare)) {
      const depth = bare.length - bare.trimStart().length;
      if (depth === 0) block += 1;
      stack.length = depth;
      stack[depth] = testNameOn(bare).replace(TAP_CONTAINER, '').trim();
      continue;
    }

    const passLine = isPassLine(line);
    const nonPassLine = isNonPassLine(line);

    // Escape codes can sit between the pass mark and the ID, so match against
    // the stripped line — otherwise they read as word characters and break the
    // boundary check.
    const plain = stripAnsi(line);
    const idsOnThisLine = [];
    for (const id of knownIds) {
      const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeForRegex(id)}([^A-Za-z0-9]|$)`);
      if (pattern.test(plain)) idsOnThisLine.push(id);
    }

    if (passLine && idsOnThisLine.length > 1) {
      // One pass line naming several spec IDs proves nothing about which test
      // covers which — count none of them as ran, flag them as ambiguous instead.
      for (const id of idsOnThisLine) seenOnSharedLines.add(id);
      continue;
    }

    for (const id of idsOnThisLine) {
      if (passLine) {
        ran.add(id);
        // Remember which test carried the ID. Every spec uses H1, V1, EC1, so
        // one task's suite satisfies another task's gate unless the collision
        // is noticed — the way a doc-only task once passed 7/7 having written
        // no tests at all.
        if (!passingLines.has(id)) passingLines.set(id, new Map());
        const name = testNameOn(plain);
        // Tầng cuối của ngăn xếp là `# Subtest:` của chính test này, không phải
        // suite cha — bỏ ra, nếu không mọi test đều mang tên mình hai lần.
        const parents = stack.filter((s) => s !== undefined);
        if (parents[parents.length - 1] === name) parents.pop();
        passingLines.get(id).set(pathKey(block, parents, name), { name, repo: repoDangChay });
      } else if (nonPassLine) {
        seenOnNonPassLines.add(id);
      } else {
        seenOnUnknownLines.add(id);
      }
    }
  }

  // A task declares one test per ID. Two different tests answering to the same
  // ID means at least one of them belongs to someone else.
  //
  // Unless the task said which is its own: a test named `CP-15-H1 …` carries
  // both ids, so the ambiguity is resolved without renaming everything already
  // written. Two tests both claiming the task id is still the task's own doing.
  const collided = [];
  for (const [id, byPath] of passingLines) {
    const muc0 = [...byPath.values()];

    // Một dòng thôi cũng phải xét: nếu nó khai chủ là task khác thì đó không
    // phải test của task này, dù chỉ có đúng một dòng khớp ID. Bỏ qua sớm ở đây
    // là để lọt case "task chưa viết gì mà đúng một task khác đã viết" — chính là
    // giới hạn INV-2 mà spec ghi là chưa bịt.
    if (byPath.size === 1) {
      if (taskId && khaiChuNaoDo(muc0[0].name, id, knownTasks) && !ownsLine(muc0[0].name, taskId, id)) {
        ran.delete(id);
        seenOnOtherTasks.add(id);
      }
      continue;
    }

    // Khớp theo biên chứ không phải chuỗi con, y như cách khớp ID ở trên.
    // `CP-1` là chuỗi con của `CP-15`: dùng `includes` thì CP-1 nhận vơ mọi test
    // tên `CP-15-*` làm của mình — đúng con bug task này sinh ra để giết.
    const muc = [...byPath.values()];
    const owned = taskId ? muc.filter((m) => ownsLine(m.name, taskId, id)) : [];

    // Một task đa repo phủ cùng một case ở hai repo là chuyện bình thường —
    // "đổi endpoint ở backend, rồi màn hình gọi nó" chính là case CP-13 sinh ra để
    // phục vụ. Đòi đúng một dòng khai chủ thì người dùng đặt tên đúng chuẩn vẫn
    // đỏ, và lời khuyên gate in ra thành lời khuyên chết.
    const repoDaKhai = new Set(owned.map((m) => m.repo));
    if (owned.length > 0 && repoDaKhai.size === owned.length) continue;

    // Mọi dòng đều khai chủ khác: không cái nào là test của task này. Đó là
    // thiếu test, không phải đụng độ — báo sai loại thì người ta đi sửa nhầm chỗ.
    if (taskId && owned.length === 0 &&
        [...byPath.values()].every((m) => khaiChuNaoDo(m.name, id, knownTasks))) {
      // Đừng xoá sạch: ID biến mất khỏi mọi nhóm thì báo cáo nói "không tìm
      // thấy dấu vết" trong khi output có hai dòng pass mang đúng chữ đó, và
      // `seenAnywhere` về 0 làm gate quay ra khuyên sửa reporter đang chạy đúng.
      ran.delete(id);
      seenOnOtherTasks.add(id);
      continue;
    }

    collided.push(id);
    ran.delete(id);
  }

  // Final dedup: if an ID passed (unambiguously) on any line, remove it from the
  // other buckets. A test that passed is a test that ran — earlier failures are history.
  //
  // ID bị đụng độ cũng vậy: nó đã lộ diện, chỉ là không rõ của ai. Để nó ở lại
  // các nhóm kia thì báo cáo in hai câu chọi nhau về cùng một ID.
  for (const id of [...ran, ...collided]) {
    seenOnNonPassLines.delete(id);
    seenOnUnknownLines.delete(id);
    seenOnSharedLines.delete(id);
  }

  return {
    ran: [...ran],
    collided: collided.sort(),
    collisions: Object.fromEntries(
      collided.map((id) => [id, [...passingLines.get(id).values()].map((m) => m.name)]),
    ),
    seenOnNonPassLines: [...seenOnNonPassLines],
    seenOnUnknownLines: [...seenOnUnknownLines],
    seenOnSharedLines: [...seenOnSharedLines],
    seenOnOtherTasks: [...seenOnOtherTasks],
  };
}

export function compareWithSpec(specIds, ranIds) {
  const ran = new Set(ranIds);
  const spec = new Set(specIds);
  const missing = specIds.filter((id) => !ran.has(id));
  const extra = ranIds.filter((id) => !spec.has(id));
  return { missing, extra, ok: missing.length === 0 };
}

function splitRow(line) {
  return line.split('|').slice(1, -1).map((cell) => cell.trim());
}

function isSeparator(cells) {
  return cells.every((c) => /^:?-{2,}:?$/.test(c));
}

export function parseSpec(markdown) {
  const lines = markdown.split(/\r?\n/);

  let taskId = '';
  let title = '';
  let type = '';
  let verifyBy = null;
  let verifyByKeyword = null;
  let verifyBySet = false;
  let testCommand = null;
  let testCommandSet = false;
  let scope = '';
  const sections = new Map();
  const testCases = [];
  const malformedRows = [];

  let currentSection = null;
  let buffer = [];
  let inTestTable = false;
  let typeSet = false;
  let scopeSet = false;
  let reviewBase = null;
  let reviewBaseSet = false;
  let reviewEnd = null;
  let reviewEndSet = false;
  // Gốc soi và Soi đến của từng repo con có git riêng: `Gốc soi (be): <ref>` (CP-84).
  const repoBases = {};
  const repoEnds = {};
  let envDeclared = null;
  let envDeclaredSet = false;

  // Lời khai chỉ tính ở PHẦN ĐẦU spec — trước heading `##` đầu tiên — đúng chỗ
  // `Loại:` và `Phạm vi:` đã nằm. Tài liệu và ví dụ đều ở dưới các heading, nên
  // không ví dụ nào chạm tới vùng này.
  //
  // Bốn lần thử đọc markdown cho đúng đều sập, mỗi lần một cửa khác: cờ lật theo
  // dòng mắc ở một dấu lẻ; ghép cặp theo thứ tự lệch khi khối lồng nhau; fence
  // quên đóng ghép với dấu mở của khối kế tiếp và nuốt cả khoảng giữa; rồi dấu
  // đóng của khối đó thành dấu mở mới, đẩy ví dụ ra ngoài vùng fence và để nó
  // thắng lời khai thật. Ba lần đầu làm lời khai biến mất, lần thứ tư còn tệ hơn:
  // phạm vi soi lấy từ một dòng trong tài liệu.
  //
  // Vị trí thì đo được, còn "dòng này có phải ví dụ không" thì không. Cùng một
  // bài học với CP-32: chỗ nào phải suy ra ý người viết từ văn bản, chỗ đó sai.
  const ketThucDau = lines.findIndex((l) => /^##\s+/.test(l));
  const cuoiVungDau = ketThucDau === -1 ? lines.length : ketThucDau;

  const flush = () => {
    if (currentSection !== null) {
      sections.set(currentSection, buffer.join('\n').trim());
    }
    buffer = [];
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineNumber = lineIndex + 1;

    const heading1 = line.match(/^#\s+([^:]+):\s*(.+)$/);
    if (heading1) {
      taskId = heading1[1].trim();
      title = heading1[2].trim();
      continue;
    }

    const heading2 = line.match(/^##\s+(.+)$/);
    if (heading2) {
      flush();
      currentSection = heading2[1].trim();
      inTestTable = currentSection === 'Test cases';
      continue;
    }

    // Parse metadata anywhere in the file, but only take first occurrence
    const typeLine = line.match(/^Loại:\s*(.+)$/);
    if (typeLine && !typeSet) {
      type = typeLine[1].trim();
      typeSet = true;
    }
    const scopeLine = line.match(/^Phạm vi:\s*(.+)$/);
    if (scopeLine && !scopeSet) {
      scope = scopeLine[1].trim();
      scopeSet = true;
    }

    // Task chạy suite khác với cả dự án thì khai ở đây. Compass có hai suite —
    // nhanh và sâu — và task nào cần suite sâu thì gate phải chạy đúng nó, không
    // thì nó báo thiếu test cho những case đang xanh.
    const cmdLine = line.match(/^Lệnh test:\s*(.+)$/);
    if (cmdLine && !testCommandSet) {
      const v = cmdLine[1].trim();
      if (v !== '') { testCommand = v; testCommandSet = true; }
    }

    // Việc không có test tự động — sửa tài liệu, đổi config — thì khai thẳng.
    // Ép bịa test case chỉ tạo ra chỗ cho lỗ INV-2 phát tác: ID bịa ra sẽ
    // khớp test của task khác và gate báo xanh cho việc chưa ai kiểm tra.
    // Giữ lại cả từ khóa của chính dòng đó: gate trích lại dòng khai cho người
    // đọc, và spec viết dạng cũ mà gate trích dạng mới `Kiểm tra bằng:` thì người
    // đó tìm trong spec không thấy dòng nào như vậy (CP-54).
    const byLine = line.match(/^(Kiểm(?: tra)? bằng):\s*(.+)$/);
    if (byLine && !verifyBySet) {
      const v = byLine[2].trim().toLowerCase();
      if (v !== '') { verifyBy = v; verifyByKeyword = byLine[1]; verifyBySet = true; }
    }

    // Nơi việc của task này bắt đầu. `reviewBase` trong config là một giá trị
    // chung cho cả dự án, nên trên nhánh mang nhiều task nó chỉ đúng cho một
    // task; những task còn lại được soi trên diff không chứa code của chúng, và
    // gate xanh trên bằng chứng nói về việc của người khác.
    const baseLine = lineIndex >= cuoiVungDau ? null : line.match(/^Gốc soi:\s*(.+)$/);
    if (baseLine && !reviewBaseSet) {
      const v = baseLine[1].trim();
      if (v !== '') { reviewBase = v; reviewBaseSet = true; }
    }

    // Nơi việc của task này kết thúc. Gate luôn soi tới HEAD, nên task nằm giữa
    // lịch sử nhánh bị soi chung với mọi commit đến sau nó — CP-6 ra 78 file
    // thay vì 13. Không khai thì vẫn tới HEAD, như cũ (CP-36).
    const endLine = lineIndex >= cuoiVungDau ? null : line.match(/^Soi đến:\s*(.+)$/);
    if (endLine && !reviewEndSet) {
      const v = endLine[1].trim();
      if (v !== '') { reviewEnd = v; reviewEndSet = true; }
    }

    // Sha của git gốc không có nghĩa gì trong git của repo con, nên mỗi repo con
    // khai mốc riêng, theo tên repo trong `repos` (CP-84). Dòng đầu cho mỗi repo thắng,
    // như dòng không ngoặc.
    const repoLine = lineIndex >= cuoiVungDau ? null : line.match(/^(Gốc soi|Soi đến) \(([^)]*)\):\s*(.*)$/);
    if (repoLine) {
      const target = repoLine[1] === 'Gốc soi' ? repoBases : repoEnds;
      const name = repoLine[2].trim();
      const v = repoLine[3].trim();
      if (name !== '' && v !== '' && !Object.hasOwn(target, name)) target[name] = v;
    }

    // Lời cho phép đọc `.env`, do người duyệt spec ký. Nằm ở vùng đầu như
    // `Gốc soi:` nên một câu nhắc `.env` trong `## Mục tiêu` không thành lời
    // cho phép. Giữ cả chuỗi rỗng: `Dùng .env:` không lý do là lời khai hỏng,
    // và gate phải phân biệt được nó với không khai gì.
    const envLine = lineIndex >= cuoiVungDau ? null : line.match(/^Dùng \.env:(.*)$/);
    if (envLine && !envDeclaredSet) {
      envDeclared = envLine[1].trim();
      envDeclaredSet = true;
    }

    if (inTestTable && line.trim().startsWith('|')) {
      const cells = splitRow(line);
      if (cells.length === 5 && !isSeparator(cells) && cells[0] !== 'ID') {
        testCases.push({
          id: cells[0],
          layer: cells[1],
          description: cells[2],
          expected: cells[3],
          priority: cells[4],
        });
      } else if (cells.length !== 5 && !isSeparator(cells) && cells[0] !== 'ID') {
        malformedRows.push({
          line: lineNumber,
          text: line,
          cellCount: cells.length,
        });
      }
      continue;
    }

    buffer.push(line);
  }
  flush();

  return { taskId, title, type, scope, testCommand, verifyBy, verifyByKeyword, reviewBase, reviewEnd, repoBases, repoEnds, envDeclared, sections, testCases, malformedRows };
}

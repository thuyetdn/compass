// Thay một mục pitfall thay vì chép thêm. Đóng lại một điều tra là chuyện
// thường — sửa hồ sơ làm `docHash` lệch, và gate buộc đóng lại — nên `--close`
// chỉ biết append đã để INV-1 và INV-5 mỗi cái hai bản, phải dọn tay.
//
// Đây là thao tác có xoá trên file duy nhất lưu bẫy đã sập. Mất một mục là mất
// cả buổi của người sau, nên luật ở đây nghiêng hết về giữ.
//
// Ba lần thử đọc fence markdown để biết dòng `## ` nào là heading thật đều sập,
// mỗi lần một cửa: cờ lật theo dòng mắc ở một dấu lẻ; ghép cặp theo thứ tự thì
// hai dấu lẻ ở hai mục khác nhau ghép với nhau và xoá sạch khoảng giữa; và
// `FENCE` chỉ biết dấu ``` nên khối `~~~` vẫn lọt.
//
// Cùng bài học với CP-34: chỗ nào phải suy ra ý người viết từ văn bản, chỗ đó
// sai. Nên chỗ này KHÔNG đọc fence nữa. Nó chỉ cắt đúng một khối:
//
//   từ dòng `## <tiêu đề cần thay>`  →  tới dòng `## ` KẾ TIẾP
//
// và nếu dòng `## ` kế tiếp hoá ra nằm trong một khối code, thì hậu quả xấu
// nhất là mục mới bị cắt ngắn — thấy được ngay khi đọc file. Ngược lại, đoán
// sai theo hướng "đó không phải heading" là quét tới cuối file và xoá mọi mục
// phía sau, im lặng, exit 0.

// Khoảng trắng LITERAL, không phải `\s` — khớp đúng mẫu `lib/investigation-parser.mjs`
// dùng để cắt section (`/^## /`). Lệch nhau thì `##<tab>Tiêu đề` trong một ví dụ
// lọt qua parser vào thân pitfall, rồi ở đây lại thành ranh giới mục: mỗi lần
// đóng lại nhân bản phần đuôi, đúng cái bug task này sinh ra để diệt.
const HEADING = /^## (.*)$/;

// Tìm mục mang đúng tiêu đề này. Trả về { from, to } theo chỉ số dòng, `to` là
// dòng đầu của mục kế tiếp (hoặc hết file). Không có thì trả null.
//
// Khớp tiêu đề PHẢI đúng nguyên văn, không phải tiền tố, và so bằng chuỗi chứ
// không bằng regex: `INV-1` là tiền tố của `INV-10`, và tiêu đề thật có `(`,
// `.`, `*` bên trong.
function timMuc(lines, title) {
  let from = -1;

  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(HEADING);
    if (!h) continue;

    if (from === -1) {
      if (h[1].trim() === title) from = i;
      continue;
    }
    // Heading cấp hai kế tiếp: mục cũ hết ở đây. `###` bên trong không tính,
    // vì nó không khớp HEADING.
    return { from, to: i };
  }

  return from === -1 ? null : { from, to: lines.length };
}

// Cắt file thành từng dòng KÈM dấu kết thúc của chính nó. Split rồi join lại
// bằng một EOL chung đổi luôn dấu kết thúc của những dòng không ai chạm tới:
// một mục CRLF nằm cạnh một file phần lớn LF bị viết lại hết, và ràng buộc
// "mọi mục khác nguyên từng byte" vỡ. Giữ dấu kết thúc theo từng dòng thì phần
// ngoài vùng thay là chuỗi con nguyên bản, không phải bản dựng lại.
function catDong(text) {
  const ra = [];
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    if (nl === -1) { ra.push({ text: text.slice(i), eol: '' }); break; }
    const coCR = nl > i && text[nl - 1] === '\r';
    ra.push({ text: text.slice(i, coCR ? nl - 1 : nl), eol: coCR ? '\r\n' : '\n' });
    i = nl + 1;
  }
  return ra;
}

// EOL cho những dòng MỚI sinh ra, chọn theo số đông. Chỉ áp cho dòng mới; dòng
// cũ giữ dấu kết thúc của chính nó.
function eolCua(text) {
  const crlf = text.split('\r\n').length - 1;
  const lf = text.split('\n').length - 1;
  return crlf * 2 > lf ? '\r\n' : '\n';
}

// Nội dung mới cho file, hoặc null nếu không tìm thấy mục để thay.
//
// Nhận và trả chuỗi; không đọc, không ghi, không in. Người gọi quyết định làm gì
// với kết quả, kể cả khi ghi thất bại.
export function replaceEntry(existing, title, body) {
  const eol = eolCua(existing);
  const dong = catDong(existing);
  const vung = timMuc(dong.map((d) => d.text), title);
  if (vung === null) return null;

  const truoc = dong.slice(0, vung.from);
  const sau = dong.slice(vung.to);

  // Bỏ dòng trắng đuôi của phần trước: mục mới đã tự mở bằng một dòng trắng ở
  // trên nó, và giữ cả hai để lại một khối trắng mỗi lần đóng lại.
  //
  // Giữ lại dòng trắng CUỐI CÙNG vừa bỏ, kèm đúng dấu kết thúc nó mang. Dựng
  // một dòng trắng mới bằng `eol` chung là đổi một byte của mục lân cận — mục
  // dùng CRLF nằm trong file phần lớn LF mất `\r` của chính nó.
  let phanCach = null;
  while (truoc.length > 0 && truoc[truoc.length - 1].text.trim() === '') {
    phanCach = truoc.pop();
  }

  // Mục mới KHÔNG tự thêm dòng trắng cuối. Có dòng sau thì dòng trắng phân cách
  // là việc của phần sau; không có thì đuôi file chỉ cần một dấu kết thúc.
  const moi = [`## ${title}`, '', ...body.split(/\r?\n/)];
  const phanMoi = moi.map((t) => t + eol).join('');

  // Phần sau ghép lại nguyên bản, kèm đúng dấu kết thúc từng dòng đã mang.
  // Phần sau bắt đầu ngay bằng dòng `## ` của mục kế tiếp, nên cần một dòng
  // trắng chen vào. Dùng `eol` chung ở đây là đúng: dòng trắng này thuộc phần
  // vừa viết, không phải dòng nào của mục lân cận.
  const phanSau = sau.length === 0 ? '' : eol + sau.map((d) => d.text + d.eol).join('');

  const phanTruoc = truoc.map((d) => d.text + (d.eol || eol)).join('');
  // Dòng trắng phân cách: dùng lại dòng cũ nếu có, chỉ sinh mới khi trước đó
  // không có dòng nào (mục đứng ngay sau tiêu đề file).
  const cach = truoc.length === 0 ? '' : (phanCach === null ? eol : phanCach.text + (phanCach.eol || eol));

  return phanTruoc + cach + phanMoi + phanSau;
}

// Khối để append khi mục chưa từng có. Tách ra để `investigate` không phải tự
// ghép chuỗi ở hai chỗ với hai cách xử lý newline khác nhau.
export function appendBlock(existing, title, body) {
  // Theo EOL của file, không hardcode LF. File pitfalls thật dùng CRLF, và chèn
  // LF vào đó tạo dòng lệch kiểu — lần đóng lại sau sẽ reflow chúng, cho ra một
  // diff giả che mất mục thật sự đổi.
  const eol = eolCua(existing);
  const separator = existing === '' || /\r?\n$/.test(existing) ? '' : eol;
  const lines = ['', `## ${title}`, '', ...body.split(/\r?\n/), ''];
  return separator + lines.join(eol);
}

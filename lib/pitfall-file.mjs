import { scanFences } from './markdown-fence.mjs';

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
// `FENCE` chỉ biết dấu ``` nên khối `~~~` vẫn lọt. Sau đó chỗ này thôi đọc fence
// và cắt tới dòng `## ` kế tiếp, chấp nhận hậu quả xấu nhất là mục mới bị cắt.
//
// Cái giá đó hoá ra không nhỏ: parser hồ sơ (CP-53) giờ giữ nguyên dòng `## `
// trong khối code của mục Pitfall, và cắt ở dòng đó thì phần đuôi từ dòng ấy trở
// đi nằm lại rồi nhân bản sau MỖI lần đóng lại. Nên giờ đọc fence lại — nhưng
// không tin nó một mình. Mỗi mục có hai điểm kết thúc:
//
//   cũ:        dòng `## ` kế tiếp, như trước
//   theo fence: dòng `## ` kế tiếp NẰM NGOÀI khối code, đọc fence từ chính
//              heading của mục (không mang trạng thái từ đầu file vào)
//
// và chỉ lấy điểm theo fence khi CẢ HAI điều này đúng, không thì lấy điểm cũ:
//
//   1. mọi khối mở sau heading đều đã đóng trước điểm đó;
//   2. mọi dòng `## ` bị bỏ qua đều là một dòng TRONG KHỐI CODE CỦA THÂN SẮP GHI,
//      theo đúng bộ nhận `markdown-fence.mjs` đọc thân đó.
//
// Điều 2 là nhân chứng: thân mới do Compass cầm trong tay, không phải đoán ý
// người viết. Một heading thật như `## Mục Y` không phải dòng trong khối của
// thân mới, nên không dấu lẻ nào làm nó bị nuốt. Từng lần sập cũ:
//
//   - cờ mắc ở dấu lẻ: khối mở tới hết file thì vi phạm điều 1 → điểm cũ;
//   - hai dấu lẻ ở hai mục ghép cặp: heading giữa chúng không có nhân chứng
//     trong thân mới → vi phạm điều 2 → điểm cũ;
//   - chỉ biết ```: bộ nhận dùng chung với parser, theo CommonMark, biết cả ~~~;
//     parser và chỗ này không thể đọc hai kiểu nữa.
//
// Hậu quả xấu nhất vẫn ở đúng chỗ CP-35 đặt: một đoạn đuôi trùng nhìn thấy
// được, không bao giờ một mục lân cận bị xoá. Rủi ro còn lại, chấp nhận có ý
// thức: điểm BẮT ĐẦU của mục vẫn tìm bằng tiêu đề khớp nguyên văn và không đọc
// fence — đọc fence từ đầu file chính là trạng thái toàn cục đã sập — nên một
// dòng trong khối code trùng đúng tiêu đề của một điều tra khác sẽ bị nhận nhầm.

// Khoảng trắng LITERAL, không phải `\s` — khớp đúng mẫu `lib/investigation-parser.mjs`
// dùng để cắt section (`/^## /`). Lệch nhau thì `##<tab>Tiêu đề` trong một ví dụ
// lọt qua parser vào thân pitfall, rồi ở đây lại thành ranh giới mục: mỗi lần
// đóng lại nhân bản phần đuôi, đúng cái bug CP-35 sinh ra để diệt.
const HEADING = /^## (.*)$/;

// Tìm mục mang đúng tiêu đề này. Trả về { from, to } theo chỉ số dòng, `to` là
// dòng đầu của mục kế tiếp (hoặc hết file). Không có thì trả null.
//
// Khớp tiêu đề PHẢI đúng nguyên văn, không phải tiền tố, và so bằng chuỗi chứ
// không bằng regex: `INV-1` là tiền tố của `INV-10`, và tiêu đề thật có `(`,
// `.`, `*` bên trong.
//
// `body` là thân sắp ghi — nhân chứng cho luật ở đầu file.
function timMuc(lines, title, body) {
  const from = lines.findIndex((l) => {
    const h = l.match(HEADING);
    return h !== null && h[1].trim() === title;
  });
  if (from === -1) return null;

  // Điểm cũ: heading cấp hai kế tiếp. `###` bên trong không tính, vì nó không
  // khớp HEADING.
  let toCu = lines.length;
  for (let i = from + 1; i < lines.length; i++) {
    if (HEADING.test(lines[i])) { toCu = i; break; }
  }

  // Điểm theo fence, đọc từ chính heading của mục: trạng thái fence không được
  // mang từ phần trên của file xuống.
  const { inside, open } = scanFences(lines.slice(from));
  let toFence = lines.length;
  for (let i = from + 1; i < lines.length; i++) {
    if (HEADING.test(lines[i]) && !inside[i - from]) { toFence = i; break; }
  }
  if (toFence === toCu) return { from, to: toCu };

  // Điều 1: không khối nào còn mở tại điểm đó.
  if (open !== null && from + open.line < toFence) return { from, to: toCu };

  // Điều 2: mọi dòng `## ` bị bỏ qua phải là một dòng trong khối code của thân
  // sắp ghi. So nguyên văn: thân được ghi ra đúng từng dòng như thế.
  const dongThan = body.split(/\r?\n/);
  const thanFence = scanFences(dongThan).inside;
  const nhanChung = new Set(dongThan.filter((_, i) => thanFence[i]));
  for (let i = toCu; i < toFence; i++) {
    if (HEADING.test(lines[i]) && !nhanChung.has(lines[i])) return { from, to: toCu };
  }

  return { from, to: toFence };
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
  const vung = timMuc(dong.map((d) => d.text), title, body);
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

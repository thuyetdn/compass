// Dòng nào nằm trong khối code. Parser hồ sơ điều tra và `pitfall-file.mjs`
// cùng hỏi câu này, và trước đây mỗi bên tự trả lời: hai bên lệch nhau là một
// dòng được parser nhét vào thân pitfall rồi bị bên kia đọc thành ranh giới mục,
// và mỗi lần đóng lại nhân bản phần đuôi. Một chỗ trả lời thì không lệch được.
//
// Luật theo CommonMark, không tự chế. Một trong ba lần thử đọc fence trước đây
// (ghi ở đầu `pitfall-file.mjs`) sập vì bộ nhận chỉ biết ``` mà quên ~~~. Hai
// lần kia — cờ mắc ở một dấu lẻ, và hai dấu lẻ ở hai mục ghép thành một khối —
// không phải lỗi nhận dấu mà lỗi TIN vào kết quả khi văn bản có dấu lẻ. Bộ nhận
// không sửa được chuyện đó; nó chỉ khai ra khối còn mở, và người gọi quyết định.
//
//   Dấu mở:  tối đa ba dấu cách, rồi ba ` trở lên (phần info phía sau không được
//            có `) hoặc ba ~ trở lên.
//   Dấu đóng: tối đa ba dấu cách, rồi ĐÚNG ký tự của dấu mở, ít nhất ngần ấy cái,
//            rồi chỉ còn khoảng trắng.
//
// Nên ~~~ trong khối ```, ``` trong khối bốn backtick, và ```js trong khối ```
// đều là chữ trong khối. Thụt bốn dấu cách là code thụt lề, không phải fence.
//
// Khoảng trắng ở đây là dấu cách literal, không phải `\s`: tab trước dấu mở
// không phải "tối đa ba dấu cách".
const DAU_MO = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const DAU_DONG = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

// Nhận mảng dòng ĐÃ cắt dấu kết thúc. Trả về:
//   inside[i] — dòng i nằm trong một khối, kể cả chính dòng dấu mở và dấu đóng;
//   open      — khối còn mở khi hết dòng, { line, marker }, hoặc null.
//
// `open` là kết quả, không phải chi tiết: khối không đóng nghĩa là mọi dòng phía
// sau đều bị coi là code, và người gọi phải được biết để không tin vào đó.
export function scanFences(lines) {
  const inside = new Array(lines.length).fill(false);
  let open = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (open !== null) {
      inside[i] = true;
      const dong = line.match(DAU_DONG);
      if (dong && dong[1][0] === open.marker[0] && dong[1].length >= open.marker.length) open = null;
      continue;
    }

    const mo = line.match(DAU_MO);
    if (!mo) continue;
    // ```foo`bar không phải fence: CommonMark cấm ` trong info string của dấu
    // backtick, để `code` inline mở đầu dòng không bị đọc thành khối.
    if (mo[1][0] === '`' && mo[2].includes('`')) continue;
    open = { line: i, marker: mo[1] };
    inside[i] = true;
  }

  return { inside, open };
}

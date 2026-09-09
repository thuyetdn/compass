// The one list of gates Compass can actually run. Keeping it here stops the
// failure that shipped once already: check.mjs knew about a gate that
// task-types.mjs had never heard of, so the gate silently never ran.
// `done` không nằm trong danh sách này: nó là cổng cuối, không phải gate mà
// `check` chạy. Nhưng nó **có** ghi bản ghi vào cùng sổ, nên chỗ nào duyệt sổ
// cũng phải chấp nhận khoá đó.
export const IMPLEMENTED_GATES = ['spec', 'knowledge', 'convention', 'test', 'ui', 'visual', 'review'];

// Cheap first, expensive last, so a fast failure never pays for a slow gate.
export const GATE_ORDER = ['spec', 'knowledge', 'convention', 'test', 'ui', 'visual', 'review'];

// Gates that read the project's code, and so must record what that code looked
// like. `done` compares the recording against the tree as it stands now; a gate
// left off this list closes a task on evidence about code that has moved on.
//
// It lives here beside the other lists because the same omission has shipped
// twice: a gate added in one file that another file never learned about.
export const SOURCE_DEPENDENT_GATES = ['knowledge', 'convention', 'test', 'ui', 'visual'];

// Gate cần một trang để mở. Repo không khai `devUrl` thì không có trang nào, và
// bắt chúng chạy là bắt đo một thứ không tồn tại.
export const BROWSER_GATES = ['ui', 'visual'];

// Lý do duy nhất `check` được phép bỏ qua một gate bắt buộc, và là chuỗi duy
// nhất `done` chấp nhận. Một hằng số chung chứ không phải hai chuỗi giống nhau
// ở hai file: `check` sửa lời văn mà `done` không biết thì mọi bản ghi skip
// biến thành "chưa chạy", và task đang đóng được bỗng đóng không được.
export const LY_DO_KHONG_DEVURL = 'không khai devUrl';

export function isImplemented(gate) {
  return IMPLEMENTED_GATES.includes(gate);
}

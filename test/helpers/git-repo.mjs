import { execFileSync } from 'node:child_process';

// Gate `secrets` đọc diff, nên nó cần một repo git để đọc. Thư mục tạm không
// phải repo thì gate đỏ đúng như spec CP-40 case E6 muốn — và kéo theo mọi test
// dựng bối cảnh bằng mkdtempSync. Dựng sẵn một repo rỗng rẻ hơn nhiều so với
// nới luật của gate: không có git thì không ai quét được secret, và gate xanh
// lúc đó là lời khai sai.
//
// Commit rỗng chứ không commit file: diff rỗng là câu trả lời hợp lệ cho gate
// này ("task chưa đổi gì thì chưa lọt secret nào"), còn commit sẵn file lại
// khiến mọi test thừa hưởng một lịch sử mà chúng không khai.
export function initRepo(root) {
  const run = (args) => execFileSync('git', args, {
    cwd: root,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  run(['init', '-q']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Test']);
  run(['config', 'commit.gpgsign', 'false']);
  run(['commit', '--allow-empty', '-q', '-m', 'base']);
  return root;
}

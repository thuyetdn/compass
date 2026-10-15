import { test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App.jsx';

async function addTodo(user, title) {
  const input = screen.getByLabelText('Việc mới');
  await user.click(input);
  await user.paste(title);
  await user.click(screen.getByRole('button', { name: 'Thêm' }));
}

const titles = () => screen.queryAllByRole('listitem').map((li) => li.textContent);
const clearButton = () => screen.getByRole('button', { name: 'Xóa việc đã xong' });

test('TD-002-EC3 a todo marked then unmarked survives the clear', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, 'việc một');
  await addTodo(user, 'việc hai');
  const [first, second] = screen.getAllByRole('checkbox');
  await user.click(first);
  await user.click(first);
  await user.click(second);
  await user.click(clearButton());
  expect(titles()).toEqual(['việc một']);
});

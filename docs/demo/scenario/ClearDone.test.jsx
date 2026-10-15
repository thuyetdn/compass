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

test('TD-002-H1 clears the one done todo and keeps the other', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, 'việc một');
  await addTodo(user, 'việc hai');
  await user.click(screen.getAllByRole('checkbox')[0]);
  await user.click(clearButton());
  expect(titles()).toEqual(['việc hai']);
});

test('TD-002-H2 keeps the undone todos in entry order', async () => {
  const user = userEvent.setup();
  render(<App />);
  for (const t of ['1', '2', '3', '4', '5']) await addTodo(user, `việc ${t}`);
  const boxes = screen.getAllByRole('checkbox');
  await user.click(boxes[1]);
  await user.click(boxes[3]);
  await user.click(clearButton());
  expect(titles()).toEqual(['việc 1', 'việc 3', 'việc 5']);
});

test('TD-002-H3 leaves the remaining count unchanged', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, 'việc một');
  await addTodo(user, 'việc hai');
  await addTodo(user, 'việc ba');
  await user.click(screen.getAllByRole('checkbox')[0]);
  expect(screen.getByText('Còn lại: 2')).toBeInTheDocument();
  await user.click(clearButton());
  expect(screen.getByText('Còn lại: 2')).toBeInTheDocument();
});

test('TD-002-H4 a remaining todo can still be marked done', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, 'việc một');
  await addTodo(user, 'việc hai');
  await user.click(screen.getAllByRole('checkbox')[0]);
  await user.click(clearButton());
  await user.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('checkbox')).toBeChecked();
  expect(screen.getByText('Còn lại: 0')).toBeInTheDocument();
});

test('TD-002-H5 a todo added after clearing goes to the end', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, 'việc một');
  await addTodo(user, 'việc hai');
  await user.click(screen.getAllByRole('checkbox')[0]);
  await user.click(clearButton());
  await addTodo(user, 'việc mới');
  expect(titles()).toEqual(['việc hai', 'việc mới']);
});

test('TD-002-H6 a second clear removes the todo marked after the first', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, 'việc một');
  await addTodo(user, 'việc hai');
  await addTodo(user, 'việc ba');
  await user.click(screen.getAllByRole('checkbox')[0]);
  await user.click(clearButton());
  await user.click(screen.getAllByRole('checkbox')[1]);
  await user.click(clearButton());
  expect(titles()).toEqual(['việc hai']);
});

test('TD-002-V1 the button is disabled while nothing is done', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, 'việc một');
  expect(clearButton()).toBeDisabled();
});

test('TD-002-V2 the button is disabled on an empty list', () => {
  render(<App />);
  expect(clearButton()).toBeDisabled();
});

test('TD-002-E1 clearing with a half-typed draft neither adds it nor wipes it', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, 'việc một');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByLabelText('Việc mới'));
  await user.paste('đang gõ dở');
  await user.click(clearButton());
  expect(titles()).toEqual([]);
  expect(screen.getByLabelText('Việc mới')).toHaveValue('đang gõ dở');
});

test('TD-002-EC1 clearing when everything is done empties the list', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, 'việc một');
  await addTodo(user, 'việc hai');
  for (const box of screen.getAllByRole('checkbox')) await user.click(box);
  await user.click(clearButton());
  expect(titles()).toEqual([]);
  expect(screen.getByText('Còn lại: 0')).toBeInTheDocument();
});

test('TD-002-EC2 of two todos with the same title only the done one goes', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, 'mua sữa');
  await addTodo(user, 'mua sữa');
  await user.click(screen.getAllByRole('checkbox')[1]);
  await user.click(clearButton());
  expect(titles()).toEqual(['mua sữa']);
  expect(screen.getByRole('checkbox')).not.toBeChecked();
});

test('TD-002-S1 a script-tag title shows as text and is cleared like any other', async () => {
  const user = userEvent.setup();
  render(<App />);
  const title = '<script>alert(1)</script>';
  await user.click(screen.getByLabelText('Việc mới'));
  await user.paste(title);
  await user.click(screen.getByRole('button', { name: 'Thêm' }));
  expect(screen.getByText(title)).toBeInTheDocument();
  expect(document.querySelector('script')).toBeNull();
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Xóa việc đã xong' }));
  expect(screen.queryByText(title)).toBeNull();
  expect(document.querySelector('script')).toBeNull();
});

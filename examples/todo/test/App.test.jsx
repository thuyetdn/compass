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

test('H1 adds a todo to the list', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, 'mua sữa');
  expect(screen.getByText('mua sữa')).toBeInTheDocument();
});

test('H2 keeps two todos in entry order', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, 'việc một');
  await addTodo(user, 'việc hai');
  const items = screen.getAllByRole('listitem').map((li) => li.textContent);
  expect(items).toEqual(['việc một', 'việc hai']);
});

test('H3 marks a todo as done', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, 'mua sữa');
  await user.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('checkbox')).toBeChecked();
});

test('H4 unmarks a done todo', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, 'mua sữa');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('checkbox')).not.toBeChecked();
});

test('H5 shows the remaining count after adding', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, 'việc một');
  await addTodo(user, 'việc hai');
  expect(screen.getByText('Còn lại: 2')).toBeInTheDocument();
});

test('H6 lowers the remaining count when one is done', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, 'việc một');
  await addTodo(user, 'việc hai');
  await user.click(screen.getAllByRole('checkbox')[0]);
  expect(screen.getByText('Còn lại: 1')).toBeInTheDocument();
});

test('V1 rejects an empty submission', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Thêm' }));
  expect(screen.queryAllByRole('listitem')).toHaveLength(0);
});

test('V2 rejects a whitespace-only submission', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, '   ');
  expect(screen.queryAllByRole('listitem')).toHaveLength(0);
});

test('V3 clears the input after adding', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, 'mua sữa');
  expect(screen.getByLabelText('Việc mới')).toHaveValue('');
});

test('EC1 starts with an empty list', () => {
  render(<App />);
  expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  expect(screen.getByText('Còn lại: 0')).toBeInTheDocument();
});

test('EC2 shows a very long title in full', async () => {
  const user = userEvent.setup();
  render(<App />);
  const long = 'a'.repeat(500);
  await addTodo(user, long);
  expect(screen.getByText(long)).toBeInTheDocument();
});

test('E1 leaves the list untouched when toggling an unknown id', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, 'mua sữa');
  const before = screen.getAllByRole('listitem').map((li) => li.textContent);
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('checkbox'));
  expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(before);
  expect(screen.getByText('Còn lại: 1')).toBeInTheDocument();
});

test('S1 renders a script tag as text, not markup', async () => {
  const user = userEvent.setup();
  render(<App />);
  await addTodo(user, '<script>alert(1)</script>');
  expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
  expect(document.querySelector('script')).toBeNull();
});

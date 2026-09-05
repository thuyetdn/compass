import './App.css';
import React, { useState } from 'react';

export function App() {
  const [todos, setTodos] = useState([]);
  const [draft, setDraft] = useState('');

  function addTodo(event) {
    event.preventDefault();
    const title = draft.trim();
    if (title === '') return;
    setTodos((current) => [...current, { id: crypto.randomUUID(), title, done: false }]);
    setDraft('');
  }

  function toggle(id) {
    setTodos((current) =>
      current.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo)),
    );
  }

  return (
    <main>
      <h1>Việc cần làm</h1>
      <form onSubmit={addTodo}>
        <label htmlFor="draft">Việc mới</label>
        <input id="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit">Thêm</button>
      </form>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <label>
              <input type="checkbox" checked={todo.done} onChange={() => toggle(todo.id)} />
              {todo.title}
            </label>
          </li>
        ))}
      </ul>
      <p>Còn lại: {todos.filter((t) => !t.done).length}</p>
    </main>
  );
}

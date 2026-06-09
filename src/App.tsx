import { getCurrentWindow } from '@tauri-apps/api/window';
import { type CSSProperties, useEffect, useState } from 'react';

type Todo = { id: number; text: string; done: boolean };
type NemuState = {
  focus: string;
  scratch: string;
  todos: Todo[];
  pinned: boolean;
  opacity: number;
};

const STORAGE_KEY = 'nemu';
const MIN_OPACITY = 0.7;
const DEFAULT_STATE: NemuState = {
  focus: '',
  scratch: '',
  todos: [],
  pinned: true,
  opacity: 0.95,
};

function clampOpacity(value: unknown) {
  const opacity = Number(value);

  if (!Number.isFinite(opacity)) {
    return DEFAULT_STATE.opacity;
  }

  return Math.min(1, Math.max(MIN_OPACITY, opacity));
}

function normalizeTodos(value: unknown): Todo[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((todo): todo is Partial<Todo> => Boolean(todo) && typeof todo === 'object')
    .map(todo => ({
      id: typeof todo.id === 'number' ? todo.id : Date.now(),
      text: typeof todo.text === 'string' ? todo.text : '',
      done: Boolean(todo.done),
    }))
    .filter(todo => todo.text.trim());
}

function loadState(): NemuState {
  try {
    const data = localStorage.getItem(STORAGE_KEY);

    if (!data) {
      return DEFAULT_STATE;
    }

    const saved = JSON.parse(data) as Partial<NemuState>;

    return {
      focus: typeof saved.focus === 'string' ? saved.focus : DEFAULT_STATE.focus,
      scratch: typeof saved.scratch === 'string' ? saved.scratch : DEFAULT_STATE.scratch,
      todos: normalizeTodos(saved.todos),
      pinned: typeof saved.pinned === 'boolean' ? saved.pinned : DEFAULT_STATE.pinned,
      opacity: clampOpacity(saved.opacity),
    };
  } catch {
    return DEFAULT_STATE;
  }
}

const PinIcon = () => (
  <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'>
    <line x1='12' y1='17' x2='12' y2='22' />
    <path d='M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 2-2V3H6v1a2 2 0 0 0 2 2h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z' />
  </svg>
);

const PlusIcon = () => (
  <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round'>
    <line x1='12' y1='5' x2='12' y2='19' />
    <line x1='5' y1='12' x2='19' y2='12' />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round'>
    <line x1='6' y1='6' x2='18' y2='18' />
    <line x1='18' y1='6' x2='6' y2='18' />
  </svg>
);

export default function App() {
  const [state, setState] = useState<NemuState>(loadState);
  const [input, setInput] = useState('');
  const { focus, scratch, todos, pinned, opacity } = state;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) {
      return;
    }

    const syncPinnedState = async () => {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.setAlwaysOnTop(pinned);
        await appWindow.setVisibleOnAllWorkspaces(pinned);
      } catch (error) {
        console.warn('Unable to update window pin state', error);
      }
    };

    void syncPinnedState();
  }, [pinned]);

  const updateState = (patch: Partial<NemuState>) => {
    setState(current => ({ ...current, ...patch }));
  };

  const addTodo = () => {
    if (!input.trim()) return;
    updateState({ todos: [{ id: Date.now(), text: input.trim(), done: false }, ...todos] });
    setInput('');
  };

  const toggleTodo = (id: number) => {
    updateState({
      todos: todos.map(todo => todo.id === id ? { ...todo, done: !todo.done } : todo),
    });
  };

  const removeTodo = (id: number) => {
    updateState({ todos: todos.filter(todo => todo.id !== id) });
  };

  const activeCount = todos.filter(todo => !todo.done).length;
  const cardStyle = { '--panel-alpha': opacity.toFixed(2) } as CSSProperties;

  return (
    <div className='nemu-card' style={cardStyle}>
      <div className='header'>
        <div className='brand' data-tauri-drag-region>
          <div className='title' data-tauri-drag-region>Nemu</div>
          <div className='subtitle' data-tauri-drag-region>working memory</div>
        </div>
        <div className='header-actions'>
          <button
            className={`pin-button${pinned ? ' active' : ''}`}
            type='button'
            aria-pressed={pinned}
            aria-label={pinned ? 'Disable always on top' : 'Keep always on top'}
            title={pinned ? 'Always on top' : 'Pin to desktop'}
            onClick={() => updateState({ pinned: !pinned })}
          >
            <PinIcon />
          </button>
        </div>
      </div>

      <section>
        <label>Focus</label>
        <input
          value={focus}
          placeholder='One thing to keep in view'
          onChange={event => updateState({ focus: event.target.value })}
        />
      </section>

      <section className='task-section'>
        <div className='section-heading'>
          <label>Today</label>
          <span>{activeCount} open</span>
        </div>
        <div className='todo-input'>
          <input
            value={input}
            placeholder='Capture a task'
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => event.key === 'Enter' && addTodo()}
          />
          <button type='button' aria-label='Add task' onClick={addTodo}>
            <PlusIcon />
          </button>
        </div>

        <div className='todo-list'>
          {todos.map(todo => (
            <article
              className={`todo-card${todo.done ? ' done' : ''}`}
              key={todo.id}
              title={todo.done ? 'Double-click to reopen' : 'Double-click to complete'}
              onDoubleClick={() => toggleTodo(todo.id)}
            >
              <input
                aria-label={todo.done ? 'Mark task open' : 'Mark task complete'}
                type='checkbox'
                checked={todo.done}
                onChange={() => toggleTodo(todo.id)}
              />
              <span className='todo-text'>{todo.text}</span>
              <button
                className='todo-remove'
                type='button'
                aria-label='Delete task'
                onClick={event => {
                  event.stopPropagation();
                  removeTodo(todo.id);
                }}
              >
                <CloseIcon />
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className='scratch-section'>
        <label>Scratch</label>
        <textarea
          value={scratch}
          placeholder='Loose notes'
          onChange={event => updateState({ scratch: event.target.value })}
        />
      </section>

      <div className='control-strip'>
        <span>Opacity</span>
        <input
          aria-label='Panel opacity'
          className='opacity-slider'
          type='range'
          min={MIN_OPACITY}
          max='1'
          step='0.01'
          value={opacity}
          onChange={event => updateState({ opacity: clampOpacity(event.target.value) })}
        />
        <strong>{Math.round(opacity * 100)}%</strong>
      </div>
    </div>
  );
}

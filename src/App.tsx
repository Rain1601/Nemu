import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

type Todo = { id: number; text: string; done: boolean };
type NemuState = {
  todos: Todo[];
  pinned: boolean;
  opacity: number;
};

const STORAGE_KEY = 'nemu';
const MIN_OPACITY = 0.7;
const DEFAULT_STATE: NemuState = {
  todos: [],
  pinned: true,
  opacity: 0.95,
};

function clampOpacity(value: unknown) {
  const opacity = Number(value);
  if (!Number.isFinite(opacity)) return DEFAULT_STATE.opacity;
  return Math.min(1, Math.max(MIN_OPACITY, opacity));
}

function normalizeTodos(value: unknown): Todo[] {
  if (!Array.isArray(value)) return [];
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
    if (!data) return DEFAULT_STATE;
    const saved = JSON.parse(data) as Partial<NemuState>;
    return {
      todos: normalizeTodos(saved.todos),
      pinned: typeof saved.pinned === 'boolean' ? saved.pinned : DEFAULT_STATE.pinned,
      opacity: clampOpacity(saved.opacity),
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function autosize(el: HTMLTextAreaElement) {
  el.style.height = '0';
  el.style.height = `${el.scrollHeight}px`;
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

const CheckIcon = () => (
  <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'>
    <polyline points='20 6 9 17 4 12' />
  </svg>
);

function CardEditor({
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string;
  placeholder?: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    autosize(el);
  }, []);

  const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const trimmed = text.trim();
      if (trimmed) onCommit(trimmed);
      else onCancel();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  };

  const handleBlur = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    if (trimmed !== initial) onCommit(trimmed);
    else onCancel();
  };

  return (
    <article className='todo-card editing'>
      <textarea
        ref={ref}
        rows={1}
        value={text}
        placeholder={placeholder}
        onChange={event => {
          setText(event.target.value);
          autosize(event.currentTarget);
        }}
        onKeyDown={handleKey}
        onBlur={handleBlur}
      />
    </article>
  );
}

export default function App() {
  const [state, setState] = useState<NemuState>(loadState);
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { todos, pinned, opacity } = state;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    void (async () => {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.setAlwaysOnTop(pinned);
        await appWindow.setVisibleOnAllWorkspaces(pinned);
      } catch (error) {
        console.warn('Unable to update window pin state', error);
      }
    })();
  }, [pinned]);

  const updateState = (patch: Partial<NemuState>) => {
    setState(current => ({ ...current, ...patch }));
  };

  const addTodo = (text: string) => {
    updateState({ todos: [{ id: Date.now(), text, done: false }, ...todos] });
    setComposing(false);
  };

  const updateTodoText = (id: number, text: string) => {
    updateState({
      todos: todos.map(todo => (todo.id === id ? { ...todo, text } : todo)),
    });
    setEditingId(null);
  };

  const toggleTodo = (id: number) => {
    updateState({
      todos: todos.map(todo => (todo.id === id ? { ...todo, done: !todo.done } : todo)),
    });
  };

  const removeTodo = (id: number) => {
    updateState({ todos: todos.filter(todo => todo.id !== id) });
    if (editingId === id) setEditingId(null);
  };

  const beginCompose = () => {
    if (editingId !== null) return;
    setComposing(true);
  };

  const onSurfaceDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (composing) return;
    beginCompose();
  };

  const activeCount = todos.filter(todo => !todo.done).length;
  const doneCount = todos.length - activeCount;
  const status =
    todos.length === 0
      ? 'ready when you are'
      : activeCount === 0
        ? 'all clear'
        : doneCount === 0
          ? `${activeCount} open`
          : `${activeCount} open · ${doneCount} done`;

  const cardStyle = { '--panel-alpha': opacity.toFixed(2) } as CSSProperties;

  return (
    <div className='nemu-card' style={cardStyle}>
      <div className='header'>
        <div className='brand' data-tauri-drag-region>
          <div className='title' data-tauri-drag-region>Nemu</div>
          <div className='subtitle' data-tauri-drag-region>{status}</div>
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

      <div className='card-surface' onDoubleClick={onSurfaceDoubleClick}>
        {composing && (
          <CardEditor
            initial=''
            placeholder='What needs doing?'
            onCommit={addTodo}
            onCancel={() => setComposing(false)}
          />
        )}

        {todos.map(todo =>
          editingId === todo.id ? (
            <CardEditor
              key={todo.id}
              initial={todo.text}
              onCommit={text => updateTodoText(todo.id, text)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <article
              className={`todo-card${todo.done ? ' done' : ''}`}
              key={todo.id}
              title='Double-click to edit'
              onDoubleClick={event => {
                event.stopPropagation();
                setEditingId(todo.id);
              }}
            >
              <button
                className='todo-check'
                type='button'
                aria-label={todo.done ? 'Mark task open' : 'Mark task done'}
                aria-pressed={todo.done}
                onClick={event => {
                  event.stopPropagation();
                  toggleTodo(todo.id);
                }}
              >
                {todo.done && <CheckIcon />}
              </button>
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
          )
        )}

        {!composing && todos.length === 0 && (
          <button className='empty-state' type='button' onClick={beginCompose}>
            <PlusIcon />
            <span className='empty-title'>Nothing on the list</span>
            <span className='empty-hint'>Double-click anywhere, or click here</span>
          </button>
        )}

        {!composing && todos.length > 0 && (
          <button className='add-hint' type='button' aria-label='Add task' onClick={beginCompose}>
            <PlusIcon />
            <span>Add task</span>
          </button>
        )}
      </div>

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

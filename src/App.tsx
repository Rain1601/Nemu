import { useEffect, useState } from 'react';

type Todo = { id:number; text:string; done:boolean };

export default function App() {
  const [focus,setFocus]=useState('');
  const [scratch,setScratch]=useState('');
  const [input,setInput]=useState('');
  const [todos,setTodos]=useState<Todo[]>([]);

  useEffect(()=>{
    const data=localStorage.getItem('nemu');
    if(data){
      const s=JSON.parse(data);
      setFocus(s.focus||'');
      setScratch(s.scratch||'');
      setTodos(s.todos||[]);
    }
  },[]);

  useEffect(()=>{
    localStorage.setItem('nemu',JSON.stringify({focus,scratch,todos}));
  },[focus,scratch,todos]);

  const addTodo=()=>{
    if(!input.trim()) return;
    setTodos([{id:Date.now(),text:input,done:false},...todos]);
    setInput('');
  };

  return (
    <div className='nemu-card'>
      <div className='header' data-tauri-drag-region>
        <div>Nemu</div>
        <div className='subtitle'>working memory</div>
      </div>

      <section>
        <label>Focus</label>
        <input value={focus} onChange={e=>setFocus(e.target.value)} />
      </section>

      <section>
        <label>Today</label>
        <div className='todo-input'>
          <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addTodo()} />
          <button onClick={addTodo}>+</button>
        </div>
        {todos.map(t=>(
          <div className='todo' key={t.id}>
            <input type='checkbox' checked={t.done} onChange={()=>setTodos(todos.map(x=>x.id===t.id?{...x,done:!x.done}:x))}/>
            <span>{t.text}</span>
          </div>
        ))}
      </section>

      <section>
        <label>Scratch</label>
        <textarea value={scratch} onChange={e=>setScratch(e.target.value)} />
      </section>
    </div>
  )
}

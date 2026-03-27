/**
 * TasksView.jsx — Kanban task board
 */
import { useState } from 'react'
import { useTheme } from '../../ThemeContext'

function TaskCard({ task, isExpanded, onClick, backendUrl, onUpdate }) {
  const { theme: T } = useTheme()
  const [newStatus, setNewStatus] = useState(task.status)
  const [newPriority, setNewPriority] = useState(task.priority)
  const [newAssignee, setNewAssignee] = useState(task.assignee)

  const priorityColor = task.priority === 'urgent' ? T.danger : task.priority === 'high' ? T.warning : task.priority === 'medium' ? T.accentCyan : T.textMuted
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done'

  const handleUpdateTask = async () => {
    try {
      await fetch(`${backendUrl}/brain/tasks/${task.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, priority: newPriority, assignee: newAssignee }),
      })
      onUpdate()
    } catch {}
  }

  return (
    <div style={{
      borderRadius: 10, background: T.bgCard, border: `1px solid ${isOverdue ? 'rgba(239,68,68,0.3)' : T.border}`,
      overflow: 'hidden', cursor: 'pointer', transition: 'all 150ms', display: 'flex', position: 'relative',
    }}>
      <div style={{ width: 3, height: '100%', flexShrink: 0, background: priorityColor }} />
      <div style={{ flex: 1, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }} onClick={onClick}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text, lineHeight: 1.3 }}>{task.title}</div>
          <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: priorityColor, color: task.priority === 'medium' ? '#000' : '#fff', textTransform: 'uppercase' }}>
            {task.priority?.toUpperCase()}
          </span>
        </div>
        {task.assignee && <div style={{ fontSize: 10, color: T.accentCyan, fontWeight: 600 }}>{task.assignee}</div>}
        {task.due_date && (
          <div style={{ fontSize: 10, fontWeight: 500, color: isOverdue ? T.danger : T.textMuted, display: 'flex', alignItems: 'center', gap: 6 }}>
            {new Date(task.due_date).toLocaleDateString()}
            {isOverdue && <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: T.danger, color: '#fff', textTransform: 'uppercase' }}>OVERDUE</span>}
          </div>
        )}
        {task.tags?.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {task.tags.slice(0, 2).map((tag, i) => (
              <span key={i} style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, background: 'rgba(139,92,246,0.15)', color: T.accentPurple, fontWeight: 600 }}>{tag}</span>
            ))}
          </div>
        )}
      </div>
      {isExpanded && (
        <div style={{ width: '100%', padding: '12px', borderTop: `1px solid ${T.border}`, background: T.bgSurface, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {task.description && <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><label style={{ fontSize: 10, fontWeight: 700, color: T.textDim, textTransform: 'uppercase' }}>Description</label><p style={{ fontSize: 11, color: T.textSecondary, margin: 0, lineHeight: 1.4 }}>{task.description}</p></div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: T.textDim, textTransform: 'uppercase' }}>Status</label>
            <select style={{ padding: '6px 8px', borderRadius: 6, background: T.bgCard, border: `1px solid ${T.border}`, color: T.text, fontSize: 11, outline: 'none' }} value={newStatus} onChange={e => setNewStatus(e.target.value)}>
              <option value="pending">Pending</option><option value="in_progress">In Progress</option><option value="blocked">Blocked</option><option value="done">Done</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: T.textDim, textTransform: 'uppercase' }}>Priority</label>
            <select style={{ padding: '6px 8px', borderRadius: 6, background: T.bgCard, border: `1px solid ${T.border}`, color: T.text, fontSize: 11, outline: 'none' }} value={newPriority} onChange={e => setNewPriority(e.target.value)}>
              <option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select>
          </div>
          <button style={{ padding: '6px 10px', borderRadius: 6, background: T.accentCyan, border: 'none', color: '#000', fontSize: 11, fontWeight: 700, cursor: 'pointer' }} onClick={handleUpdateTask}>Save Changes</button>
        </div>
      )}
    </div>
  )
}

function TaskColumn({ title, tasks, onTaskClick, expandedTask, backendUrl, onUpdate }) {
  const { theme: T } = useTheme()
  return (
    <div style={{ borderRadius: 12, background: T.bgGlass, border: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', minHeight: 400 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${T.border}` }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: T.text, margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</h3>
        <span style={{ fontSize: 12, fontWeight: 700, background: 'rgba(147,197,253,0.15)', padding: '2px 8px', borderRadius: 6, color: '#93c5fd' }}>{tasks.length}</span>
      </div>
      <div style={{ flex: 1, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
        {tasks.length === 0 ? (
          <div style={{ fontSize: 12, color: T.textMuted, textAlign: 'center', padding: '20px 8px' }}>No tasks yet</div>
        ) : tasks.map((task, idx) => (
          <TaskCard key={task.id || idx} task={task} isExpanded={expandedTask?.id === task.id} onClick={() => onTaskClick(task)} backendUrl={backendUrl} onUpdate={onUpdate} />
        ))}
      </div>
    </div>
  )
}

function CreateTaskForm({ onClose, backendUrl, onCreated }) {
  const { theme: T } = useTheme()
  const [formData, setFormData] = useState({ title: '', description: '', assignee: '', priority: 'medium', due_date: '', tags: '' })

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const params = new URLSearchParams({ title: formData.title, assignee: formData.assignee, due_date: formData.due_date, description: formData.description })
      await fetch(`${backendUrl}/brain/tasks/create?${params}`, { method: 'POST' })
      onCreated(); onClose()
    } catch {}
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} role="dialog" aria-label="Create Task">
      <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 16, padding: 24, maxWidth: 500, width: '90%', backdropFilter: 'blur(16px)' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: '0 0 16px 0' }}>Create Task</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input type="text" placeholder="Task title" required style={{ padding: '10px 12px', borderRadius: 8, background: T.bgSurface, border: `1px solid ${T.border}`, color: T.text, fontSize: 13, outline: 'none' }} value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} />
          <textarea placeholder="Description (optional)" style={{ padding: '10px 12px', borderRadius: 8, background: T.bgSurface, border: `1px solid ${T.border}`, color: T.text, fontSize: 13, outline: 'none', fontFamily: 'inherit', minHeight: 80, resize: 'none' }} value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
          <input type="text" placeholder="Assignee" style={{ padding: '10px 12px', borderRadius: 8, background: T.bgSurface, border: `1px solid ${T.border}`, color: T.text, fontSize: 13, outline: 'none' }} value={formData.assignee} onChange={e => setFormData({...formData, assignee: e.target.value})} />
          <select style={{ padding: '10px 12px', borderRadius: 8, background: T.bgSurface, border: `1px solid ${T.border}`, color: T.text, fontSize: 13, outline: 'none' }} value={formData.priority} onChange={e => setFormData({...formData, priority: e.target.value})}>
            <option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select>
          <input type="date" style={{ padding: '10px 12px', borderRadius: 8, background: T.bgSurface, border: `1px solid ${T.border}`, color: T.text, fontSize: 13, outline: 'none' }} value={formData.due_date} onChange={e => setFormData({...formData, due_date: e.target.value})} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="submit" style={{ flex: 1, padding: '10px 16px', borderRadius: 8, background: T.accentCyan, border: 'none', color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Create</button>
            <button type="button" style={{ flex: 1, padding: '10px 16px', borderRadius: 8, background: 'transparent', border: `1px solid ${T.border}`, color: T.textSecondary, fontSize: 13, fontWeight: 700, cursor: 'pointer' }} onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function TasksView({ data, backendUrl }) {
  const { theme: T } = useTheme()
  const { tasks, teams, fetchAll } = data
  const [taskFilter, setTaskFilter] = useState({ assignee: '', priority: '', search: '' })
  const [expandedTask, setExpandedTask] = useState(null)
  const [showCreateTask, setShowCreateTask] = useState(false)

  const filteredTasks = tasks.filter(t => {
    if (taskFilter.assignee && t.assignee !== taskFilter.assignee) return false
    if (taskFilter.priority && t.priority !== taskFilter.priority) return false
    if (taskFilter.search && !t.title.toLowerCase().includes(taskFilter.search.toLowerCase())) return false
    return true
  })

  const columns = {
    pending: filteredTasks.filter(t => t.status === 'pending'),
    in_progress: filteredTasks.filter(t => t.status === 'in_progress'),
    blocked: filteredTasks.filter(t => t.status === 'blocked'),
    done: filteredTasks.filter(t => t.status === 'done'),
  }
  const assignees = [...new Set(tasks.map(t => t.assignee).filter(Boolean))]

  return (
    <div style={{ padding: '24px 28px', height: '100%', overflow: 'auto', background: T.gradientSubtle }} role="main" aria-label="Task Board">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: T.text, margin: 0 }}>Task Board</h1>
          <span style={{ fontSize: 12, color: T.textDim, fontWeight: 500 }}>Kanban view of all tasks</span>
        </div>
        <button style={{ padding: '10px 16px', borderRadius: 8, background: T.accentCyan, border: 'none', color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer' }} onClick={() => setShowCreateTask(!showCreateTask)}>
          + Create Task
        </button>
      </div>

      {showCreateTask && <CreateTaskForm onClose={() => setShowCreateTask(false)} backendUrl={backendUrl} onCreated={fetchAll} />}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24, padding: '12px 16px', borderRadius: 12, background: T.bgCard, border: `1px solid ${T.border}` }}>
        <input type="text" placeholder="Search tasks..." style={{ flex: 1, padding: '8px 12px', borderRadius: 8, background: T.bgSurface, border: `1px solid ${T.border}`, color: T.text, fontSize: 13, outline: 'none' }} value={taskFilter.search} onChange={e => setTaskFilter({...taskFilter, search: e.target.value})} />
        <select style={{ padding: '8px 12px', borderRadius: 8, background: T.bgSurface, border: `1px solid ${T.border}`, color: T.text, fontSize: 13, outline: 'none' }} value={taskFilter.assignee} onChange={e => setTaskFilter({...taskFilter, assignee: e.target.value})}>
          <option value="">All Assignees</option>
          {assignees.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 8 }}>
          {['', 'urgent', 'high', 'medium', 'low'].map(p => (
            <button key={p} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: taskFilter.priority === p ? T.accentCyan : 'transparent', borderColor: taskFilter.priority === p ? T.accentCyan : T.border, color: taskFilter.priority === p ? '#000' : T.textSecondary }} onClick={() => setTaskFilter({...taskFilter, priority: p})}>
              {p ? p.charAt(0).toUpperCase() + p.slice(1) : 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Kanban Board */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, overflow: 'auto' }}>
        <TaskColumn title="To Do" tasks={columns.pending} onTaskClick={t => setExpandedTask(expandedTask?.id === t.id ? null : t)} expandedTask={expandedTask} backendUrl={backendUrl} onUpdate={fetchAll} />
        <TaskColumn title="In Progress" tasks={columns.in_progress} onTaskClick={t => setExpandedTask(expandedTask?.id === t.id ? null : t)} expandedTask={expandedTask} backendUrl={backendUrl} onUpdate={fetchAll} />
        <TaskColumn title="In Review" tasks={columns.blocked} onTaskClick={t => setExpandedTask(expandedTask?.id === t.id ? null : t)} expandedTask={expandedTask} backendUrl={backendUrl} onUpdate={fetchAll} />
        <TaskColumn title="Done" tasks={columns.done} onTaskClick={t => setExpandedTask(expandedTask?.id === t.id ? null : t)} expandedTask={expandedTask} backendUrl={backendUrl} onUpdate={fetchAll} />
      </div>
    </div>
  )
}

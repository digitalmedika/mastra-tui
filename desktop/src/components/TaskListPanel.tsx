import React from 'react'
import type { TaskItem } from '../lib/types'

interface TaskListPanelProps {
  tasks: TaskItem[]
}

export default function TaskListPanel({ tasks }: TaskListPanelProps) {
  if (tasks.length === 0) {
    return (
      <div className="tasklist-panel">
        <div className="tasklist-header">TASKS</div>
        <div className="tasklist-empty">
          <p>No active tasks</p>
          <p className="tasklist-hint">Ask the agent to do multi-step work to see tasks here</p>
        </div>
      </div>
    )
  }

  return (
    <div className="tasklist-panel">
      <div className="tasklist-header">
        <span>TASKS</span>
        <span className="tasklist-count">
          {tasks.filter((t) => t.done).length}/{tasks.length}
        </span>
      </div>
      <div className="tasklist-items">
        {tasks.map((task) => (
          <div
            key={task.index}
            className={`tasklist-item ${task.done ? 'done' : ''} ${task.current ? 'current' : ''}`}
          >
            <span className="tasklist-checkbox">
              {task.done ? '✓' : task.current ? '○' : '○'}
            </span>
            <span className="tasklist-text">{task.index}. {task.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

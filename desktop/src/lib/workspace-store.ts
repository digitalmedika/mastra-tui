export interface Workspace {
  id: string
  name: string
  path: string
}

export interface WorkspaceStore {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
}

const STORAGE_KEY = 'loccle-workspaces'

function generateId() {
  return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function loadWorkspaces(): WorkspaceStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { workspaces: [], activeWorkspaceId: null }
    return JSON.parse(raw) as WorkspaceStore
  } catch {
    return { workspaces: [], activeWorkspaceId: null }
  }
}

export function saveWorkspaces(store: WorkspaceStore) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function addWorkspace(name: string, path: string): Workspace {
  const store = loadWorkspaces()
  const ws: Workspace = { id: generateId(), name, path }
  store.workspaces = [...store.workspaces.filter((w) => w.path !== path), ws]
  if (!store.activeWorkspaceId) {
    store.activeWorkspaceId = ws.id
  }
  saveWorkspaces(store)
  return ws
}

export function removeWorkspace(id: string) {
  const store = loadWorkspaces()
  store.workspaces = store.workspaces.filter((w) => w.id !== id)
  if (store.activeWorkspaceId === id) {
    store.activeWorkspaceId = store.workspaces[0]?.id ?? null
  }
  saveWorkspaces(store)
}

export function setActiveWorkspace(id: string) {
  const store = loadWorkspaces()
  store.activeWorkspaceId = id
  saveWorkspaces(store)
}

export function getActiveWorkspace(): Workspace | null {
  const store = loadWorkspaces()
  if (!store.activeWorkspaceId) return null
  return store.workspaces.find((w) => w.id === store.activeWorkspaceId) ?? null
}

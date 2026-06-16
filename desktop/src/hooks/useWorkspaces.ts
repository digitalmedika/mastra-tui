import { useState, useCallback, useEffect } from 'react'
import {
  loadWorkspaces,
  addWorkspace as addWs,
  removeWorkspace as removeWs,
  setActiveWorkspace as setActive,
  getActiveWorkspace,
  type Workspace,
  type WorkspaceStore,
} from '../lib/workspace-store'

export function useWorkspaces() {
  const [store, setStore] = useState<WorkspaceStore>(loadWorkspaces)

  const refresh = useCallback(() => {
    setStore(loadWorkspaces())
  }, [])

  const activeWorkspace = getActiveWorkspace()

  const addWorkspace = useCallback(async (name: string, path?: string) => {
    const folderPath = path ?? (window as any).electronAPI?.openFolderDialog
      ? await (window as any).electronAPI.openFolderDialog()
      : prompt('Enter workspace path:')

    if (!folderPath) return null
    const ws = addWs(name, folderPath)
    refresh()
    return ws
  }, [refresh])

  const removeWorkspace = useCallback((id: string) => {
    removeWs(id)
    refresh()
  }, [refresh])

  const setActiveWorkspace = useCallback((id: string) => {
    setActive(id)
    refresh()
  }, [refresh])

  return {
    workspaces: store.workspaces,
    activeWorkspace,
    addWorkspace,
    removeWorkspace,
    setActiveWorkspace,
  }
}

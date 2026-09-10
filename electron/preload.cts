import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron';

type Listener<T> = (payload: T) => void;

interface HtmlFilePayload {
  fileName: string;
  filePath: string;
  html: string;
  backupPath?: string;
  warnings?: string[];
  recovered?: boolean;
}
const api = {
  listSamples: () => ipcRenderer.invoke('htmlpoint:list-samples'),
  openHtmlDialog: () => ipcRenderer.invoke('htmlpoint:open-dialog'),
  openDroppedHtmlFile: (file: File): Promise<HtmlFilePayload> => {
    // This is deliberately File-only: renderer code cannot mint a trusted path.
    const filePath = webUtils.getPathForFile(file);
    return ipcRenderer.invoke('htmlpoint:open-dropped-file', filePath);
  },
  openSample: (filePath: string) => ipcRenderer.invoke('htmlpoint:open-sample', filePath),
  saveHtml: (payload: { filePath: string; html: string; sourcePath?: string; warnings?: string[] }) =>
    ipcRenderer.invoke('htmlpoint:save', payload),
  saveAsHtml: (payload: { defaultPath?: string; html: string; sourcePath?: string; warnings?: string[] }) =>
    ipcRenderer.invoke('htmlpoint:save-as', payload),
  createBackup: (payload: { filePath: string; html: string }) =>
    ipcRenderer.invoke('htmlpoint:create-backup', payload),
  discardAutoBackups: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('htmlpoint:discard-auto-backups', filePath),
  openImageDialog: () => ipcRenderer.invoke('htmlpoint:open-image-dialog'),
  registerPreviewSource: (sourcePath: string): Promise<string> =>
    ipcRenderer.invoke('htmlpoint:register-preview-source', sourcePath),
  onOpenedFile: (listener: Listener<HtmlFilePayload>) => {
    const wrapped = (_event: IpcRendererEvent, payload: HtmlFilePayload) => listener(payload);
    ipcRenderer.on('htmlpoint:file-opened', wrapped);
    return () => {
      ipcRenderer.off('htmlpoint:file-opened', wrapped);
    };
  },
  onMenuSaveAs: (listener: Listener<void>) => {
    const wrapped = () => listener();
    ipcRenderer.on('htmlpoint:menu-save-as', wrapped);
    return () => {
      ipcRenderer.off('htmlpoint:menu-save-as', wrapped);
    };
  },
  onMenuSave: (listener: Listener<void>) => {
    const wrapped = () => listener();
    ipcRenderer.on('htmlpoint:menu-save', wrapped);
    return () => {
      ipcRenderer.off('htmlpoint:menu-save', wrapped);
    };
  },
  onMenuUndo: (listener: Listener<void>) => {
    const wrapped = () => listener();
    ipcRenderer.on('htmlpoint:menu-undo', wrapped);
    return () => ipcRenderer.off('htmlpoint:menu-undo', wrapped);
  },
  onMenuRedo: (listener: Listener<void>) => {
    const wrapped = () => listener();
    ipcRenderer.on('htmlpoint:menu-redo', wrapped);
    return () => ipcRenderer.off('htmlpoint:menu-redo', wrapped);
  },
  onOperationError: (listener: Listener<string>) => {
    const wrapped = (_event: IpcRendererEvent, message: string) => listener(message);
    ipcRenderer.on('htmlpoint:operation-error', wrapped);
    return () => {
      ipcRenderer.off('htmlpoint:operation-error', wrapped);
    };
  },
  onCloseRequested: (callback: () => void) => {
    const wrapped = () => callback();
    ipcRenderer.on('htmlpoint:close-requested', wrapped);
    return () => {
      ipcRenderer.off('htmlpoint:close-requested', wrapped);
    };
  },
  confirmClose: async (): Promise<void> => {
    ipcRenderer.send('htmlpoint:confirm-close');
  }
};
contextBridge.exposeInMainWorld('htmlpoint', api);

export type HtmlpointApi = typeof api;

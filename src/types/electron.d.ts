import type { HtmlpointApi } from '../../electron/preload.cjs';

type HtmlpointBridge = Readonly<
  Omit<
    HtmlpointApi,
    'registerPreviewSource' | 'openDroppedHtmlFile' | 'onMenuUndo' | 'onMenuRedo' | 'saveHtml' | 'onMenuSave' | 'discardAutoBackups' | 'openExternalLink'
  > & {
    registerPreviewSource?: HtmlpointApi['registerPreviewSource'];
    openDroppedHtmlFile?: HtmlpointApi['openDroppedHtmlFile'];
    onMenuUndo?: HtmlpointApi['onMenuUndo'];
    onMenuRedo?: HtmlpointApi['onMenuRedo'];
    saveHtml?: HtmlpointApi['saveHtml'];
    onMenuSave?: HtmlpointApi['onMenuSave'];
    discardAutoBackups?: HtmlpointApi['discardAutoBackups'];
    openExternalLink?: HtmlpointApi['openExternalLink'];
  }
>;

declare global {
  interface Window {
    htmlpoint?: HtmlpointBridge;
  }
}
export {};

import type { HtmlpointApi } from '../../electron/preload.cjs';

type HtmlpointBridge = Readonly<
  Omit<HtmlpointApi, 'registerPreviewSource' | 'openDroppedHtmlFile' | 'onMenuUndo' | 'onMenuRedo'> & {
    registerPreviewSource?: HtmlpointApi['registerPreviewSource'];
    openDroppedHtmlFile?: HtmlpointApi['openDroppedHtmlFile'];
    onMenuUndo?: HtmlpointApi['onMenuUndo'];
    onMenuRedo?: HtmlpointApi['onMenuRedo'];
  }
>;

declare global {
  interface Window {
    htmlpoint?: HtmlpointBridge;
  }
}

export {};

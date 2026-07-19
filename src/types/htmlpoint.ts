export type ReportSectionKind = 'header' | 'section' | 'generic';
export type EditableNodeKind = 'text' | 'table' | 'image' | 'chart' | 'list';
export type ReportLanguage = 'ko' | 'en' | string;

export interface ParseOptions {
  fileName?: string;
  sourcePath?: string;
}

export interface TableCellSnapshot {
  text: string;
  html: string;
  rowSpan: number;
  colSpan: number;
  tagName: 'td' | 'th';
}

export interface TableSnapshot {
  rows: TableCellSnapshot[][];
}

export interface ImageSnapshot {
  src: string;
  alt: string;
  width?: string;
  height?: string;
  style?: string;
  frameWidth?: string;
  frameHeight?: string;
  frameStyle?: string;
}

export interface TextStyleSnapshot {
  fontFamily?: string;
  fontSize?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
}

export interface ChartDataRow {
  label: string;
  value: number;
  series?: string;
  group?: string;
  x?: number;
  y?: number;
}

export interface ChartSnapshot {
  kind:
    | 'svg-bar'
    | 'svg-bar-label'
    | 'svg-point'
    | 'svg-path'
    | 'svg-generic'
    | 'canvas'
    | 'unknown';
  editable: boolean;
  rows: ChartDataRow[];
  reason: string;
}

export interface EditableNode {
  id: string;
  sectionId: string;
  kind: EditableNodeKind;
  tagName: string;
  label: string;
  path: number[];
  text: string;
  html: string;
  selector?: string;
  translationSelector?: string;
  languageTexts?: Partial<Record<ReportLanguage, string>>;
  textStyle?: TextStyleSnapshot;
  textEffect?: TextEffectSettings;
  table?: TableSnapshot;
  image?: ImageSnapshot;
  chart?: ChartSnapshot;
  chartPresentation?: ChartPresentationSettings;
}

export interface SelectionVisualSnapshot {
  nodeId: string;
  textStyle?: TextStyleSnapshot;
  textEffect?: TextEffectSettings;
  imageMetrics?: Partial<ImageSnapshot>;
  frameMetrics?: {
    width?: string;
    height?: string;
    style?: string;
  };
}

export interface AssetRef {
  id: string;
  kind: 'image' | 'svg' | 'canvas';
  sectionId?: string;
  src?: string;
  alt?: string;
  embedded: boolean;
}

export interface TranslationEntry {
  selector: string;
  koHtml: string;
  enHtml: string;
}

export interface EditOperation {
  id: string;
  type:
    | 'text'
    | 'translation'
    | 'table'
    | 'image'
    | 'chart'
    | 'section'
    | 'serialize';
  label: string;
  sectionId?: string;
  nodeId?: string;
  before?: string;
  after?: string;
  timestamp: number;
}

export interface ReportSection {
  id: string;
  kind: ReportSectionKind;
  title: string;
  parentKey: string;
  originalIndex?: number;
  html: string;
  textPreview: string;
  hidden: boolean;
  editableNodes: EditableNode[];
  changed: boolean;
}

export interface ReportDocument {
  id: string;
  title: string;
  fileName?: string;
  sourcePath?: string;
  sourceHtml: string;
  sections: ReportSection[];
  assets: AssetRef[];
  languages: ReportLanguage[];
  activeLanguage: ReportLanguage;
  translations: TranslationEntry[];
  operations: EditOperation[];
  dirty: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface EditResult {
  report: ReportDocument;
  insertedNodeId?: string;
}

export type TextEditValidationCode =
  | 'rich-text-child-token-mismatch'
  | 'rich-text-child-token-ambiguous';

export interface TextEditValidation {
  ok: false;
  code: TextEditValidationCode;
  message: string;
}

export interface TextEditOutcome {
  report: ReportDocument;
  validation?: TextEditValidation;
}

export type TextReplacementOutcome = { ok: true } | TextEditValidation;

export interface SaveResult {
  html: string;
  changedSections: string[];
  warnings: string[];
  backupPath?: string;
}

export interface ImageFilterSettings {
  rotation?: number;
  brightness?: number;
  contrast?: number;
  blur?: number;
}

export interface ImageResizeSettings {
  width?: number;
  height?: number;
  unit: 'px' | '%';
}

export interface TextStyleSettings {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
}

export interface TextEffectSettings {
  preset: 'none' | 'neutral' | 'info' | 'warning' | 'danger' | 'success';
  fill: string;
  textColor: string;
  borderColor: string;
  radius: number;
  bold: boolean;
}

export interface ChartPresentationSettings {
  caption?: string;
  width?: number;
  height?: number;
  frame: boolean;
  align: 'left' | 'center' | 'right';
}

export type TableSortDirection = 'asc' | 'desc';

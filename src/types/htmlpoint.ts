export type ReportSectionKind = 'header' | 'section' | 'slide' | 'canvas' | 'generic';
export type EditableNodeKind =
  | 'text'
  | 'table'
  | 'image'
  | 'chart'
  | 'list'
  | 'shape'
  | 'connector';
export type ReportLanguage = 'ko' | 'en' | string;

export type ImportAdapterKind = 'semantic' | 'slide' | 'fig-canvas' | 'candidate';

export interface SourceRef {
  adapter: ImportAdapterKind;
  domPath: number[];
  htmlId?: string;
  objectId?: string;
}

export interface ImportCandidate {
  id: string;
  adapter: ImportAdapterKind;
  selector: string;
  label: string;
  domPath: number[];
  reason: string;
}

export type RenderSnapshotWarningCode =
  | 'missing-asset'
  | 'font-fallback'
  | 'unsupported-css'
  | 'text-overflow'
  | 'outside-page'
  | 'broken-connector'
  | 'picture-fallback';

export interface RenderSnapshotWarning {
  code: RenderSnapshotWarningCode;
  message: string;
  sourceNodeId?: string;
  severity: 'warning' | 'error';
}

export interface RenderTextRun {
  text: string;
  sourceNodeId?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  fontFamily?: string;
  fontSizePx?: number;
}

export interface RenderBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderSnapshotObject {
  id: string;
  sourceNodeId?: string;
  kind: EditableNodeKind | 'page-background';
  bounds: RenderBounds;
  paintOrder: number;
  textRuns?: RenderTextRun[];
  assetSrc?: string;
  table?: TableSnapshot;
  shapeType?: 'rect' | 'ellipse';
  diagram?: DiagramObjectSnapshot;
  capabilities: string[];
  warnings: RenderSnapshotWarning[];
}

export interface RenderSnapshotPage {
  sectionId: string;
  title: string;
  width: number;
  height: number;
  language?: ReportLanguage;
  objects: RenderSnapshotObject[];
  warnings: RenderSnapshotWarning[];
}

export interface RenderedDocumentSnapshot {
  schemaVersion: 1;
  reportId: string;
  reportRevision: string;
  createdAt: number;
  pages: RenderSnapshotPage[];
  warnings: RenderSnapshotWarning[];
}

export interface ParseOptions {
  fileName?: string;
  sourcePath?: string;
  selectedCandidatePath?: number[];
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
  hasFrame?: boolean;
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
  /** DOM path of the visual object moved/resized for this content node. */
  layoutTargetPath?: number[];
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
  sourceRef?: SourceRef;
  diagram?: DiagramObjectSnapshot;
}

export interface DiagramObjectSnapshot {
  role: 'node' | 'edge';
  objectId: string;
  fromObjectId?: string;
  toObjectId?: string;
  startAnchor?: string;
  endAnchor?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
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
  layoutMetrics?: ObjectLayoutMetrics;
}

export interface ObjectLayoutMetrics {
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  baseTranslateX: number;
  baseTranslateY: number;
  lockHeight?: boolean;
  lockSize?: boolean;
  lockPosition?: boolean;
}

export interface ObjectLayoutPatch {
  nodeId: string;
  offsetX?: number;
  offsetY?: number;
  baseTranslateX?: number;
  baseTranslateY?: number;
  width?: number;
  height?: number;
  resetPosition?: boolean;
}

export type ObjectLayoutCommand =
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-top'
  | 'align-middle'
  | 'align-bottom'
  | 'distribute-horizontal'
  | 'distribute-vertical'
  | 'reset-position';

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
    | 'layout'
    | 'diagram'
    | 'export'
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
  sourceId?: string;
  languageScope?: ReportLanguage;
  parentKey: string;
  originalIndex?: number;
  html: string;
  textPreview: string;
  hidden: boolean;
  outlineItems?: SectionOutlineItem[];
  editableNodes: EditableNode[];
  changed: boolean;
  sourceRef?: SourceRef;
}
export interface SectionOutlineItem {
  id: string;
  label: string;
  path: number[];
  dynamic: boolean;
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
  importCandidates?: ImportCandidate[];
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

export interface TextRangeStyleSettings extends TextStyleSettings {}

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

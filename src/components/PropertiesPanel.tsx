import { ChangeEvent, useEffect, useState } from 'react';
import { BarChart3, Image as ImageIcon, List, Palette, Table2, Type } from 'lucide-react';
import { parseChartCsvRows, serializeChartCsvRows } from '../lib/chartCsv';
import { resizeWithAspectLock } from '../lib/imageSizing';
import { getAutoTextareaRows } from '../lib/uiSizing';
import {
  ChartDataRow,
  ChartPresentationSettings,
  EditableNode,
  ImageFilterSettings,
  ImageResizeSettings,
  ReportDocument,
  TableCellSnapshot,
  TextEffectSettings,
  TextStyleSettings
} from '../types/htmlpoint';

interface PropertiesPanelProps {
  report: ReportDocument | null;
  selectedSectionId?: string;
  selectedNodeId?: string;
  selectedNodeIds?: string[];
  selectedNodeOverride?: EditableNode;
  selectedCell: { row: number; cell: number };
  onNodeSelect: (nodeId: string) => void;
  onCellSelect: (row: number, cell: number) => void;
  onTextChange: (nodeId: string, text: string, language: string) => void;
  onTextEffect: (nodeId: string, settings: TextEffectSettings) => void;
  onTextStyle: (nodeIds: string[], settings: TextStyleSettings) => void;
  onTranslationChange: (selector: string, text: string) => void;
  onTableCellText: (nodeId: string, row: number, cell: number, text: string) => void;
  onAddTableRow: (nodeId: string, row: number) => void;
  onAddTableColumn: (nodeId: string, column: number) => void;
  onDeleteTableRow: (nodeId: string, row: number) => void;
  onDeleteTableColumn: (nodeId: string, column: number) => void;
  onSortTable: (nodeId: string, column: number, direction: 'asc' | 'desc') => void;
  onFilterTable: (nodeId: string, query: string) => void;
  onMergeRight: (nodeId: string, row: number, cell: number) => void;
  onUnmerge: (nodeId: string, row: number, cell: number) => void;
  onCellStyle: (nodeId: string, row: number, cell: number, styles: Partial<CSSStyleDeclaration>) => void;
  onPasteTable: (nodeId: string, text: string) => void;
  onReplaceImage: (nodeId: string) => void;
  onImageFilter: (nodeId: string, settings: ImageFilterSettings) => void;
  onResizeImage: (nodeId: string, settings: ImageResizeSettings) => void;
  onResizeImageFrame: (nodeId: string, settings: ImageResizeSettings) => void;
  onCropImage: (nodeId: string, inset: number) => void;
  onImageAnnotation: (nodeId: string, text: string, tone: 'note' | 'warning' | 'box') => void;
  onChartPresentation: (nodeId: string, settings: ChartPresentationSettings) => void;
  onChartData: (nodeId: string, rows: ChartDataRow[]) => void;
}

export function PropertiesPanel({
  report,
  selectedSectionId,
  selectedNodeId,
  selectedNodeIds = selectedNodeId ? [selectedNodeId] : [],
  selectedNodeOverride,
  selectedCell,
  onNodeSelect,
  onCellSelect,
  onTextChange,
  onTextEffect,
  onTextStyle,
  onTranslationChange,
  onTableCellText,
  onAddTableRow,
  onAddTableColumn,
  onDeleteTableRow,
  onDeleteTableColumn,
  onSortTable,
  onFilterTable,
  onMergeRight,
  onUnmerge,
  onCellStyle,
  onPasteTable,
  onReplaceImage,
  onImageFilter,
  onResizeImage,
  onResizeImageFrame,
  onCropImage,
  onImageAnnotation,
  onChartPresentation,
  onChartData
}: PropertiesPanelProps): JSX.Element {
  const section = report?.sections.find((candidate) => candidate.id === selectedSectionId);
  const selectedNodes = (section?.editableNodes ?? []).filter((candidate) =>
    selectedNodeIds.includes(candidate.id)
  );
  const selectedNodeFromSection =
    selectedNodes.find((candidate) => candidate.id === selectedNodeId) ??
    section?.editableNodes.find((candidate) => candidate.id === selectedNodeId);
  const selectedNode =
    selectedNodeOverride && selectedNodeOverride.id === selectedNodeFromSection?.id
      ? selectedNodeOverride
      : selectedNodeFromSection;
  const sameKindSelection =
    selectedNodes.length <= 1 ||
    selectedNodes.every((candidate) => candidate.kind === selectedNodes[0]?.kind);
  const inspectableNode = sameKindSelection ? selectedNode : undefined;
  const activeTab =
    inspectableNode?.kind === 'table'
      ? 'table'
      : inspectableNode?.kind === 'image'
        ? 'image'
        : inspectableNode?.kind === 'chart'
          ? 'chart'
          : 'text';

  return (
    <aside className="properties">
      <div className="panel-head">
        <strong>Properties</strong>
        <span>{section?.kind || 'Section'}</span>
      </div>
      <PropertyKind node={inspectableNode} mixed={!sameKindSelection && selectedNodes.length > 1} />
      <div className="property-body">
        {section ? (
          <>
            <ObjectPicker
              nodes={section.editableNodes}
              selectedNodeId={selectedNodeId}
              selectedCount={selectedNodes.length}
              onNodeSelect={onNodeSelect}
            />
            {!sameKindSelection && selectedNodes.length > 1 && (
              <div className="multi-select-note">
                서로 다른 종류의 개체 {selectedNodes.length}개가 선택되어 공통 Properties만 표시됩니다.
              </div>
            )}
            {inspectableNode ? (
              <>
                {activeTab === 'text' && (
                  <TextInspector
                    report={report}
                    node={inspectableNode}
                    selectedNodeIds={selectedNodes.length ? selectedNodes.map((node) => node.id) : [inspectableNode.id]}
                    onTextChange={onTextChange}
                    onTextEffect={onTextEffect}
                    onTextStyle={onTextStyle}
                    onTranslationChange={onTranslationChange}
                  />
                )}
                {activeTab === 'table' && inspectableNode.table && (
                  <TableInspector
                    key={inspectableNode.id}
                    node={inspectableNode}
                    selectedCell={selectedCell}
                    onCellSelect={onCellSelect}
                    onTableCellText={onTableCellText}
                    onAddTableRow={onAddTableRow}
                    onAddTableColumn={onAddTableColumn}
                    onDeleteTableRow={onDeleteTableRow}
                    onDeleteTableColumn={onDeleteTableColumn}
                    onSortTable={onSortTable}
                    onFilterTable={onFilterTable}
                    onMergeRight={onMergeRight}
                    onUnmerge={onUnmerge}
                    onCellStyle={onCellStyle}
                    onPasteTable={onPasteTable}
                  />
                )}
                {activeTab === 'image' && inspectableNode.image && (
                  <ImageInspector
                    node={inspectableNode}
                    onReplaceImage={onReplaceImage}
                    onImageFilter={onImageFilter}
                    onResizeImage={onResizeImage}
                    onResizeImageFrame={onResizeImageFrame}
                    onCropImage={onCropImage}
                    onImageAnnotation={onImageAnnotation}
                  />
                )}
                {activeTab === 'chart' && (
                  <ChartInspector
                    node={inspectableNode}
                    onChartPresentation={onChartPresentation}
                    onChartData={onChartData}
                  />
                )}
              </>
            ) : (
              <div className="empty-panel">개체를 선택하세요.</div>
            )}
          </>
        ) : (
          <div className="empty-panel">보고서를 열면 속성이 표시됩니다.</div>
        )}
      </div>
    </aside>
  );
}

function PropertyKind({
  node,
  mixed
}: {
  node?: EditableNode;
  mixed: boolean;
}): JSX.Element {
  if (mixed) {
    return (
      <div className="property-kind">
        <Palette size={15} aria-hidden="true" focusable="false" />
        <span>Mixed selection</span>
      </div>
    );
  }

  switch (node?.kind) {
    case 'table':
      return (
        <div className="property-kind">
          <Table2 size={15} aria-hidden="true" focusable="false" />
          <span>Table</span>
        </div>
      );
    case 'image':
      return (
        <div className="property-kind">
          <ImageIcon size={15} aria-hidden="true" focusable="false" />
          <span>Image</span>
        </div>
      );
    case 'chart':
      return (
        <div className="property-kind">
          <BarChart3 size={15} aria-hidden="true" focusable="false" />
          <span>Chart</span>
        </div>
      );
    case 'list':
      return (
        <div className="property-kind">
          <List size={15} aria-hidden="true" focusable="false" />
          <span>List</span>
        </div>
      );
    case 'text':
      return (
        <div className="property-kind">
          <Type size={15} aria-hidden="true" focusable="false" />
          <span>Text</span>
        </div>
      );
    default:
      return (
        <div className="property-kind">
          <Palette size={15} aria-hidden="true" focusable="false" />
          <span>No object selected</span>
        </div>
      );
  }
}

function ObjectPicker({
  nodes,
  selectedNodeId,
  selectedCount,
  onNodeSelect
}: {
  nodes: EditableNode[];
  selectedNodeId?: string;
  selectedCount: number;
  onNodeSelect: (nodeId: string) => void;
}): JSX.Element {
  return (
    <label className="field">
      <span>Selected object{selectedCount > 1 ? ` · ${selectedCount} selected` : ''}</span>
      <select value={selectedNodeId ?? ''} onChange={(event) => onNodeSelect(event.target.value)}>
        <option value="">None</option>
        {nodes.map((node) => (
          <option key={node.id} value={node.id}>
            {node.kind} · {node.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextInspector({
  report,
  node,
  selectedNodeIds,
  onTextChange,
  onTextEffect,
  onTextStyle,
  onTranslationChange
}: {
  report: ReportDocument | null;
  node: EditableNode;
  selectedNodeIds: string[];
  onTextChange: (nodeId: string, text: string, language: string) => void;
  onTextEffect: (nodeId: string, settings: TextEffectSettings) => void;
  onTextStyle: (nodeIds: string[], settings: TextStyleSettings) => void;
  onTranslationChange: (selector: string, text: string) => void;
}): JSX.Element {
  const activeLanguage = report?.activeLanguage ?? 'ko';
  const initialText =
    activeLanguage === 'en' && node.languageTexts?.en
      ? stripHtml(node.languageTexts.en)
      : node.text;
  const [value, setValue] = useState(initialText);
  const [english, setEnglish] = useState(stripHtml(node.languageTexts?.en ?? ''));

  useEffect(() => {
    setValue(initialText);
    setEnglish(stripHtml(node.languageTexts?.en ?? ''));
  }, [initialText, node.id, node.languageTexts?.en]);

  return (
    <section className="inspector-section">
      <h3>Text Style</h3>
      <label className="field">
        <span>{activeLanguage.toUpperCase()} text</span>
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={getAutoTextareaRows(value)}
        />
      </label>
      <button type="button" className="blue-button" onClick={() => onTextChange(node.id, value, activeLanguage)}>
        Apply Text
      </button>
      {node.translationSelector && (
        <>
          <label className="field">
            <span>ENG linked text</span>
            <textarea
              value={english}
              onChange={(event) => setEnglish(event.target.value)}
              rows={getAutoTextareaRows(english)}
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            onClick={() => onTranslationChange(node.translationSelector!, english)}
          >
            Apply ENG
          </button>
        </>
      )}
      <div className="style-box">
        <div className="style-title">Font</div>
        <div className="font-grid">
          <label className="field compact-field">
            <span>Family</span>
            <select
              value={normalizeFontFamily(node.textStyle?.fontFamily) || 'Noto Sans KR'}
              onChange={(event) => onTextStyle(selectedNodeIds, { fontFamily: event.target.value })}
            >
              <option>Noto Sans KR</option>
              <option>Malgun Gothic</option>
              <option>Arial</option>
              <option>Segoe UI</option>
            </select>
          </label>
          <label className="field compact-field">
            <span>Size</span>
            <input
              type="number"
              min={6}
              max={96}
              step={0.5}
              value={readFontSizeNumber(node.textStyle?.fontSize) || 10.5}
              onChange={(event) => onTextStyle(selectedNodeIds, { fontSize: Number(event.target.value) })}
            />
          </label>
          <label className="field compact-field">
            <span>Color</span>
            <input
              type="color"
              value={node.textStyle?.color || '#1f2328'}
              onChange={(event) => onTextStyle(selectedNodeIds, { color: event.target.value })}
            />
          </label>
        </div>
        <div className="mini-grid">
          <button
            type="button"
            className={node.textStyle?.bold ? 'active' : ''}
            onClick={() => onTextStyle(selectedNodeIds, { bold: !node.textStyle?.bold })}
          >
            B
          </button>
          <button
            type="button"
            className={node.textStyle?.italic ? 'active' : ''}
            onClick={() => onTextStyle(selectedNodeIds, { italic: !node.textStyle?.italic })}
          >
            I
          </button>
          <button
            type="button"
            className={node.textStyle?.underline ? 'active' : ''}
            onClick={() => onTextStyle(selectedNodeIds, { underline: !node.textStyle?.underline })}
          >
            U
          </button>
          <button type="button" disabled title="Superscript is planned after v2">
            x²
          </button>
        </div>
      </div>
      <TextEffectControls
        node={node}
        onApply={(settings) => onTextEffect(node.id, settings)}
      />
    </section>
  );
}

const effectPresets: Record<TextEffectSettings['preset'], TextEffectSettings> = {
  none: {
    preset: 'none',
    fill: '#ffffff',
    textColor: '#1f2328',
    borderColor: '#d7dbe2',
    radius: 0,
    bold: false
  },
  neutral: {
    preset: 'neutral',
    fill: '#f3f4f6',
    textColor: '#303842',
    borderColor: '#cfd6df',
    radius: 6,
    bold: true
  },
  info: {
    preset: 'info',
    fill: '#e8f2ff',
    textColor: '#0f4f86',
    borderColor: '#86b7e8',
    radius: 999,
    bold: true
  },
  warning: {
    preset: 'warning',
    fill: '#fff4ce',
    textColor: '#7a5200',
    borderColor: '#f2c94c',
    radius: 999,
    bold: true
  },
  danger: {
    preset: 'danger',
    fill: '#fde7e9',
    textColor: '#9f1b1f',
    borderColor: '#f3a5aa',
    radius: 999,
    bold: true
  },
  success: {
    preset: 'success',
    fill: '#e7f6d5',
    textColor: '#276221',
    borderColor: '#9fd37f',
    radius: 999,
    bold: true
  }
};

function TextEffectControls({
  node,
  onApply
}: {
  node: EditableNode;
  onApply: (settings: TextEffectSettings) => void;
}): JSX.Element {
  const [settings, setSettings] = useState<TextEffectSettings>(() => getNodeEffectSettings(node));
  const activePreset = effectPresets[settings.preset] ?? effectPresets.none;

  useEffect(() => {
    setSettings(getNodeEffectSettings(node));
  }, [
    node.id,
    node.textEffect?.borderColor,
    node.textEffect?.bold,
    node.textEffect?.fill,
    node.textEffect?.preset,
    node.textEffect?.radius,
    node.textEffect?.textColor
  ]);

  return (
    <div className="style-box">
      <div className="style-title">
        <Palette size={14} />
        AI/PPT effect
      </div>
      <label className="field compact-field">
        <span>Preset</span>
        <select
          value={settings.preset}
          onChange={(event) => {
            const preset = event.target.value as TextEffectSettings['preset'];
            setSettings({ ...effectPresets[preset], preset });
          }}
        >
          <option value="none">None</option>
          <option value="warning">Warning badge</option>
          <option value="info">Info badge</option>
          <option value="success">Success badge</option>
          <option value="danger">Risk badge</option>
          <option value="neutral">Neutral label</option>
        </select>
      </label>
      <div className="inline-fields effect-colors">
        <label title="Fill">
          <span>Fill</span>
          <input
            type="color"
            value={settings.fill}
            onChange={(event) => setSettings({ ...settings, fill: event.target.value })}
          />
        </label>
        <label title="Text">
          <span>Text</span>
          <input
            type="color"
            value={settings.textColor}
            onChange={(event) => setSettings({ ...settings, textColor: event.target.value })}
          />
        </label>
        <label title="Line">
          <span>Line</span>
          <input
            type="color"
            value={settings.borderColor}
            onChange={(event) => setSettings({ ...settings, borderColor: event.target.value })}
          />
        </label>
      </div>
      <Slider
        label="Radius"
        min={0}
        max={999}
        value={settings.radius}
        onChange={(radius) => setSettings({ ...settings, radius })}
      />
      <label className="check-field">
        <input
          type="checkbox"
          checked={settings.bold}
          onChange={(event) => setSettings({ ...settings, bold: event.target.checked })}
        />
        Bold label
      </label>
      <div className="effect-preview">
        <span
          style={{
            backgroundColor: settings.fill || activePreset.fill,
            borderColor: settings.borderColor || activePreset.borderColor,
            borderRadius: settings.radius,
            color: settings.textColor || activePreset.textColor,
            fontWeight: settings.bold ? 700 : 500
          }}
        >
          {node.text || 'Effect'}
        </span>
      </div>
      <button type="button" onClick={() => onApply(settings)}>
        Apply Effect
      </button>
    </div>
  );
}

function getNodeEffectSettings(node: EditableNode): TextEffectSettings {
  if (!node.textEffect) {
    return effectPresets.none;
  }
  return {
    ...(effectPresets[node.textEffect.preset] ?? effectPresets.none),
    ...node.textEffect
  };
}

const TABLE_PAGE_SIZE = 20;

function TableInspector({
  node,
  selectedCell,
  onCellSelect,
  onTableCellText,
  onAddTableRow,
  onAddTableColumn,
  onDeleteTableRow,
  onDeleteTableColumn,
  onSortTable,
  onFilterTable,
  onMergeRight,
  onUnmerge,
  onCellStyle,
  onPasteTable
}: {
  node: EditableNode;
  selectedCell: { row: number; cell: number };
  onCellSelect: (row: number, cell: number) => void;
  onTableCellText: (nodeId: string, row: number, cell: number, text: string) => void;
  onAddTableRow: (nodeId: string, row: number) => void;
  onAddTableColumn: (nodeId: string, column: number) => void;
  onDeleteTableRow: (nodeId: string, row: number) => void;
  onDeleteTableColumn: (nodeId: string, column: number) => void;
  onSortTable: (nodeId: string, column: number, direction: 'asc' | 'desc') => void;
  onFilterTable: (nodeId: string, query: string) => void;
  onMergeRight: (nodeId: string, row: number, cell: number) => void;
  onUnmerge: (nodeId: string, row: number, cell: number) => void;
  onCellStyle: (nodeId: string, row: number, cell: number, styles: Partial<CSSStyleDeclaration>) => void;
  onPasteTable: (nodeId: string, text: string) => void;
}): JSX.Element {
  const rows = node.table?.rows ?? [];
  const rowCount = rows.length;
  const pageCount = Math.max(1, Math.ceil(rowCount / TABLE_PAGE_SIZE));
  const selectedPage = Math.min(
    Math.max(0, Math.floor(selectedCell.row / TABLE_PAGE_SIZE)),
    pageCount - 1
  );
  const [page, setPage] = useState(selectedPage);
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * TABLE_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + TABLE_PAGE_SIZE, rowCount);
  const selected = rows[selectedCell.row]?.[selectedCell.cell];
  const [cellText, setCellText] = useState(selected?.text ?? '');
  const [filter, setFilter] = useState('');
  const [paste, setPaste] = useState('');

  useEffect(() => {
    setPage(selectedPage);
  }, [node.id, rowCount, selectedCell.row, selectedPage]);

  useEffect(() => {
    setCellText(selected?.text ?? '');
  }, [selected?.text, selectedCell.cell, selectedCell.row]);

  return (
    <section className="inspector-section">
      <h3>Table</h3>
      <div className="table-mini">
        {rows.slice(pageStart, pageEnd).map((row, localRowIndex) => {
          const rowIndex = pageStart + localRowIndex;
          return (
            <div className="table-mini-row" key={`${node.id}-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <button
                  type="button"
                  key={`${rowIndex}-${cellIndex}`}
                  className={
                    selectedCell.row === rowIndex && selectedCell.cell === cellIndex ? 'active' : ''
                  }
                  onClick={() => onCellSelect(rowIndex, cellIndex)}
                >
                  {cell.text || cell.tagName.toUpperCase()}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <div className="button-row table-pagination">
        <button
          type="button"
          disabled={safePage === 0}
          onClick={() => setPage((current) => Math.max(0, current - 1))}
        >
          Previous
        </button>
        <span>Rows {rowCount ? pageStart + 1 : 0}–{pageEnd} of {rowCount}</span>
        <button
          type="button"
          disabled={safePage >= pageCount - 1}
          onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
        >
          Next
        </button>
      </div>
      <label className="field">
        <span>Cell text</span>
        <input value={cellText} onChange={(event) => setCellText(event.target.value)} />
      </label>
      <button
        type="button"
        className="blue-button"
        onClick={() => onTableCellText(node.id, selectedCell.row, selectedCell.cell, cellText)}
      >
        Apply Cell
      </button>
      <div className="button-row">
        <button type="button" onClick={() => onAddTableRow(node.id, selectedCell.row)}>+ Row</button>
        <button type="button" onClick={() => onAddTableColumn(node.id, selectedCell.cell + 1)}>+ Column</button>
        <button type="button" onClick={() => onDeleteTableRow(node.id, selectedCell.row)}>- Row</button>
        <button type="button" onClick={() => onDeleteTableColumn(node.id, selectedCell.cell)}>- Column</button>
      </div>
      <div className="button-row">
        <button type="button" onClick={() => onSortTable(node.id, selectedCell.cell, 'asc')}>Sort ↑</button>
        <button type="button" onClick={() => onSortTable(node.id, selectedCell.cell, 'desc')}>Sort ↓</button>
      </div>
      <label className="field">
        <span>Filter</span>
        <input value={filter} onChange={(event) => setFilter(event.target.value)} />
      </label>
      <button type="button" className="secondary-button" onClick={() => onFilterTable(node.id, filter)}>
        Apply Filter
      </button>
      <div className="button-row">
        <button type="button" onClick={() => onMergeRight(node.id, selectedCell.row, selectedCell.cell)}>Merge Right</button>
        <button type="button" onClick={() => onUnmerge(node.id, selectedCell.row, selectedCell.cell)}>Unmerge</button>
      </div>
      <CellStyleControls
        key={`${node.id}-${selectedCell.row}-${selectedCell.cell}`}
        selected={selected}
        onStyle={(styles) => onCellStyle(node.id, selectedCell.row, selectedCell.cell, styles)}
      />
      <label className="field">
        <span>Excel paste</span>
        <textarea value={paste} onChange={(event) => setPaste(event.target.value)} rows={4} />
      </label>
      <button type="button" className="secondary-button" onClick={() => onPasteTable(node.id, paste)}>
        Paste Table
      </button>
    </section>
  );
}

function CellStyleControls({
  selected,
  onStyle
}: {
  selected?: TableCellSnapshot;
  onStyle: (styles: Partial<CSSStyleDeclaration>) => void;
}): JSX.Element {
  const [background, setBackground] = useState('#e8f2ff');
  const [align, setAlign] = useState('left');
  return (
    <div className="style-box">
      <div className="style-title">
        <Palette size={14} />
        Cell style
      </div>
      <div className="inline-fields">
        <input
          type="color"
          value={background}
          onChange={(event) => setBackground(event.target.value)}
          title="Background"
        />
        <select value={align} onChange={(event) => setAlign(event.target.value)}>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>
      <button
        type="button"
        onClick={() =>
          onStyle({
            backgroundColor: background,
            textAlign: align,
            borderColor: '#0f6cbd'
          } as Partial<CSSStyleDeclaration>)
        }
        disabled={!selected}
      >
        Apply Style
      </button>
    </div>
  );
}

function ImageInspector({
  node,
  onReplaceImage,
  onImageFilter,
  onResizeImage,
  onResizeImageFrame,
  onCropImage,
  onImageAnnotation
}: {
  node: EditableNode;
  onReplaceImage: (nodeId: string) => void;
  onImageFilter: (nodeId: string, settings: ImageFilterSettings) => void;
  onResizeImage: (nodeId: string, settings: ImageResizeSettings) => void;
  onResizeImageFrame: (nodeId: string, settings: ImageResizeSettings) => void;
  onCropImage: (nodeId: string, inset: number) => void;
  onImageAnnotation: (nodeId: string, text: string, tone: 'note' | 'warning' | 'box') => void;
}): JSX.Element {
  const [settings, setSettings] = useState<ImageFilterSettings>({
    rotation: 0,
    brightness: 100,
    contrast: 100,
    blur: 0
  });
  const [crop, setCrop] = useState(0);
  const [size, setSize] = useState<ImageResizeSettings>({
    width: readSizeNumber(node.image?.width),
    height: readSizeNumber(node.image?.height),
    unit: 'px'
  });
  const [frameSize, setFrameSize] = useState<ImageResizeSettings>({
    width: readSizeNumber(node.image?.frameWidth),
    height: readSizeNumber(node.image?.frameHeight),
    unit: 'px'
  });
  const [lockImageRatio, setLockImageRatio] = useState(true);
  const [lockFrameRatio, setLockFrameRatio] = useState(true);
  const [annotation, setAnnotation] = useState('');
  const [tone, setTone] = useState<'note' | 'warning' | 'box'>('note');

  useEffect(() => {
    setSize({
      width: readSizeNumber(node.image?.width),
      height: readSizeNumber(node.image?.height),
      unit: 'px'
    });
    setFrameSize({
      width: readSizeNumber(node.image?.frameWidth),
      height: readSizeNumber(node.image?.frameHeight),
      unit: 'px'
    });
  }, [node.id, node.image?.frameHeight, node.image?.frameWidth, node.image?.height, node.image?.width]);

  return (
    <section className="inspector-section">
      <h3>Image</h3>
      {node.image?.src && <img className="image-preview" src={node.image.src} alt={node.image.alt} />}
      <button type="button" className="blue-button" onClick={() => onReplaceImage(node.id)}>
        Replace Image
      </button>
      <Slider label="Rotate" min={-180} max={180} value={settings.rotation ?? 0} onChange={(rotation) => setSettings({ ...settings, rotation })} />
      <Slider label="Brightness" min={40} max={180} value={settings.brightness ?? 100} onChange={(brightness) => setSettings({ ...settings, brightness })} />
      <Slider label="Contrast" min={40} max={180} value={settings.contrast ?? 100} onChange={(contrast) => setSettings({ ...settings, contrast })} />
      <Slider label="Blur" min={0} max={12} value={settings.blur ?? 0} onChange={(blur) => setSettings({ ...settings, blur })} />
      <button type="button" className="secondary-button" onClick={() => onImageFilter(node.id, settings)}>
        Apply Adjustments
      </button>
      <div className="style-box">
        <div className="style-title">Image Size</div>
        <div className="size-current">
          Current {formatSizeValue(node.image?.width, size.width)} x {formatSizeValue(node.image?.height, size.height)}
        </div>
        <div className="size-grid">
          <label className="field compact-field">
            <span>W</span>
            <input
              type="number"
              min={1}
              value={size.width || ''}
              onChange={(event) => {
                const nextSize = { ...size, width: Number(event.target.value) };
                setSize(resizeWithAspectLock(getAspectBase(node.image?.width, node.image?.height, size), nextSize, 'width', lockImageRatio));
              }}
            />
          </label>
          <label className="field compact-field">
            <span>H</span>
            <input
              type="number"
              min={1}
              value={size.height || ''}
              onChange={(event) => {
                const nextSize = { ...size, height: Number(event.target.value) };
                setSize(resizeWithAspectLock(getAspectBase(node.image?.width, node.image?.height, size), nextSize, 'height', lockImageRatio));
              }}
            />
          </label>
          <label className="field compact-field">
            <span>Unit</span>
            <select
              value={size.unit}
              onChange={(event) => setSize({ ...size, unit: event.target.value as ImageResizeSettings['unit'] })}
            >
              <option value="px">px</option>
              <option value="%">%</option>
            </select>
          </label>
        </div>
        <label className="check-field">
          <input
            type="checkbox"
            checked={lockImageRatio}
            onChange={(event) => setLockImageRatio(event.target.checked)}
          />
          Lock ratio
        </label>
        <button type="button" onClick={() => onResizeImage(node.id, size)}>
          Apply Image Size
        </button>
      </div>
      <div className="style-box">
        <div className="style-title">Frame Size</div>
        <div className="size-current">
          Current {formatSizeValue(node.image?.frameWidth, frameSize.width)} x {formatSizeValue(node.image?.frameHeight, frameSize.height)}
        </div>
        <div className="size-grid">
          <label className="field compact-field">
            <span>W</span>
            <input
              type="number"
              min={1}
              value={frameSize.width || ''}
              onChange={(event) => {
                const nextSize = { ...frameSize, width: Number(event.target.value) };
                setFrameSize(resizeWithAspectLock(getAspectBase(node.image?.frameWidth, node.image?.frameHeight, frameSize), nextSize, 'width', lockFrameRatio));
              }}
            />
          </label>
          <label className="field compact-field">
            <span>H</span>
            <input
              type="number"
              min={1}
              value={frameSize.height || ''}
              onChange={(event) => {
                const nextSize = { ...frameSize, height: Number(event.target.value) };
                setFrameSize(resizeWithAspectLock(getAspectBase(node.image?.frameWidth, node.image?.frameHeight, frameSize), nextSize, 'height', lockFrameRatio));
              }}
            />
          </label>
          <label className="field compact-field">
            <span>Unit</span>
            <select
              value={frameSize.unit}
              onChange={(event) => setFrameSize({ ...frameSize, unit: event.target.value as ImageResizeSettings['unit'] })}
            >
              <option value="px">px</option>
              <option value="%">%</option>
            </select>
          </label>
        </div>
        <label className="check-field">
          <input
            type="checkbox"
            checked={lockFrameRatio}
            onChange={(event) => setLockFrameRatio(event.target.checked)}
          />
          Lock ratio
        </label>
        <button type="button" onClick={() => onResizeImageFrame(node.id, frameSize)}>
          Apply Frame Size
        </button>
      </div>
      <Slider label="Crop" min={0} max={40} value={crop} onChange={setCrop} />
      <button type="button" className="secondary-button" onClick={() => onCropImage(node.id, crop)}>
        Apply Crop
      </button>
      <label className="field">
        <span>Annotation</span>
        <input value={annotation} onChange={(event) => setAnnotation(event.target.value)} />
      </label>
      <select value={tone} onChange={(event) => setTone(event.target.value as 'note' | 'warning' | 'box')}>
        <option value="note">Note</option>
        <option value="warning">Warning</option>
        <option value="box">Box</option>
      </select>
      <button
        type="button"
        className="secondary-button"
        onClick={() => onImageAnnotation(node.id, annotation, tone)}
      >
        Add Annotation
      </button>
    </section>
  );
}

function ChartInspector({
  node,
  onChartPresentation,
  onChartData
}: {
  node: EditableNode;
  onChartPresentation: (nodeId: string, settings: ChartPresentationSettings) => void;
  onChartData: (nodeId: string, rows: ChartDataRow[]) => void;
}): JSX.Element {
  const [settings, setSettings] = useState<ChartPresentationSettings>(() =>
    getChartPresentationSettings(node)
  );
  const [dataText, setDataText] = useState(() => serializeChartCsvRows(node.chart?.rows ?? []));

  useEffect(() => {
    setSettings(getChartPresentationSettings(node));
    setDataText(serializeChartCsvRows(node.chart?.rows ?? []));
  }, [
    node.chartPresentation?.align,
    node.chartPresentation?.caption,
    node.chartPresentation?.frame,
    node.chartPresentation?.height,
    node.chartPresentation?.width,
    node.id,
    node.html
  ]);

  const chartRows = node.chart?.rows ?? [];
  const chartEditable = Boolean(node.chart?.editable);

  return (
    <section className="inspector-section">
      <h3>Chart</h3>
      <div className="chart-plan">
        <strong>Chart editing mode</strong>
        <span>V2: SVG title bar, visible-label bar, point/path coordinate data can be edited and reapplied.</span>
        <span>Raster image charts and unsupported SVG diagrams remain preserve-only to avoid corrupting report layout.</span>
      </div>
      <label className="field">
        <span>Caption</span>
        <input
          value={settings.caption ?? ''}
          onChange={(event) => setSettings({ ...settings, caption: event.target.value })}
        />
      </label>
      <div className="size-grid">
        <label className="field compact-field">
          <span>W</span>
          <input
            type="number"
            min={120}
            value={settings.width ?? ''}
            onChange={(event) =>
              setSettings({
                ...settings,
                width: event.target.value ? Number(event.target.value) : undefined
              })
            }
          />
        </label>
        <label className="field compact-field">
          <span>H</span>
          <input
            type="number"
            min={80}
            value={settings.height ?? ''}
            onChange={(event) =>
              setSettings({
                ...settings,
                height: event.target.value ? Number(event.target.value) : undefined
              })
            }
          />
        </label>
        <label className="field compact-field">
          <span>Align</span>
          <select
            value={settings.align}
            onChange={(event) =>
              setSettings({ ...settings, align: event.target.value as ChartPresentationSettings['align'] })
            }
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </label>
      </div>
      <label className="check-field">
        <input
          type="checkbox"
          checked={settings.frame}
          onChange={(event) => setSettings({ ...settings, frame: event.target.checked })}
        />
        Frame
      </label>
      <button type="button" className="blue-button" onClick={() => onChartPresentation(node.id, settings)}>
        Apply Chart
      </button>
      <div className="style-box chart-data-box">
        <div className="style-title">Data</div>
        <div className={chartEditable ? 'chart-data-status editable' : 'chart-data-status'}>
          {node.chart?.kind ?? 'unknown'} · {chartEditable ? `${chartRows.length} editable rows` : 'preserve only'}
        </div>
        {node.chart?.reason && <div className="chart-data-reason">{node.chart.reason}</div>}
        {chartRows.length > 0 && (
          <div className="chart-row-preview" aria-label="Chart data preview">
            {chartRows.slice(0, 8).map((row, index) => (
              <div key={`${row.label}-${index}`}>
                <span>{row.label}</span>
                <strong>{formatChartRowValue(row)}</strong>
              </div>
            ))}
          </div>
        )}
        <label className="field compact-field">
          <span>CSV data</span>
          <textarea
            value={dataText}
            onChange={(event) => setDataText(event.target.value)}
            rows={Math.max(4, Math.min(10, dataText.split(/\r?\n/).length))}
            disabled={!chartEditable}
          />
        </label>
        <button type="button" onClick={() => onChartData(node.id, parseChartCsvRows(dataText))} disabled={!chartEditable}>
          Apply Data
        </button>
      </div>
    </section>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  onChange
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label className="slider-field">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(Number(event.target.value))}
      />
      <output>{value}</output>
    </label>
  );
}

function normalizeFontFamily(fontFamily?: string): string {
  if (!fontFamily) {
    return '';
  }
  const first = fontFamily.split(',')[0]?.trim().replace(/^["']|["']$/g, '') ?? '';
  const options = ['Noto Sans KR', 'Malgun Gothic', 'Arial', 'Segoe UI'];
  return options.includes(first) ? first : 'Noto Sans KR';
}

function readFontSizeNumber(fontSize?: string): number {
  const match = fontSize?.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function readSizeNumber(value?: string): number {
  const match = value?.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function getAspectBase(
  widthValue: string | undefined,
  heightValue: string | undefined,
  fallback: ImageResizeSettings
): ImageResizeSettings {
  return {
    width: readSizeNumber(widthValue) || fallback.width,
    height: readSizeNumber(heightValue) || fallback.height,
    unit: fallback.unit
  };
}

function stripHtml(value: string): string {
  const element = document.createElement('div');
  element.innerHTML = value;
  return element.textContent ?? '';
}

function getChartPresentationSettings(node: EditableNode): ChartPresentationSettings {
  return node.chartPresentation ?? {
    caption: undefined,
    width: undefined,
    height: undefined,
    frame: false,
    align: 'left'
  };
}

function formatChartRowValue(row: ChartDataRow): string {
  if (row.x !== undefined || row.y !== undefined) {
    return `x ${row.x ?? '-'} / y ${row.y ?? '-'}`;
  }
  return String(row.value);
}

function formatSizeValue(value: string | undefined, fallback?: number): string {
  if (value && value.trim()) {
    return value.trim();
  }
  return fallback && fallback > 0 ? String(Math.round(fallback)) : 'auto';
}

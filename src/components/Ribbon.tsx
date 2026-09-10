import {
  ArrowDown,
  ArrowUp,
  Bold,
  Copy,
  Download,
  FolderOpen,
  Image as ImageIcon,
  Italic,
  List,
  Paintbrush,
  Pilcrow,
  Redo2,
  Save,
  Scissors,
  Search,
  Table2,
  Trash2,
  Type,
  Underline,
  Undo2
} from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { SampleFile } from '../lib/fileServices';
import { tooltipProps } from '../lib/tooltips';
import {
  EditableNodeKind,
  ReportDocument,
  TextStyleSettings,
  TextStyleSnapshot
} from '../types/htmlpoint';
interface RibbonProps {
  report: ReportDocument | null;
  samples?: SampleFile[];
  activeTab: string;
  selectedSectionIndex: number;
  sectionCount: number;
  sectionHidden: boolean;
  selectedKind?: EditableNodeKind;
  selectedTextStyle?: TextStyleSnapshot;
  canUndo: boolean;
  canRedo: boolean;
  onTabChange: (tab: string) => void;
  onOpen: () => void;
  onSampleOpen?: (sample: SampleFile) => void;
  onSave?: () => void;
  onSaveAs: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onTextStyle: (settings: TextStyleSettings) => void;
  onInsertTable: () => void;
  onInsertImage: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onHideToggle: () => void;
  onMove: (delta: -1 | 1) => void;
  onTableAddRow: () => void;
  onTableAddColumn: () => void;
  onTableDeleteRow: () => void;
  onTableDeleteColumn: () => void;
  onTableSort: (direction: 'asc' | 'desc') => void;
  onImageReplace: () => void;
  onImageCrop: () => void;
  onReviewSummary: () => void;
  onLanguageChange: (language: string) => void;
}
const tabs = ['Home', 'Insert', 'Table', 'Image', 'Review', 'Export'];
const RIBBON_PANEL_ID = 'ribbon-panel';

export interface RibbonGroupModel {
  title: string;
}
export function getRibbonGroupsForTab(tab: string): RibbonGroupModel[] {
  switch (tab) {
    case 'Insert':
      return [{ title: 'Insert Objects' }];
    case 'Table':
      return [{ title: 'Table Tools' }, { title: 'Cell' }];
    case 'Image':
      return [{ title: 'Image Tools' }, { title: 'Adjust' }];
    case 'Review':
      return [{ title: 'Review' }, { title: 'Changes' }];
    case 'Export':
      return [{ title: 'Export' }];
    case 'Home':
    default:
      return [
        { title: 'File' },
        { title: 'Font' },
        { title: 'Paragraph' },
        { title: 'Sections' },
        { title: 'Language' }
      ];
  }
}
export function Ribbon({
  report,
  activeTab,
  selectedSectionIndex,
  sectionCount,
  sectionHidden,
  selectedKind,
  selectedTextStyle,
  canUndo,
  canRedo,
  onTabChange,
  onOpen,
  onSave,
  onSaveAs,
  onUndo,
  onRedo,
  onTextStyle,
  onInsertTable,
  onInsertImage,
  onDuplicate,
  onDelete,
  onHideToggle,
  onMove,
  onTableAddRow,
  onTableAddColumn,
  onTableDeleteRow,
  onTableDeleteColumn,
  onTableSort,
  onImageReplace,
  onImageCrop,
  onReviewSummary,
  onLanguageChange
}: RibbonProps): JSX.Element {
  const isTable = selectedKind === 'table';
  const isImage = selectedKind === 'image';
  const isText = selectedKind === 'text' || selectedKind === 'list';
  const selectedFontFamily = normalizeFontFamily(selectedTextStyle?.fontFamily) || 'Noto Sans KR';
  const selectedFontSize = normalizeFontSize(selectedTextStyle?.fontSize) || '10.5';
  const hasSelectedSection = Boolean(
    report &&
      selectedSectionIndex >= 0 &&
      selectedSectionIndex < sectionCount &&
      selectedSectionIndex < report.sections.length
  );
  return (
    <header className="chrome">
      <div className="title-row">
        <div className="brand">
          <div className="brand-mark">H</div>
          <strong>HTMLpoint</strong>
        </div>
        <div className="quick-actions" aria-label="Quick actions">
          <IconButton icon={<Save />} label="Save" onClick={onSave ?? onSaveAs} disabled={!report || !report.dirty} />
          <IconButton icon={<Undo2 />} label="Undo" onClick={onUndo} disabled={!canUndo} />
          <IconButton icon={<Redo2 />} label="Redo" onClick={onRedo} disabled={!canRedo} />
        </div>
        <div className="document-title">
          {report ? <>{report.fileName || 'HTML Report'} <span>{report.dirty ? 'Modified' : 'Saved'}</span></> : 'No document'}
        </div>
        <button className="primary-save" type="button" onClick={onSave ?? onSaveAs} disabled={!report || !report.dirty} {...tooltipProps('Save HTML')}>
          <Save size={16} />
          Save
        </button>
      </div>
      <nav className="tab-row" role="tablist" aria-label="Ribbon tabs">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab}
            id={ribbonTabId(tab)}
            role="tab"
            aria-controls={RIBBON_PANEL_ID}
            aria-selected={activeTab === tab}
            tabIndex={activeTab === tab ? 0 : -1}
            className={activeTab === tab ? 'active' : ''}
            onClick={() => onTabChange(tab)}
            onKeyDown={(event) => handleRibbonTabKeyDown(event, tab, onTabChange)}
            {...tooltipProps(`${tab} tab`)}
          >
            {tab}
          </button>
        ))}
      </nav>
      <div
        className="ribbon"
        id={RIBBON_PANEL_ID}
        role="tabpanel"
        aria-labelledby={ribbonTabId(activeTab)}
      >
        {activeTab === 'Home' && (
          <>
            <FileGroup onOpen={onOpen} />
            <RibbonGroup title="Font">
              <select
                className="font-select"
                value={selectedFontFamily}
                disabled={!isText}
                onChange={(event) => onTextStyle({ fontFamily: event.target.value })}
                {...tooltipProps('Font family')}
              >
                <option>Noto Sans KR</option>
                <option>Malgun Gothic</option>
                <option>Arial</option>
                <option>Segoe UI</option>
              </select>
              <select
                className="size-select"
                value={selectedFontSize}
                disabled={!isText}
                onChange={(event) => onTextStyle({ fontSize: Number(event.target.value) })}
                {...tooltipProps('Font size')}
              >
                <option>9</option>
                <option>10.5</option>
                <option>12</option>
                <option>16</option>
                <option>20</option>
                <option>24</option>
              </select>
              <IconButton
                icon={<Bold />}
                label="Bold"
                disabled={!isText}
                pressed={Boolean(selectedTextStyle?.bold)}
                onClick={() => onTextStyle({ bold: !selectedTextStyle?.bold })}
              />
              <IconButton
                icon={<Italic />}
                label="Italic"
                disabled={!isText}
                pressed={Boolean(selectedTextStyle?.italic)}
                onClick={() => onTextStyle({ italic: !selectedTextStyle?.italic })}
              />
              <IconButton
                icon={<Underline />}
                label="Underline"
                disabled={!isText}
                pressed={Boolean(selectedTextStyle?.underline)}
                onClick={() => onTextStyle({ underline: !selectedTextStyle?.underline })}
              />
              <label className="ribbon-color" {...tooltipProps('Font color')}>
                <Type size={17} />
                <input
                  type="color"
                  value={selectedTextStyle?.color || '#1f2328'}
                  disabled={!isText}
                  onChange={(event) => onTextStyle({ color: event.target.value })}
                />
              </label>
              <IconButton icon={<Paintbrush />} label="Format Painter" disabled />
            </RibbonGroup>
            <RibbonGroup title="Paragraph">
              <IconButton icon={<List />} label="List" disabled />
              <IconButton icon={<Pilcrow />} label="Paragraph" disabled />
              <MoveButtons
                canMoveUp={hasSelectedSection && selectedSectionIndex > 0}
                canMoveDown={hasSelectedSection && selectedSectionIndex < sectionCount - 1}
                onMove={onMove}
              />
            </RibbonGroup>
            <SectionButtons
              hasSelectedSection={hasSelectedSection}
              sectionCount={sectionCount}
              sectionHidden={sectionHidden}
              onDuplicate={onDuplicate}
              onHideToggle={onHideToggle}
              onDelete={onDelete}
            />
            <LanguageGroup report={report} onLanguageChange={onLanguageChange} />
          </>
        )}
        {activeTab === 'Insert' && (
          <RibbonGroup title="Insert Objects">
            <button className="large-tool" type="button" onClick={onInsertTable} disabled={!report} {...tooltipProps('Insert table')}>
              <Table2 />
              <span>Table</span>
            </button>
            <button className="large-tool" type="button" onClick={onInsertImage} disabled={!report} {...tooltipProps('Insert image')}>
              <ImageIcon />
              <span>Image</span>
            </button>
          </RibbonGroup>
        )}
        {activeTab === 'Table' && (
          <>
            <RibbonGroup title="Table Tools">
              <button className="compact-tool" type="button" onClick={onTableAddRow} disabled={!isTable} {...tooltipProps('Add row')}>+ Row</button>
              <button className="compact-tool" type="button" onClick={onTableAddColumn} disabled={!isTable} {...tooltipProps('Add column')}>+ Column</button>
              <button className="compact-tool" type="button" onClick={onTableDeleteRow} disabled={!isTable} {...tooltipProps('Delete row')}>- Row</button>
              <button className="compact-tool" type="button" onClick={onTableDeleteColumn} disabled={!isTable} {...tooltipProps('Delete column')}>- Column</button>
            </RibbonGroup>
            <RibbonGroup title="Cell">
              <button className="compact-tool" type="button" onClick={() => onTableSort('asc')} disabled={!isTable} {...tooltipProps('Sort ascending')}>Sort Up</button>
              <button className="compact-tool" type="button" onClick={() => onTableSort('desc')} disabled={!isTable} {...tooltipProps('Sort descending')}>Sort Down</button>
            </RibbonGroup>
          </>
        )}
        {activeTab === 'Image' && (
          <>
            <RibbonGroup title="Image Tools">
              <button className="large-tool" type="button" onClick={onImageReplace} disabled={!isImage} {...tooltipProps('Replace image')}>
                <ImageIcon />
                <span>Replace</span>
              </button>
              <button className="large-tool" type="button" onClick={onImageCrop} disabled={!isImage} {...tooltipProps('Crop image')}>
                <Scissors />
                <span>Crop</span>
              </button>
            </RibbonGroup>
            <RibbonGroup title="Adjust">
              <button className="compact-tool" type="button" onClick={onImageCrop} disabled={!isImage} {...tooltipProps('Crop 10%')}>Crop 10%</button>
            </RibbonGroup>
          </>
        )}
        {activeTab === 'Review' && (
          <>
            <RibbonGroup title="Review">
              <button className="large-tool" type="button" onClick={onReviewSummary} disabled={!report} {...tooltipProps('Change summary')}>
                <Search />
                <span>Summary</span>
              </button>
            </RibbonGroup>
            <RibbonGroup title="Changes">
              <button className="compact-tool" type="button" onClick={onUndo} disabled={!canUndo} {...tooltipProps('Undo')}>Undo</button>
              <button className="compact-tool" type="button" onClick={onRedo} disabled={!canRedo} {...tooltipProps('Redo')}>Redo</button>
            </RibbonGroup>
          </>
        )}
        {activeTab === 'Export' && (
          <RibbonGroup title="Export">
            <button className="large-tool" type="button" onClick={onSaveAs} disabled={!report} {...tooltipProps('Save As HTML')}>
              <Download />
              <span>HTML</span>
            </button>
          </RibbonGroup>
        )}
      </div>
    </header>
  );
}
function FileGroup({
  onOpen
}: {
  onOpen: () => void;
}): JSX.Element {
  return (
    <RibbonGroup title="File">
      <button type="button" className="large-tool" onClick={onOpen} {...tooltipProps('Open HTML')}>
        <FolderOpen />
        <span>Open</span>
      </button>
    </RibbonGroup>
  );
}
function MoveButtons({
  canMoveUp,
  canMoveDown,
  onMove
}: {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: -1 | 1) => void;
}): JSX.Element {
  return (
    <>
      <button className="compact-tool" type="button" onClick={() => onMove(-1)} disabled={!canMoveUp} {...tooltipProps('Move section up')}>
        <ArrowUp size={16} />
        Up
      </button>
      <button className="compact-tool" type="button" onClick={() => onMove(1)} disabled={!canMoveDown} {...tooltipProps('Move section down')}>
        <ArrowDown size={16} />
        Down
      </button>
    </>
  );
}
function SectionButtons({
  hasSelectedSection,
  sectionCount,
  sectionHidden,
  onDuplicate,
  onHideToggle,
  onDelete
}: {
  hasSelectedSection: boolean;
  sectionCount: number;
  sectionHidden: boolean;
  onDuplicate: () => void;
  onHideToggle: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <RibbonGroup title="Sections">
      <button className="compact-tool" type="button" onClick={onDuplicate} disabled={!hasSelectedSection} {...tooltipProps('Duplicate section')}>
        <Copy size={16} />
        Duplicate
      </button>
      <button
        className="compact-tool"
        type="button"
        onClick={onHideToggle}
        disabled={!hasSelectedSection}
        {...tooltipProps(sectionHidden ? 'Show section' : 'Hide section')}
        aria-label={
          sectionHidden
            ? 'Show section — currently hidden'
            : 'Hide section — currently visible'
        }
      >
        <Scissors size={16} />
        {sectionHidden ? 'Show' : 'Hide'}
      </button>
      <button className="compact-tool danger" type="button" onClick={onDelete} disabled={!hasSelectedSection || sectionCount <= 1} {...tooltipProps('Delete section')}>
        <Trash2 size={16} />
        Delete
      </button>
    </RibbonGroup>
  );
}
function LanguageGroup({
  report,
  onLanguageChange
}: {
  report: ReportDocument | null;
  onLanguageChange: (language: string) => void;
}): JSX.Element {
  return (
    <RibbonGroup title="Language">
      {report?.languages.map((language) => (
        <button
          type="button"
          key={language}
          className={report.activeLanguage === language ? 'seg active' : 'seg'}
          onClick={() => onLanguageChange(language)}
          {...tooltipProps(`Language ${language.toUpperCase()}`)}
        >
          {language.toUpperCase()}
        </button>
      ))}
    </RibbonGroup>
  );
}
function RibbonGroup({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="ribbon-group">
      <div className="ribbon-controls">{children}</div>
      <div className="ribbon-title">{title}</div>
    </section>
  );
}
function IconButton({
  icon,
  label,
  disabled,
  pressed,
  onClick
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick?: () => void;
}): JSX.Element {
  return (
    <button
      className={pressed ? 'icon-button active' : 'icon-button'}
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      {...tooltipProps(label)}
    >
      {icon}
    </button>
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
function normalizeFontSize(fontSize?: string): string {
  if (!fontSize) {
    return '';
  }
  const match = fontSize.match(/\d+(?:\.\d+)?/);
  if (!match) {
    return '';
  }
  const numeric = Number(match[0]);
  const options = ['9', '10.5', '12', '16', '20', '24'];
  return options.includes(String(numeric)) ? String(numeric) : '10.5';
}

function ribbonTabId(tab: string): string {
  return `ribbon-tab-${tab.toLowerCase()}`;
}
function handleRibbonTabKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  tab: string,
  onTabChange: (tab: string) => void
): void {
  const currentIndex = tabs.indexOf(tab);
  let nextIndex: number | undefined;
  switch (event.key) {
    case 'ArrowRight':
      nextIndex = (currentIndex + 1) % tabs.length;
      break;
    case 'ArrowLeft':
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      break;
    case 'Home':
      nextIndex = 0;
      break;
    case 'End':
      nextIndex = tabs.length - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  const tabButtons = event.currentTarget
    .closest('[role="tablist"]')
    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  tabButtons?.[nextIndex]?.focus();
  onTabChange(tabs[nextIndex]);
}

import { Minus, Plus } from 'lucide-react';
import { ReportDocument } from '../types/htmlpoint';

interface StatusBarProps {
  report: ReportDocument | null;
  selectedIndex: number;
  zoom: number;
  fitMode?: boolean;
  backupPath?: string;
  onZoomChange: (zoom: number) => void;
  onFit?: () => void;
}

export function StatusBar({
  report,
  selectedIndex,
  zoom,
  fitMode = false,
  backupPath,
  onZoomChange,
  onFit
}: StatusBarProps): JSX.Element {
  const wordCount = report
    ? report.sections.reduce((total, section) => total + section.textPreview.split(/\s+/).filter(Boolean).length, 0)
    : 0;

  return (
    <footer className="status-bar">
      <span>{report ? `Section ${selectedIndex + 1} of ${report.sections.length}` : 'No document'}</span>
      <span>{wordCount.toLocaleString()} words</span>
      <span>{report?.activeLanguage ? `${report.activeLanguage.toUpperCase()}` : '—'}</span>
      <span>{report ? (report.dirty ? 'Modified' : 'Saved') : 'No document'}</span>
      {backupPath && <span className="backup-note">Backup: {backupPath}</span>}
      <div className="zoom-controls">
        <button
          className="fit-button"
          type="button"
          aria-label="Fit preview to canvas"
          aria-pressed={fitMode}
          disabled={!report}
          onClick={onFit}
        >
          Fit
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          disabled={!report}
          onClick={() => onZoomChange(Math.max(50, zoom - 10))}
        >
          <Minus size={15} />
        </button>
        <input
          type="range"
          aria-label="Preview zoom"
          min={50}
          max={140}
          value={zoom}
          disabled={!report}
          onChange={(event) => onZoomChange(Number(event.target.value))}
        />
        <button
          type="button"
          aria-label="Zoom in"
          disabled={!report}
          onClick={() => onZoomChange(Math.min(140, zoom + 10))}
        >
          <Plus size={15} />
        </button>
        <span>{zoom}%</span>
      </div>
    </footer>
  );
}

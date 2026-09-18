import type { DocumentQualityIssue, DocumentQualityReport } from '../lib/documentQuality';

export function QualityPanel({
  report,
  onSelect
}: {
  report: DocumentQualityReport;
  onSelect?: (issue: DocumentQualityIssue) => void;
}): JSX.Element {
  if (!report.issues.length) {
    return <p className="quality-empty">문서 품질 경고가 없습니다.</p>;
  }
  return (
    <div className="quality-list" aria-label="Document quality issues">
      {report.issues.map((issue) => (
        <button
          key={issue.id}
          type="button"
          className={`quality-item ${issue.severity}`}
          onClick={() => onSelect?.(issue)}
          disabled={!issue.canNavigate}
        >
          <span className="quality-code">{issue.code}</span>
          <span>{issue.message}</span>
        </button>
      ))}
    </div>
  );
}

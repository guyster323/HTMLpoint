import type { ChangeSummaryEntry } from '../lib/changeSummary';

export function ChangeSummaryTimeline({ entries }: { entries: ChangeSummaryEntry[] }): JSX.Element {
  if (!entries.length) {
    return <p className="change-summary-empty">아직 변경 내역이 없습니다.</p>;
  }

  return (
    <ol className="change-summary-timeline" aria-label="변경 이력">
      {[...entries].reverse().map((entry) => (
        <li key={entry.id} className="change-summary-entry">
          <div className="change-summary-heading">
            <span className="change-summary-chip">{entry.category}</span>
            <strong>{entry.label}</strong>
          </div>
          <div className="change-summary-metadata">
            <time>{entry.timestamp}</time>
            {entry.sectionTitle ? <span>{entry.sectionTitle}</span> : null}
          </div>
          {entry.before || entry.after ? (
            <details className="change-summary-details">
              <summary>변경 전후 보기</summary>
              <div className="change-summary-excerpts">
                {entry.before ? (
                  <div className="change-summary-excerpt" aria-label="변경 전">
                    <strong>변경 전</strong>
                    <p>{entry.before}</p>
                  </div>
                ) : null}
                {entry.after ? (
                  <div className="change-summary-excerpt" aria-label="변경 후">
                    <strong>변경 후</strong>
                    <p>{entry.after}</p>
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

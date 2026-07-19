import { EyeOff, Plus, Rows3 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { buildThumbnailHtml } from '../lib/preview';
import { ReportDocument } from '../types/htmlpoint';

interface SectionRailProps {
  report: ReportDocument | null;
  selectedSectionId?: string;
  onSelect: (sectionId: string) => void;
  onDuplicate: () => void;
}

export function SectionRail({
  report,
  selectedSectionId,
  onSelect,
  onDuplicate
}: SectionRailProps): JSX.Element {
  return (
    <aside className="section-rail">
      <div className="rail-head">
        <strong>Sections</strong>
        <button type="button" title="Duplicate section" onClick={onDuplicate} disabled={!report}>
          <Plus size={16} />
        </button>
      </div>
      <div className="thumbnail-list">
        {report ? (
          report.sections.map((section, index) => (
            <button
              type="button"
              className={section.id === selectedSectionId ? 'thumbnail active' : 'thumbnail'}
              key={section.id}
              onClick={() => onSelect(section.id)}
            >
              <span className="thumb-index">{index + 1}</span>
              <ThumbnailCard sectionHtml={section.html} index={index} hidden={section.hidden} eager={section.id === selectedSectionId || index < 2} />
              <span className="thumb-title">{section.title}</span>
            </button>
          ))
        ) : (
          <div className="empty-rail">
            <Rows3 size={24} />
            <span>HTML을 열면 섹션이 표시됩니다.</span>
          </div>
        )}
      </div>
    </aside>
  );
}

function ThumbnailCard({ sectionHtml, index, hidden, eager }: { sectionHtml: string; index: number; hidden: boolean; eager: boolean }): JSX.Element {
  const cardRef = useRef<HTMLSpanElement>(null);
  const [mounted, setMounted] = useState(eager);
  useEffect(() => {
    if (eager) { setMounted(true); return; }
    const card = cardRef.current;
    if (!card || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setMounted(true);
        observer.disconnect();
      }
    }, { rootMargin: '240px' });
    observer.observe(card);
    return () => observer.disconnect();
  }, [eager]);
  return <span ref={cardRef} className="thumb-card">
    {hidden && <span className="hidden-badge"><EyeOff size={13} /></span>}
    {mounted ? <iframe title={`Section ${index + 1}`} sandbox="" srcDoc={buildThumbnailHtml(sectionHtml)} /> : <span className="thumbnail-placeholder" aria-label={`Section ${index + 1} thumbnail loading`}>Preview on demand</span>}
  </span>;
}

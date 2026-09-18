import type {
  RenderBounds,
  RenderedDocumentSnapshot,
  RenderSnapshotWarning
} from '../types/htmlpoint';

export interface DocumentQualityIssue {
  id: string;
  sectionId: string;
  nodeId?: string;
  code: RenderSnapshotWarning['code'] | 'overlap';
  severity: 'warning' | 'error';
  message: string;
  bounds?: RenderBounds;
  canNavigate: boolean;
}

export interface DocumentQualityReport {
  issues: DocumentQualityIssue[];
  errors: number;
  warnings: number;
}

export function evaluateDocumentQuality(
  snapshot: RenderedDocumentSnapshot
): DocumentQualityReport {
  const issues: DocumentQualityIssue[] = [];
  snapshot.pages.forEach((page) => {
    page.objects.forEach((object) => {
      object.warnings.forEach((item, index) => {
        issues.push({
          id: `${page.sectionId}:${object.id}:${item.code}:${index}`,
          sectionId: page.sectionId,
          nodeId: item.sourceNodeId ?? object.sourceNodeId,
          code: item.code,
          severity: item.severity,
          message: item.message,
          bounds: object.bounds,
          canNavigate: Boolean(item.sourceNodeId ?? object.sourceNodeId)
        });
      });
    });
  });
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  return {
    issues,
    errors,
    warnings: issues.length - errors
  };
}

export function qualitySummary(report: DocumentQualityReport): string {
  if (!report.issues.length) {
    return '문서 품질 경고가 없습니다.';
  }
  return `오류 ${report.errors}개 · 경고 ${report.warnings}개`;
}

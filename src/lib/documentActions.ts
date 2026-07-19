import { parseOpenedFile } from './fileServices';
import type { OpenedHtmlFile } from './fileServices';
import type { ReportDocument } from '../types/htmlpoint';

export type PendingDocumentAction =
  | { type: 'opened-file'; opened: OpenedHtmlFile }
  | { type: 'dropped-file'; file: File }
  | { type: 'close-window' };

export function validateOpenedReport(opened: OpenedHtmlFile): ReportDocument {
  const report = parseOpenedFile(opened);
  if (report.sections.length === 0) {
    throw new Error('편집 가능한 <header> 또는 <section>을 찾지 못했습니다.');
  }
  return report;
}

export function nextReportAfterSave(
  report: ReportDocument,
  filePath: string
): ReportDocument {
  return {
    ...report,
    fileName: filePath.split(/[\\/]/).pop() ?? report.fileName,
    sourcePath: filePath,
    dirty: false
  };
}

export function isCurrentBackupSnapshot(
  currentReport: ReportDocument | null,
  requestedReport: ReportDocument
): boolean {
  return (
    currentReport === requestedReport &&
    currentReport.sourcePath === requestedReport.sourcePath
  );
}

export function shouldCreateAutoBackup(
  report: ReportDocument | null
): report is ReportDocument & { sourcePath: string } {
  return Boolean(report?.dirty && report.sourcePath);
}

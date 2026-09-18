import { parseOpenedCandidate, parseOpenedFile } from './fileServices';
import type { OpenedHtmlFile } from './fileServices';
import type { ImportCandidate, ReportDocument } from '../types/htmlpoint';

export type PendingDocumentAction =
  | { type: 'opened-file'; opened: OpenedHtmlFile }
  | { type: 'dropped-file'; file: File }
  | { type: 'close-window' };

export class ReportImportError extends Error {
  readonly opened: OpenedHtmlFile;
  readonly candidates: ImportCandidate[];

  constructor(opened: OpenedHtmlFile, candidates: ImportCandidate[]) {
    super('편집 가능한 영역을 자동으로 정하지 못했습니다. 후보 영역을 선택하세요.');
    this.name = 'ReportImportError';
    this.opened = opened;
    this.candidates = candidates;
  }
}

export function validateOpenedReport(
  opened: OpenedHtmlFile,
  selectedCandidatePath?: number[]
): ReportDocument {
  const report = selectedCandidatePath
    ? parseOpenedCandidate(opened, selectedCandidatePath)
    : parseOpenedFile(opened);
  if (report.sections.length === 0) {
    if (report.importCandidates?.length) {
      throw new ReportImportError(opened, report.importCandidates);
    }
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

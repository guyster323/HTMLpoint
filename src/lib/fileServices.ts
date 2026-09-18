import { parseReportHtml } from './htmlParser';
import { serializeReportHtml } from './htmlSerializer';
import { serializeDeploymentHtml } from './deployment';
import { ReportDocument } from '../types/htmlpoint';
import {
  exportRenderedDocumentToPptx,
  PptxExportOptions,
  PptxExportReport
} from './export/pptx';
import { createRenderedDocumentSnapshot } from './renderSnapshot';

export interface SampleFile {
  fileName: string;
  filePath: string;
  size?: number;
  modifiedAt?: string;
}

export interface OpenedHtmlFile {
  fileName: string;
  filePath?: string;
  html: string;
  backupPath?: string;
  warnings?: string[];
  recovered?: boolean;
}

export interface SavedHtmlFile {
  filePath: string;
  warnings?: string[];
}
export interface SavedPptxFile {
  filePath: string;
  report: PptxExportReport;
}
export interface SavedDeploymentHtmlFile {
  filePath: string;
  warnings: string[];
  removedScripts: number;
}
export interface SavedPdfFile {
  filePath: string;
  warnings: string[];
  removedScripts: number;
}
const FALLBACK_SAMPLES: SampleFile[] = [
  {
    fileName: 'Noise_Demand_Analysis_20260609.html',
    filePath: 'HTML_reference/Noise_Demand_Analysis_20260609.html'
  },
  {
    fileName: 'GR23US0011_NorthernOrchard_MDVF2_UTF2_LogAnalysis_Report_260703.html',
    filePath: 'HTML_reference/GR23US0011_NorthernOrchard_MDVF2_UTF2_LogAnalysis_Report_260703.html'
  },
  {
    fileName: 'GR23KR0005_에너지게이트_부산진구청_Cell전압벌어짐_Noise측정report_260610.html',
    filePath: 'HTML_reference/GR23KR0005_에너지게이트_부산진구청_Cell전압벌어짐_Noise측정report_260610.html'
  },
  {
    fileName: 'GR19KR0011_아이파워_국내PV(성원태양광)_BSC_Log_data_오류_분석_Report.html',
    filePath: 'HTML_reference/GR19KR0011_아이파워_국내PV(성원태양광)_BSC_Log_data_오류_분석_Report.html'
  }
];
export async function listSamples(): Promise<SampleFile[]> {
  if (window.htmlpoint) {
    return window.htmlpoint.listSamples();
  }
  return FALLBACK_SAMPLES;
}
export async function openSample(sample: SampleFile): Promise<OpenedHtmlFile> {
  if (window.htmlpoint) {
    return window.htmlpoint.openSample(sample.filePath);
  }
  const response = await fetch(`/${sample.filePath.split('/').map(encodeURIComponent).join('/')}`);
  if (!response.ok) {
    throw new Error(`Sample load failed: ${sample.fileName}`);
  }
  return {
    fileName: sample.fileName,
    filePath: sample.filePath,
    html: stripDevServerInjection(await response.text())
  };
}
export async function openHtmlDialog(): Promise<OpenedHtmlFile | null> {
  if (!window.htmlpoint) {
    return null;
  }
  return window.htmlpoint.openHtmlDialog();
}

export function parseOpenedFile(file: OpenedHtmlFile): ReportDocument {
  const report = parseReportHtml(file.html, {
    fileName: file.fileName,
    sourcePath: file.filePath
  });
  return file.recovered ? { ...report, dirty: true } : report;
}
export async function saveAsHtml(report: ReportDocument): Promise<SavedHtmlFile | undefined> {
  const result = serializeReportHtml(report);
  const fallbackName = report.fileName?.replace(/\.html?$/i, '') || 'htmlpoint-report';
  const defaultPath = `${fallbackName}.html`;
  if (window.htmlpoint) {
    const saved = await window.htmlpoint.saveAsHtml({
      defaultPath,
      html: result.html,
      sourcePath: report.sourcePath,
      warnings: result.warnings
    });
    return saved ?? undefined;
  }
  const blob = new Blob([result.html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = defaultPath;
  anchor.click();
  URL.revokeObjectURL(url);
  return { filePath: defaultPath, warnings: result.warnings };
}

export function parseOpenedCandidate(
  file: OpenedHtmlFile,
  candidatePath: number[]
): ReportDocument {
  const report = parseReportHtml(file.html, {
    fileName: file.fileName,
    sourcePath: file.filePath,
    selectedCandidatePath: candidatePath
  });
  return file.recovered ? { ...report, dirty: true } : report;
}

export async function saveAsPptx(
  report: ReportDocument,
  options: PptxExportOptions = {}
): Promise<SavedPptxFile | undefined> {
  const snapshot = createRenderedDocumentSnapshot(report);
  const exported = await exportRenderedDocumentToPptx(snapshot, options);
  const fallbackName = report.fileName?.replace(/\.html?$/i, '') || 'htmlpoint-report';
  const defaultPath = `${fallbackName}.pptx`;
  if (window.htmlpoint?.savePptx) {
    const saved = await window.htmlpoint.savePptx({ defaultPath, data: exported.data });
    return saved ? { ...saved, report: exported.report } : undefined;
  }
  const browserBuffer = new ArrayBuffer(exported.data.byteLength);
  new Uint8Array(browserBuffer).set(exported.data);
  const blob = new Blob([browserBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = defaultPath;
  anchor.click();
  URL.revokeObjectURL(url);
  return { filePath: defaultPath, report: exported.report };
}

export async function saveAsDeploymentHtml(
  report: ReportDocument
): Promise<SavedDeploymentHtmlFile | undefined> {
  const deployment = serializeDeploymentHtml(report);
  const fallbackName = report.fileName?.replace(/\.html?$/i, '') || 'htmlpoint-report';
  const defaultPath = `${fallbackName}.deployment.html`;
  if (window.htmlpoint?.saveAsHtml) {
    const saved = await window.htmlpoint.saveAsHtml({
      defaultPath,
      html: deployment.html,
      sourcePath: report.sourcePath,
      warnings: deployment.warnings
    });
    return saved
      ? { filePath: saved.filePath, warnings: deployment.warnings, removedScripts: deployment.removedScripts }
      : undefined;
  }
  downloadTextFile(defaultPath, deployment.html, 'text/html;charset=utf-8');
  return {
    filePath: defaultPath,
    warnings: deployment.warnings,
    removedScripts: deployment.removedScripts
  };
}

export async function saveAsPdf(report: ReportDocument): Promise<SavedPdfFile | undefined> {
  const deployment = serializeDeploymentHtml(report);
  const fallbackName = report.fileName?.replace(/\.html?$/i, '') || 'htmlpoint-report';
  const defaultPath = `${fallbackName}.deployment.pdf`;
  if (window.htmlpoint?.savePdf) {
    const saved = await window.htmlpoint.savePdf({
      defaultPath,
      html: deployment.html,
      sourcePath: report.sourcePath
    });
    return saved
      ? { filePath: saved.filePath, warnings: deployment.warnings, removedScripts: deployment.removedScripts }
      : undefined;
  }
  if (typeof window.print !== 'function') {
    throw new Error('PDF 저장은 HTMLpoint 데스크톱 앱에서 사용할 수 있습니다.');
  }
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    throw new Error('PDF 인쇄 창을 열 수 없습니다. 팝업 차단을 확인하세요.');
  }
  printWindow.document.open();
  printWindow.document.write(deployment.html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  return undefined;
}

function downloadTextFile(fileName: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function saveHtml(report: ReportDocument): Promise<SavedHtmlFile | undefined> {
  const result = serializeReportHtml(report);
  if (window.htmlpoint?.saveHtml && report.sourcePath) {
    return window.htmlpoint.saveHtml({
      filePath: report.sourcePath,
      html: result.html,
      sourcePath: report.sourcePath,
      warnings: result.warnings
    });
  }
  return saveAsHtml(report);
}
export async function createAutoBackup(report: ReportDocument): Promise<{ backupPath?: string; warnings: string[] }> {
  if (!window.htmlpoint || !report.sourcePath) {
    return { warnings: [] };
  }
  const result = serializeReportHtml(report);
  const backup = await window.htmlpoint.createBackup({
    filePath: report.sourcePath,
    html: result.html
  });
  return { backupPath: backup.backupPath, warnings: result.warnings };
}
export async function openImageAsDataUrl(): Promise<{ fileName: string; dataUrl: string } | null> {
  if (!window.htmlpoint) {
    return null;
  }
  return window.htmlpoint.openImageDialog();
}
function stripDevServerInjection(html: string): string {
  return html
    .replace(/<script\b[^>]*type=["']module["'][^>]*>[\s\S]*?@react-refresh[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*src=["']\/@vite\/client["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<script\b[^>]*src=["']\/src\/main\.tsx["'][^>]*>\s*<\/script>/gi, '');
}

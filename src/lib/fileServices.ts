import { parseReportHtml } from './htmlParser';
import { serializeReportHtml } from './htmlSerializer';
import { ReportDocument } from '../types/htmlpoint';

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

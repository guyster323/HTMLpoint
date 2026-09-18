import type { ReportDocument } from '../types/htmlpoint';
import { stripEditorArtifacts } from './editorArtifacts';
import { parseHtml } from './htmlParser';
import { serializeReportHtml } from './htmlSerializer';

export interface DeploymentHtmlOptions {
  language?: string;
  preserveScripts?: boolean;
}

export interface DeploymentHtmlResult {
  html: string;
  warnings: string[];
  removedScripts: number;
}

export function serializeDeploymentHtml(
  report: ReportDocument,
  options: DeploymentHtmlOptions = {}
): DeploymentHtmlResult {
  const serialized = serializeReportHtml(report);
  const document = parseHtml(serialized.html);
  stripEditorArtifacts(document);
  const language = options.language ?? report.activeLanguage;
  hideInactiveLanguagePanes(document, language);
  const removedScripts = options.preserveScripts
    ? 0
    : document.scripts.length;
  if (!options.preserveScripts) {
    document.querySelectorAll('script').forEach((script) => script.remove());
  }
  document.querySelectorAll<HTMLElement>('*').forEach((element) => {
    Array.from(element.attributes)
      .filter((attribute) => attribute.name.startsWith('data-htmlpoint-'))
      .forEach((attribute) => element.removeAttribute(attribute.name));
  });
  const warnings = [...serialized.warnings];
  if (removedScripts) {
    warnings.push(`배포용 HTML에서 동적 script ${removedScripts}개를 제거했습니다.`);
  }
  return {
    html: `<!doctype html>\n${document.documentElement.outerHTML}`,
    warnings,
    removedScripts
  };
}

function hideInactiveLanguagePanes(document: Document, activeLanguage: string): void {
  document.querySelectorAll<HTMLElement>('[data-report-lang]').forEach((element) => {
    const language = element.dataset.reportLang?.trim();
    if (!language || language === activeLanguage) {
      element.hidden = false;
      if (element.style.display === 'none') element.style.display = '';
      return;
    }
    element.hidden = true;
    element.style.display = 'none';
  });
}

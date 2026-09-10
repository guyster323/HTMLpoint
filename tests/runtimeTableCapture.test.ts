import { describe, expect, it } from 'vitest';
import { captureRuntimeTable, setTableCellText } from '../src/lib/editing';
import { getElementPath } from '../src/lib/domPaths';
import { parseHtml, parseReportHtml } from '../src/lib/htmlParser';

const reportHtml = `<!doctype html><html><body><main>
  <section id="visuals">
    <h2>시각화 벤치마크</h2>
    <details>
      <summary>전체 Rack Heatmap 보기 열기</summary>
      <div class="runtime-panel">
        <div class="rack-heatmap-host"></div>
      </div>
    </details>
  </section>
</main></body></html>`;

function setupReport() {
  const report = parseReportHtml(reportHtml);
  const section = report.sections[0];
  const sectionDocument = parseHtml(section.html);
  const root = sectionDocument.body.firstElementChild!;
  const host = root.querySelector('.rack-heatmap-host')!;
  return { report, section, hostPath: getElementPath(root, host) };
}

describe('runtime table capture', () => {
  it('creates a visible editable snapshot, hides the runtime host, and opens details', () => {
    const { report, section, hostPath } = setupReport();
    const result = captureRuntimeTable(
      report,
      section.id,
      hostPath,
      `<table class="heatmap-table htmlpoint-preview-node"
          data-htmlpoint-node-id="forged" data-htmlpoint-runtime-wired="true"
          title="동적 표 · 클릭하여 정적 편집본으로 변환" onclick="alert(1)"
          style="width:100%;background:rgb(245, 246, 247);position:fixed;background-image:url(javascript:alert(1))">
        <tbody><tr>
          <th id="rack-header">Rack</th>
          <td onmouseover="alert(2)" style="background:rgb(255, 180, 180);position:fixed">
            <script>window.__unsafe = true</script>
            <iframe srcdoc="<script>alert(3)</script>"></iframe>
            <svg onload="alert(4)"><text>unsafe</text></svg>
            <a class="bad-link" href="java&#x0A;script:alert(5)" target="_blank">bad</a>
            <a class="credential-link" href="https://user:secret@example.com/private">credential</a>
            <a class="safe-link" href="https://example.com/detail" target="_blank">safe</a>
            <img class="unsafe-image" src="data:image/svg+xml;base64,PHN2Zy8+" onerror="alert(6)">
            <img class="safe-image" src="data:image/png;base64,AAAA" onerror="alert(7)">
            <img class="remote-image" src="https://example.com/tracker.png">
            <span data-host-script-action="run">data gadget</span>
            <blink>42</blink>
          </td>
        </tr></tbody>
      </table>`
    );

    expect(result.report).not.toBe(report);
    expect(result.report.dirty).toBe(true);
    expect(result.insertedNodeId).toBeTruthy();
    expect(
      result.report.sections[0].editableNodes.find(
        (node) => node.id === result.insertedNodeId
      )?.kind
    ).toBe('table');
    expect(result.report.operations.at(-1)).toEqual(
      expect.objectContaining({
        type: 'table',
        sectionId: section.id,
        nodeId: result.insertedNodeId
      })
    );

    const nextDocument = parseHtml(result.report.sections[0].html);
    const details = nextDocument.querySelector('details')!;
    const host = nextDocument.querySelector<HTMLElement>('.rack-heatmap-host')!;
    const wrapper = host.nextElementSibling as HTMLElement;
    const table = wrapper.querySelector<HTMLTableElement>(':scope > table')!;

    expect(details.open).toBe(true);
    expect(host.hidden).toBe(true);
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.style.getPropertyValue('display')).toBe('none');
    expect(host.style.getPropertyPriority('display')).toBe('important');
    expect(wrapper.dataset.htmlpointRuntimeTableSnapshot).toBe('true');
    expect(wrapper.style.getPropertyValue('display')).toBe('block');
    expect(wrapper.style.getPropertyPriority('display')).toBe('important');
    expect(table.style.getPropertyValue('display')).toBe('table');
    expect(table.style.getPropertyPriority('display')).toBe('important');

    expect(table.querySelector('script,iframe,svg')).toBeNull();
    expect(table.querySelector('[onclick],[onmouseover],[onerror]')).toBeNull();
    expect(table.getAttribute('data-htmlpoint-node-id')).toBeNull();
    expect(table.getAttribute('title')).toBeNull();
    expect(table.classList.contains('htmlpoint-preview-node')).toBe(false);
    expect(table.classList.contains('heatmap-table')).toBe(true);
    expect(table.style.position).toBe('');
    expect(table.style.backgroundImage).toBe('');
    expect(table.style.background).not.toBe('');
    expect(table.querySelector('.bad-link')?.getAttribute('href')).toBeNull();
    expect(table.querySelector('.credential-link')?.getAttribute('href')).toBeNull();
    expect(table.querySelector('.safe-link')?.getAttribute('href')).toBe(
      'https://example.com/detail'
    );
    expect(table.querySelector('.safe-link')?.getAttribute('target')).toBeNull();
    expect(table.querySelector('.safe-link')?.getAttribute('rel')).toBe(
      'noopener noreferrer'
    );
    expect(table.querySelector('.unsafe-image')?.getAttribute('src')).toBeNull();
    expect(table.querySelector('.safe-image')?.getAttribute('src')).toBe(
      'data:image/png;base64,AAAA'
    );
    expect(table.querySelector('.remote-image')?.getAttribute('src')).toBeNull();
    expect(table.querySelector('[data-host-script-action]')).toBeNull();
    expect(table.textContent).toContain('42');

    const edited = setTableCellText(
      result.report,
      section.id,
      result.insertedNodeId!,
      0,
      1,
      '43'
    );
    const editedDocument = parseHtml(edited.sections[0].html);
    expect(editedDocument.querySelector('.rack-heatmap-host')?.hasAttribute('hidden')).toBe(true);
    expect(editedDocument.querySelector('table')?.rows[0].cells[1].textContent).toBe('43');
  });

  it('is idempotent for a host that already has a captured table', () => {
    const { report, section, hostPath } = setupReport();
    const first = captureRuntimeTable(
      report,
      section.id,
      hostPath,
      '<table><tbody><tr><td>original</td></tr></tbody></table>'
    );
    const second = captureRuntimeTable(
      first.report,
      section.id,
      hostPath,
      '<table><tbody><tr><td>replacement</td></tr></tbody></table>'
    );

    expect(second.report).toBe(first.report);
    expect(second.insertedNodeId).toBe(first.insertedNodeId);
    expect(second.report.operations).toHaveLength(1);
    const document = parseHtml(second.report.sections[0].html);
    expect(document.querySelectorAll('[data-htmlpoint-runtime-table-snapshot]')).toHaveLength(1);
    expect(document.querySelector('table')?.textContent).toBe('original');
  });

  it('rejects invalid roots, invalid host paths, and oversized payloads without history', () => {
    const { report, section, hostPath } = setupReport();
    const invalidRoot = captureRuntimeTable(
      report,
      section.id,
      hostPath,
      '<div><table><tr><td>not a root table</td></tr></table></div>'
    );
    const invalidPath = captureRuntimeTable(
      report,
      section.id,
      [999],
      '<table><tr><td>valid table</td></tr></table>'
    );
    const unrelatedHost = captureRuntimeTable(
      report,
      section.id,
      [0],
      '<table><tr><td>not inside the dynamic disclosure</td></tr></table>'
    );
    const oversized = captureRuntimeTable(
      report,
      section.id,
      hostPath,
      `<table><caption>${'x'.repeat(2 * 1024 * 1024)}</caption></table>`
    );
    const oversizedUtf8 = captureRuntimeTable(
      report,
      section.id,
      hostPath,
      `<table><caption>${'가'.repeat(800_000)}</caption></table>`
    );

    expect(invalidRoot.report).toBe(report);
    expect(invalidPath.report).toBe(report);
    expect(unrelatedHost.report).toBe(report);
    expect(oversized.report).toBe(report);
    expect(oversizedUtf8.report).toBe(report);
    expect(report.dirty).toBe(false);
    expect(report.operations).toHaveLength(0);
  });
});

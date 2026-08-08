export type PlanStatus = 'complete' | 'partial' | 'excluded' | 'pending';

export interface PlanItem {
  milestone: string;
  label: string;
  status: PlanStatus;
  evidence: string;
}

export interface MilestoneAchievement {
  name: string;
  total: number;
  completed: number;
  partial: number;
  percent: number;
}

export interface PlanAchievement {
  total: number;
  completed: number;
  partial: number;
  excluded: number;
  pending: number;
  percent: number;
  byMilestone: MilestoneAchievement[];
  remaining: PlanItem[];
}

export const v1PlanItems: PlanItem[] = [
  { milestone: 'Milestone 1', label: 'Electron + React 프로젝트 스캐폴딩', status: 'complete', evidence: 'package.json, electron/main.ts, src/App.tsx' },
  { milestone: 'Milestone 1', label: 'Electron 파일 열기/저장 IPC', status: 'complete', evidence: 'open-dialog, save-as IPC handlers' },
  { milestone: 'Milestone 1', label: '자동 백업', status: 'complete', evidence: 'createBackupFromPath, createAutoBackup' },
  { milestone: 'Milestone 1', label: '샘플 4종 로드', status: 'complete', evidence: 'listSamples/openSample and tests/referenceSamples.test.ts' },
  { milestone: 'Milestone 1', label: '섹션 썸네일/캔버스 표시', status: 'complete', evidence: 'SectionRail, Canvas' },
  { milestone: 'Milestone 1', label: 'Windows 포터블 앱 실행', status: 'complete', evidence: 'Vite base ./ and Electron package runtime QA' },
  { milestone: 'Milestone 1', label: 'Drag & Drop HTML Open', status: 'complete', evidence: 'dropImport and App drop zone' },
  { milestone: 'Milestone 2', label: '텍스트/제목/목록 편집', status: 'complete', evidence: 'editTextNode, PropertiesPanel' },
  { milestone: 'Milestone 2', label: '섹션 복제/삭제/숨김/순서 변경', status: 'complete', evidence: 'duplicate/delete/hide/move operations' },
  { milestone: 'Milestone 2', label: 'Undo/Redo', status: 'complete', evidence: 'App past/future state' },
  { milestone: 'Milestone 2', label: '변경 요약', status: 'complete', evidence: 'formatChangeOperation/ChangeSummaryTimeline' },
  { milestone: 'Milestone 2', label: '단일 HTML Save As', status: 'complete', evidence: 'serializeReportHtml and save-as IPC' },
  { milestone: 'Milestone 3', label: '표 셀 수정', status: 'complete', evidence: 'setTableCellText' },
  { milestone: 'Milestone 3', label: 'Excel 붙여넣기', status: 'complete', evidence: 'importTabDelimitedTable' },
  { milestone: 'Milestone 3', label: '행/열 삽입', status: 'complete', evidence: 'addTableRow/addTableColumn' },
  { milestone: 'Milestone 3', label: '행/열 삭제', status: 'complete', evidence: 'deleteTableRow/deleteTableColumn' },
  { milestone: 'Milestone 3', label: '셀 병합/해제', status: 'complete', evidence: 'mergeTableCellRight/unmergeTableCell' },
  { milestone: 'Milestone 3', label: '정렬/필터', status: 'complete', evidence: 'sortTableByColumn/filterTableRows' },
  { milestone: 'Milestone 3', label: '배경색/강조/테두리/정렬', status: 'complete', evidence: 'styleTableCell' },
  { milestone: 'Milestone 3', label: '수식 계산 제외', status: 'excluded', evidence: 'approved v1 exclusion' },
  { milestone: 'Milestone 4', label: '이미지 교체', status: 'complete', evidence: 'replaceImageSource/openImageDialog' },
  { milestone: 'Milestone 4', label: '크롭', status: 'complete', evidence: 'cropImage' },
  { milestone: 'Milestone 4', label: '회전', status: 'complete', evidence: 'applyImageFilter rotation' },
  { milestone: 'Milestone 4', label: '밝기/대비', status: 'complete', evidence: 'applyImageFilter brightness/contrast' },
  { milestone: 'Milestone 4', label: '화살표/박스/텍스트 주석', status: 'partial', evidence: 'text/box annotation exists; arrow drawing remains next phase' },
  { milestone: 'Milestone 4', label: '모자이크/블러', status: 'partial', evidence: 'blur filter exists; pixel mosaic remains next phase' },
  { milestone: 'Milestone 5', label: '샘플 4종 회귀 검수', status: 'complete', evidence: 'tests/referenceSamples.test.ts' },
  { milestone: 'Milestone 5', label: '브라우저 표시 검수', status: 'complete', evidence: 'Playwright rendered smoke tests' },
  { milestone: 'Milestone 5', label: '@media print 보존 검수', status: 'complete', evidence: 'serializer tests contain @media print assertion' },
  { milestone: 'Milestone 5', label: 'Windows 포터블 패키징', status: 'complete', evidence: 'release/HTMLpoint-0.1.0-portable.exe' },
  { milestone: 'v1 Exclusion', label: '차트 데이터 편집 제외', status: 'excluded', evidence: 'approved v1 exclusion' },
  { milestone: 'v1 Exclusion', label: 'AI 번역 제외', status: 'excluded', evidence: 'approved v1 exclusion' },
  { milestone: 'v1 Exclusion', label: '클라우드 저장 제외', status: 'excluded', evidence: 'offline-only approved scope' },
  { milestone: 'v1 Exclusion', label: 'PDF 직접 export 제외', status: 'excluded', evidence: 'approved v1 exclusion' }
];

export function calculatePlanAchievement(items: PlanItem[]): PlanAchievement {
  const count = (status: PlanStatus) => items.filter((item) => item.status === status).length;
  const total = items.length;
  const completed = count('complete');
  const partial = count('partial');
  const excluded = count('excluded');
  const pending = count('pending');
  const score = completed + partial * 0.5 + excluded;
  const percent = total ? Math.round((score / total) * 100) : 0;
  const milestones = Array.from(new Set(items.map((item) => item.milestone)));

  return {
    total,
    completed,
    partial,
    excluded,
    pending,
    percent,
    byMilestone: milestones.map((name) => {
      const scoped = items.filter((item) => item.milestone === name);
      const scopedComplete = scoped.filter((item) => item.status === 'complete' || item.status === 'excluded').length;
      const scopedPartial = scoped.filter((item) => item.status === 'partial').length;
      return {
        name,
        total: scoped.length,
        completed: scopedComplete,
        partial: scopedPartial,
        percent: scoped.length ? Math.round(((scopedComplete + scopedPartial * 0.5) / scoped.length) * 100) : 0
      };
    }),
    remaining: items.filter((item) => item.status !== 'complete')
  };
}

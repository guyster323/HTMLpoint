import { describe, expect, it } from 'vitest';
import { calculatePlanAchievement, v1PlanItems } from '../src/lib/phaseReport';

describe('v1 plan achievement reporting', () => {
  it('calculates quantitative completion and exposes remaining next-phase items', () => {
    const report = calculatePlanAchievement(v1PlanItems);

    expect(report.total).toBeGreaterThan(20);
    expect(report.completed).toBeGreaterThan(0);
    expect(report.percent).toBeGreaterThan(60);
    expect(report.remaining.map((item) => item.label)).toContain('PDF 직접 export 제외');
    expect(report.byMilestone.some((milestone) => milestone.name === 'Milestone 5')).toBe(true);

    expect(v1PlanItems.find((item) => item.label === '행/열 삭제')).toMatchObject({
      status: 'complete',
      evidence: 'deleteTableRow/deleteTableColumn'
    });

    expect(v1PlanItems.find((item) => item.label === '변경 요약')).toMatchObject({
      status: 'complete',
      evidence: 'formatChangeOperation/ChangeSummaryTimeline'
    });
  });
});

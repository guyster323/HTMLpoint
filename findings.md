# HTMLpoint UI/UX 및 기능 점검 결과

- 점검일: 2026-07-13 (Asia/Seoul)
- 대상: `HTMLpoint 0.1.0`
- 대상 런타임: Vite renderer + `release/win-unpacked/HTMLpoint.exe`
- 점검 방식: Playwright 1.61.1 실제 렌더링/클릭/입력/드래그, 패키징 Electron 직접 제어, Vitest, TypeScript/Vite 빌드, 소스 교차 검토
- 화면 크기: 1440×900, 1024×768(조건부 소형 화면), Electron 기본 창
- 샘플: `GR23KR0005_에너지게이트_부산진구청_Cell전압벌어짐_Noise측정report_260610.html`

## 결론

앱과 패키징 런타임은 실행되며 승인 샘플을 열고 기본 편집 기능을 수행할 수 있다. 그러나 현재 상태는 실사용 문서 편집기로 보기 어렵다. 빈 화면의 무한 렌더 루프, 저장하지 않은 변경 유실, 섹션 삭제 후 편집 화면 붕괴, 리치 텍스트/차트 캡션/원래 서식 손상처럼 사용자 데이터와 직결된 문제가 우선 해결되어야 한다.

자동 테스트 41개와 빌드는 모두 통과했지만, 통과 범위가 실제 사용자 상태 전이와 데이터 보존을 충분히 다루지 못한다. 특히 “두 번 연속 적용”, “선택 섹션 삭제”, “수정 중 다른 파일 열기”, “부모 텍스트에 중첩 태그가 있는 경우”가 빠져 있다.

### 우선순위 요약

| 우선순위 | 건수 | 핵심 내용 |
|---|---:|---|
| Critical | 2 | 선택 없음 상태 무한 렌더, 저장하지 않은 변경 즉시 유실 |
| High | 4 | 섹션 삭제 화면 붕괴, 리치 텍스트/차트 캡션/원래 서식 손상 |
| Medium | 12 | 잘못된 성공 상태, Undo 문맥 상실, 표 편집 오류, 오해를 부르는 UI, 모달·접근성·자산 경로 문제 |
| Low/조건부 | 2 | 소형 화면 잘림, 상태 의존 명령의 레이블/활성화 불일치 |

## 상세 Findings

### HPT-001 · Critical · 선택된 섹션이 없으면 무한 렌더 루프가 발생한다

- 검증: Playwright에서 빈 앱을 연 직후 0.6초부터 `Maximum update depth exceeded`가 반복됐다. 보고서를 열기 전부터 발생한다.
- 사용자 영향: 초기 화면과 섹션 선택이 사라진 상태에서 CPU 사용량, 입력 지연, 배터리 소모가 증가할 수 있다. 개발 모드 콘솔도 오류로 오염된다.
- 원인: `selectedSection`이 없을 때 `setSelectedNodeIds([])`를 매 렌더마다 새 배열로 설정하고, 같은 배열 상태를 effect 의존성에 포함한다.
- 위치: `src/App.tsx:150-171`
- 재현:
  1. 앱을 열고 아무 문서도 열지 않는다.
  2. 개발자 콘솔을 확인한다.
  3. React maximum update depth 경고가 반복된다.
- 권장: 이미 선택이 비어 있으면 상태를 갱신하지 않도록 함수형 업데이트에서 동일 참조를 반환한다. `selectedSectionId`가 없을 때의 초기화 effect를 별도로 분리하고 회귀 테스트를 추가한다.

### HPT-002 · Critical · 수정 중 다른 파일을 열거나 드롭하면 확인 없이 변경이 유실된다

- 검증: 텍스트를 수정해 문서가 `Modified`가 된 뒤 다른 HTML을 드롭했다. 확인창은 0회였고 문서 제목이 즉시 `replacement.html Saved`로 바뀌었다.
- 사용자 영향: 저장하지 않은 작업을 복구할 수 없다. 드롭 파일은 `sourcePath`가 없어 자동 백업도 생성되지 않는다.
- 원인: `loadReport`와 드롭/열기 경로가 현재 `report.dirty`를 확인하지 않는다. Electron 창 닫기에도 dirty 확인이 없다.
- 위치: `src/App.tsx:299-345`, `electron/main.ts:31-55`, `electron/main.ts:69-98`
- 권장: 열기, 드롭, 새 문서 교체, 앱 종료 전에 `저장 / 버리기 / 취소` 확인을 제공한다. 드롭 문서도 임시 복구본을 남긴다.

### HPT-003 · High · 선택 중인 섹션을 삭제하면 문서가 남아 있어도 편집 화면이 빈 상태가 된다

- 검증: 13개 섹션 중 두 번째 섹션을 삭제하자 섹션은 12개 남았지만 활성 썸네일은 0개가 됐다. 캔버스는 `No document loaded`, Properties는 `보고서를 열면 속성이 표시됩니다`로 바뀌었다.
- 추가 영향: 삭제 확인이 없으며, HPT-001과 같은 “선택 없음” 코드 경로에 진입한다. 상태바는 남은 문서가 있는데도 선택 상태를 정확히 표현하지 못한다.
- 위치: `src/App.tsx:150-171`, `src/App.tsx:499-500`, `src/lib/editing.ts:609-624`, `src/components/Canvas.tsx:25-31`
- 권장: 삭제 전 인덱스를 기억한 뒤 다음 섹션, 없으면 이전 섹션을 즉시 선택한다. 노드와 셀 선택도 함께 재설정하고 삭제 확인 또는 즉시 실행취소 토스트를 제공한다.

### HPT-004 · High · 부모 텍스트 편집 시 내부 강조/링크/배지 마크업이 삭제된다

- 검증: 최종 결론의 아래 HTML을 Properties에서 편집했다.

```html
<span class="pill bad">개선 미확인</span> 6/10 Ferrite 조치 이후 ...
```

  적용 후에는 `QA RICH TEXT REPLACEMENT`라는 순수 텍스트만 남고 `<span>`이 사라졌다.
- 사용자 영향: 텍스트만 수정해도 배지, 링크, 강조, 인라인 구조가 조용히 유실된다.
- 원인: 파서는 부모와 자식 텍스트 요소를 모두 편집 개체로 만들지만, 편집 시 부모의 `textContent`를 통째로 교체한다.
- 위치: `src/lib/htmlParser.ts:20`, `src/lib/htmlParser.ts:530` 부근, `src/lib/editing.ts:37`
- 권장: 자식 요소가 있는 부모는 직접 편집 대상에서 제외하거나, 텍스트 노드 단위 편집으로 바꾼다. 적용 전 구조 손상 경고와 중첩 마크업 회귀 테스트를 추가한다.

### HPT-005 · High · `Apply Chart`를 두 번 누르면 방금 만든 캡션이 삭제된다

- 검증:
  1. 차트 Caption에 `QA persistent caption` 입력 후 `Apply Chart` → 캡션 생성 성공.
  2. 적용 직후 Caption 입력값이 빈 문자열로 초기화됨.
  3. 다시 `Apply Chart` → 캡션이 삭제됨.
- 사용자 영향: 크기나 정렬만 다시 적용해도 캡션이 사라질 수 있다.
- 원인: Inspector가 node 변경마다 `caption: ''`으로 초기화하고, 적용 로직은 빈 캡션이면 기존 캡션을 제거한다.
- 위치: `src/components/PropertiesPanel.tsx:881-899`, `src/lib/editing.ts:563-578`
- 권장: 기존 `figcaption[data-htmlpoint-chart-caption]`을 상태 초기값으로 읽는다. 사용자가 캡션을 변경하지 않았다면 캡션을 적용 대상에서 제외한다.

### HPT-006 · High · AI/PPT 효과의 `None`이 효과뿐 아니라 원래 타이포그래피도 삭제한다

- 검증: 원래 스타일이 `color:#123456;font-size:22px;font-weight:400;line-height:2`인 요소에서 `None`을 적용하자 `style` 속성 전체가 사라졌다.
- 사용자 영향: 효과 제거를 눌렀을 뿐인데 원본 색상, 글자 크기, 굵기, 행간이 손상된다.
- 원인: `None` 처리에서 효과가 추가한 값인지 구분하지 않고 `color`, `font-weight`, `font-size`, `line-height` 등을 무조건 제거한다.
- 위치: `src/lib/editing.ts:429-457`
- 권장: 적용 전 원래 스타일 스냅샷을 보존해 복원하거나, 효과 전용 CSS class/custom property만 추가·제거한다.

### HPT-007 · Medium · 지원 구조가 없는 HTML도 성공한 것처럼 표시한다

- 검증: `<main><h1>Hello</h1></main>` 구조의 유효 HTML을 드롭했다. 결과는 썸네일 0개, 빈 캔버스, 상태바 `Section 1 of 0`인데 메시지는 `plain.html dropped and loaded`였다.
- 사용자 영향: 사용자는 파일이 손상됐는지, 형식이 미지원인지, 불러오기가 실패했는지 알 수 없다.
- 위치: `src/lib/htmlParser.ts:101-120`, `src/App.tsx:299-331`, `src/components/StatusBar.tsx:23-30`
- 권장: `sections.length === 0`이면 성공 처리하지 않는다. 지원 구조 안내, 본문 전체를 단일 섹션으로 가져오기, 취소 중 하나를 제공한다.

### HPT-008 · Medium · Undo/Redo가 작업 중인 섹션 문맥을 잃고 첫 섹션으로 이동한다

- 검증: 세 번째 섹션 `현장 점검 이후 개선 여부`에서 텍스트를 수정하고 Undo하자 첫 번째 표지 섹션으로 이동했다.
- 사용자 영향: 연속 편집 중 위치를 잃고 매번 원래 섹션을 다시 찾아야 한다.
- 원인: Undo/Redo가 이전 선택을 복원하지 않고 항상 `sections[0]`과 첫 노드를 선택한다.
- 위치: `src/App.tsx:361-391`
- 권장: 히스토리에 문서와 선택 상태를 함께 저장하거나, 현재 섹션 ID가 복원된 문서에도 존재하면 그대로 유지한다.

### HPT-009 · Medium · `<tbody>`만 있는 표의 첫 행에서 `+ Row`를 누르면 새 행이 표 끝에 추가된다

- 검증: 행이 `A, B, C`인 표의 첫 행을 선택하고 `+ Row`를 실행했다. 실제 결과는 `A, B, C, 빈 행`이며 기대 결과는 `A, 빈 행, B, C`였다.
- 원인: body anchor 계산이 `afterRowIndex - 1`을 사용해 첫 행에서 anchor가 없어지고 append 경로로 빠진다.
- 위치: `src/lib/editing.ts:85-119`
- 권장: 전체 table row index를 thead/tbody 로컬 index로 정확히 변환하고, 선택 행의 `nextSibling` 앞에 삽입한다.

### HPT-010 · Medium · 큰 표는 13행 또는 9열 이후 셀을 선택할 수 없다

- 검증: 13×9 표를 열었을 때 Properties 미니 표는 12행×8열만 렌더링했다.
- 사용자 영향: 잘린 영역의 셀 텍스트, 병합, 정렬, 스타일을 편집할 UI 경로가 없다.
- 원인: `rows.slice(0, 12)`와 `row.slice(0, 8)`로 고정한다.
- 위치: `src/components/PropertiesPanel.tsx:568-584`
- 권장: 전체 표 가상 스크롤, 행/열 좌표 입력, 페이지 이동 중 하나를 제공하고 현재 표시 범위를 명시한다.

### HPT-011 · Medium · Properties의 Text/Table/Image/Chart가 탭처럼 보이지만 클릭해도 아무 반응이 없다

- 검증: Text 활성 상태에서 Table을 눌러도 활성 탭과 내용이 모두 Text로 유지됐다.
- 사용자 영향: 사용자는 속성 범주를 전환할 수 있다고 예상하지만 무반응을 경험한다.
- 원인: 네 버튼에 `onClick`이 없고 활성 상태가 선택 개체 종류에서만 계산된다.
- 위치: `src/components/PropertiesPanel.tsx:96-128`
- 권장: 실제 탭 기능을 구현하거나 버튼이 아닌 개체 종류 표시로 바꾼다.

### HPT-012 · Medium · 표 삽입 후 새 개체가 선택되지 않고 완료 피드백도 없다

- 검증: `Insert table` 실행 후 table 개체와 셀 개체 4개가 추가됐지만 선택은 기존 텍스트에 남았고 Inspector도 Text였다. 하단 메시지도 기존 `dropped and loaded` 상태였다.
- 사용자 영향: 삽입 성공 여부와 새 표의 위치를 즉시 파악하기 어렵고, 사용자가 Object 목록에서 다시 찾아야 한다.
- 위치: `src/App.tsx:492-497`, `src/lib/editing.ts`의 `insertTableAfterNode`
- 권장: 새 table node ID를 반환해 자동 선택하고 캔버스에 스크롤/강조한다. `표가 추가되었습니다` 상태 메시지를 제공한다.

### HPT-013 · Medium · 기본 100% 줌이 데스크톱 캔버스 폭에 맞지 않는다

- 검증: 1440×900에서 canvas viewport는 820px, 문서 프레임은 1120px, 실제 scroll width는 1176px였다. 처음부터 356px의 가로 스크롤이 필요했다.
- 사용자 영향: 일반 데스크톱에서도 보고서 오른쪽을 보려면 계속 가로 스크롤해야 한다. Properties와 Section Rail이 고정 폭을 크게 차지한다.
- 위치: `src/styles.css:402-405`, `src/styles.css:579-605`, `src/components/Canvas.tsx:68-71`
- 권장: 기본값을 `Fit to window`로 계산하고 `Fit`, `100%` 명령을 분리한다. 좌우 패널 접기 또는 자동 축소도 제공한다.

### HPT-014 · Medium · 변경 요약 모달의 키보드 동작이 불완전하다

- 검증: 모달을 열어도 포커스가 배경 Summary 버튼에 남았다. Escape를 눌러도 닫히지 않았다.
- 사용자 영향: 키보드/스크린리더 사용자가 모달과 배경 UI 사이에서 길을 잃고, 배경 명령을 실행할 수 있다.
- 위치: `src/App.tsx:717-739`
- 권장: 열릴 때 Close 또는 제목으로 포커스를 이동하고, Tab 순환, Escape 닫기, 닫힌 뒤 포커스 복원, 배경 `inert`를 구현한다.

### HPT-015 · Medium · 저장 후 자동 백업이 새 파일이 아닌 이전 원본 경로를 계속 사용한다

- 소스 근거: Save As 성공 시 `fileName`과 `dirty`만 갱신하고 `sourcePath`는 변경하지 않는다. 자동 백업은 `report.sourcePath`를 사용한다.
- 사용자 영향: 다른 폴더/이름으로 저장한 뒤 편집하면 백업이 새 파일 옆이 아니라 이전 원본 옆에 생성된다.
- 위치: `src/App.tsx:337-346`, `src/lib/fileServices.ts:97-106`
- 권장: Save As 결과 경로를 `sourcePath`로 갱신하고 새 기준 백업을 만든다.

### HPT-016 · Medium · 상대경로 이미지/CSS가 원본 HTML 폴더를 기준으로 해석되지 않는다

- 소스 근거: 원본 경로는 `sourcePath`에만 저장되고 preview `iframe srcDoc`에는 원본 디렉터리를 가리키는 `<base>`가 없다.
- 사용자 영향: `images/a.png`, `style.css` 같은 상대 URL을 쓰는 보고서는 미리보기에서 자산이 깨질 수 있다. data URL 기반 승인 샘플에서는 가려진다.
- 위치: `src/components/Canvas.tsx:76-81`, `src/lib/preview.ts`, `src/lib/fileServices.ts:67-71`
- 권장: 안전하게 변환된 file URL base 또는 자산 인라인 변환을 제공한다. 저장 시 원래 상대경로 보존 정책도 명시한다.

### HPT-017 · Medium · 세로 병합 셀의 Unmerge가 표 구조를 복원하지 못한다

- 소스 근거: `rowSpan`을 1로 만들지만 아래 행에 빠진 셀을 생성하지 않는다. 새 셀은 현재 행의 `colSpan` 수만큼만 추가한다.
- 사용자 영향: rowspan 해제 후 열 정렬과 셀 수가 어긋날 수 있다.
- 위치: `src/lib/editing.ts:201-220`
- 권장: 원래 row/column occupancy를 계산해 각 영향 행에 셀을 복원한다. rowspan/colspan 조합 테스트를 추가한다.

### HPT-018 · Medium · 오류와 상태 메시지의 전달력이 부족하다

- 소스 근거: Open/Save는 사용자용 `try/catch`가 없고 자동 백업 실패는 무시된다. 하단 메시지에는 `role="status"` 또는 `aria-live`가 없다.
- 사용자 영향: 저장/백업 실패를 모르고 작업을 계속할 수 있으며 스크린리더는 드롭 오류나 저장 성공을 알기 어렵다.
- 위치: `src/App.tsx:96-108`, `src/App.tsx:313-345`, `src/App.tsx:714-716`
- 권장: 오류별 메시지와 재시도 동작을 제공하고 상태 영역을 live region으로 만든다.

### HPT-019 · Low/조건부 · 소형 화면에서 오른쪽 Properties가 잘리고 접근할 가로 스크롤도 없다

- 검증: 1024×768에서 document width는 1100px, body는 `overflow:hidden`, Properties 오른쪽은 x=1100이었다. 오른쪽 76px이 잘렸다.
- 조건: Electron 창은 `minWidth:1180`이므로 현재 데스크톱 최소 창에서는 직접 재현되지 않는다. 웹 배포, OS 배율, 향후 최소 폭 변경 시 문제가 된다.
- 위치: `src/styles.css:33-35`, `src/styles.css:89-96`, `src/styles.css:1251-1263`, `electron/main.ts:31-36`
- 권장: 리본/패널 축약, 패널 접기, 최소 폭 이하에서의 명시적 가로 스크롤 또는 반응형 레이아웃을 제공한다.

### HPT-020 · Low · 상태 의존 명령과 접근 가능한 이름이 현재 상태와 맞지 않는다

- 검증/근거:
  - 숨긴 섹션에도 버튼 이름이 계속 `Hide section`이고 `Unhide/Show`로 바뀌지 않는다.
  - 첫/마지막 섹션의 Up/Down, 마지막 한 섹션의 Delete가 활성 상태지만 클릭은 무반응이다.
  - 줌 `-`, `+` 아이콘 버튼 두 개와 range에 접근 가능한 이름이 없다.
  - Properties/Ribbon 탭은 현재 선택을 `aria-selected` 등으로 노출하지 않는다.
- 위치: `src/components/Ribbon.tsx:314-376`, `src/components/StatusBar.tsx:32-46`, `src/components/PropertiesPanel.tsx:111-127`
- 권장: 경계 조건에 따라 disabled를 갱신하고 `Hide/Show` 레이블과 `aria-pressed`를 상태에 맞춘다. 줌 컨트롤에는 `축소`, `확대`, `미리보기 배율` 이름을 부여한다.

## 통과한 항목

| 항목 | 결과 | 증거 |
|---|---|---|
| Vitest | PASS | 11개 파일, 41개 테스트 통과 |
| TypeScript + Vite + Electron 빌드 | PASS | `npm run build` 성공 |
| 패키징 Electron 실행 | PASS | `HTMLpoint.exe`, `file:///.../app.asar/dist/index.html` 로드 |
| Electron preload IPC | PASS | `openHtmlDialog`, `saveAsHtml`, `createBackup` 등 8개 API 확인 |
| 승인 샘플 로드 | PASS | 13개 섹션, 첫 섹션 7개 개체 렌더링 |
| 페이지 식별/빈 화면/오버레이 | PASS | title `HTMLpoint`, 의미 있는 초기 UI, framework overlay 없음 |
| 일반 표 행 추가 | PASS | 승인 샘플 표 6행 → 7행 |
| Image inspector | PASS | 이미지 개체 선택 시 Image inspector와 preview 표시 |
| Chart inspector | PASS | SVG point 차트 29개 편집 행 표시 |
| 줌 상태 변경 | PASS | `+` 클릭 시 100% → 110% |
| 비HTML 드롭 피드백 | PASS | `HTML 파일만 열 수 있습니다.` 표시 |

## 자동 테스트에 추가할 회귀 시나리오

1. 문서가 없는 초기 화면에서 2초 동안 렌더/콘솔 오류가 없는지 검사한다.
2. 수정된 문서를 다른 파일로 교체하거나 창을 닫을 때 확인 흐름을 검사한다.
3. 선택 섹션 삭제 후 인접 섹션, 첫 노드, 상태바가 일관되게 선택되는지 검사한다.
4. `<p>A <strong>B</strong> <a>link</a></p>` 편집 후 태그 보존을 검사한다.
5. 차트 캡션을 적용한 뒤 두 번째 `Apply Chart`에도 보존되는지 검사한다.
6. 원래 타이포그래피가 있는 요소에서 Effect `None` 적용 후 원래 스타일 보존을 검사한다.
7. `<tbody>` 전용 표의 첫/중간/마지막 행 삽입 위치를 검사한다.
8. 13×9 이상 표의 모든 셀을 선택할 수 있는지 검사한다.
9. Undo/Redo 후 원래 섹션과 개체 선택이 유지되는지 검사한다.
10. 지원 섹션이 0개인 HTML을 성공으로 표시하지 않는지 검사한다.

## 점검 범위와 증거

- Browser/Computer Use 플러그인은 이 세션에 없어 Browser 플러그인 방식의 직접 제어는 불가능했다.
- 허용된 대체 경로인 Playwright로 렌더러를 클릭·입력·드래그했고, 패키징된 Electron 앱도 직접 실행/제어했다.
- 외부 점검 증거는 저장소 밖 `D:\LGES_Backup\AI_Driven\htmlpoint-audit\results`에 보관했다.
  - `ui-audit.json`, `extended-audit.json`, `runtime-audit.json`, `focused-regressions.json`
  - `01-empty-desktop.png` ~ `05-electron-runtime.png`
- 네이티브 Open/Save 파일 선택창에서 실제 파일을 저장하는 흐름과 5초 자동 백업의 실제 파일 생성은 이번 자동화에서 수행하지 않았다. 해당 부분은 소스 경로 검토로만 평가했다.

## 개선 적용 및 재검증 (2026-07-13)

> 읽기 안내: 위의 결론, 우선순위, 41개 테스트 수치는 개선 전 초기 점검 기록이다. 원문 보존을 위해 수정하지 않았으며, 현재 상태는 이 절의 최종 재검증 결과를 기준으로 한다.

- 최종 상태: Resolved 19건 / Partially resolved 1건 / Open 0건
- 전체 회귀: Vitest 17개 파일, 128/128 통과
- 빌드/패키지: TypeScript + Vite + Electron 빌드와 Windows portable 패키징 성공
- 렌더러 QA: 필수 31/31 통과, 콘솔 경고·오류 0건, page error 0건, request failure 0건
- 패키지 Electron QA: 필수 16/16 통과, 콘솔 경고·오류 0건, page error 0건, request failure 0건
- Browser/Computer Use 플러그인은 사용할 수 없어 Playwright로 렌더러와 패키징 Electron을 직접 제어했다.

### HPT-001 해결 상태

- 상태: Resolved
- 구현: 문서·섹션·노드·셀 선택을 session reducer로 통합하고, 빈 선택은 이미 비어 있을 때 동일 참조를 반환하도록 안정화했다.
- 집중 테스트: editorSession.test.ts에서 빈 선택 참조 안정성, 삭제/Undo/Redo의 원자적 선택 복원을 검증했다.
- 렌더링/패키지 증거: 빈 앱을 2초 이상 유지한 Playwright 검사에서 maximum-depth/framework 경고, 오버레이, 콘솔 오류가 모두 0건이었다.
- 남는 제한: 2초 안정성 관찰과 회귀 테스트 범위이며 장시간 메모리 프로파일링은 수행하지 않았다.

### HPT-002 해결 상태

- 상태: Resolved
- 구현: Open, Drop, 문서 교체, 창 닫기에 저장 후 계속/변경 버리기/취소 guard를 공통 적용하고 Electron close를 one-shot 확인 흐름으로 연결했다.
- 집중 테스트: documentActions.test.ts 11개 테스트에서 취소 보존, 저장 실패, 백업 경고 확인, pending action 처리를 검증했다.
- 렌더링/패키지 증거: 렌더러에서 Save/Discard/Cancel 세 경로를 모두 통과했고, 패키지 창 닫기는 dirty 모달에서 취소 후 문서가 유지되고 최종 discard/confirm으로 정상 종료됐다.
- 남는 제한: 네이티브 OS Open/Save 파일 선택창 자체는 자동화하지 않았지만 메뉴, preload API, 실제 file-opened IPC와 native close는 패키지에서 확인했다.

### HPT-003 해결 상태

- 상태: Resolved
- 구현: 선택 섹션 삭제 시 다음 섹션, 없으면 이전 섹션과 첫 유효 노드를 같은 reducer 전이에서 선택하고 선택 상태를 Undo/Redo 이력에 포함했다.
- 집중 테스트: editorSession.test.ts에서 중간/마지막 섹션 삭제와 선택 포함 Undo/Redo를 검증했다.
- 렌더링/패키지 증거: 13개 중 중간 섹션을 삭제한 뒤 12개 문서, 인접 섹션 1개, 노드 1개, 활성 object chip 1개와 비어 있지 않은 Canvas가 일치했다.
- 남는 제한: 삭제는 확인창 없이 즉시 수행되며 사용자는 Undo로 되돌리는 방식이다.

### HPT-004 해결 상태

- 상태: Resolved
- 구현: 부모의 textContent 전체 교체 대신 직접 텍스트 토큰만 갱신해 중첩 요소, 링크, 속성, 주석과 순서를 보존하고 모호한 편집은 설명 가능한 no-op으로 처리했다.
- 집중 테스트: dataPreservation.test.ts에서 nested pill, 두 child subtree, 잘못된 토큰 순서, Properties/iframe 편집과 저장 재파싱을 검증했다.
- 렌더링/패키지 증거: 최종 128개 회귀와 승인 샘플 편집/Undo/Redo가 통과했으며 별도 중첩 마크업 보존은 component/serialization 테스트로 확인했다.
- 남는 제한: 자식 토큰의 상대 순서를 바꾸는 모호한 입력은 구조를 추측하지 않고 거부한다.

### HPT-005 해결 상태

- 상태: Resolved
- 구현: 기존 chart presentation과 caption을 Inspector 초기 상태로 읽고, caption 미변경과 사용자의 명시적 빈 값 삭제를 구분했다.
- 집중 테스트: dataPreservation.test.ts에서 caption 생성 후 Apply Chart 두 번, 기존 caption 유지, 명시적 삭제와 저장 재파싱을 검증했다.
- 렌더링/패키지 증거: 전체 회귀 128/128과 프로덕션 빌드가 통과했다. 이 항목의 반복 Apply 동작은 집중 component 테스트가 직접 검증한다.
- 남는 제한: HTMLpoint가 생성한 caption과 인접 chart 결합 규칙 범위에서 보장한다.

### HPT-006 해결 상태

- 상태: Resolved
- 구현: 효과 최초 적용 전에 원래 inline style을 보존하고 None에서 HTMLpoint 효과가 소유한 값만 제거한 뒤 원래 색상, 크기, 굵기, 행간을 복원한다.
- 집중 테스트: dataPreservation.test.ts에서 effect→None, 두 효과 연속 적용→None, 저장/재열기 후 원래 스타일 복원을 검증했다.
- 렌더링/패키지 증거: 전체 회귀 128/128과 패키지 빌드가 통과했으며 스타일 보존 결과는 직렬화 재파싱까지 비교했다.
- 남는 제한: 복원 보장은 HTMLpoint 효과가 기록·소유하는 style metadata 범위다.

### HPT-007 해결 상태

- 상태: Resolved
- 구현: editable header/section이 0개인 HTML은 성공 상태를 커밋하기 전에 명시적으로 거부하고 기존 문서를 유지한다.
- 집중 테스트: documentActions.test.ts에서 unsupported structure가 load/replace를 진행하지 않고 error 상태를 만드는지 검증했다.
- 렌더링/패키지 증거: 렌더러 QA에서 잘못된 import가 role=alert로 전달되고 성공 status와 분리되는 것을 확인했다.
- 남는 제한: 지원하지 않는 본문을 자동 단일 섹션으로 변환하지 않고 안내 후 거부하는 정책이다.

### HPT-008 해결 상태

- 상태: Resolved
- 구현: history entry에 report와 section/node/multi/cell selection을 함께 저장하고 유효성 정규화 후 복원한다.
- 집중 테스트: editorSession.test.ts에서 같은 이벤트의 편집, 삭제, cell selection에 대한 Undo/Redo 문맥 복원을 검증했다.
- 렌더링/패키지 증거: 렌더러 edit→Undo→Redo와 패키지 edit→Undo에서 동일 section/node ID와 원래 텍스트가 유지됐다.
- 남는 제한: 복원 대상 ID가 문서에서 사라진 경우에는 첫 유효 선택으로 정규화한다.

### HPT-009 해결 상태

- 상태: Resolved
- 구현: global row index를 소유 row group의 local index로 변환하고 선택 행의 next sibling 앞에 새 행을 삽입한다.
- 집중 테스트: tableStabilization.test.ts에서 tbody-only 첫/중간/마지막, thead 포함, multiple tbody와 stale index를 검증했다.
- 렌더링/패키지 증거: 표 집중 테스트와 전체 128개 회귀, 최종 build/package가 모두 통과했다.
- 남는 제한: 매우 복잡한 병합 표의 행 추가 결과는 문서별 시각 확인을 추가로 권장한다.

### HPT-010 해결 상태

- 상태: Resolved
- 구현: 표 Inspector가 모든 열과 페이지당 20행을 제공하고 Previous/Next, 전역 셀 좌표, 외부 선택에 맞춘 페이지 이동을 지원한다.
- 집중 테스트: tableStabilization.test.ts에서 20행 전체, 모든 열, 21행 이후, row 23 외부 선택과 페이지 왕복을 검증했다.
- 렌더링/패키지 증거: 관련 component 테스트와 전체 회귀 128/128이 통과했다.
- 남는 제한: 가상화 대신 페이지 방식을 사용하며 매우 넓은 표는 가로 스크롤이 필요하다.

### HPT-011 해결 상태

- 상태: Resolved
- 구현: 동작하지 않는 Text/Table/Image/Chart 가짜 탭을 선택 object kind를 설명하는 비대화형 표시로 교체했다.
- 집중 테스트: uiBehavior.test.ts에서 text/table/image, 빈 선택, mixed selection의 kind 표시와 비대화형 semantics를 검증했다.
- 렌더링/패키지 증거: 렌더러에서 표·이미지 삽입 직후 Properties kind가 각각 Table/Image로 바뀌고 새 object가 선택되는 것을 확인했다.
- 남는 제한: 속성 범주를 사용자가 임의 전환하는 기능은 제공하지 않는 설계다.

### HPT-012 해결 상태

- 상태: Resolved
- 구현: 삽입 결과의 새 node ID를 session reducer가 원자적으로 선택하고 cell state를 초기화하며 active chip reveal, 성공 status, Undo/Redo 이력을 함께 갱신한다.
- 집중 테스트: tableStabilization.test.ts에서 table/image 삽입 선택, constrained anchor, Undo/Redo, 80개 이후 active chip을 검증했다.
- 렌더링/패키지 증거: 렌더러에서 table과 image가 각각 즉시 선택·가시화되고 Table inserted/Image inserted polite status가 표시됐다.
- 남는 제한: 이미지 선택은 bridge stub으로 실행했으며 네이티브 이미지 파일 선택창 자체는 자동화하지 않았다.

### HPT-013 해결 상태

- 상태: Resolved
- 구현: 기본 Fit, ResizeObserver 기반 재계산, 50–100% clamp를 적용하고 수동 줌에서는 Fit을 해제하며 새 문서에서 다시 Fit으로 복귀한다.
- 집중 테스트: previewStabilization.test.ts에서 820/1120px의 68% 계산, observer lifecycle, load/reset/manual 전이를 검증했다.
- 렌더링/패키지 증거: 1440px에서 stage clientWidth/scrollWidth가 모두 820px였고 문서 가로 overflow 없이 Fit 68%, 수동 78%, Fit 복귀를 확인했다.
- 남는 제한: 최소 50% clamp 때문에 극단적으로 좁은 폭에서는 의도적으로 스크롤이 남을 수 있다.

### HPT-014 해결 상태

- 상태: Resolved
- 구현: 공용 portal Modal에 초기 focus, 양방향 Tab trap, Escape 닫기, background inert, trigger focus restore를 적용했다.
- 집중 테스트: documentActions.test.ts와 uiBehavior.test.ts에서 공용 Modal 및 실제 Review→Summary 통합을 검증했다.
- 렌더링/패키지 증거: Summary의 aria-modal, Close 초기 focus, Tab/Shift+Tab trap, Escape 후 Change summary trigger 복귀를 실제 Chromium에서 확인했다.
- 남는 제한: 실제 스크린리더의 음성 출력은 별도 AT로 검증하지 않았다.

### HPT-015 해결 상태

- 상태: Partially resolved
- 구현: Save As 성공 경로를 fileName과 sourcePath 및 history checkpoint에 함께 반영해 이후 backup 기준이 새 파일 경로를 따르도록 수정했다.
- 집중 테스트: documentActions.test.ts와 editorSession.test.ts에서 새 sourcePath, 저장 checkpoint, 후속 편집과 backup warning을 검증했다.
- 렌더링/패키지 증거: 렌더러의 Save then continue 직렬화와 패키지의 save/preload API 노출은 통과했다.
- 남는 제한: 네이티브 Save As 파일 선택창에서 새 폴더에 실제 저장하고 5초 뒤 그 폴더에 backup 파일이 생기는 end-to-end 흐름은 자동화하지 못했다.

### HPT-016 해결 상태

- 상태: Resolved
- 구현: 저장 HTML을 바꾸지 않는 preview 전용 token base와 root/realpath 제한 custom protocol을 추가했고, CSP는 해당 scheme을 image/style/font/media에만 허용했다. 썸네일은 잘못된 app.asar/file 요청을 만들 수 있는 비메모리 src/srcset을 중립화한다.
- 집중 테스트: previewStabilization.test.ts, previewProtocol.test.ts, packagingConfig.test.ts에서 base 분리, 저장 원문 불변, traversal/symlink/race/owner cleanup, CSP 제한, srcset/NBSP 경계를 검증했다.
- 렌더링/패키지 증거: 공백 포함 실제 폴더의 상대 CSS, PNG, CSS background image가 packaged Electron에서 htmlpoint-asset URL로 로드됐고 stylesheet/image 응답은 200, request failure와 console error는 0건이었다.
- 남는 제한: 썸네일은 안전한 data/blob 자산만 직접 표시하며 상대 자산의 완전한 fidelity는 main Canvas에서 제공한다.

### HPT-017 해결 상태

- 상태: Resolved
- 구현: logical occupancy map으로 rowspan×colspan이 점유한 사각형을 계산하고 Unmerge 시 영향 받는 각 행에 빠진 셀을 복원한다.
- 집중 테스트: tableStabilization.test.ts에서 rowspan, rowspan+colspan, rowspan=0, tbody 경계와 복원 좌표를 검증했다.
- 렌더링/패키지 증거: 표 집중 테스트와 전체 회귀 128/128, 최종 build/package가 통과했다.
- 남는 제한: 원본에 존재하지 않았던 복원 셀의 내용은 빈 셀로 생성된다.

### HPT-018 해결 상태

- 상태: Resolved
- 구현: status/error를 명시적 discriminant로 관리하고 성공·취소는 polite status, 실패는 alert로 분리했으며 Open/Save/backup 및 Electron operation-error를 사용자 메시지로 전달한다.
- 집중 테스트: uiBehavior.test.ts와 documentActions.test.ts에서 role, aria-live, 취소 status, 저장 실패, backup warning과 modal 오류를 검증했다.
- 렌더링/패키지 증거: 렌더러에서 성공 status와 import alert가 올바른 role로 노출됐고, 패키지 preload의 onOperationError를 포함한 12개 API가 존재했으며 최종 실행 오류는 0건이었다.
- 남는 제한: 실제 스크린리더 발화와 모든 OS 파일 오류 조합은 수동 AT/장애 주입으로 추가 검증할 수 있다.

### HPT-019 해결 상태

- 상태: Resolved
- 구현: 1100px 미만에서 명시적 가로 접근 경로와 Sections/Properties 접기·펼치기 컨트롤을 제공한다.
- 집중 테스트: previewStabilization.test.ts에서 두 패널의 label, aria-expanded, class/display 전이를 검증했다.
- 렌더링/패키지 증거: 1024×768에서 documentScrollWidth 1100px와 body overflow-x auto를 확인했고 가로 이동 후 Properties가 viewport 안에 들어오며 두 패널 collapse/restore가 모두 동작했다.
- 남는 제한: Electron의 현재 minWidth는 1180px이므로 1024px 검증은 웹 renderer viewport 기준이다.

### HPT-020 해결 상태

- 상태: Resolved
- 구현: 첫/마지막/단일 섹션의 경계 명령을 disabled 처리하고 Hide/Show 설명을 상태에 맞추며 Ribbon tab semantics/키보드 이동과 줌 accessible name을 추가했다.
- 집중 테스트: uiBehavior.test.ts 22개 테스트에서 command boundary, visibility label/state, tablist Arrow/Home/End, Properties semantics, 줌 이름을 검증했다.
- 렌더링/패키지 증거: uiBehavior component 검사와 Chromium DOM/accessibility assertion에서 경계 명령, Fit/줌 이름, 선택 kind와 modal focus 상태를 확인했고 renderer 필수 31/31이 통과했다.
- 남는 제한: 실제 키보드 보조기기와 스크린리더 조합별 발화는 별도 수동 접근성 검증 대상이다.

## 최종 증거 위치

- 렌더러 결과: D:\LGES_Backup\AI_Driven\htmlpoint-audit\results\post-fix-qa.json
- 패키지 결과: D:\LGES_Backup\AI_Driven\htmlpoint-audit\results\post-fix-electron-qa.json
- 스크린샷: D:\LGES_Backup\AI_Driven\htmlpoint-audit\results\post-fix-*.png
- 상세 검증 보고서: D:\LGES_Backup\AI_Driven\htmlpoint-audit\sdd\task-7-report.md

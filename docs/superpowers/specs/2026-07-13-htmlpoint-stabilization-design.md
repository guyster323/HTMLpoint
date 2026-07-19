# HTMLpoint 안정화 설계

## 목적

`findings.md`의 20개 항목을 해결해 HTMLpoint를 실사용 가능한 오프라인 HTML 보고서 편집기로 안정화한다. 기존 PowerPoint형 외관, 승인 샘플 호환성, Electron 패키징 방식, 저장 HTML의 원본 CSS·script 보존은 유지한다.

## 범위

이번 개선은 다음 네 영역을 포함한다.

1. 문서와 사용자 작업의 데이터 안전성
2. 텍스트·차트·표·섹션 편집 정확성
3. 상태 피드백·키보드·접근성·레이아웃 사용성
4. 회귀 테스트와 패키징 Electron 검증

새로운 문서 형식, 온라인 동기화, 협업, 계정, 클라우드 저장, 전면적인 시각 재설계는 포함하지 않는다.

## 설계 원칙

- 기존 UI의 시각 언어와 주요 배치를 유지한다.
- HTML 직렬화는 원본 `<style>`, `<script>`, 번역 데이터와 지원 샘플의 구조를 보존한다.
- 사용자 작업을 소리 없이 버리거나 원본 서식을 파괴하지 않는다.
- 화면에서 버튼처럼 보이는 요소는 실제 동작하거나 버튼이 아닌 표시 요소여야 한다.
- 모든 상태 전이는 순수 헬퍼로 먼저 표현하고 Vitest 회귀 테스트를 작성한다.
- 렌더링과 상호작용은 Playwright로 검증하고 패키징 Electron에서 최종 smoke test를 수행한다.
- 새 런타임 의존성은 추가하지 않는다.

## 접근 방식

대규모 재작성 대신 점진적 안정화를 적용한다. 현재 컴포넌트 구조는 유지하되 `App.tsx`에 섞여 있는 선택·히스토리·문서 교체 결정을 작은 순수 헬퍼로 분리한다. `editing.ts`의 DOM 변경 연산은 기존 인터페이스를 가능한 한 유지하면서 데이터 보존 규칙을 강화한다.

이 방식은 단순 조건문 패치보다 회귀 위험을 낮추고, 전면 재구성보다 승인 샘플과 직렬화 호환성을 지키기 쉽다.

## 아키텍처

### 1. 편집 세션 상태

문서 상태와 선택 상태를 함께 다루는 세션 스냅샷을 도입한다.

```ts
interface EditorSelection {
  sectionId?: string;
  nodeId?: string;
  nodeIds: string[];
  cell: { row: number; cell: number };
}

interface EditorHistoryEntry {
  report: ReportDocument;
  selection: EditorSelection;
}
```

Undo/Redo 히스토리는 `ReportDocument`만 저장하지 않고 선택 스냅샷도 함께 저장한다. 복원 시 동일 section/node가 존재하면 유지하고, 존재하지 않으면 인접 섹션과 첫 편집 노드로 안전하게 보정한다.

선택 보정은 React effect가 아니라 순수 함수로 수행한다.

```ts
normalizeSelection(report, selection, preferredSectionIndex?): EditorSelection
```

보고서가 없고 선택도 이미 비어 있으면 동일 상태 객체를 반환한다. 이 규칙으로 빈 화면의 무한 렌더 루프를 제거한다.

### 2. 문서 교체와 미저장 변경 보호

Open, drag-and-drop, Electron menu open, 창 닫기 전에 동일한 dirty guard를 사용한다.

- 현재 문서가 clean이면 즉시 진행한다.
- dirty이면 인앱 확인 대화상자를 연다.
- 선택지는 `저장 후 계속`, `변경 버리기`, `취소`다.
- 저장이 취소되거나 실패하면 문서 교체/종료도 취소한다.
- Electron `beforeunload` 또는 main/renderer IPC를 이용해 창 닫기에도 같은 결정을 적용한다.

문서 교체 요청은 pending 상태로 보관한다.

```ts
type PendingDocumentAction =
  | { type: 'open-file'; opened: OpenedHtmlFile }
  | { type: 'drop-file'; file: File }
  | { type: 'close-window' };
```

브라우저 fallback과 Electron 모두 동일한 인앱 흐름을 사용한다.

### 3. 편집 연산의 데이터 보존

#### 리치 텍스트

자식 element를 포함한 부모 텍스트 노드는 일반 텍스트 치환 대상으로 노출하지 않는다. 기본 규칙은 가장 깊은 편집 가능 텍스트 요소만 선택하는 것이다. 부모 요소를 선택해야 하는 경우에는 직접 텍스트 노드만 교체하고 자식 element는 보존한다.

텍스트 편집 함수는 다음을 보장한다.

- `<strong>`, `<a>`, `<span>`, `<em>` 같은 자식 element 보존
- 선택한 leaf element의 텍스트는 정상 변경
- 번역 연결 selector 보존
- 빈 텍스트 입력도 명시적인 사용자 변경으로 처리

#### Text Effect

효과는 원본 inline typography를 직접 덮어쓰지 않고 `data-htmlpoint-effect`와 효과 전용 CSS custom property/class로 표현한다. `None`은 효과 전용 속성만 제거한다. 기존 `color`, `font-size`, `font-weight`, `line-height`는 보존한다.

#### Chart

차트 Inspector는 현재 캡션, width, height, frame, align을 실제 DOM에서 읽어 초기화한다. 적용 시 사용자가 변경하지 않은 속성은 유지한다. 연속 적용에도 캡션이 사라지지 않아야 한다.

#### Table

- 새 행은 선택 행 바로 다음에 삽입한다.
- thead/tbody/tfoot의 로컬 인덱스를 명시적으로 계산한다.
- rowspan 해제는 영향받은 각 행에 빠진 셀을 복원한다.
- 12×8 미니 표 제한을 없애고 전체 셀을 스크롤 가능한 grid에서 선택한다.
- 매우 큰 표에서도 DOM 전체를 한 번에 과도하게 렌더링하지 않도록 행 단위 페이지 또는 가상 범위를 사용한다. 현재 범위에서는 단순 페이지 방식으로 20행 단위 탐색을 제공한다.

### 4. 섹션과 삽입 개체 흐름

섹션 삭제는 현재 인덱스를 기준으로 다음 섹션, 없으면 이전 섹션을 선택한다. 마지막 한 섹션은 Delete를 disabled 처리한다. 삭제 직후 인접 섹션의 첫 노드와 첫 셀을 선택한다.

Up/Down은 경계에서 disabled 처리한다. Hide 명령은 현재 상태에 따라 `Hide`/`Show`로 바뀌고 `aria-pressed`를 노출한다.

표/이미지 삽입 함수는 새 node ID를 포함한 결과를 반환한다.

```ts
interface EditResult {
  report: ReportDocument;
  insertedNodeId?: string;
}
```

삽입 후 새 개체를 선택하고 캔버스/Objects strip에서 보이도록 스크롤한다. 상태 영역에 완료 메시지를 표시한다.

### 5. Properties와 명령 UI

Properties 상단의 Text/Table/Image/Chart는 수동 탭이 아니라 현재 선택 개체 종류를 알려 주는 상태 표시로 바꾼다. 버튼 외형을 제거하고 `role="status"` 또는 읽기 가능한 label을 사용한다. 선택 개체 종류 전환은 `Selected object` combobox로 수행한다.

Ribbon 탭은 `tablist`, `tab`, `aria-selected`, 연결된 `tabpanel` 의미를 갖는다. 줌 축소/확대/range에 접근 가능한 이름을 추가한다.

하단 메시지 영역은 `role="status" aria-live="polite"`를 사용한다. 오류는 `role="alert"`를 사용하고 가능한 경우 재시도 동작을 제공한다.

### 6. 모달과 키보드

공통 Modal 컴포넌트를 도입해 변경 요약과 미저장 변경 확인에 사용한다.

- 열릴 때 첫 의미 있는 버튼으로 포커스 이동
- Tab/Shift+Tab 포커스 순환
- Escape로 취소/닫기
- 배경 `inert` 또는 상응하는 포커스 차단
- 닫힌 뒤 호출 버튼으로 포커스 복원

Canvas의 직접 선택은 기존 포인터 방식을 유지하면서 Objects strip과 Properties combobox를 공식 키보드 대체 경로로 명시한다. preview node에 무차별적으로 tab stop을 추가해 수백 개 포커스가 생기지 않도록 한다.

### 7. 줌과 레이아웃

초기 줌은 고정 100%가 아니라 `Fit`으로 계산한다.

```ts
fitZoom = clamp(floor((canvasWidth - padding * 2) / 1120 * 100), 50, 100)
```

사용자가 줌을 수동 변경하면 해당 문서 세션에서는 자동 Fit을 중지한다. Status bar에 `Fit` 버튼과 현재 배율을 제공한다.

Electron 최소 폭 1180px은 유지한다. 1100px 이하 웹 viewport에서는 좌우 패널을 접을 수 있게 하고 body 전체가 잘리는 대신 workspace가 안전하게 스크롤되도록 한다.

### 8. 파일 경로, 자산과 백업

Save As 성공 시 `fileName`뿐 아니라 `sourcePath`도 새 경로로 갱신한다. 이후 자동 백업은 새 파일 옆에 생성한다.

상대경로 자산은 다음 정책을 사용한다.

- Electron에서 원본 HTML을 열 때 source directory를 안전한 file base로 preview에 전달한다.
- 저장 HTML 자체에 편집기 전용 `<base>`를 영구 삽입하지 않는다.
- preview에만 임시 base를 삽입하고 serializer에서 제거한다.
- 외부 http/https 자산은 기존 오프라인 guard 정책대로 차단한다.

Open, Save, backup 오류는 사용자 메시지로 전달한다. 백업 실패는 작업을 막지 않지만 경고 상태와 재시도 가능 여부를 표시한다.

### 9. 지원하지 않는 HTML 구조

파싱 결과 section이 0개이면 성공으로 로드하지 않는다. 사용자에게 다음 안내를 제공한다.

> 편집 가능한 `<header>` 또는 `<section>`을 찾지 못했습니다.

이번 범위에서는 자동으로 `<main>`을 section으로 변환하지 않는다. 원본 구조를 임의로 바꾸는 것보다 명시적 실패가 안전하다.

## 오류 처리

- 사용자 취소는 오류가 아니며 기존 문서와 상태를 유지한다.
- 파싱 오류와 지원 구조 없음은 문서 교체 전에 검증한다.
- 저장 실패 시 dirty 상태를 유지하고 pending action을 실행하지 않는다.
- 백업 실패는 warning으로 표시하되 현재 편집을 유지한다.
- 편집 연산이 대상 node/section을 찾지 못하면 report를 변경하지 않고 사용자에게 실패 메시지를 표시한다.
- 모든 비동기 이벤트 handler는 처리되지 않은 rejection을 남기지 않는다.

## 테스트 전략

### Vitest 단위/회귀 테스트

- 빈 report/selection 정규화가 동일 참조를 유지하는지
- 삭제 후 다음/이전 section 선택
- Undo/Redo가 section/node/cell 선택 복원
- 중첩 마크업 텍스트 편집 보존
- Effect None이 원래 typography 보존
- 차트 캡션 연속 적용 보존
- tbody 첫/중간/마지막 행 삽입 순서
- rowspan/colspan 해제 구조
- 13×9 표의 모든 셀 접근
- Save As 후 sourcePath 갱신
- section 0개 문서 거부
- 상대경로 preview base가 serializer에 유출되지 않음

### Playwright 렌더링 테스트

- 빈 앱 2초 동안 console error/warning 없음
- 샘플 로드 → 텍스트 편집 → Undo → 원래 section 유지
- dirty 문서 → 다른 파일 드롭 → 취소/버리기/저장 흐름
- section 삭제 → 인접 section 선택과 정상 캔버스
- Insert Table → 새 table 자동 선택
- Properties 종류 표시가 무반응 버튼이 아님
- 변경 요약/dirty modal 포커스, Escape, focus restore
- Fit zoom에서 1440px 기본 화면 가로 스크롤 최소화
- 1180px Electron 최소 폭과 1024px 웹 fallback
- console health, framework overlay, screenshot evidence

### 패키징 검증

- `npm test`
- `npm run build`
- `release/win-unpacked/HTMLpoint.exe` 실행
- preload API 존재
- 승인 샘플 4개 parse/serialize
- 대표 샘플 13개 section 렌더링

## Finding 추적표

| Finding | 설계 처리 |
|---|---|
| HPT-001 | 선택 정규화와 effect 제거 |
| HPT-002 | dirty guard와 pending action |
| HPT-003 | 삭제 후 인접 선택 |
| HPT-004 | leaf/direct text 편집 |
| HPT-005 | 차트 설정 DOM 초기화 |
| HPT-006 | 효과 전용 속성 제거 |
| HPT-007 | section 0개 로드 거부 |
| HPT-008 | 히스토리에 선택 스냅샷 저장 |
| HPT-009 | tbody 인덱스 수정 |
| HPT-010 | 표 페이지 탐색 |
| HPT-011 | Properties 종류 표시로 변경 |
| HPT-012 | 삽입 결과 node ID와 자동 선택 |
| HPT-013 | Fit zoom |
| HPT-014 | 공통 접근성 Modal |
| HPT-015 | Save As sourcePath 갱신 |
| HPT-016 | preview 전용 base URL |
| HPT-017 | rowspan 복원 알고리즘 |
| HPT-018 | 오류/상태 live region |
| HPT-019 | 소형 viewport panel fallback |
| HPT-020 | 명령 상태와 접근 가능한 이름 |

## 완료 기준

- `findings.md`의 HPT-001~HPT-020 각각에 구현 또는 명시적으로 검증된 비적용 사유가 있다.
- 새 회귀 테스트가 원래 문제에서 실패하고 구현 후 통과한다.
- 기존 41개 테스트와 새 테스트가 모두 통과한다.
- TypeScript/Vite/Electron 빌드가 통과한다.
- Playwright에서 빈 화면 console health, 핵심 편집 흐름, 모달, Fit zoom을 검증한다.
- 패키징 Electron에서 preload와 대표 샘플 로드가 통과한다.
- 원본 승인 샘플의 CSS, script, 번역 데이터가 직렬화 후 보존된다.

## 구현 순서

1. 세션 선택/히스토리와 무한 렌더 제거
2. dirty guard와 문서 교체/닫기 보호
3. 리치 텍스트, Effect, Chart 데이터 보존
4. section/table/insert 연산 정확성
5. Properties/Ribbon/Modal/상태 접근성
6. Fit zoom, panel fallback, 상대경로/백업 경로
7. 전체 Playwright와 패키징 Electron 회귀 검증

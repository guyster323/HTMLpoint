# HTMLpoint 핵심 사양 검증 및 개선 계획

- 작성일: 2026-07-19
- 대상: HTMLpoint 0.1.0 Windows x64
- 상태: 검증 완료, 개선 착수 전
- 최종 판단: 기본 편집 안정성과 저장 안전장치는 동작하지만, 상대 자산이 있는 문서의 Drop 및 다른 폴더 Save As는 핵심 사양을 충족하지 못한다. 5.4MB 승인 샘플의 유의미한 첫 화면도 약 20초가 걸려 사용성 개선이 필요하다.

## 1. 검증 방식과 한계

요청한 `computer-use` 스킬의 지침은 확인했다. 지침에 따라 실행 파일을 선택하면 이 Windows 환경에서는 `orca`여야 하지만, `ORCA_CLI_COMMAND`와 `ORCA_DEV_REPO_ROOT`가 비어 있고 `Get-Command orca`도 실행 파일을 찾지 못했다. 따라서 Orca의 접근성 트리 기반 조작은 실행할 수 없었다.

대신 다음 범위는 실제 렌더러와 패키지 Electron 앱을 Playwright로 구동하고 클릭·편집·드롭·IPC·디스크 결과·스크린샷을 확인했다.

- 렌더러: Vite preview의 실제 UI 조작
- 데스크톱 패키지: `release/win-unpacked/HTMLpoint.exe` 실제 실행
- 파일 수명주기: 임시 폴더에 실제 HTML, `.bak`, `.autosave` 생성 후 내용 검사
- 상대 자산: 같은 fixture를 Drop과 native-open IPC로 각각 열어 CSS/image 결과 비교
- 시각 확인: 빈 상태, 대용량 샘플, 1024px, Save As 후 깨진 자산을 스크린샷으로 확인

Save As 경로 선택은 운영체제 대화상자 자체를 자동 클릭하지 않고 Electron main의 대화상자 반환값만 임시 경로로 대체했다. 그 뒤의 제품 코드인 파일 쓰기, overwrite backup, autosave, sourcePath 변경, preview protocol은 실제로 실행했다. Windows 파일 대화상자의 키보드/스크린리더 동작은 Orca CLI가 준비된 환경에서 별도 수동 게이트가 필요하다.

## 2. 이번에 직접 확인한 결과

| 검증 항목 | 결과 | 판정 |
|---|---:|---|
| Vitest | 17 files, 128/128 통과 | PASS |
| TypeScript/Vite/Electron build | exit 0 | PASS |
| 렌더러 필수 UI 시나리오 | 31/31 통과, console/page/request 오류 0 | PASS |
| 패키지 Electron 필수 시나리오 | 16/16 통과, custom protocol 응답 4건 정상 | PASS |
| 대용량 승인 샘플 5,425,538 bytes | shell 11,332ms, main preview 19,591ms, 첫 thumbnail 19,811ms | FAIL, 체감 성능 |
| 상대 자산 native Open | CSS 7px border, image naturalWidth 1, protocol 200, 오류 0 | PASS |
| 같은 파일 Drop | sourcePath/base 없음, CSS 미적용, image naturalWidth 0, 요청 실패 2건 | FAIL, 핵심 사양 |
| 새 경로 Save As | 실제 HTML 생성 및 편집 marker 보존 | PASS |
| overwrite backup | `.bak.html` 1개, 기존 sentinel 보존 | PASS |
| 5초 autosave | `.autosave.html` 1개, 저장 전·후 marker 모두 보존 | PASS |
| 다른 폴더 Save As 후 상대 자산 | CSS 404, image 404/naturalWidth 0 | FAIL, 핵심 사양 |
| Portable wrapper | artifact 존재와 hash만 확인, 직접 실행하지 않음 | 미검증 |

이번에 사용한 패키지 EXE는 마지막 production source 변경 뒤 약 4분 후 생성되어 현재 소스와 시점상 일치한다. 다만 `npm run build`는 release를 다시 package하지 않으므로, 이후 QA가 오래된 EXE를 잘못 검사하지 않도록 freshness gate가 필요하다.

### 증거 파일

- 렌더러 결과: `D:/LGES_Backup/AI_Driven/htmlpoint-audit/results/post-fix-qa.json`
- 패키지 결과: `D:/LGES_Backup/AI_Driven/htmlpoint-audit/results/post-fix-electron-qa.json`
- Drop/Open 비교와 성능: `D:/LGES_Backup/AI_Driven/htmlpoint-audit/results/spec-validation-2026-07-19.json`
- Save/backup/Save As 비교: `D:/LGES_Backup/AI_Driven/htmlpoint-audit/results/save-backup-validation-2026-07-19.json`
- Save As 후 자산 누락 화면: `D:/LGES_Backup/AI_Driven/htmlpoint-audit/results/save-backup-validation-2026-07-19.png`

## 3. 핵심 사양 판정표

| ID | 핵심 사양 | 현재 판정 | 근거 또는 공백 |
|---|---|---|---|
| CORE-01 | `.html/.htm` Open/Drop이 같은 문서와 자산을 연다 | FAIL | Drop payload에는 `filePath`가 없어 상대 자산 base를 만들지 못함 |
| CORE-02 | 원본 DOM/CSS/script/번역과 의도한 편집만 보존한다 | PARTIAL | 단위 회귀는 강함. serializer warning이 Save/autosave에서 폐기됨 |
| CORE-03 | 선택·히스토리·Undo/Redo가 함께 복원된다 | PARTIAL | Ribbon 편집은 통과. `Ctrl+Z/Y`와 Electron Edit 메뉴 연동은 미검증 |
| CORE-04 | Save As, overwrite backup, autosave, dirty guard가 데이터 손실 없이 동작한다 | PARTIAL | 저장·backup은 통과. 폴더 이동 시 상대 자산이 조용히 깨짐 |
| CORE-05 | 상대 CSS/image/font/media가 offline package에서 원본 기준으로 열린다 | FAIL | native Open만 통과. Drop과 이동 Save As 실패 |
| CORE-06 | 승인 샘플을 실사용 가능한 시간 안에 표시한다 | FAIL | 5.4MB 파일의 유의미한 main preview가 19.6초 |
| CORE-07 | Win-unpacked와 portable이 동일하게 offline 동작한다 | PARTIAL | win-unpacked만 직접 실행. portable wrapper 실행 미검증 |
| CORE-08 | 1024px 및 키보드 사용자도 핵심 기능에 즉시 접근한다 | PARTIAL | 도달은 가능하나 전체 페이지 가로 스크롤, 초기 버튼/패널 잘림 |

## 4. 확정 결함과 원인

### P0-01. Drop이 sourcePath를 잃어 상대 자산이 깨짐

`src/lib/dropImport.ts`의 `acceptDroppedHtmlFile()`은 `fileName`과 `html`만 반환한다. 반면 `src/components/Canvas.tsx`는 `report.sourcePath`가 있을 때만 source-directory base를 등록한다. 따라서 native Open은 `htmlpoint-asset://` protocol로 CSS/image를 200 응답하지만 Drop은 app.asar의 `dist` 아래를 찾다가 차단된다.

사용자 영향: 같은 파일인데 Open 버튼으로 열면 정상이고 드롭하면 디자인과 이미지가 사라진다. 화면은 문서가 열린 것으로 표시하므로 손상 여부를 놓치기 쉽다.

### P0-02. 다른 폴더 Save As가 상대 자산을 조용히 분리함

`src/lib/fileServices.ts`와 `electron/main.ts`는 HTML 한 파일만 기록한다. Save 성공 뒤 `src/lib/documentActions.ts`가 `sourcePath`를 새 HTML 경로로 바꾸므로 preview는 새 폴더에서 기존 상대 CSS/image를 찾는다. 자산은 복사되지 않아 404가 발생한다.

사용자 영향: 저장 성공 메시지와 `.bak`/`.autosave`는 정상인데 결과 보고서의 스타일과 이미지가 깨진다. 데이터 안전성 관점에서 가장 먼저 막아야 한다.

### P0-03. 직렬화 손실 경고가 저장 경로에서 사라짐

`serializeReportHtml()`은 `warnings[]`를 반환하지만 `saveAsHtml()`과 `createAutoBackup()`은 `html`만 사용한다. 손실 가능성이 있어도 UI가 `Saved`로 끝날 수 있다.

### P1-01. 대용량 샘플의 준비 상태가 너무 늦고 성공 표시가 이르다

shell이 문서를 인식하는 데 11.3초, 실제 main preview가 의미 있는 내용을 보이는 데 19.6초가 걸렸다. shell 준비 뒤에도 약 8.3초 동안 미리보기가 비어 있을 수 있으며 명확한 단계별 진행 표시가 없다. 기존 패키지 QA도 너무 일찍 screenshot을 찍어 빈 preview를 정상처럼 기록했다.

### P1-02. 배포물 진위와 실제 portable 실행이 자동 보장되지 않음

현재 `package`는 build와 electron-builder를 연결하지만 E2E 스크립트는 저장소 밖에 있고 win-unpacked 경로를 직접 사용한다. QA 직전 package 여부, portable wrapper 기동, build ID는 gate가 아니다.

### P1-03. 편집 단축키와 고급 편집의 실제 Canvas 왕복이 비어 있음

Electron 메뉴는 native `role: 'undo'/'redo'`이고 앱 session Undo/Redo와 연결된 증거가 없다. 표·차트·이미지의 순수 함수 테스트는 풍부하지만 실제 iframe 클릭/더블클릭/resize/postMessage 및 전체 UI 조작 매트릭스는 부족하다.

### P2-01. 빈 상태와 좁은 화면이 오해와 탐색 비용을 만듦

문서가 없을 때 상단/하단이 `Saved`로 보인다. `Save As HTML` 접근성 이름이 같은 버튼이 둘이며, 1024px에서는 최소 1100px shell 때문에 전체 페이지 가로 스크롤이 생긴다. Properties와 주요 저장 동작이 첫 화면에서 잘릴 수 있다.

## 5. 개선 실행 계획

각 작업은 먼저 실패하는 자동화 시나리오를 추가하고, 구현 뒤 해당 시나리오와 전체 128개 회귀를 통과시키는 순서로 진행한다.

### 단계 A — P0 데이터·자산 안전성

#### A1. Open/Drop 동등성 확보

대상 파일:

- `electron/preload.cts`
- `electron/main.ts`
- `src/lib/dropImport.ts`
- `src/lib/fileServices.ts`
- `src/types/electron.d.ts`
- `tests/dropImport.test.ts`
- 신규 `tests/e2e/drop-open-parity.spec.ts`

구현 방향:

1. preload에서 Electron `webUtils.getPathForFile(file)`로 실제 드롭된 `File`의 경로를 얻는다. renderer가 임의 문자열 경로를 신뢰 경로로 만들지 않도록 실제 `File`을 입력으로 받는 좁은 API만 노출한다.
2. main에서 확장자, 존재 여부, regular file, canonical realpath를 다시 검증한다. preview root token은 canonical source directory에만 발급한다.
3. Drop 결과에도 native Open과 동일한 `filePath/sourcePath`를 넣는다.
4. 경로를 얻을 수 없는 브라우저 실행에서는 상대 자산 참조 유무를 검사한다. 상대 자산이 있으면 “Open 버튼으로 열어야 자산을 보존할 수 있음”을 명시하고 조용히 성공하지 않는다.

수용 기준:

- 공백·한글이 포함된 같은 fixture를 Open/Drop했을 때 computed style, image naturalWidth, background image가 동일하다.
- Drop 뒤 `sourcePath`가 canonical HTML 경로이고 custom protocol CSS/image가 모두 200이다.
- console error, page error, request failure가 0이다.
- `.txt`, 위조 확장자, directory, source root 밖 traversal/symlink가 거부된다.
- Drop한 문서도 dirty guard와 autosave 정책을 적용받는다.

#### A2. relocation-safe Save As 도입

대상 파일:

- `src/lib/htmlSerializer.ts`
- 신규 `src/lib/assetDependencies.ts`
- `src/lib/fileServices.ts`
- `src/lib/documentActions.ts`
- `electron/main.ts`
- `electron/preload.cts`
- `src/App.tsx`
- 신규 `tests/assetDependencies.test.ts`
- 신규 `tests/e2e/save-as-relocation.spec.ts`

구현 방향:

1. HTML의 `src`, `href`, `poster`, `srcset`과 CSS `url()`에서 상대 의존성을 수집한다. `data:`, `blob:`, `http(s):`, fragment는 제외한다.
2. 1차 안전장치로, 상대 의존성이 있는 문서를 다른 directory에 저장할 때 무조건 성공 처리하지 않는다. 기본 동작은 “자산과 함께 저장”으로 하고 “HTML만 저장”은 깨질 수 있는 파일 목록을 보여 준 뒤 명시 확인을 받는다. Cancel은 현재 sourcePath와 clean checkpoint를 변경하지 않는다.
3. 자산과 함께 저장은 canonical source root 안의 의존 파일만 상대 tree를 유지해 복사한다. CSS 안의 중첩 `url()`도 재귀 수집한다. traversal·symlink escape는 거부한다.
4. HTML과 자산은 임시 경로에 먼저 기록한 뒤 rename하는 방식으로 실패 시 부분 저장을 피한다. 기존 대상 덮어쓰기 전 `.bak` 정책은 유지한다.
5. 복사 충돌·누락·권한 오류는 어떤 파일에서 실패했는지 보여 주고 `sourcePath`를 새 경로로 바꾸지 않는다.

수용 기준:

- 현재 실패 fixture를 다른 폴더로 Save As한 직후와 앱 재기동/재열기 뒤 CSS/image가 모두 정상이다.
- 원본 자산, 저장된 자산, 원본 HTML은 변경되지 않는다.
- 누락 자산, 읽기 전용 대상, 중간 복사 실패에서 성공 메시지가 나오지 않고 clean checkpoint가 갱신되지 않는다.
- 같은 폴더 Save As와 자산이 모두 inline인 문서는 추가 질문 없이 기존 흐름을 유지한다.
- `.bak`와 5초 `.autosave`가 새 HTML 옆 backup directory에 계속 생성된다.

#### A3. serializer warning을 저장 계약에 포함

대상 파일:

- `src/lib/fileServices.ts`
- `src/App.tsx`
- `src/types/htmlpoint.ts`
- `tests/documentActions.test.ts`
- `tests/dataPreservation.test.ts`

구현 방향:

1. `serializeReportHtml().warnings`를 Save 결과와 autosave 결과에 포함한다.
2. 저장 손실 가능성이 있는 warning은 저장 전 상세 확인 또는 차단으로 처리한다. warning을 확인하지 않은 저장은 `Saved` 상태가 될 수 없다.
3. autosave warning은 status live region과 진단 로그에 남기되 자동백업 루프를 무한 재시도하지 않는다.
4. save 후 다시 parse하여 원본 허용목록 diff와 의도한 편집 diff만 존재하는지 검사하는 E2E를 추가한다.

수용 기준:

- warning이 있는 fixture는 warning 내용과 영향 section을 표시한다.
- Cancel 시 디스크, sourcePath, dirty 상태가 유지된다.
- 승인 후 저장한 결과는 재열기와 DOM diff를 통과한다.

### 단계 B — P1 로딩 성능과 상태 진실성

#### B1. 대용량 문서 로딩 계측과 active-first 렌더링

대상 파일:

- `src/App.tsx`
- `src/components/Canvas.tsx`
- `src/components/SectionRail.tsx`
- `src/lib/htmlParser.ts`
- `src/lib/preview.ts`
- `src/styles.css`
- 신규 `tests/e2e/large-sample-performance.spec.ts`

구현 방향:

1. `read`, `parse`, `session commit`, `active preview load`, `thumbnail ready` performance mark를 남긴다.
2. active section preview를 먼저 만들고 첫 화면 밖 thumbnail iframe은 `IntersectionObserver`로 지연 생성한다. thumbnail은 현재 화면에 필요한 소수만 유지한다.
3. parser/serializer의 중복 DOM 생성과 section별 전체 문서 재직렬화를 계측해 cache 또는 precomputed fragment로 줄인다.
4. `Reading → Parsing → Rendering section 1 → Building thumbnails` 단계와 취소 가능한 progress UI를 제공한다.
5. 문서 제목의 성공 상태는 active preview의 load/ready 신호 뒤에만 표시한다. shell만 준비된 상태는 `Loading`으로 유지한다.

동일 QA 머신의 5.4MB 승인 샘플 수용 기준:

- shell interaction 가능: 3초 이내
- active preview 의미 있는 내용: 6초 이내
- 첫 thumbnail: 8초 이내
- main thread 1초 이상 연속 정지 없음
- 측정 시작·종료 조건을 JSON에 기록하고 3회 median으로 판정
- 로딩 중 빈 흰 화면만 보이지 않고 진행 단계와 Cancel이 보임

#### B2. 성능 회귀와 장시간 안정성

- 승인 샘플 4종의 크기·section/object 수·read/parse/render 시간을 baseline JSON으로 관리한다.
- 대표 샘플에서 편집 50회, Undo/Redo 40회, autosave 10회 뒤 메모리와 응답성을 측정한다.
- console warning/error와 모든 request failure를 필수 실패로 취급한다.

### 단계 C — P1 핵심 편집 완결성

#### C1. 앱 session Undo/Redo를 모든 입력 경로에 연결

대상 파일:

- `electron/main.ts`
- `electron/preload.cts`
- `src/App.tsx`
- `src/lib/editorSession.ts`
- 신규 `tests/e2e/undo-redo-inputs.spec.ts`

수용 기준:

- Ribbon, `Ctrl+Z`, `Ctrl+Y`/`Ctrl+Shift+Z`, Electron Edit 메뉴가 같은 session history를 사용한다.
- text/table/image/section 편집과 Save checkpoint 전후에 document와 selection이 함께 복원된다.
- iframe inline edit 중 브라우저 native undo와 app undo가 충돌하지 않는다.

#### C2. 실제 Canvas/UI 편집 매트릭스

승인 샘플 4종 각각 다음 최소 경로를 수행한다.

1. Open
2. 실제 Canvas click/double-click으로 선택·텍스트 편집
3. 대표 표 또는 차트 또는 이미지 편집
4. Save As
5. 앱 종료·재실행·재열기
6. DOM 및 시각 결과 비교

추가 필수 시나리오:

- 표: 셀 편집, 행/열, 정렬/필터, merge/unmerge, 21행 이후 pagination
- 차트: data/caption 반복 Apply의 idempotency
- 이미지: replace, aspect/size, frame, crop, filter, resize postMessage
- section: duplicate, move, hide/show, 마지막 section 삭제 복구
- KO/EN 전환, 다중 선택 일괄 서식, 한국어 IME 조합

### 단계 D — P2 사용성·접근성

#### D1. 빈 상태와 명령 구조 정리

- 문서가 없으면 제목과 status를 `No document`로 통일한다.
- Save/Undo/Redo/zoom처럼 대상 문서가 필요한 명령은 비활성화하고 이유 tooltip을 제공한다.
- 동일한 `Save As HTML` 버튼 둘을 하나의 primary command로 통합하거나 quick action을 `Save`로 분리해 이름과 동작을 구별한다.
- 로드·저장·backup 경고는 각각 다른 live-region 상태와 아이콘을 사용한다.

#### D2. 1024px에서 전역 가로 스크롤 제거

- `.app-shell`의 고정 최소폭 의존을 제거한다.
- Section Rail과 Properties를 접을 수 있는 drawer/overlay로 바꾸고 중앙 Canvas를 우선한다.
- ribbon command는 우선순위별 overflow menu로 이동한다.
- object chip과 긴 제목은 ellipsis뿐 아니라 전체 내용을 볼 tooltip/accessible name을 제공한다.

수용 기준:

- 1024×768 및 1366×768에서 body horizontal overflow가 0이다.
- Open, Save, section 탐색, Properties 열기/닫기를 수평 스크롤 없이 수행한다.
- 125%/150% Windows DPI, 키보드 전용, focus order, modal trap/restore, screen reader name을 확인한다.

### 단계 E — 배포·회귀 운영

#### E1. QA를 저장소와 package pipeline에 편입

대상:

- 신규 `tests/e2e/`
- `package.json`
- Windows CI 또는 로컬 `npm run verify:release`

권장 명령 구성:

- `test:unit`: Vitest
- `test:e2e:renderer`: Vite preview UI
- `test:e2e:electron`: fresh win-unpacked UI
- `test:e2e:portable`: portable wrapper 기동 smoke
- `verify:release`: clean build → package → unit → renderer E2E → win-unpacked E2E → portable smoke

gate 조건:

- package 시작 시 source/build ID를 생성하고 결과 JSON과 About/진단에 기록한다.
- E2E는 방금 생성한 artifact hash만 받으며 고정된 옛 release 경로를 암묵적으로 사용하지 않는다.
- win-unpacked와 portable 모두 창 생성, preload API, Open/Save/close, 네트워크 차단을 확인한다.
- screenshot은 preview ready 신호 뒤에만 촬영한다.
- 모든 console warning/error, page error, request failure는 allowlist 없는 필수 실패다.

#### E2. 단일 제품 사양 문서 확정

README 또는 `docs/product-spec.md`에 CORE-01~08의 지원/부분지원/제외와 수용 기준을 둔다. 현재 코드와 충돌하는 `src/lib/phaseReport.ts`, `findings.md` 앞부분의 과거 결론, 41-test 기준 설계 문구는 이 표를 기준으로 갱신한다.

## 6. 권장 작업 순서와 게이트

| 순서 | 묶음 | 완료 게이트 |
|---:|---|---|
| 1 | A1 Drop/Open parity | Drop fixture의 CSS/image/custom protocol이 Open과 동일 |
| 2 | A2 Save As relocation | 다른 폴더 저장·재기동·재열기 후 자산 정상, 실패 시 원자적 rollback |
| 3 | A3 warning/data diff | 손실성 저장이 조용히 성공하지 않음 |
| 4 | B1/B2 active-first loading | 5.4MB 샘플 3회 median SLO 통과 |
| 5 | C1/C2 실제 편집 매트릭스 | 승인 샘플 4종 open→edit→save→reopen 통과 |
| 6 | D1/D2 UX·접근성 | 1024px overflow 0, keyboard/DPI/IME gate 통과 |
| 7 | E1/E2 배포 진위 | fresh win-unpacked+portable 전체 gate와 canonical spec 일치 |

단계 A가 끝나기 전에는 상대 자산 문서의 Drop과 다른 폴더 Save As를 “완전 지원”으로 표시하지 않는다. 즉시 배포가 필요하면 임시로 두 동작에 명확한 차단/경고를 넣고 native Open 및 원본 폴더 저장을 안내하는 것이 안전하다.

## 7. 전체 완료 정의

- CORE-01~08에 자동화 또는 명시적 수동 증거가 연결되어 있다.
- 승인 샘플 4종이 packaged app에서 open→실제 편집→save→종료→reopen을 통과한다.
- 상대 자산 fixture가 Open, Drop, 같은 폴더 Save As, 다른 폴더 Save As에서 모두 동일하다.
- 저장 성공은 HTML, 의존 자산, backup, warning 상태가 모두 일관될 때만 표시된다.
- 5.4MB 샘플이 정의된 SLO와 로딩 상태 진실성을 충족한다.
- 1024×768, 1366×768, 125%/150% DPI, keyboard-only, 한국어 IME에서 핵심 동작을 완료한다.
- fresh win-unpacked와 portable artifact가 같은 build ID로 전체 release gate를 통과한다.
- 결과 JSON, screenshot, artifact hash가 한 실행 디렉터리에 보관된다.

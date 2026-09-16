# HTMLpoint 동작 점검 및 개선 결과

## 후속 — 2026-09-13 (QA-07 패치와 잠금 상태)

전자-builder 25 `multiUser.nsh`의 사용자별 경로 고정 길이 읽기를 패키징 전 패치하고, 새 설치본의 무인 설치·실행·제거를 고유 시험 폴더에서 종료 코드 0으로 확인했다. 상세 해시·명령·남은 IME/파일창 제한은 [artifacts/qa-2026-09-13/REPORT.md](artifacts/qa-2026-09-13/REPORT.md)에 있다. 오늘 미패치 설치본 4회는 충돌하지 않았고, 데스크톱 잠금으로 실제 Open/Save As 선택과 Microsoft IME는 아직 미완료다.

## 추가 검증 결과 — 2026-09-12 15:45 KST

사용자의 추가 요청으로 실제 포터블 실행, 설치판, OS 파일 선택창과 한글 조합 경로를 검사했다. **포터블과 Chromium 한글 조합 검사는 통과했다. 무인 설치에서는 새 충돌을 발견했으며, 실제 Windows IME와 파일 선택 조작은 잠금 때문에 여전히 미완료다.** 아래 앞선 검사 결과와 구분한다.

| 추가 검사 | 결과 | 근거와 범위 |
| --- | --- | --- |
| 포터블 단일 EXE | 통과 | `HTMLpoint-Portable-0.3.0-x64.exe` 자체 실행 → 임시 폴더 압축 해제 → 자식 앱 실행 확인. 그 앱에 19개 기능 검사 모두 통과. 종료 후 런처 프로세스와 압축 해제 폴더가 사라짐 |
| 포터블 내용 대조 | 통과 | 압축 해제된 `app.asar` SHA-256이 앞서 검사한 win-unpacked와 동일: `030687c105f1a7282f09fbffec541a6ce512d0b669cd011a8da5d1fe8e964289` |
| Chromium 한글 조합 | 5개 통과 | DOM 이벤트를 직접 발송하는 대신 Chromium `Input.imeSetComposition`으로 `ㅎ→하→한` 처리. 실제 compositionstart/update/end와 `isComposing=true` Enter 확인. Properties Ctrl+Enter 보호, 조합 완료 적용, 인라인 Enter 보호, Undo/Redo, 한글 저장·재열기 통과 |
| 실제 Windows IME | 미완료 | 위 검사는 OS 키보드·Microsoft IME 후보창·한/영 전환을 통과하지 않는다. 잠금 해제된 사용자 데스크톱이 필요 |
| 네이티브 Open / Save As | 호출 확인, 선택 미검증 | 실제 `showOpenDialog` / `showSaveDialog`를 반환값 대체 없이 호출한 것을 확인. 잠금 상태에서는 선택창 조작과 선택 경로 반환을 확인하지 못함. 검증용 프로세스만 종료 |
| NSIS 무인 설치 | **실패: QA-07** | `/S /currentuser /D=<새 시험 폴더>` 실행에서 종료 코드 `-1073741819` (`0xc0000005`). 설치 EXE 생성 안 됨. Windows 이벤트 1000/1001이 `System.dll`, offset `0x1581` 충돌을 기록 |
| 일반 설치 마법사 | 시작만 확인 | Orca 접근성 트리에서 설치 위치 화면과 시험 경로 확인. ‘설치’ 명령은 semantic action 미지원으로 synthetic fallback, `unverified` 반환. 화면 진행을 확인하지 못해 시험 마법사 종료 |
| 설치된 앱 실행 / 제거 | 미완료 | 설치가 완료되지 않아 제거 동작까지 검증하지 못함. 기존 HTMLpoint 설치와 바로가기가 없는 것을 먼저 확인하고 새 시험 폴더만 대상으로 실행 |

### QA-07. 로컬 무인 설치 중 NSIS 충돌 (P1: 릴리스 검증 차단)

- 대상은 앞서 `win.signAndEditExecutable=false`로 생성한 로컬 검증용 설치판이다. 기본 배포 설정의 설치판 및 다른 PC에서의 재현 여부는 아직 확인하지 않았다.
- 확인된 실패는 **무인 설치 모드**다. 일반 마법사가 설치 위치 화면까지 열렸으므로 일반 설치도 같은 원인으로 실패한다고 단정하지 않는다.
- 충돌 모듈과 코드까지 확인했으며 근본 원인은 미확정이다. 잠금·PC 환경 또는 패키징 도구의 영향과 제품 설정 문제를 분리하는 후속 원인 분석이 필요하다. 이번 검증에서 제품 코드나 설치 설정을 임의 변경하지 않았다.
- 재현: `HTMLpoint-Setup-0.3.0-x64.exe /S /currentuser /D=D:\AI_Driven\HTMLPoint_clone_2026-09\artifacts\verification-2026-09-12\release\install-smoke` (시험 전 해당 경로와 기존 설치 존재 여부를 확인해야 함).
- 완료 기준: 새 시험 폴더의 무인 설치 정상 종료, 등록된 설치 경로·바로가기 대상 확인, 설치된 앱의 열기/편집/저장, 제거 후 파일·등록·바로가기 정리 확인. 현재 이 기준은 충족하지 못했다.

### 추가 검증 자료

- [포터블 실행·압축 해제 대조·정리](artifacts/verification-2026-09-12/native-followup-results.json) / [포터블 19개 동작 검사](artifacts/verification-2026-09-12/portable-wrapper/electron-functional-results.json)
- [한글 조합 5개 결과와 이벤트 기록](artifacts/verification-2026-09-12/composition-results.json) / [조합 회귀 검사 코드](tests/e2e/electron-composition.cjs)
- [실제 열기 API 호출](artifacts/verification-2026-09-12/native-open-results.json) / [실제 Save As API 호출](artifacts/verification-2026-09-12/native-save-results.json) / [Orca 잠금 상태](artifacts/verification-2026-09-12/orca-followup-state.json)
- [설치 검사 결과](artifacts/verification-2026-09-12/installer-results.json) / [Windows 충돌 이벤트](artifacts/verification-2026-09-12/installer-crash-events.json) / [일반 설치 마법사 접근성 상태](artifacts/verification-2026-09-12/installer-wizard-state.json)

---

## 개선 반영 결과 — 2026-09-12

요청한 개선을 서브에이전트 없이 반영했다. Windows 잠금 상태에서도 빌드, 실제 Electron의 편집·파일 저장, 패키지 실행 검증을 수행했다. **Orca를 통한 데스크톱 입력 검증은 남아 있으며, 자동 검사 통과를 전체 기능 무결점 판정으로 해석하지 않는다.** 기존 `improve/` 파일과 사용자 원본 보고서는 수정하지 않았다.

| 항목 | 반영 내용 | 확인 결과 |
| --- | --- | --- |
| QA-01 | 릴리스와 `verify:release`를 build → unit → renderer E2E → Electron E2E → `package:built` 순서로 변경 | 패키징 시 재빌드하지 않음. 로컬 패키지의 컴파일 파일 13개가 검사한 빌드와 바이트 단위로 일치 |
| QA-02 | 썸네일에서 제거한 외부·상대 이미지를 이름이 있는 자리표시자로 표시. CSP로 외부 요청 차단 유지 | 본문 상대 CSS/SVG 정상 로드, 썸네일에 깨진 이미지 없음. 원본 스타일 전체 재현은 지원하지 않는 단순 미리보기 |
| QA-03 | Fit과 줌의 50% 하한을 1%로 완화 | 900/1024/1280px에서 실제 창 폭 변경, 계산 배율 반영, 캔버스 가로 overflow 없음 확인 |
| QA-04 | 상대 자산·병합 표·다국어·동적 표/SVG 차트 합성 fixture 4종 필수 검사. 준비 신호·이미지·선택 이후 성능 측정. Electron E2E를 릴리스에 추가 | 필수 검사 skip 없음. 실제 현장 자료는 `test:local-samples`로 별도 검사하며 자료가 없으면 실패 |
| QA-05 | 개발 실행 시 main/preload 자동 컴파일·감시·재시작. 미저장 문서 종료 보호 유지. Vite에서 생성물/프로필 폴더 감시 제외 | Electron 빌드 폴더가 없는 상태에서 기동 확인. 최종 개발 실행에서 재빌드 → 종료 확인 → 취소 시 변경 유지 → 종료 후 새 빌드 실행 통과 |
| QA-06 | Size & Position 기본 접기, 개체 전환 시 속성 패널 상단 이동, 적용 전 텍스트 안내와 Ctrl+Enter 적용 | 실제 Electron에서 안내·적용 확인. 작은 창에서도 Apply Text 접근 개선 |
| 추가 수정 | 인라인 편집 Escape 취소가 `<strong>`·`<a>`를 일반 텍스트로 바꾸던 오류 수정. 편집 전 DOM 노드를 보관·복원하고 조합 중 키 이벤트 무시 | 더블클릭/F2, Escape 후 원래 DOM 객체·링크 유지, Enter 적용, Undo 통과. 조합 이벤트 검사는 합성 이벤트이며 실제 한글 IME 검증은 아님 |

### 개선 후 검증

| 검사 | 결과 |
| --- | --- |
| `npm run build` | TypeScript·Vite·Electron 빌드 통과 |
| `npm run test:unit` | 28개 파일, 242개 통과, skip 없음 |
| `npm run test:e2e:renderer` | 인라인 편집 회귀 및 실제 배율 반영 검사 통과. 5,554,164바이트·220 Section 준비 시간 4,648 / 5,172 / 4,171ms, 중앙값 **4,648ms**로 6,000ms 기준 통과 |
| `npm run test:e2e:electron` | 소스 빌드 19개 통과. 열기, 편집, Undo/Redo, 자동 백업, Save/Save As, 자산 복사, 재열기, 병합 표, 언어 전환, SVG 데이터 편집·저장 포함 |
| 새 패키지 실행 | `win-unpacked/HTMLpoint.exe`에 같은 19개 검사 적용, 모두 통과, `pageerror` 0건 |
| 개발 재시작 | 변경 보호·취소·새 빌드 재시작 3항목 통과 |
| 패키지 대조 | `app.asar` 내 dist/dist-electron 파일 13개와 로컬 빌드가 모두 동일 |

성능 측정 조건을 초기의 iframe 표시 시점에서 실제 준비·이미지·선택 시점으로 강화했으므로, 아래 초기 2,266ms와 직접적인 속도 비교는 할 수 없다. GitHub Actions 원격 실행은 수행하지 않았다.

### 로컬 패키징 결과와 남은 확인

기본 `package:built` 실행은 이 PC에서 winCodeSign 도구 압축 해제 중 심볼릭 링크 생성 권한 부족으로 실패했다. 제품 배포 설정을 변경하지 않고 다음 **로컬 검증용 옵션**으로 설치판·포터블 파일을 생성했다. 실행 파일 리소스 편집과 서명을 생략한 검증용 결과이며, 기본 명령의 이 PC 실행까지 통과했다는 의미는 아니다.

```powershell
npm run package:built -- --config.directories.output=artifacts/verification-2026-09-12/release --config.win.signAndEditExecutable=false
```

- 산출물: `artifacts/verification-2026-09-12/release/HTMLpoint-Setup-0.3.0-x64.exe`, `HTMLpoint-Portable-0.3.0-x64.exe`
- 이 단계의 실제 실행 검사는 `win-unpacked/HTMLpoint.exe`를 대상으로 했다. 포터블 단일 EXE와 설치판의 후속 결과는 문서 맨 위 추가 검증 결과를 따른다.
- Windows가 잠겨 있어 Orca 화면·입력, OS 파일 선택창/파일 드롭, 실제 한글 IME, 포인터 드래그·크기 조절, OS 단축키·DPI·스크린리더는 미검증이다. 파일 선택창은 테스트 경로를 반환하도록 대체했고 실제 IPC와 파일 I/O는 제품 구현을 실행했다.
- 이미지 화살표·모자이크·크롭, 다중 개체 조작, 프로세스 강제 종료 후 복구 선택, 읽기 전용 폴더 fallback, 네트워크 단절·다른 PC 및 대용량 현장 문서는 별도 실사용 확인 대상이다.

### 개선 후 증거

- [실제 Electron 19개 결과](artifacts/verification-2026-09-12/electron-functional-results.json) / [패키지 실행 19개 결과](artifacts/verification-2026-09-12/packaged/electron-functional-results.json)
- [단위 검사 결과](artifacts/verification-2026-09-12/unit-results.json) / [성능 결과](artifacts/verification-2026-09-12/renderer-results.json)
- [개발 재시작 결과](artifacts/verification-2026-09-12/dev-watch-results.json) / [패키지 내용 SHA-256 대조](artifacts/verification-2026-09-12/package-content-check.json)
- [1024px 패키지 화면](artifacts/verification-2026-09-12/packaged/electron-narrow.png) / [저장본 재열기](artifacts/verification-2026-09-12/packaged/electron-reopened.png)
- 회귀 검사: [Electron 동작 검사](tests/e2e/electron-workflow.cjs), [렌더러 성능·인라인 검사](tests/e2e/renderer-performance.cjs), [필수 보고서 호환성 검사](tests/referenceSamples.test.ts)

---

## 초기 점검 기록 (개선 전)

아래 내용은 최초 발견 근거를 보존한 기록이다. 아래의 코드 상태·238개 검사·미확인 항목은 **개선 전 기준**이며, 현재 반영 상태와 남은 제한은 위 결과를 따른다.

- 점검일: 2026-09-12 (KST)
- 대상: `HTMLpoint 0.3.0`, 커밋 `8fcbb98` — `Add PowerPoint-style object layout editing`
- 환경: Windows, Node.js `v24.19.0`, npm `11.17.0`, Orca `1.4.199`
- 범위: 현재 소스 빌드, 기존 테스트, Electron 실행 및 주요 편집·저장 흐름, 관련 구현 확인
- 초기 점검의 변경 범위: 이 문서와 `artifacts/qa-2026-09-12/`의 점검 자료만 추가. 이후 개선에서 제품 소스와 회귀 검사를 수정했다.

## 판정

**확인한 기본 편집·저장 흐름은 동작한다. 다만 전체 기능에 문제가 없다고 판정할 수는 없다.**

빌드, 단위 테스트 238개, 기존 렌더러 E2E, 보조 Electron 점검 14개가 통과했다. 반면 릴리스 작업의 빌드 순서에 결함이 있고, 썸네일의 상대 이미지 누락과 작은 창의 Fit 표시에는 개선이 필요하다.

요청한 `orca-cli` 및 `computer-use` 스킬을 읽고 설치 버전의 가이드에 따라 `orca computer`로 앱과 창을 확인했다. 그러나 **Windows가 잠겨 있어 캡처에는 잠금 화면이 나타났고 앱 내부 접근성 요소도 확인되지 않았다.** 잠금 해제를 요청했지만 점검 종료 시점까지 해제되지 않아 Orca를 통한 실제 데스크톱 클릭·키보드 조작은 미완료다.

이를 보완한 Electron/Playwright 점검은 네이티브 파일 대화상자의 반환 경로만 점검용 파일로 지정했다. 렌더러 버튼, 실제 Electron IPC, HTML 직렬화, 파일 쓰기, 상대 자산 프로토콜은 제품 구현을 사용했다. 따라서 파일 대화상자의 실제 사용자 조작, Windows IME, OS 단축키, 잠금 해제 상태의 포인터 조작까지 검증한 것으로 해석하면 안 된다. 아래 `electron-*.png`도 Electron 렌더링 캡처이며 Orca 데스크톱 캡처가 아니다.

## 검증 결과

| 검증 | 결과 | 관찰 및 범위 |
| --- | --- | --- |
| `npm run build` | 통과 | TypeScript, Vite 렌더러, Electron main/preload 빌드 성공 |
| `npm run test:unit` | 통과, 일부 제외 | 27개 파일·238개 테스트 통과. 현장 샘플 테스트 파일 1개·테스트 1개는 skip |
| `npm run test:e2e:renderer` | 통과 | 5,554,053바이트, 220개 섹션, preview iframe 표시까지 2,266ms. 썸네일 iframe 4개 생성 |
| 기존 E2E의 1024px 화면 | 통과 | 문서 본체 가로 overflow 없음, Open 존재, 초기 Save 비활성, 패널 제어 존재 |
| Electron 시작·빈 문서 | 통과 | 제품 빌드에서 앱 시작, Save 비활성 |
| 한글·공백 경로 HTML 열기 | 통과 | 3개 섹션과 내용 표시, 상대 CSS 및 SVG 정상 로드 |
| Properties 텍스트 편집 | 통과 | Apply Text 후 본문 반영, Modified 및 Save 활성화 |
| Undo / Redo | 통과 | 수정 전후 텍스트로 되돌아가는 것을 preview에서 확인 |
| 숫자로 개체 이동 | 통과 | X를 41 → 71로 변경 후 한 번의 Undo로 41 복원 |
| Zoom / Fit 상태 전환 | 통과 | 수동 확대 시 Fit 해제, Fit 클릭 시 활성화. 실제 폭 맞춤 한계는 별도 발견 사항 참조 |
| 섹션 이동·표 편집 | 통과 | 다른 섹션의 표 선택, 셀 값 수정, 행 추가, Undo 후 원래 행 수 복원 |
| 변경 요약 | 통과 | 모달 표시 및 Escape로 닫힘 |
| 미저장 상태 종료 | 통과 | 종료 요청 시 저장/버리기/취소 모달 표시, 취소 후 변경 유지 |
| 자동 복구본 생성 | 통과 | `.htmlpoint-backups` 안에 autosave 파일 생성 확인. 실제 크래시 복구 선택은 미검증 |
| Save | 통과 | 디스크 HTML에 수정 텍스트·셀 반영, Save 비활성으로 전환, 편집하지 않은 `<strong>` 보존 |
| 다른 폴더 Save As | 통과 | HTML과 상대 CSS·SVG 복사 확인. 복사된 CSS·SVG 내용은 원본과 동일 |
| 저장본 다시 열기 | 통과 | 수정 텍스트 및 상대 이미지 표시 유지 |
| Electron 창 너비 1024px | 부분 통과 | 콘텐츠 영역 1008px에서 body overflow 없음, Sections 접기/펼치기 정상. 캔버스 내부 잘림은 존재 |
| Orca 네이티브 사용 점검 | 미완료 | 앱 PID/창 확인 성공, Windows 잠금으로 화면·입력 검증 제한 |
| 인라인 직접 편집 추가 탐색 | 미확인 | 잠금 상태의 보조 자동화에서 더블클릭/F2 후 편집 진입을 확인하지 못함. 이후 취소·드래그 검증까지 진행되지 않음 |

보조 Electron 점검에서 `pageerror`는 0건이었다. preview가 교체되는 흐름에서 SVG 요청에 `net::ERR_ABORTED` 1건이 기록됐지만 처음 열기와 저장본 다시 열기의 이미지 로드는 통과했다. 이를 지속적인 자산 로드 실패로 판정하지 않았다.

기존 E2E 종료 로그의 preview 서버 `code 1`은 `concurrently -k`가 성공한 테스트 뒤 서버를 종료하며 출력한 값이다. 전체 npm 명령의 종료 코드는 0이었다.

## 개선 우선순위

P1은 배포 흐름을 막는 문제, P2는 사용자 기능·검증 신뢰도 개선, P3는 개발 및 사용 편의 개선으로 분류했다.

| ID | 우선순위 | 항목 | 증거 수준 |
| --- | --- | --- | --- |
| QA-01 | P1 | Windows 릴리스와 `verify:release`에서 빌드가 E2E보다 늦음 | 작업 순서 확인 + 빌드 산출물 부재 시 실패 재현 |
| QA-02 | P2 | 섹션 썸네일에서 상대 이미지와 원본 스타일 누락 | Electron 화면 및 DOM 확인 |
| QA-03 | P2 | 작은 창에서 Fit 활성 상태에도 캔버스가 잘림 | Electron 1024px 창 캡처 + 50% 하한 구현 확인 |
| QA-04 | P2 | 현장 샘플·사용 가능 시점·네이티브 기능에 대한 검증 공백 | 실제 skip 및 테스트 구현 확인 |
| QA-05 | P3 | 개발 실행이 사전 생성된 Electron JS에 의존 | package scripts 및 entrypoint 확인, 깨끗한 개발 실행은 미실행 |
| QA-06 | P3 | 속성 패널의 적용 버튼 접근성과 편집 피드백 개선 | 화면 관찰에 따른 UX 제안 |

### QA-01. 릴리스 검사 전에 빌드하기

- 위치: [.github/workflows/release.yml](.github/workflows/release.yml) 25행, [package.json](package.json) 15·16행.
- 현재 순서: 단위 테스트 → 렌더러 E2E → `npm run package` 내부에서 빌드.
- 렌더러 E2E는 `vite preview`를 사용한다. `dist/`는 Git에서 제외되어 있으므로 깨끗한 checkout에는 preview할 결과물이 없다. `verify:release`도 같은 순서다.
- 기존 `dist/`를 지우지 않고 다음 명령으로 산출물 부재 조건을 재현했다.

```powershell
node node_modules/vite/bin/vite.js preview --outDir artifacts/qa-2026-09-12/absent-dist --host 127.0.0.1 --strictPort --port 4273
```

- 결과: 종료 코드 1, `The directory "artifacts/qa-2026-09-12/absent-dist" does not exist. Did you build your project?`
- 영향: 새 Windows runner에서는 패키징 전에 실패할 수 있다. 기존 dist가 있는 개발 PC에서는 오래된 렌더러를 검사한 뒤 새 소스를 패키징하는 검증 불일치도 가능하다. GitHub Actions를 원격 실행한 결과는 아니며, 로컬 실패 재현과 workflow 순서에 근거한 판단이다.
- 개선: `build → unit/E2E → 동일 빌드 결과 패키징` 순서를 보장한다. 일반 CI의 [.github/workflows/ci.yml](.github/workflows/ci.yml)은 이미 E2E 전에 build를 실행한다.
- 완료 기준: `dist/`, `dist-electron/` 없는 새 checkout에서 릴리스 검증이 통과하고, 검사한 렌더러와 패키지에 들어간 렌더러가 동일하다.

### QA-02. 상대 자산 문서의 썸네일 표현 개선

- 재현: [점검 보고서](artifacts/qa-2026-09-12/fixtures/점검%20보고서.html)를 연 뒤 본문과 첫 번째 Sections 썸네일을 비교한다.
- 본문 이미지 `naturalWidth=360`, 제목 색상 `rgb(21, 95, 141)`로 정상이다. 썸네일은 이미지 `naturalWidth=0`, `src` 제거, 제목 색상 `rgb(34, 34, 34)`로 확인됐다.
- 원인: [SectionRail.tsx](src/components/SectionRail.tsx) 98행은 섹션 HTML만 넘긴다. [preview.ts](src/lib/preview.ts) 2370행의 `buildThumbnailHtml`은 별도 기본 스타일을 사용하며 `neutralizeThumbnailAssetRequests`는 data/blob 외 src를 의도적으로 제거한다.
- 판정: 본문 저장이나 자산 로드 결함이 아니라, 현재 썸네일의 안전한 축약 정책에서 생기는 표시 한계다. 깨진 이미지 아이콘 때문에 실제 보고서 파일이 손상된 것으로 오해할 수 있다.
- 개선: 제거된 이미지를 의도적인 자리표시자로 표시하거나, 허용된 로컬 자산만 메모리 이미지로 변환해 재사용한다. 원본 스타일은 안전한 정적 범위만 반영한다. 모든 외부 요청을 무조건 허용하는 방식은 피한다.
- 완료 기준: 상대 이미지가 있는 문서의 썸네일에 깨진 이미지 아이콘이 없고, 외부 네트워크 요청 없이 섹션을 구별할 수 있다.
- 화면: [본문과 썸네일 비교](artifacts/qa-2026-09-12/electron-loaded.png).

### QA-03. Fit이 실제 캔버스 폭에 맞도록 조정

- 재현: 보고서를 연 상태에서 창 너비를 1024px로 줄이고 양쪽 패널을 펼친다. Fit 활성 상태에서도 배율은 50% 아래로 내려가지 않고 캔버스 내부 가로 스크롤이 남는다.
- 원인: [Canvas.tsx](src/components/Canvas.tsx) 10행의 `MIN_ZOOM = 50` 및 `calculateFitZoom`의 하한 제한. [StatusBar.tsx](src/components/StatusBar.tsx)도 줌 범위를 50~140%로 제한한다.
- 영향: 앱 전체 body overflow 검사는 통과해도 보고서 오른쪽이 잘릴 수 있다. “Fit” 표시와 사용자가 보는 결과가 다르다.
- 개선: 자동 Fit에서는 실제 가용 폭을 우선하거나, 패널을 자동으로 접어 필요한 공간을 확보한다. 낮은 배율을 제한하려면 폭 맞춤이 불가능한 상태를 표시하고 패널 접기를 안내한다.
- 완료 기준: 900/1024/1280px 창에서 Fit 활성 시 페이지 폭이 캔버스 안에 들어오거나, 제한 이유와 즉시 실행 가능한 대응이 표시된다. body뿐 아니라 `.canvas-stage` overflow도 검사한다.
- 화면: [작은 창에서 Fit 50%](artifacts/qa-2026-09-12/electron-narrow.png).

### QA-04. 검증 범위를 실제 사용 완료 시점까지 확대

- [referenceSamples.test.ts](tests/referenceSamples.test.ts)는 `HTML_reference/`가 없으면 skip한다. 이번 환경에도 승인 샘플 4개가 없어 호환성을 확인하지 못했다.
- [renderer-performance.cjs](tests/e2e/renderer-performance.cjs) 32행은 iframe 요소 표시까지만 기다린다. 따라서 2,266ms는 내부 문서 렌더·이미지 로드·선택 이벤트 준비가 모두 끝난 시간이라고 볼 수 없다. 측정도 1회다.
- 보조 점검의 열기/저장은 실제 파일 I/O를 사용했으나 네이티브 대화상자 선택을 대체했다. 인라인 편집 진입 추가 탐색도 끝까지 통과하지 못했다. OS 잠금의 영향과 제품 동작을 분리해서 재검증해야 한다.
- 개선: 비식별화된 대표 문서 fixture를 저장소에 포함하고, 필수 릴리스 검사에서 샘플 부재가 조용히 skip되지 않게 한다. preview 준비 신호, 실제 개체 선택·편집 가능 여부, 이미지 완료를 기다린 뒤 3회 중앙값을 기록한다.
- 완료 기준: 외부 파일 없이 상대 자산, 복합 표, 동적 차트, 언어 전환 fixture가 검증되며, 잠금 해제된 Windows에서 네이티브 열기/저장·드래그·IME·단축키 및 새 배포판 smoke가 통과한다.

### QA-05. 개발 실행의 Electron 컴파일 의존성 명시

- [package.json](package.json) 5행의 entrypoint는 `dist-electron/main.js`다. `npm run dev`는 Vite와 `electron .`만 시작하며 Electron TypeScript를 컴파일하지 않는다.
- 해석: 깨끗한 checkout에서는 entrypoint가 아직 없고, 기존 빌드가 있으면 main/preload 수정이 반영되지 않은 JS를 실행할 수 있다. 이번 점검은 먼저 build한 제품 실행이며, dist를 제거한 `npm run dev` 자체는 실행하지 않았다.
- 개선: `predev` 또는 별도 개발 단계에서 Electron TS 빌드를 보장하고, main/preload 변경 시 재빌드·재시작한다. README에도 선행 조건을 맞춘다.
- 완료 기준: 문서에 나온 설치·개발 실행 명령만으로 새 checkout이 시작되고, main/preload 수정도 반영된다.

### QA-06. 속성 패널의 적용 흐름 정리

- 화면에서 Size & Position이 먼저 크게 표시되어 짧은 창에서는 Text Style과 Apply Text를 찾기 위해 스크롤해야 한다. 새 개체를 선택해도 패널 스크롤 위치에 따라 핵심 입력이 보이지 않을 수 있다.
- 개선: 위치/서식 그룹 접기, 편집 종류에 맞는 그룹 우선 표시, 적용 전 입력이 남아 있음을 알리는 표시를 검토한다. 주요 Apply 버튼을 해당 그룹 하단에 고정하는 방식도 가능하다.
- 제품 오류로 확정한 항목은 아니며, 작은 화면에서 편집 단계를 줄이기 위한 UX 제안이다.

## 미검증 범위 및 다음 점검

1. 잠금 해제 상태에서 Orca로 네이티브 파일 열기·저장 대화상자, 더블클릭/F2 인라인 편집, 드래그 이동/크기 조절, Ctrl+S/Z, 한글 IME를 확인한다.
2. 강조·링크 문장 편집 후 Escape 취소 시 표시/DOM이 유지되는지 확인한다. 추가 자동 탐색은 편집 진입 확인에서 중단되어 이 동작의 성공·실패를 판단하지 않았다.
3. 이미지 화살표·모자이크·크롭, SVG 차트 편집, 여러 개체 정렬, 언어 전환, 동적 표 캡처, OS 파일 드롭은 이번 수동 실행 범위에 포함되지 않았다. 관련 단위 테스트 통과가 데스크톱 실사용 검증을 대신하지는 않는다.
4. 프로세스 비정상 종료 후 복구 선택, 읽기 전용 폴더 fallback, 네트워크 단절 환경, 대용량 실문서는 추가 점검 대상이다.
5. 이번에는 현재 소스를 직접 빌드해 Electron으로 실행했다. 설치판/portable 새 패키지 생성, 설치·제거 및 다른 PC에서의 실행은 검증하지 않았다.

## 점검 자료

- [보조 Electron 점검 코드](artifacts/qa-2026-09-12/electron-functional.cjs) / [14개 결과와 오류 기록](artifacts/qa-2026-09-12/electron-functional-results.json)
- [인라인 편집 추가 탐색 코드](artifacts/qa-2026-09-12/electron-inline-cancel.cjs) / [미완료 결과](artifacts/qa-2026-09-12/electron-inline-cancel-results.json)
- [Orca 마지막 상태](artifacts/qa-2026-09-12/orca-last-state.json) — screenshot 경로는 임시 파일이며 만료될 수 있다.
- [변경 요약](artifacts/qa-2026-09-12/electron-change-summary.png), [미저장 종료 보호](artifacts/qa-2026-09-12/electron-dirty-close.png), [저장본 다시 열기](artifacts/qa-2026-09-12/electron-reopened.png)
- [다른 폴더에 저장한 결과](artifacts/qa-2026-09-12/save-as/저장%20결과.html)

보조 점검은 `npm run build` 후 `node artifacts/qa-2026-09-12/electron-functional.cjs`로 다시 실행할 수 있다. 점검용 fixture만 편집하며 종료 시 원래 내용으로 되돌리고, `save-as/`에 저장 결과를 남긴다. 사용자 원본 보고서는 사용하지 않았다.

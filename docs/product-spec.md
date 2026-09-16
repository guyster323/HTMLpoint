# HTMLpoint 제품 핵심 사양

이 문서는 현재 제품이 보장하는 범위와 검증 기준의 단일 기준점이다.

| ID | 사양 | 현재 상태 | 검증 기준 |
| --- | --- | --- | --- |
| CORE-01 | Open과 Drop은 동일한 HTML과 상대 자산을 연다 | 지원 | Electron Drop은 실제 File 경로를 검증·정규화하고 preview root를 등록한다. 브라우저 Drop은 상대 자산 문서를 명시적으로 거부한다. |
| CORE-02 | 원본 DOM/CSS/script와 의도한 편집을 보존한다 | 부분 지원 | serializer warning은 저장/자동백업 결과에 전달된다. 전체 DOM diff E2E는 추가 검증 대상이다. |
| CORE-03 | 선택·히스토리·Undo/Redo를 함께 복원한다 | 지원 | Ribbon, 단축키 및 Electron Edit menu가 editor session history를 사용한다. |
| CORE-04 | Save As, backup, autosave는 손실 없이 동작한다 | 지원 | 다른 폴더 Save As는 상대 의존 자산을 staging 후 함께 저장하며, 실패하면 sourcePath/checkpoint를 바꾸지 않는다. |
| CORE-05 | 상대 CSS/image/font/media를 offline에서 연다 | 지원 | Preview protocol은 canonical source root만 제공하며 Save As는 상대 의존 tree를 복사한다. |
| CORE-06 | 승인 대용량 샘플의 실사용 성능 | 부분 지원 | 합성 220 Section 문서의 preview 초기화·이미지·선택 준비를 3회 측정하고 중앙값 6초를 검사한다. 실제 승인 현장 샘플의 성능은 별도 검증 대상이다. |
| CORE-07 | win-unpacked와 portable이 동일하게 offline 동작한다 | 부분 지원 | production build, 새 win-unpacked 및 실제 portable wrapper 자식 앱에서 19개 동작 검사와 패키지 내용 대조를 수행했다. NSIS 무인 설치는 electron-builder 25의 사용자별 경로 복사 패치와 `verify:nsis`로 검사한다. 네트워크 단절과 자동 artifact build-ID gate는 미검증이다. |
| CORE-08 | 1024px·키보드 사용자가 즉시 핵심 기능에 접근한다 | 부분 지원 | 900/1024/1280px에서 body와 캔버스의 가로 overflow를 검사한다. Fit은 50% 아래로 축소 가능하며 위치 속성 접기와 텍스트 Ctrl+Enter 적용을 제공한다. DPI/IME/screen-reader 수동 gate는 추가 검증 대상이다. |

## 저장 안전성

- HTML 또는 의존 자산을 완전히 stage하지 못하면 Save As 성공을 표시하지 않는다.
- 같은 폴더 Save As와 inline-only 문서는 추가 자산 복사를 하지 않는다.
- 저장 경고는 `Saved` 상태로 숨기지 않으며, autosave 경고는 live status로 노출한다.

## 릴리스 게이트

`npm run build`와 `npm test`가 기본 gate다. release 검증에는 fresh artifact의 Open, Drop, Save As, close, offline request 및 portable wrapper smoke가 추가로 필요하다.

`npm run verify:release`는 build → unit → renderer E2E → Electron E2E → package:built → Windows NSIS 무인 설치/실행/제거 순서로 검사한 결과를 패키징한다. 저장소의 합성 fixture 4종은 필수이며, 실제 승인 보고서는 `npm run test:local-samples`로 별도 검사한다. Electron E2E는 파일 선택창의 반환 경로를 대체하므로 실제 OS 대화상자·IME 수동 확인을 대체하지 않는다.

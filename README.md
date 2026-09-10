# HTMLpoint

Offline Windows HTML report editor with a PowerPoint-style shell.
PowerPoint 스타일의 셸 인터페이스를 기반으로 하는 오프라인 Windows HTML 보고서 에디터입니다.

## 다운로드 및 설치

일반 사용자는 Node.js나 npm을 설치할 필요가 없습니다.

1. [최신 Release](https://github.com/guyster323/HTMLpoint/releases/latest)를 엽니다.
2. 아래 두 배포판 중 하나를 내려받습니다.
   - `HTMLpoint-Setup-<version>-x64.exe`: 권장 설치판. 시작 메뉴와 바탕 화면 바로가기를 만듭니다.
   - `HTMLpoint-Portable-<version>-x64.exe`: 설치 권한이 없는 PC에서 사용하는 단일 실행 파일입니다.
3. 같은 Release의 `SHA256SUMS.txt`로 다운로드 파일의 무결성을 확인할 수 있습니다.

> 아직 Release가 보이지 않는 경우 유지관리자가 `v0.2.0` 같은 버전 태그를 push해야 합니다. 태그가 생성되면 GitHub Actions가 테스트, Windows 빌드, SHA-256 생성, Release 게시를 자동으로 수행합니다.

### 비정상 종료 복구

- 편집 후 5초 동안 추가 변경이 없으면 자동 복구본을 원본 옆 `.htmlpoint-backups` 폴더에 원자적으로 기록합니다.
- 원본 폴더가 읽기 전용이면 Windows 사용자 데이터 폴더의 `HTMLpoint/Backups`에 대신 보관합니다.
- 원본보다 새로운 복구본이 있으면 다음에 원본을 열 때 복구본과 원본 중 하나를 선택할 수 있습니다.
- 디스크가 계속 증가하지 않도록 문서별 자동 복구본 20개와 원본 백업 10개를 유지합니다.

---
## 🚀 프로젝트 소개 (Introduction)

`HTMLpoint`는 정적 HTML 보고서를 편리하게 시각적으로 편집하고 관리할 수 있도록 설계된 데스크톱 애플리케이션입니다. React (Vite) 렌더러와 Electron 프레임워크를 기반으로 구축되었으며, 단일 실행 파일(.exe) 형태의 포터블 환경을 지원하여 별도의 설치 없이 어디서나 구동 가능합니다.

- **PowerPoint-style UI/UX**: 슬라이드/섹션 기반의 탐색 창과 리본 메뉴, 속성 패널을 통해 직관적으로 HTML 요소를 편집할 수 있습니다.
- **안전한 데이터 보존**: 자동 백업 기능(5초 주기)을 통해 예기치 못한 종료 상황에서도 편집본을 안전하게 복구할 수 있습니다.
- **다양한 편집 도구**: 텍스트, 표(Table), 이미지, SVG 차트 데이터 편집 및 PPT 스타일 효과 적용을 지원합니다.

---
## 🛠️ 최근 개선 내용 (Recent Improvements - 2026-07-13)

최근 UI/UX 안정성 및 기능성 향상을 위해 총 20건의 핵심 이슈(HPT-001 ~ HPT-020)를 해결 및 검증하였습니다.
### 1. UI/UX 및 안정성 개선
- **무한 렌더링 문제 해결 (HPT-001)**: 문서가 비어 있거나 섹션 선택이 해제되었을 때 발생하던 무한 렌더 루프(`Maximum update depth exceeded`)를 Session Reducer 통합 및 참조 안정화를 통해 완전히 해결하였습니다.
- **작업 유실 방지 가드 도입 (HPT-002)**: 문서를 수정 중인 상태(Dirty)에서 다른 파일을 드롭하거나 앱을 종료할 때, 확인 및 저장 가드 모달을 제공하여 변경 사항이 무단 유실되는 현상을 차단했습니다.
- **레이아웃 반응성 강화 (HPT-013, HPT-019)**: 기본 뷰포트 배율을 화면 크기에 맞는 최적 비율(`Fit to window`)로 자동 계산하고, 1024px 이하의 소형 화면에서는 좌우 사이드 패널(Sections/Properties)을 접고 펼칠 수 있는 인터페이스를 추가하였습니다.
- **키보드 및 웹 접근성 개선 (HPT-014, HPT-020)**: 모달 팝업 시 포커스 트랩(Focus Trap) 및 Escape 닫기를 지원하며, 줌 컨트롤 및 숨김 섹션 설명 등의 스크린리더 Accessible Name 및 상태 레이블을 일치시켰습니다.
### 2. 편집 기능 및 데이터 보존 고도화
- **섹션 삭제 흐름 개선 (HPT-003)**: 활성화된 섹션을 삭제할 때 화면이 빈 상태로 남지 않고, 인접 섹션(다음 또는 이전)으로 선택이 유연하게 이동하며 편집 맥락을 유지하도록 수정했습니다.
- **마크업 보존 편집 (HPT-004)**: 인라인 강조 배지(`<span>`), 하이퍼링크(`<a>`) 등이 포함된 텍스트 편집 시, 원래의 HTML 마크업 구조를 손상시키지 않고 텍스트 토큰만 안전하게 교체하도록 수정했습니다.
- **효과(None) 적용 시 서식 복원 (HPT-006)**: 타이포그래피 효과를 `None`으로 해제할 때 기존의 인라인 스타일(폰트 크기, 행간, 색상 등)을 잃지 않고 원본 스타일로 안정적으로 복원하는 기능이 도입되었습니다.
- **차트 및 표 편집 강화 (HPT-005, HPT-009, HPT-010, HPT-017)**:
  - 차트 캡션 적용을 연속으로 호출할 때 캡션 내용이 유실되는 현상을 해결했습니다.
  - `<tbody>`만 있는 표에서 행 삽입 시 위치 어긋남 오류를 바로잡았습니다.
  - 세로 병합 셀 해제(Unmerge) 시 주변 셀 구조를 완벽하게 계산해 복원합니다.
  - 표 Inspector에 페이지네이션(20행 기준) 및 셀 좌표 이동을 지원하여 대형 표(13x9 이상)도 제약 없이 편집이 가능합니다.
### 3. 내부 시스템 및 파일 처리
- **안전한 이미지/자산 로드 (HPT-016)**: 보안 샌드박스 환경 내에서 상대 경로 이미지 및 CSS 자산이 깨지지 않고 렌더링되도록 전용 preview token base 및 custom protocol(`htmlpoint-asset`)을 구축하였습니다.
- **표 및 이미지 삽입 피드백 (HPT-012)**: 새 요소를 삽입하면 캔버스 스크롤 이동 및 포커싱이 수행되며 하단 상태바에 완료 피드백을 전달합니다.
- **지원하지 않는 파일 필터링 (HPT-007)**: 편집 불가능한 HTML 파일 임포트 시, 상태바 오도로 유도하지 않고 오류 팝업 및 안내를 통해 작업을 거부하도록 검증 프로세스를 보강했습니다.

---

## 개발 및 배포

아래 npm 명령은 앱 개발자와 유지관리자 전용입니다. 일반 사용자는 위 Release의 EXE를 사용하세요.

### 의존성 설치
```bash
npm install
```

### 개발 모드 실행 (Renderer + Electron)
```bash
npm run dev
```
### 단위 및 E2E 테스트 실행
```bash
# 단위 테스트
npm run test:unit

# E2E 렌더러 테스트
npm run test:e2e:renderer
```

### Windows 배포판 패키징
```bash
npm run package
```
빌드가 완료되면 `release/` 폴더에 설치판과 포터블판이 함께 생성됩니다.

```text
HTMLpoint-Setup-0.2.0-x64.exe
HTMLpoint-Portable-0.2.0-x64.exe
```

### GitHub Release 게시

```bash
git tag v0.2.0
git push origin v0.2.0
```

`.github/workflows/release.yml`이 Windows에서 잠금 파일 기반 `npm ci`, 단위 테스트, 패키징과 체크섬 생성을 수행한 뒤 GitHub Release에 배포판을 첨부합니다. 수동 실행 시에는 GitHub Actions의 artifact로만 생성되며 Release는 만들지 않습니다.

Windows 코드 서명 인증서가 있으면 Repository secrets에 `CSC_LINK`, `CSC_KEY_PASSWORD`를 등록하세요. 인증서가 없을 때도 빌드는 가능하지만 Windows SmartScreen 경고가 나타날 수 있습니다.

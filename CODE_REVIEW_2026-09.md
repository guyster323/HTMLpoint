# HTMLpoint 코드 리뷰 및 개선 결과

- 기준 브랜치: `main`
- 검토일: 2026-09-10
- 검토 범위: Electron main/preload, React 편집 상태, 파일 열기·저장·백업, preview protocol, Windows 패키징, CI/Release

## 결론

기존 HPT-001~020 수정은 편집 상태와 UI 회귀를 상당 부분 보완했지만, 실사용 안정성과 배포 과정에는 별도의 공백이 남아 있었다. 특히 자동 백업은 생성만 하고 복구 흐름이 없었으며, 백업 수 제한이 없어 장기 사용 시 디스크를 계속 점유했다. 운영 메뉴의 Reload는 dirty guard를 우회할 수 있었고, Save 동작이 항상 Save As 대화상자를 열었다. 저장 자산 스캐너는 data URL이 포함된 `srcset`과 `mailto:` 같은 URI를 로컬 파일로 오인할 수 있었다.

배포 측면에서는 README가 포터블 EXE를 안내했지만 GitHub Release와 자동 빌드 workflow가 없어, 실제 사용자는 소스 코드를 받고 `npm install`부터 수행해야 했다. 이는 배포판이라기보다 개발 프로젝트에 가까운 상태였다.

## 발견 사항과 조치

| 우선순위 | 발견 사항 | 사용자 영향 | 조치 |
|---|---|---|---|
| Critical | 자동 백업 복구 진입점 부재 | 비정상 종료 후 백업 파일을 직접 찾아야 하며, 존재 자체를 알기 어려움 | 원본보다 최신 autosave 탐지 및 열기 시 복구 선택창 추가 |
| High | 운영 메뉴 Reload가 변경 유실 방지 흐름을 우회 | 수정 중 Reload 시 현재 세션 유실 가능 | Reload/DevTools 메뉴를 개발 모드에만 노출 |
| High | 백업 파일 무제한 누적, 직접 write | 장기 사용 시 디스크 증가, 쓰기 중 종료 시 부분 파일 가능 | 동일 폴더 임시 파일+flush+rename, autosave 20개/bak 10개 유지 |
| High | Windows renderer URL을 문자열로 조합 | 설치 경로의 공백·역슬래시 처리에 취약 | `pathToFileURL()` 사용 |
| High | Release 부재 | 비전문가가 Node.js/npm/빌드 도구를 설치해야 함 | NSIS 설치판+포터블판 자동 빌드 및 GitHub Release workflow 추가 |
| Medium | Save가 항상 Save As로 동작 | 반복 저장마다 파일 선택창이 열림 | Ctrl+S/Save는 현재 파일 저장, Ctrl+Shift+S는 Save As로 분리 |
| Medium | `srcset` data URL을 comma로 단순 분리 | Save As 시 base64 조각을 파일 경로로 오인해 실패 | data URL을 보존하는 srcset parser 적용 |
| Medium | `mailto:`, `tel:`, `javascript:` 등을 자산으로 수집 | 링크가 있는 문서의 Save As가 실패할 수 있음 | URI scheme이 있는 참조를 로컬 자산 복사 대상에서 제외 |
| Medium | 읽기 전용 원본 폴더에서 autosave 실패 | 네트워크/권한 제한 폴더에서 복구본 미생성 | 사용자 데이터 폴더 fallback 추가 |
| Medium | 여러 앱 인스턴스 허용 | 동일 문서 동시 편집과 덮어쓰기 위험 | single-instance lock 및 기존 창 focus 적용 |
| Medium | preview message의 송신 frame 미검증 | 다른 iframe 메시지가 편집 명령으로 처리될 가능성 | 현재 Report preview의 `contentWindow`만 허용 |
| Medium | 존재하지 않는 `HTML_reference`를 패키징 대상으로 지정 | 깨끗한 CI/clone 환경에서 패키징 불안정 | 저장소에 없는 `extraResources` 제거 |
| Low | 최소 창 폭 1180px과 1024px 대응 UI 불일치 | 작은 화면 대응 기능을 실제 창에서 활용하기 어려움 | 최소 폭 900px, 최소 높이 640px로 조정 |

## 배포 방식 결정

기본 배포 방식은 npm/npx 또는 PyInstaller가 아니라 Windows 실행 파일이다.

- `npx`는 명령이 짧지만 Node.js 설치와 npm 네트워크 접근이 필요하므로 비전문가용 오프라인 배포판이 아니다.
- PyInstaller는 Python 프로그램을 묶는 도구이므로 React/Electron 앱을 다시 작성하지 않는 한 적합하지 않다.
- Electron Builder의 NSIS 설치판과 portable EXE는 현재 코드 구조를 유지하면서 사용자 PC에 개발 환경을 요구하지 않는다.

릴리스 산출물:

- `HTMLpoint-Setup-<version>-x64.exe`
- `HTMLpoint-Portable-<version>-x64.exe`
- `SHA256SUMS.txt`

## 검증 범위

- 추가한 파일 지속성 helper에 대해 원자적 쓰기, 원자적 복사, 보존 개수, backup 이름, srcset/URI 판별 회귀 테스트를 추가했다.
- 패키징 설정에 NSIS/portable 두 target과 Release workflow를 확인하는 테스트를 추가했다.
- 이 검토 환경에서는 npm registry 접근이 정책상 403으로 차단되어 의존성 설치와 Electron 실행 검증을 수행할 수 없었다. GitHub Actions가 깨끗한 Windows/Ubuntu runner에서 동일 잠금 파일로 이를 검증하도록 구성했다.

## 남은 위험과 다음 권장 사항

1. Windows 코드 서명 인증서를 workflow secret 또는 조직 signing service와 연결해야 SmartScreen 경고를 최소화할 수 있다.
2. 원본 HTML의 inline script는 preview sandbox 안에서 실행된다. 동적 차트 호환성을 위한 현재 설계이지만, 신뢰할 수 없는 HTML을 열 수 있는 제품으로 확장하려면 script 비활성 모드를 추가해야 한다.
3. 100 MB HTML, 25 MB 이미지 제한은 메모리 급증 방지용 초기 기준이다. 실제 현장 보고서 크기 분포를 수집한 뒤 조정할 수 있다.
4. Release workflow 최초 실행 후 설치판 설치/삭제, portable 실행, 한글·공백 경로 열기/저장을 Windows VM에서 확인해야 한다.
5. 현재 Electron 33 계열은 공식 지원 범위 밖이다. 이번 변경에서는 검증되지 않은 9개 major 동시 상승이 새 불안정을 만들 수 있어 즉시 교체하지 않았고, Dependabot과 CI를 추가했다. 지원 중인 Electron 42 이상으로 올리는 PR은 Windows 패키지 회귀를 통과한 뒤 병합해야 한다.
6. 공개 저장소에 `LICENSE`가 없다. 외부 배포 범위에 맞는 라이선스는 소유자가 선택해 추가해야 하므로 이번 변경에서 임의 지정하지 않았다.

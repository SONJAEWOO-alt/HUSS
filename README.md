# 천안·아산 고용 불균형 징후 탐색 — 실행 안내서

천안시·아산시의 산업별 고용구조, 빈 일자리, 청년 취업구조를 공공데이터로 분석하고
AI를 통해 고용 불균형 징후와 추가 조사 방향·개선 전략을 제안하는 웹서비스입니다.

> **서비스 성격**: 통계 조회가 아니라 지역 고용정책 의사결정 지원용 탐색 도구입니다.
> 현재 자료로 실제 구인·구직 미스매치 규모나 인과관계를 **확정할 수 없습니다.**

## 시스템 구성

| 구성 | 기술 | 포트 | 설명 |
|---|---|---|---|
| 프론트엔드 | React 18 + TypeScript + Vite + Tailwind + Recharts | 5173 (dev) | 화면 3종 (고용현황/청년징후/AI보고서) |
| 백엔드 | Node.js + Express | 8787 | 정적 데이터 API + Gemini + KOSIS + MCP 프록시 |
| 자체 MCP 서버 | 공식 MCP TypeScript SDK + Streamable HTTP | 8788 | 도구 4개 (아래 설명) |

```
web-app/
├── index.html, vite.config.ts, tailwind.config.js   # 프론트엔드 설정
├── src/
│   ├── types.ts              # 데이터 계약 타입 + 판단 규칙(judgeDiagnosis) + 표시 형식
│   ├── data.ts               # 정적 JSON 로딩 + 서비스 상태 조회 (비차단)
│   ├── App.tsx               # 탭 셸 + 헤더 서비스 상태 배지
│   └── components/
│       ├── ui.tsx            # 공용 UI (카드/배지/경고/출처/빈상태/스피너)
│       ├── DashboardScreen.tsx  # 화면① 산업별 고용 현황
│       ├── YouthScreen.tsx      # 화면② 청년 고용구조·불균형 징후
│       └── AiScreen.tsx         # 화면③ Gemini AI 분석·개선 전략
├── public/
│   ├── data/                 # 인계 R 집계 JSON 9개 (원본 그대로)
│   └── metadata/             # catalog/dimensions/ui_policy/sources/metrics
├── server/
│   ├── server.mjs            # Express 백엔드 (8787)
│   ├── lib/
│   │   ├── data.mjs          # 정적 데이터 레이어 + 무결성 검증 + evidence 구성
│   │   ├── gemini.mjs        # Gemini 호출 + 응답 검증기 (근거ID/금지어/status)
│   │   └── kosis.mjs         # KOSIS 공식 OpenAPI + 응답 검증 + 캐시
│   ├── mcp/
│   │   └── server.mjs        # 자체 MCP 서버 (8788, Streamable HTTP)
│   ├── test/
│   │   ├── run-tests.mjs     # 백엔드 통합 테스트 (40항목)
│   │   └── mcp-client-test.mjs # MCP 왕복 호출 테스트 (37항목)
│   └── .env.example          # API 키 설정 예시
└── dist/                     # 프로덕션 빌드 산출물 (빌드 시 생성)
```

## 빠른 시작

### 사전 요구
- Node.js 18 이상 (개발 검증: Node 26.13.0 LTS)
- API 키는 **선택**입니다. 키가 없어도 전체 서비스가 동작합니다.

### 1) 설치

```bash
cd web-app
npm install            # 프론트엔드 의존성
cd server
npm install            # 백엔드 의존성
```

### 2) API 키 설정 (선택)

```bash
cd server
cp .env.example .env   # Windows: copy .env.example .env
# .env 편집: GEMINI_API_KEY, KOSIS_API_KEY 값 입력
```

- `GEMINI_API_KEY`: [Google AI Studio](https://aistudio.google.com/apikey) 발급
- `KOSIS_API_KEY`: [KOSIS OpenAPI](https://kosis.kr/openapi/index/index.jsp) 일반 인증키 발급

### 3) 실행 (터미널 3개)

```bash
# 터미널 1 — 자체 MCP 서버
cd web-app/server
npm run mcp            # http://localhost:8788/mcp

# 터미널 2 — 백엔드
cd web-app/server
npm start              # http://localhost:8787

# 터미널 3 — 프론트엔드 (개발 모드)
cd web-app
npm run dev            # http://localhost:5173
```

브라우저에서 **http://localhost:5173** 접속. 헤더 우측의 서비스 상태 배지로
정적 데이터 / Gemini / KOSIS / MCP 각각의 연결 상태를 확인할 수 있습니다.

### 4) 프로덕션 모드 (단일 포트)

```bash
cd web-app
npm run build          # dist/ 생성
cd server
npm start              # http://localhost:8787 에서 앱+API+데이터 모두 서빙
```

## 테스트 실행

```bash
# 인계 패키지 데이터 계약 검증 (원본 검증 스크립트)
cd Antigravity_개발인계
node validation/verify_package.mjs

# 백엔드 통합 테스트 (데이터 무결성·판정 통제값·NULL/0 구분·AI 검증기·KOSIS 오류처리)
cd web-app/server
npm test               # 40항목

# MCP 클라이언트 왕복 테스트 (initialize → tools/list → tools/call 실제 호출)
# MCP 서버가 실행 중이어야 합니다
cd web-app/server
npm run test:mcp       # 37항목
```

## 자체 MCP 서버 (4개 도구)

공식 MCP TypeScript SDK(`@modelcontextprotocol/sdk`)와 Streamable HTTP로 직접 구현했습니다.
엔드포인트: `http://localhost:8788/mcp` (세션리스, JSON 응답 모드)

| 도구 | 입력 | 반환 |
|---|---|---|
| `get_analysis_snapshot` | dataset_id(8종 enum), city(cheonan/asan), period, basis, group | 정적 R 집계 행 + 출처·단위·표본 경고. `source_mode=static_r_snapshot`, `api_called=false` |
| `fetch_kosis_employment` | city, period(202401~202601), group(ALL/BC/F/GI/DHJK/ELS) | KOSIS 공식 API 실시간 조회 → 지역·기간·항목·단위 검증 → 정규화. 키 미설정 시 `auth_required` |
| `compare_employment_signals` | city, period(202502 고정), basis(workplace 고정), group(공통 5군) | 상대 공석강도·청년 참여 차이 + 검증된 진단 규칙 판정 (n<30 → 소표본·판단 유보) |
| `get_indicator_metadata` | dataset_id 또는 metric_id | 출처·변수·산식·기준기간·표본 필드·분석 한계 |

- 모든 입력은 zod enum/regex로 제한되며 임의 URL·파일 경로·dataset_id는 차단됩니다.
- MCP 클라이언트 테스트(`npm run test:mcp`)로 initialize → tools/list → tools/call
  왕복과 반환값 출처·상태를 실제 검증했습니다.
- MCP 서버가 꺼져 있어도 웹 대시보드는 정상 동작합니다 (백엔드가 상태를 별도 조회).

## 백엔드 API

| 엔드포인트 | 설명 |
|---|---|
| `GET /api/health` | 서버 상태 + 데이터 무결성 + 키 설정 여부 |
| `GET /api/data/:datasetId` | 데이터셋 원본 행 + 메타데이터 |
| `GET /api/snapshot?dataset_id=&city=&period=&basis=&group=` | 조건 스냅샷 (MCP ① 도구와 동일 로직) |
| `GET /api/ai/status` | Gemini 설정 상태 |
| `POST /api/ai/report` | AI 보고서 생성 (`{city, period, basis, group}`) — 근거표는 항상 반환 |
| `GET /api/kosis/status` | KOSIS 설정 상태 |
| `POST /api/kosis/employment` | KOSIS 실제 조회 (`{city, period, group}`) |
| `GET /api/mcp/status` | MCP 서버 상태 |
| `POST /api/mcp/call` | MCP 도구 프록시 (`{tool, args}`) |

## 데이터·판단 규칙 (요약)

- **데이터**: 2026-10-30 확인 정적 R 집계 스냅샷 8개. 임의 수치·더미 데이터 없음.
- **청년 = 15~29세 취업자** (구직자 아님). 진단 가능 기간은 **2025년 하반기뿐** (202601 선택 시 청년 진단 자동 결합 없음).
- **판단 우선순위** (ui_policy.json): 자료 없음 → 표본 관측 없음 → 소표본·판단 유보(n<30) → 추가 확인할 징후(조건 충족+n≥30) → 징후 미확인(≠균형).
- **NULL ≠ 0**: 표본 없는 산업 추정치 NULL 유지, 근무지 기준 청년인구/고용률은 "해당 없음" 표시.
- **금지 표현**: 미스매치 심각/확정, 균형 확인, 통계적으로 유의, 청년 구직자 부족 규모, 검증된 정책 효과.
- **분모 구분**: 제조업 C(상세) ≠ 광·제조업 BC(공통 5군), 전체산업 A~U ≠ 공통 5군, ALL ≠ 5군 합계.
- 개선 전략은 항상 **"검증 전 제안"**으로 표시되며 효과 추정치는 제공하지 않습니다.

## 보안

- API 키는 서버 측 `.env`에만 존재하며 프론트엔드 번들·응답·로그에 노출되지 않습니다.
- 개인별 MDIS 원자료는 패키지에 포함되지 않았고 서비스에서 다루지 않습니다.
- AI 응답은 근거 ID 존재 검증·status 일치 검증·금지어 검사를 통과해야만 표시됩니다.
- 사용자가 입력한 수치는 AI 근거로 사용하지 않고 서버가 JSON에서 직접 구성합니다.

## 현재 상태 정확 표기 (2026-10-30 실호출 검증 완료)

| 기능 | 구현 | 실제 호출 검증 |
|---|---|---|
| 정적 R 데이터 대시보드 (화면①②) | ✅ 완료 | ✅ 브라우저 검증 완료 |
| **KOSIS 공식 OpenAPI 실호출** | ✅ 완료 | ✅ **실제 호출 성공·검증 완료** (아래 상세) |
| **Gemini AI 실제 생성** | ✅ 완료 | ✅ **실제 생성 성공·검증 완료** (아래 상세) |
| **자체 MCP 서버 4도구** | ✅ 완료 | ✅ 왕복 호출 테스트 통과 |
| **MCP → KOSIS 실시간 조회** | ✅ 완료 | ✅ **MCP 도구로 공식 API 실제 호출 성공** |
| 외부 API 실패 시 정적 대시보드 | ✅ 설계 | ✅ 503·타임아웃 발생 중에도 화면①② 정상 동작 확인 |

### 실호출 검증 상세 (2026-10-30)

**KOSIS 공식 OpenAPI (DT_118N_MONA59)**
- 엔드포인트: `https://kosis.kr/openapi/Param/statisticsParameterData.do?method=getList`
- 항목코드: 16118z1(전체종사자)·z3(빈일자리)·z5(빈일자리율)·z7(입직자)·z11(이직자)
- 지역코드: 천안 `ZONE2017A343401`, 아산 `ZONE2017A343404` / 산업코드: `IND201700`(전산업) 외 5군
- 검증 결과: 천안 202502 전산업 API값(258,289명/2,118건/0.9%/8,450/9,869)이 R 스냅샷과 **100% 일치**.
  아산 202502 BC(90,992/668/0.7%/1,831/1,724), 아산 202601 DHJK(10,124/252/3.1%/1,166/982)도 일치.
- 응답 검증: 통계표 ID·지역(C1)·기간(PRD_DE)·산업(C2)·단위(UNIT_NM) 자동 대조, 수신시각·응답 SHA256 기록.

**Gemini AI (gemini-3.5-flash 계열, 503 시 자동 폴백)**
- 아산시/전기·운수·정보통신·금융/2025하반기/근무지 보고서 실제 생성 성공.
- 자동 검증 18/18 통과: 모든 관측 사실에 근거 ID 부착, 수치 7종(2.2%·0.8%·1.4%p·10.5253%·15.2975%·-4.7722%p·n=4)이
  evidence 값과 정확 일치, 근거 없는 임의 수치 없음, 금지 표현 없음, effect_estimate=null·verified_effect=false 유지.
- 모델 노트: gemini-3.8-flash·3.6-flash는 503 고수요로 폴백 체계(3.5-flash → 3.5-flash-lite → flash-latest → 2.5-flash) 구축.

**MCP → KOSIS**
- MCP 도구 `fetch_kosis_employment`(천안/202502/ALL) 호출 시 `source_mode=official_api`,
  `api_called=true`로 공식 API 실제 호출 후 정규화된 5개 항목 반환 확인.

인증키는 `server/.env`에서 관리하며 (`.env.example` 참조) 원문은 로그·응답·Git에 노출되지 않습니다.

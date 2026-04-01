# OSMU 콘텐츠 에이전트 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 하나의 소스로 5개 플랫폼(블로그/카페/쓰레드/링크드인/인스타) 콘텐츠를 동시 생성하는 Claude Code 스킬 구축

**Architecture:** 단일 스킬(`skills/osmu.md`) + 2개 knowledge 파일 + profiles/output 디렉토리 구조. CLAUDE.md에 자동 인식 로직 추가로 키워드 트리거 지원.

**Tech Stack:** Claude Code 스킬 (Markdown), 프로필 저장 (Markdown with frontmatter), HTML 미리보기

---

### Task 1: knowledge/osmu_사무창.md 생성 — 사무창 비즈니스 컨텍스트

**Files:**
- Create: `knowledge/osmu_사무창.md`

**Step 1: knowledge/osmu_사무창.md 작성**

사무창 비즈니스 컨텍스트를 knowledge 파일로 작성한다. 설계서의 "핵심 비즈니스 컨텍스트" 섹션 기반.

```markdown
# 사무창 비즈니스 컨텍스트

## 상품
농수산물·과일·선물세트 온라인 판매 마스터 클래스 (1년 멤버십)

## 핵심 가치 (USP)
1. **소싱 걱정 제로:** 대표가 직접 도매로 검증된 상품(명절 선물세트, 제철 과일) 공급
2. **시즌 집중:** 1년 내내 일하는 대신 설/추석, 겨울 시즌에 집중하여 폭발적 매출 창출
3. **AI 자동화:** 상세페이지, 썸네일, 키워드 발굴 등을 AI 도구로 자동화하여 시간 단축

## 포지셔닝
단순한 '강의'가 아닌, 혼자 안 해도 되는 **'AI 직원 서비스'**
"강의가 아니라 연봉 3,300만원짜리 AI 직원을 연 330만원에 고용하는 것"

## 타겟 고객
30~50대 직장인, 주부, 자영업자
- 공통 고민: 경제적 불안, 시간 부족, 기술 장벽

## 퍼널 구조
무료 리포트 → 10분 강의 → 웨비나 → 고가 멤버십 결제

## 금지어 (사짜 느낌 유발)
- "자동 수익", "월 1억 벌기", "누구나 쉽게", "클릭 몇 번으로"
- "강의" → 대신 '서비스', '멤버십' 사용

## 자주 사용하는 데이터 포인트
- 추석 13일 1.2억 매출 (수강생 성과)
- (추가 데이터 포인트는 프로필에서 관리)
```

**Step 2: 커밋**

```bash
git add knowledge/osmu_사무창.md
git commit -m "feat: 사무창 비즈니스 컨텍스트 knowledge 파일 추가"
```

---

### Task 2: knowledge/osmu_플랫폼.md 생성 — 5개 플랫폼 가이드라인

**Files:**
- Create: `knowledge/osmu_플랫폼.md`

**Step 1: knowledge/osmu_플랫폼.md 작성**

5개 플랫폼의 상세 가이드라인 + 공통 규칙을 작성한다. 설계서의 "3. 플랫폼별 콘텐츠 최적화 가이드라인" + "4. 콘텐츠 작성 공통 규칙" 기반.

각 플랫폼 섹션에 포함할 내용:
- 목적
- 형식 (글자수, 구조)
- 필수 제약사항
- 톤앤매너
- CTA 방식

공통 규칙 섹션:
- 클리셰 금지 목록 (게임 체인저, 패러다임 시프트 등 AI가 남용하는 표현 20개+)
- 데이터 기반 설득 원칙
- CTA 삽입 원칙
- 프로필 금지어 체크 프로세스

**Step 2: 커밋**

```bash
git add knowledge/osmu_플랫폼.md
git commit -m "feat: 5개 플랫폼 콘텐츠 가이드라인 knowledge 파일 추가"
```

---

### Task 3: skills/osmu.md 생성 — OSMU 스킬 본체

**Files:**
- Create: `skills/osmu.md`

**Step 1: 스킬 frontmatter + Phase 1 (프로필 확인/생성) 작성**

```markdown
---
name: osmu
description: OSMU 멀티플랫폼 콘텐츠 에이전트. SNS, 콘텐츠, 블로그, 카페, 쓰레드, 링크드인, 인스타, OSMU, 멀티플랫폼, 글 써줘 등의 요청 시 트리거됩니다.
---
```

Phase 1 내용:
- profiles/ 폴더 Glob으로 확인
- 0개: 프로필 생성으로 이동
- 1개: 해당 프로필 사용 여부 확인
- 2개+: 목록 제시 + 선택 or 새로 만들기

Phase 2 (프로필 생성) 내용:
- 7개 항목을 한 번에 하나씩 질문
- 질문 순서: 이름 → 비즈니스 → 상품 → 타겟 → USP → 톤 → CTA
- 톤앤매너는 선택지로 제시: ① 전문적+친근 ② 캐주얼+유머 ③ 격식+신뢰 ④ 직접 입력
- 수집 완료 → profiles/프로필명.md로 저장 (frontmatter 포함)

**Step 2: Phase 3 (콘텐츠 기획) 작성**

- 주제 질문
- 플랫폼 선택 (기본 5개, 선택지로 제시)
- 인스타 포함 시 카드뉴스 방식 선택 (HTML vs 이미지 프롬프트)

**Step 3: Phase 4 (콘텐츠 생성) 작성**

- knowledge/osmu_플랫폼.md Read 지시
- 프로필 Read 지시
- 각 플랫폼별 생성 프로세스 (설계서 규칙 참조)
- 자체 검토 체크리스트
- output/YYYY-MM-DD-주제명/ 폴더에 파일 저장

**Step 4: Phase 5 (HTML 미리보기) + 프로필 관리 + 후속 안내 작성**

- HTML 미리보기 생성 여부 질문
- preview.html: 5개 플랫폼 탭 UI
- 프로필 관리: 수정/삭제 처리
- 후속 안내 문구

**Step 5: 커밋**

```bash
git add skills/osmu.md
git commit -m "feat: OSMU 멀티플랫폼 콘텐츠 스킬 추가"
```

---

### Task 4: CLAUDE.md 업데이트 — OSMU 자동 인식 로직 추가

**Files:**
- Modify: `CLAUDE.md`

**Step 1: CLAUDE.md의 역할 섹션 업데이트**

기존:
```
당신은 올웨이즈/토스쇼핑 플랫폼 전문 상품 등록 서포터입니다.
```

변경:
```
당신은 올웨이즈/토스쇼핑 플랫폼 전문 **상품 등록 서포터** 겸 **OSMU 멀티플랫폼 콘텐츠 에이전트**입니다.
```

**Step 2: 자동 인식 로직에 OSMU 모드 추가**

"모드 판단 기준" 섹션의 맨 위에 OSMU 모드를 추가:

```markdown
**OSMU 콘텐츠 모드** — 다음 중 하나라도 해당하면:
- "SNS", "콘텐츠", "블로그 글", "카페 글", "쓰레드", "링크드인", "인스타", "OSMU" 등 언급
- "멀티플랫폼", "여러 채널", "SNS 올려", "글 써줘" 등 언급
- 동작: skills/osmu.md 스킬의 프로세스를 따른다
```

**Step 3: 지식베이스 참조 방법에 OSMU 파일 추가**

기존 3개에 추가:
```
4. `knowledge/osmu_플랫폼.md` — 5개 플랫폼(블로그/카페/쓰레드/링크드인/인스타) 가이드라인, 공통 규칙
5. `knowledge/osmu_사무창.md` — 사무창 비즈니스 컨텍스트, USP, 퍼널, 금지어
```

**Step 4: 커밋**

```bash
git add CLAUDE.md
git commit -m "feat: CLAUDE.md에 OSMU 콘텐츠 에이전트 자동 인식 로직 추가"
```

---

### Task 5: 디렉토리 구조 생성 + 검증

**Files:**
- Create: `profiles/.gitkeep`
- Create: `output/.gitkeep`

**Step 1: profiles/ 및 output/ 디렉토리 생성**

```bash
mkdir -p profiles output
touch profiles/.gitkeep output/.gitkeep
```

**Step 2: 전체 파일 구조 검증**

```bash
find . -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/상품등록-서포터/*' | head -30
```

기대 결과:
```
.
./CLAUDE.md
./skills/상품등록.md
./skills/osmu.md
./knowledge/황금코볼트식_상품등록법.md
./knowledge/올웨이즈_상품명_태그.md
./knowledge/상세페이지_기획.md
./knowledge/osmu_플랫폼.md
./knowledge/osmu_사무창.md
./profiles/.gitkeep
./output/.gitkeep
./docs/plans/...
```

**Step 3: 커밋**

```bash
git add profiles/.gitkeep output/.gitkeep
git commit -m "feat: profiles 및 output 디렉토리 구조 추가"
```

---

### Task 6: 통합 테스트 — 스킬 트리거 및 프로필 흐름 확인

**Step 1: 스킬 파일 읽기 검증**

skills/osmu.md의 frontmatter가 올바른지 확인:
- name: osmu
- description에 트리거 키워드 포함 여부

**Step 2: knowledge 파일 읽기 검증**

knowledge/osmu_플랫폼.md와 knowledge/osmu_사무창.md가 올바르게 읽히는지 확인.

**Step 3: CLAUDE.md 자동 인식 로직 검증**

CLAUDE.md에서 OSMU 모드 판단 기준이 상품등록 모드보다 먼저 체크되는지 확인.
(SNS/콘텐츠 키워드가 엑셀/도매/직접입력 모드에 우선하는지)

**Step 4: 프로필 예시 생성 테스트**

profiles/테스트.md를 임시 생성하여 형식 확인 후 삭제.

**Step 5: 최종 커밋**

변경사항이 있으면 커밋. 없으면 스킵.

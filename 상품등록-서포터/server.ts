import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import * as XLSX from "xlsx";

const PORT = 8765;
const DATA_DIR = join(import.meta.dir, "data");
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR);

// ── 시즌 데이터 ──
const FOOD_SEASONS: Record<number, { fruits: string[]; vegs: string[]; note: string }> = {
  1: { fruits: ["딸기","한라봉","천혜향","레드향"], vegs: ["시금치","무","배추","당근"], note: "설 선물세트" },
  2: { fruits: ["딸기","한라봉","천혜향"], vegs: ["시금치","무","배추"], note: "설 마무리" },
  3: { fruits: ["딸기","한라봉","금귤"], vegs: ["냉이","달래","두릅","미나리"], note: "환절기 비타민" },
  4: { fruits: ["참외","대저토마토","딸기"], vegs: ["봄동","미나리","두릅"], note: "봄 제철" },
  5: { fruits: ["참외","수박","체리","매실"], vegs: ["양파","감자","마늘"], note: "어린이날/어버이날" },
  6: { fruits: ["수박","참외","자두","블루베리"], vegs: ["양파","감자","옥수수"], note: "여름 시작" },
  7: { fruits: ["수박","복숭아","자두","포도"], vegs: ["옥수수","토마토"], note: "한여름" },
  8: { fruits: ["복숭아","포도","샤인머스캣"], vegs: ["고구마","옥수수"], note: "추석 준비" },
  9: { fruits: ["사과","배","샤인머스캣","포도"], vegs: ["고구마","밤","대추"], note: "추석 선물" },
  10: { fruits: ["사과","배","감","귤"], vegs: ["고구마","밤","잣"], note: "가을 과일" },
  11: { fruits: ["귤","감","사과"], vegs: ["배추","무","파","고추"], note: "김장 시즌" },
  12: { fruits: ["귤","딸기","한라봉"], vegs: ["배추","무"], note: "연말/크리스마스" },
};

const COMMISSION = { fresh: 0.058, processed: 0.106 };
const TOSS = { sales: 0.08, payment: 0.02 };
// 택배비는 자동 추정하지 않고 사용자가 직접 입력. 식품 기본 0원.

// ── 올웨이즈 카테고리별 수수료 (VAT 별도, knowledge/수수료_가이드.md 기준 2026.3) ──
const ALWAYZ_COMM: Record<string, number> = {
  // 식품
  "신선식품": 0.058,
  "건강식품": 0.076,
  "가공/즉석식품": 0.106,
  "가공식품": 0.106,
  "냉장/냉동식품": 0.106,
  "생수/음료": 0.106,
  "스낵/간식": 0.106,
  "유제품/아이스크림/디저트": 0.106,
  "유제품": 0.106,
  "장/소스": 0.106,
  "가루/조미료/향신료": 0.106,
  "커피/차": 0.106,
  "전통주": 0.106,
  // 생활용품
  "생활소품": 0.078,
  "생활잡화": 0.078,
  "화장지/물티슈": 0.09,
  "방충용품": 0.10,
  "방향/탈취/제습/살충": 0.10,
  "방향/탈취": 0.10,
  "생리대/성인기저귀": 0.10,
  "세제/세탁용품/청소용품": 0.108,
  "생활용품": 0.108,
  // 출산/유아동
  "기저귀/교체용품": 0.064,
  "분유/유아식품": 0.064,
  "유아물티슈/캡/홀더": 0.082,
  "유아위생/건강/세제": 0.098,
  "유아동 기타": 0.10,
  // 가전/디지털
  "컴퓨터/게임/SW": 0.05,
  "TV/영상가전": 0.058,
  "계절환경가전": 0.058,
  "냉장고/밥솥/주방가전": 0.058,
  "생활가전": 0.058,
  "가전/디지털": 0.058,
  "카메라/캠코더": 0.06,
  "휴대폰/태블릿PC/액세서리": 0.064,
  "음향기기/이어폰/스피커": 0.078,
  "이미용건강가전": 0.078,
  // 뷰티
  "뷰티": 0.096,
  // 패션
  "패션": 0.105,
  "패션의류": 0.105,
  "패션잡화": 0.105,
  // 기타
  "가구/홈데코": 0.108,
  "주방용품": 0.108,
  "반려/애완용품": 0.108,
  "반려용품": 0.108,
  "문구/오피스": 0.108,
  "문구": 0.108,
  "완구/취미": 0.108,
  "도서": 0.108,
  "스포츠/레져": 0.108,
  "스포츠": 0.108,
  "골프/자전거": 0.076,
  "자동차용품": 0.10,
};

// ── 마진 계산 함수 ──
interface OptionInput {
  optionName: string; cost: number;
}

interface MarginInput {
  name: string; cost: number; deliveryCost: number;
  isTaxable: boolean; // true=과세, false=면세
  category?: string; roas?: number; timeDiscount?: number;
  options?: OptionInput[]; // 옵션별 원가
}

function calcMargin(input: MarginInput) {
  const { name, cost, deliveryCost, isTaxable, category, roas = 300, timeDiscount = 20 } = input;
  const fresh = isFresh(name, category || "");
  const commRate = category && ALWAYZ_COMM[category] ? ALWAYZ_COMM[category] : (fresh ? 0.058 : 0.106);
  const commRateVAT = commRate * 1.1; // VAT 포함

  const modes = [
    { label: "공격적", mult: 1.55 },
    { label: "기본", mult: 1.8 },
    { label: "널널", mult: 2.2 },
  ];

  const results = modes.map(m => {
    const price = prettyPrice(cost * m.mult);
    const vat = isTaxable ? Math.round(price / 11) : 0;
    const commission = Math.round(price * commRateVAT);

    // 올웨이즈 일반 판매
    const alwayzNormal = price - cost - deliveryCost - commission - vat;

    // 올웨이즈 타임특가 가격/수수료/부가세
    const timePrice = prettyPrice(price * (1 - timeDiscount / 100));
    const timeVat = isTaxable ? Math.round(timePrice / 11) : 0;
    const timeComm = Math.round(timePrice * commRateVAT);
    const adCost = Math.round(timePrice / (roas / 100));

    // 타임특가 단독 (광고 없음)
    const alwayzTime = timePrice - cost - deliveryCost - timeComm - timeVat;

    // 타임특가 + CPS (20% 이상이면 CPS 무료)
    const cpsFree = timeDiscount >= 20;
    const alwayzTimeCPS = timePrice - cost - deliveryCost - timeComm - timeVat - (cpsFree ? 0 : adCost);
    // 타임특가 + CPC
    const alwayzTimeCPC = timePrice - cost - deliveryCost - timeComm - timeVat - adCost;

    // 일반 + CPC/CPS
    const alwayzAdCost = Math.round(price / (roas / 100));
    const alwayzCPS = price - cost - deliveryCost - commission - vat - alwayzAdCost;
    const alwayzCPC = price - cost - deliveryCost - commission - vat - alwayzAdCost;

    // 일반 + CPM
    const alwayzCPM = price - cost - deliveryCost - commission - vat - alwayzAdCost;

    // 토스 일반 (수수료 10%)
    const tossComm = Math.round(price * 0.10);
    const tossVat = isTaxable ? Math.round(price / 11) : 0;
    const tossNormal = price - cost - deliveryCost - tossComm - tossVat;

    // 토스 광고 (수수료 2%만, 운영수수료 면제)
    const tossAdComm = Math.round(price * 0.02);
    const tossAdCost = Math.round(price / (roas / 100));
    const tossAd = price - cost - deliveryCost - tossAdComm - tossVat - tossAdCost;

    return {
      mode: m.label, mult: m.mult, price,
      vat, commission,
      alwayz: {
        // 시나리오 1: 일반 판매 (광고/프로모션 없음)
        normal: { profit: alwayzNormal, rate: +((alwayzNormal / price) * 100).toFixed(1) },
        // 시나리오 2: 타임특가 단독 (광고 없음)
        time: { price: timePrice, profit: alwayzTime, rate: +((alwayzTime / timePrice) * 100).toFixed(1), discount: timeDiscount },
        // 시나리오 3: CPM 광고 단독 (CPM은 타임특가와 결합 불가)
        cpm: { profit: alwayzCPM, rate: +((alwayzCPM / price) * 100).toFixed(1), adCost: alwayzAdCost },
        // 시나리오 4: CPC 광고 단독
        cpc: { profit: alwayzCPC, rate: +((alwayzCPC / price) * 100).toFixed(1), adCost: alwayzAdCost },
        // 시나리오 5: CPS 광고 단독
        cps: { profit: alwayzCPS, rate: +((alwayzCPS / price) * 100).toFixed(1), adCost: alwayzAdCost },
        // 시나리오 6: 타임특가 + CPC
        timeCPC: { price: timePrice, profit: alwayzTimeCPC, rate: +((alwayzTimeCPC / timePrice) * 100).toFixed(1), adCost, discount: timeDiscount },
        // 시나리오 7: 타임특가 + CPS (할인≥20%면 광고비 무료)
        timeCPS: { price: timePrice, profit: alwayzTimeCPS, rate: +((alwayzTimeCPS / timePrice) * 100).toFixed(1), cpsFree, adCost: cpsFree ? 0 : adCost, discount: timeDiscount },
      },
      toss: {
        normal: { profit: tossNormal, rate: +((tossNormal / price) * 100).toFixed(1), commission: tossComm },
        ad: { profit: tossAd, rate: +((tossAd / price) * 100).toFixed(1), commission: tossAdComm, adCost: tossAdCost },
      },
    };
  });

  // 옵션별 계산
  const optionResults = (input.options && input.options.length > 0) ? input.options.map(opt => {
    const optModes = [
      { label: "공격적", mult: 1.55 },
      { label: "기본", mult: 1.8 },
      { label: "널널", mult: 2.2 },
    ].map(m => {
      const price = prettyPrice(opt.cost * m.mult);
      const vat = isTaxable ? Math.round(price / 11) : 0;
      const commission = Math.round(price * commRateVAT);
      const profit = price - opt.cost - deliveryCost - commission - vat;
      const rate = +((profit / price) * 100).toFixed(1);
      // 토스
      const tossComm = Math.round(price * 0.10);
      const tossVat = isTaxable ? Math.round(price / 11) : 0;
      const tossProfit = price - opt.cost - deliveryCost - tossComm - tossVat;
      const tossRate = +((tossProfit / price) * 100).toFixed(1);
      return { mode: m.label, mult: m.mult, price, profit, rate, tossProfit, tossRate };
    });
    return { optionName: opt.optionName, cost: opt.cost, modes: optModes };
  }) : [];

  return {
    name, cost, deliveryCost, isTaxable, category: category || (fresh ? "신선식품" : "가공식품"),
    commRate, commRateVAT, roas, timeDiscount,
    modes: results,
    options: optionResults,
  };
}

// ── 상품 CRUD ──
const MARGIN_FILE = join(DATA_DIR, "margin_products.json");

function loadMarginProducts(): any[] {
  if (existsSync(MARGIN_FILE)) return JSON.parse(readFileSync(MARGIN_FILE, "utf-8"));
  return [];
}

function saveMarginProducts(products: any[]) {
  writeFileSync(MARGIN_FILE, JSON.stringify(products, null, 2));
}

const FRESH_KW = ["과일","채소","야채","감자","고구마","양파","사과","배","딸기","수박","참외","토마토","포도",
  "복숭아","감귤","귤","한라봉","천혜향","레드향","자두","체리","블루베리","매실","밤","대추",
  "시금치","무","배추","당근","파","마늘","옥수수","고추","버섯","미나리","두릅","냉이","달래",
  "생선","수산","해산","새우","오징어","고등어","갈치","육류","한우","돼지","닭","오리",
  "신선","제철","산지직송","냉장","냉동"];

function findCol(headers: string[], keywords: string[]): string | null {
  for (const h of headers) {
    const l = (h + "").toLowerCase().replace(/\s/g, "");
    for (const kw of keywords) if (l.includes(kw)) return h;
  }
  return null;
}

// 끝자리를 항상 900원으로 맞춤 (가장 가까운 _900). 동률이면 위쪽 우선.
function prettyPrice(raw: number): number {
  if (raw <= 900) return 900;
  const lower = Math.floor(raw / 1000) * 1000 + 900; // 같은 천단위의 _900
  if (raw === lower) return raw;
  if (raw < lower) {
    const below = lower - 1000;
    return (lower - raw <= raw - below) ? lower : Math.max(900, below);
  }
  const above = lower + 1000;
  return (raw - lower <= above - raw) ? lower : above;
}

function isFresh(name: string, cat: string): boolean {
  const lower = (name + " " + cat).toLowerCase();
  return FRESH_KW.some(kw => lower.includes(kw));
}

function analyzeExcel(buffer: ArrayBuffer, colMap?: { name?: string; price?: string; cat?: string; weight?: string }) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, any>[];
  if (data.length === 0) return { error: "데이터가 비어있습니다", headers: [], products: [] };

  const headers = Object.keys(data[0]);

  const nameCol = colMap?.name || findCol(headers, ["상품명","품명","제품명","이름","품목","name","상품","product","item","물품","물품명"]);
  const priceCol = colMap?.price || findCol(headers, ["원가","매입가","공급가","단가","도매가","가격","cost","price","입금가","판매단가","금액","입금단가","공급단가"]);
  const catCol = colMap?.cat || findCol(headers, ["카테고리","분류","품목","종류","category"]);
  const weightCol = colMap?.weight || findCol(headers, ["용량","규격","중량","무게","사이즈","weight","단위"]);

  if (!nameCol || !priceCol) {
    const preview = data.slice(0, 3).map(row => {
      const obj: Record<string, string> = {};
      headers.forEach(h => obj[h] = (row[h] + "").substring(0, 30));
      return obj;
    });
    return { error: "column_mapping_needed", headers, preview, detected: { nameCol, priceCol } };
  }

  const month = new Date().getMonth() + 1;
  const season = FOOD_SEASONS[month];
  const seasonKW = [...season.fruits, ...season.vegs].map(s => s.toLowerCase());

  const products = [];

  for (const row of data) {
    const name = (row[nameCol] + "").trim();
    if (!name) continue;
    const cost = parseInt((row[priceCol] + "").replace(/[^0-9]/g, "")) || 0;
    if (cost <= 0) continue;

    const cat = catCol ? (row[catCol] + "").trim() : "";
    const weight = weightCol ? (row[weightCol] + "").trim() : "";
    const fresh = isFresh(name, cat);
    const commRate = fresh ? COMMISSION.fresh : COMMISSION.processed;
    // 택배비는 사용자가 직접 입력해야 하므로 자동 추정 없이 0원으로 시작 (식품 기본)
    const delCost = 0;

    const calc = (mult: number) => {
      const price = prettyPrice(cost * mult);
      const margin = price - cost - price * commRate - delCost;
      return { price, margin, rate: +((margin / price) * 100).toFixed(1) };
    };

    const tossCalc = (price: number, adSale: boolean) => {
      const salesFee = adSale ? 0 : price * TOSS.sales;
      const payFee = price * TOSS.payment;
      const margin = price - cost - salesFee - payFee - delCost;
      return { margin, rate: +((margin / price) * 100).toFixed(1) };
    };

    const normal = calc(1.8);
    const aggressive = calc(1.55);
    const relaxed = calc(2.2);
    const tossNormal = tossCalc(normal.price, false);
    const tossAd = tossCalc(normal.price, true);

    let seasonScore = 0;
    const lower = name.toLowerCase();
    for (const kw of seasonKW) if (lower.includes(kw)) seasonScore += 2;
    seasonScore = Math.min(seasonScore, 5);

    let alwayzFit = 0;
    if (normal.price >= 8000 && normal.price <= 15000) alwayzFit += 2;
    else if (normal.price >= 5000 && normal.price <= 20000) alwayzFit += 1;
    if (normal.rate >= 25) alwayzFit += 2;
    else if (normal.rate >= 15) alwayzFit += 1;

    let tossFit = 0;
    if (normal.price >= 15000 && normal.price <= 35000) tossFit += 2;
    else if (normal.price >= 10000 && normal.price <= 40000) tossFit += 1;
    if (tossNormal.rate >= 20) tossFit += 2;
    else if (tossNormal.rate >= 10) tossFit += 1;

    products.push({
      name, cost, category: cat, weight, isFresh: fresh,
      commissionRate: commRate, deliveryCost: delCost,
      prices: { aggressive: aggressive.price, normal: normal.price, relaxed: relaxed.price },
      margins: { aggressive, normal, relaxed },
      toss: { ...tossNormal, adMargin: tossAd.margin, adRate: tossAd.rate },
      seasonScore, alwayzFit: Math.min(alwayzFit, 5), tossFit: Math.min(tossFit, 5),
    });
  }

  products.sort((a, b) => b.margins.normal.rate - a.margins.normal.rate);

  // 분석 결과를 JSON 파일로 저장 → 클로드 코드가 읽을 수 있음
  const resultPath = join(DATA_DIR, "analyzed_products.json");
  writeFileSync(resultPath, JSON.stringify({
    analyzedAt: new Date().toISOString(),
    season: { month, ...season },
    totalProducts: products.length,
    seasonProducts: products.filter(p => p.seasonScore >= 2).length,
    products,
  }, null, 2));

  return { products, headers, detected: { nameCol, priceCol, catCol, weightCol } };
}

// ── 마진 템플릿 생성 ──
function createMarginTemplate(): Buffer {
  const wb = XLSX.utils.book_new();

  // 입력 시트
  const sampleData = [
    { "상품명": "예) 성주 참외", "옵션명": "3kg", "원가": 8000, "택배비": 0, "과세구분": "면세", "카테고리": "신선식품" },
    { "상품명": "예) 성주 참외", "옵션명": "5kg", "원가": 12000, "택배비": 0, "과세구분": "면세", "카테고리": "신선식품" },
    { "상품명": "예) 성주 참외", "옵션명": "10kg", "원가": 20000, "택배비": 0, "과세구분": "면세", "카테고리": "신선식품" },
    { "상품명": "", "옵션명": "", "원가": "", "택배비": "", "과세구분": "", "카테고리": "" },
  ];
  const ws = XLSX.utils.json_to_sheet(sampleData);
  ws["!cols"] = [
    { wch: 20 }, { wch: 15 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 15 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "상품입력");

  // 안내 시트
  const guideData = [
    { "항목": "상품명", "설명": "상품 이름 (같은 상품의 옵션은 상품명을 동일하게 적어주세요)", "예시": "성주 참외" },
    { "항목": "옵션명", "설명": "용량, 무게, 개수 등 (없으면 비워두세요)", "예시": "3kg" },
    { "항목": "원가", "설명": "도매에서 사는 가격 (숫자만)", "예시": "8000" },
    { "항목": "택배비", "설명": "내가 부담하는 택배비 (무료배송이면 0)", "예시": "0" },
    { "항목": "과세구분", "설명": "면세 또는 과세 (과일/채소=면세, 가공식품/공산품=과세)", "예시": "면세" },
    { "항목": "카테고리", "설명": "아래 카테고리 중 선택 (수수료가 달라요)", "예시": "신선식품" },
    { "항목": "", "설명": "", "예시": "" },
    { "항목": "[ 카테고리 목록 ]", "설명": "수수료율", "예시": "" },
    { "항목": "신선식품", "설명": "5.8%", "예시": "과일, 채소, 생선, 고기" },
    { "항목": "건강식품", "설명": "7.6%", "예시": "건강즙, 영양제" },
    { "항목": "가공식품", "설명": "10.6%", "예시": "과자, 음료, 즉석식품" },
    { "항목": "생활소품", "설명": "7.8%", "예시": "소형 생활용품" },
    { "항목": "뷰티", "설명": "9.6%", "예시": "화장품, 스킨케어" },
    { "항목": "패션", "설명": "10.5%", "예시": "의류, 잡화" },
    { "항목": "생활용품", "설명": "10.8%", "예시": "대형 생활용품, 주방" },
  ];
  const ws2 = XLSX.utils.json_to_sheet(guideData);
  ws2["!cols"] = [{ wch: 18 }, { wch: 50 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, ws2, "작성방법");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// ── 수식 포함 엑셀 생성 (사용자가 엑셀에서 값 편집 시 자동 재계산) ──
function createMarginFormulaExport(products: any[]): Buffer {
  const wb = XLSX.utils.book_new();

  // 옵션별로 평탄화
  type Row = {
    name: string; option: string; cost: number; deliveryCost: number;
    isTaxable: boolean; category: string; roas: number; timeDiscount: number;
    mult: number;
  };
  const rows: Row[] = [];
  for (const p of products) {
    const roas = p.roas ?? p.calc?.roas ?? 300;
    const timeDiscount = p.timeDiscount ?? p.calc?.timeDiscount ?? 20;
    const category = p.category || p.calc?.category || "신선식품";
    const opts = p.calc?.options;
    if (opts && opts.length > 0) {
      for (const opt of opts) {
        rows.push({
          name: p.name, option: opt.optionName, cost: opt.cost,
          deliveryCost: p.deliveryCost || 0, isTaxable: !!p.isTaxable,
          category, roas, timeDiscount, mult: 1.8,
        });
      }
    } else {
      rows.push({
        name: p.name, option: "-", cost: p.cost, deliveryCost: p.deliveryCost || 0,
        isTaxable: !!p.isTaxable, category, roas, timeDiscount, mult: 1.8,
      });
    }
  }

  // ── 시트 1: 마진 계산 (수식) ──
  const headers = [
    "상품명", "옵션명", "원가", "택배비", "과세구분", "카테고리",   // A-F 입력
    "수수료율",                                                      // G 수식
    "배수",                                                          // H 입력
    "판매가",                                                        // I 수식
    "ROAS(%)", "할인율(%)",                                          // J-K 입력
    "타임특가가",                                                    // L 수식
    "부가세", "올_수수료", "광고비",                                  // M-O 수식
    "올_순이익(일반)", "올_마진율(일반)",                              // P-Q
    "올_순이익(타임+CPS)", "올_순이익(타임+CPC)", "올_순이익(일반+CPC)", // R-T
    "토스_수수료(일반)", "토스_순이익(일반)",                          // U-V
    "토스_수수료(광고)", "토스_순이익(광고)",                          // W-X
  ];
  // 헤더 + 입력 셀만 aoa로 먼저 생성
  const aoa: any[][] = [headers];
  for (const r of rows) {
    aoa.push([
      r.name, r.option, r.cost, r.deliveryCost, r.isTaxable ? "과세" : "면세", r.category,
      "", r.mult, "", r.roas, r.timeDiscount, "",
      "", "", "", "", "", "", "", "", "", "", "", "",
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // 수식 셀 직접 설정 (aoa_to_sheet는 formula 객체를 처리 못함)
  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    const setF = (col: string, formula: string) => {
      ws[`${col}${rowNum}`] = { t: "n", f: formula };
    };
    setF("G", `IFERROR(VLOOKUP(F${rowNum},수수료표!A:B,2,FALSE),0.058)`);
    setF("I", `ROUND(C${rowNum}*H${rowNum}/100,0)*100-100`);
    setF("L", `ROUND(I${rowNum}*(1-K${rowNum}/100)/100,0)*100-100`);
    setF("M", `IF(E${rowNum}="과세",ROUND(I${rowNum}/11,0),0)`);
    setF("N", `ROUND(I${rowNum}*G${rowNum}*1.1,0)`);
    setF("O", `IF(J${rowNum}>0,ROUND(I${rowNum}/(J${rowNum}/100),0),0)`);
    setF("P", `I${rowNum}-C${rowNum}-D${rowNum}-N${rowNum}-M${rowNum}`);
    setF("Q", `IF(I${rowNum}=0,0,P${rowNum}/I${rowNum})`);
    setF("R", `L${rowNum}-C${rowNum}-D${rowNum}-ROUND(L${rowNum}*G${rowNum}*1.1,0)-IF(E${rowNum}="과세",ROUND(L${rowNum}/11,0),0)-IF(K${rowNum}>=20,0,IF(J${rowNum}>0,ROUND(L${rowNum}/(J${rowNum}/100),0),0))`);
    setF("S", `L${rowNum}-C${rowNum}-D${rowNum}-ROUND(L${rowNum}*G${rowNum}*1.1,0)-IF(E${rowNum}="과세",ROUND(L${rowNum}/11,0),0)-IF(J${rowNum}>0,ROUND(L${rowNum}/(J${rowNum}/100),0),0)`);
    setF("T", `P${rowNum}-O${rowNum}`);
    setF("U", `ROUND(I${rowNum}*0.1,0)`);
    setF("V", `I${rowNum}-C${rowNum}-D${rowNum}-U${rowNum}-M${rowNum}`);
    setF("W", `ROUND(I${rowNum}*0.02,0)`);
    setF("X", `I${rowNum}-C${rowNum}-D${rowNum}-W${rowNum}-M${rowNum}-O${rowNum}`);
    // Q열(마진율)은 퍼센트 포맷
    ws[`Q${rowNum}`].z = "0.0%";
  }

  // !ref 재계산 (X열까지 포함)
  ws["!ref"] = XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 23, r: rows.length } });

  ws["!cols"] = [
    { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 12 },
    { wch: 9 }, { wch: 7 }, { wch: 10 }, { wch: 8 }, { wch: 9 }, { wch: 11 },
    { wch: 9 }, { wch: 10 }, { wch: 9 },
    { wch: 14 }, { wch: 10 },
    { wch: 16 }, { wch: 16 }, { wch: 14 },
    { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 },
  ];
  ws["!freeze"] = { xSplit: "2", ySplit: "1" };

  XLSX.utils.book_append_sheet(wb, ws, "마진 계산");

  // ── 시트 2: 수수료표 (VLOOKUP 참조용) ──
  const commData: any[][] = [
    ["카테고리", "수수료율"],
    ...Object.entries(ALWAYZ_COMM).map(([cat, rate]) => [cat, rate]),
  ];
  const wsComm = XLSX.utils.aoa_to_sheet(commData);
  wsComm["!cols"] = [{ wch: 18 }, { wch: 10 }];
  // B열 퍼센트 포맷
  for (let i = 2; i <= commData.length; i++) {
    const cell = wsComm[`B${i}`];
    if (cell) cell.z = "0.0%";
  }
  XLSX.utils.book_append_sheet(wb, wsComm, "수수료표");

  // ── 시트 3: 사용법 ──
  const guideData = [
    ["📝 수식 포함 엑셀 사용법"],
    [""],
    ["✏️ 편집 가능한 셀 (이것만 바꾸면 나머지는 자동 계산)"],
    ["C열", "원가", "매입가. 바꾸면 판매가·마진 전체가 자동 재계산"],
    ["D열", "택배비", "무료배송이면 0"],
    ["E열", "과세구분", "'과세' 또는 '면세' 입력. 과세면 부가세 자동 차감"],
    ["F열", "카테고리", "수수료표 시트의 카테고리명과 일치해야 VLOOKUP 작동"],
    ["H열", "배수", "1.55(공격) / 1.8(기본) / 2.2(널널). 원하는 값 입력"],
    ["J열", "ROAS(%)", "광고 효율. 기본 300 (광고비 = 판매가 ÷ ROAS%)"],
    ["K열", "할인율(%)", "타임특가 할인율. 20 이상이면 CPS 광고비 자동 무료"],
    [""],
    ["📊 자동 계산 셀 (수식이 들어있음 - 건드리지 않는 게 좋아요)"],
    ["G열", "수수료율", "카테고리 기반 VLOOKUP"],
    ["I열", "판매가", "원가×배수 → 끝자리 900원 반올림"],
    ["L열", "타임특가가", "판매가×(1-할인율%)"],
    ["M열", "부가세", "과세면 판매가/11, 면세면 0"],
    ["N열", "올_수수료", "판매가×수수료율×1.1 (VAT 포함)"],
    ["O열", "광고비", "판매가÷(ROAS%/100)"],
    ["P열", "올_순이익(일반)", "판매가 - 원가 - 택배비 - 수수료 - 부가세"],
    ["Q열", "올_마진율(일반)", "순이익/판매가 (%)"],
    ["R열", "올_순이익(타임+CPS)", "타임특가 기준. 할인율 20%↑이면 CPS 광고비 무료"],
    ["S열", "올_순이익(타임+CPC)", "타임특가 기준, CPC 광고비 차감"],
    ["T열", "올_순이익(일반+CPC)", "일반가 - 광고비"],
    ["U열", "토스_수수료(일반)", "판매가×10% (운영8% + 결제2%)"],
    ["V열", "토스_순이익(일반)", "광고 미집행 시 토스 순이익"],
    ["W열", "토스_수수료(광고)", "판매가×2% (광고 집행 시 운영수수료 면제)"],
    ["X열", "토스_순이익(광고)", "광고 집행 시 토스 순이익"],
    [""],
    ["💡 주의사항"],
    ["", "판매가(I열) 수식을 지우고 직접 가격을 입력하면 원하는 예쁜 가격(예: 14,800)으로 고정 가능"],
    ["", "카테고리 수수료율이 다르면 '수수료표' 시트에서 수정"],
    ["", "원가/택배비 입력은 반드시 숫자만 (콤마 없이)"],
  ];
  const wsGuide = XLSX.utils.aoa_to_sheet(guideData);
  wsGuide["!cols"] = [{ wch: 8 }, { wch: 22 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsGuide, "사용법");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// ── 엑셀 마진 일괄 계산 ──
function calcMarginFromExcel(buffer: ArrayBuffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  // 첫 번째 시트 (또는 "상품입력" 시트)
  const sheetName = wb.SheetNames.includes("상품입력") ? "상품입력" : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, any>[];

  if (data.length === 0) return { error: "데이터가 비어있습니다", products: [] };

  // 컬럼 매핑
  const headers = Object.keys(data[0]);
  const nameCol = findCol(headers, ["상품명","품명","제품명","이름","name"]);
  const optCol = findCol(headers, ["옵션","옵션명","용량","규격","무게","option"]);
  const costCol = findCol(headers, ["원가","매입가","도매가","공급가","cost","가격"]);
  const delCol = findCol(headers, ["택배비","배송비","delivery"]);
  const taxCol = findCol(headers, ["과세","과세구분","세금","tax"]);
  const catCol = findCol(headers, ["카테고리","분류","category"]);

  if (!nameCol || !costCol) {
    return { error: "상품명과 원가 컬럼을 찾을 수 없습니다. 템플릿을 사용해주세요.", products: [], headers };
  }

  // 상품별로 그룹핑 (같은 상품명 = 같은 상품의 옵션들)
  const productMap = new Map<string, { name: string; deliveryCost: number; isTaxable: boolean; category: string; options: { optionName: string; cost: number }[] }>();

  for (const row of data) {
    const name = (row[nameCol] + "").trim();
    if (!name) continue;
    const cost = parseInt((row[costCol] + "").replace(/[^0-9]/g, "")) || 0;
    if (cost <= 0) continue;

    const optName = optCol ? (row[optCol] + "").trim() : "";
    const delCost = delCol ? (parseInt((row[delCol] + "").replace(/[^0-9]/g, "")) || 0) : 0;
    const taxStr = taxCol ? (row[taxCol] + "").trim() : "";
    const isTaxable = (taxStr.includes("과세") && !taxStr.includes("면세") && !taxStr.includes("비과세")) || taxStr.toLowerCase() === "true";
    const category = catCol ? (row[catCol] + "").trim() : "";

    if (!productMap.has(name)) {
      productMap.set(name, {
        name,
        deliveryCost: delCost,
        isTaxable,
        category: category || (isFresh(name, "") ? "신선식품" : "가공식품"),
        options: [],
      });
    }

    const product = productMap.get(name)!;
    product.options.push({ optionName: optName || `${cost}원`, cost });
  }

  // 마진 계산
  const results: any[] = [];
  for (const [, p] of productMap) {
    const mainCost = p.options[0]?.cost || 0;
    const input: MarginInput = {
      name: p.name,
      cost: mainCost,
      deliveryCost: p.deliveryCost,
      isTaxable: p.isTaxable,
      category: p.category,
      options: p.options,
    };
    const calc = calcMargin(input);
    results.push({
      ...p,
      cost: mainCost,
      roas: 300,
      timeDiscount: 20,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      createdAt: new Date().toISOString(),
      calc,
    });
  }

  return { products: results, totalRows: data.length, totalProducts: results.length };
}

// ── Bun 서버 ──
const server = Bun.serve({
  port: PORT,
  idleTimeout: 255, // 최대값 255초 (Bun 제한)
  async fetch(req) {
    const url = new URL(req.url);

    // CORS
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE", "Access-Control-Allow-Headers": "Content-Type" } });
    }

    // API: 마진 템플릿 다운로드
    if (url.pathname === "/api/margin-template" && req.method === "GET") {
      try {
        const buf = createMarginTemplate();
        return new Response(buf, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="${encodeURIComponent("마진계산_템플릿.xlsx")}"`,
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
      }
    }

    // API: 엑셀 마진 일괄 계산
    if (url.pathname === "/api/margin-calc-excel" && req.method === "POST") {
      try {
        const formData = await req.formData();
        const file = formData.get("file") as File;
        if (!file) return Response.json({ error: "파일이 없습니다" }, { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });
        const buffer = await file.arrayBuffer();
        const result = calcMarginFromExcel(Buffer.from(buffer));
        return Response.json(result, { headers: { "Access-Control-Allow-Origin": "*" } });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
      }
    }

    // API: 엑셀 마진 결과 전체 저장
    if (url.pathname === "/api/margin-products/save-bulk" && req.method === "POST") {
      try {
        const body = await req.json();
        const existing = loadMarginProducts();
        for (const p of body.products) {
          existing.push(p);
        }
        saveMarginProducts(existing);
        return Response.json({ ok: true, total: body.products.length }, { headers: { "Access-Control-Allow-Origin": "*" } });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
      }
    }

    // API: 엑셀 업로드 + 분석
    if (url.pathname === "/api/analyze" && req.method === "POST") {
      try {
        const formData = await req.formData();
        const file = formData.get("file") as File;
        const colMapStr = formData.get("colMap") as string;
        const colMap = colMapStr ? JSON.parse(colMapStr) : undefined;

        if (!file) return Response.json({ error: "파일이 없습니다" }, { status: 400 });
        const buffer = await file.arrayBuffer();
        const result = analyzeExcel(Buffer.from(buffer), colMap);
        return Response.json(result, { headers: { "Access-Control-Allow-Origin": "*" } });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
      }
    }

    // API: 저장된 분석 결과 조회 (클로드 코드용)
    if (url.pathname === "/api/products") {
      const resultPath = join(DATA_DIR, "analyzed_products.json");
      if (existsSync(resultPath)) {
        return new Response(readFileSync(resultPath, "utf-8"), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
      return Response.json({ error: "분석 결과 없음. 대시보드에서 엑셀을 먼저 업로드하세요." }, { status: 404 });
    }

    // API: 선택한 상품 저장 (대시보드 → 클로드 코드 연결)
    if (url.pathname === "/api/select" && req.method === "POST") {
      const body = await req.json();
      const selectPath = join(DATA_DIR, "selected_product.json");
      writeFileSync(selectPath, JSON.stringify({ selectedAt: new Date().toISOString(), ...body }, null, 2));
      return Response.json({ ok: true }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    // API: 선택한 상품 조회 (클로드 코드용)
    if (url.pathname === "/api/selected") {
      const selectPath = join(DATA_DIR, "selected_product.json");
      if (existsSync(selectPath)) {
        return new Response(readFileSync(selectPath, "utf-8"), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
      return Response.json({ error: "선택된 상품 없음" }, { status: 404 });
    }

    // API: 마진 계산
    if (url.pathname === "/api/margin-calc" && req.method === "POST") {
      try {
        const body = await req.json() as MarginInput;
        const result = calcMargin(body);
        return Response.json(result, { headers: { "Access-Control-Allow-Origin": "*" } });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
      }
    }

    // API: 마진 상품 목록 조회
    if (url.pathname === "/api/margin-products" && req.method === "GET") {
      return Response.json(loadMarginProducts(), { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    // API: 마진 상품 추가/수정
    if (url.pathname === "/api/margin-products" && req.method === "POST") {
      try {
        const body = await req.json();
        const products = loadMarginProducts();
        if (body.id) {
          const idx = products.findIndex((p: any) => p.id === body.id);
          if (idx >= 0) products[idx] = { ...products[idx], ...body, updatedAt: new Date().toISOString() };
        } else {
          body.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          body.createdAt = new Date().toISOString();
          // 마진 계산 실행
          const calc = calcMargin(body);
          products.push({ ...body, calc });
        }
        saveMarginProducts(products);
        return Response.json({ ok: true, products }, { headers: { "Access-Control-Allow-Origin": "*" } });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
      }
    }

    // API: 마진 상품 삭제
    if (url.pathname.startsWith("/api/margin-products/") && req.method === "DELETE") {
      const id = url.pathname.split("/").pop();
      let products = loadMarginProducts();
      products = products.filter((p: any) => p.id !== id);
      saveMarginProducts(products);
      return Response.json({ ok: true }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    // API: 마진 상품 엑셀 내보내기
    if (url.pathname === "/api/margin-products/export" && req.method === "GET") {
      try {
        const products = loadMarginProducts();
        if (products.length === 0) {
          return Response.json({ error: "저장된 상품이 없습니다" }, { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
        }

        const rows: any[] = [];
        products.forEach((p: any) => {
          const c = p.calc;
          const m = c?.modes?.[1]; // 기본 모드
          const opts = c?.options;

          // 옵션이 있으면 옵션별 행, 없으면 상품 1행
          if (opts && opts.length > 0) {
            opts.forEach((opt: any) => {
              const om = opt.modes?.[1]; // 기본 모드
              const oa = opt.modes?.[0]; // 공격적
              const or_ = opt.modes?.[2]; // 널널
              rows.push({
                "상품명": p.name,
                "옵션명": opt.optionName,
                "원가": opt.cost,
                "택배비": p.deliveryCost,
                "과세구분": p.isTaxable ? "과세" : "면세",
                "카테고리": p.category || "",
                "공격적_판매가": oa?.price || 0,
                "공격적_마진": oa?.profit || 0,
                "공격적_마진율(%)": oa?.rate || 0,
                "기본_판매가": om?.price || 0,
                "기본_마진": om?.profit || 0,
                "기본_마진율(%)": om?.rate || 0,
                "널널_판매가": or_?.price || 0,
                "널널_마진": or_?.profit || 0,
                "널널_마진율(%)": or_?.rate || 0,
                "토스_일반_마진": om?.tossProfit || 0,
                "토스_마진율(%)": om?.tossRate || 0,
                "올웨이즈_타임특가+CPS": om?.profit || 0,
                "올웨이즈_CPC": oa?.profit || 0,
                "등록일": p.createdAt ? new Date(p.createdAt).toLocaleDateString("ko-KR") : "",
              });
            });
          } else {
            rows.push({
              "상품명": p.name,
              "옵션명": "-",
              "원가": p.cost,
              "택배비": p.deliveryCost,
              "과세구분": p.isTaxable ? "과세" : "면세",
              "카테고리": p.category || "",
              "공격적_판매가": c?.modes?.[0]?.price || 0,
              "공격적_마진": c?.modes?.[0]?.alwayz?.normal?.profit || 0,
              "공격적_마진율(%)": c?.modes?.[0]?.alwayz?.normal?.rate || 0,
              "기본_판매가": m?.price || 0,
              "기본_마진": m?.alwayz?.normal?.profit || 0,
              "기본_마진율(%)": m?.alwayz?.normal?.rate || 0,
              "널널_판매가": c?.modes?.[2]?.price || 0,
              "널널_마진": c?.modes?.[2]?.alwayz?.normal?.profit || 0,
              "널널_마진율(%)": c?.modes?.[2]?.alwayz?.normal?.rate || 0,
              "토스_일반_마진": m?.toss?.normal?.profit || 0,
              "토스_마진율(%)": m?.toss?.normal?.rate || 0,
              "올웨이즈_타임특가+CPS": m?.alwayz?.timeCPS?.profit || 0,
              "올웨이즈_CPC": m?.alwayz?.cpc?.profit || 0,
              "등록일": p.createdAt ? new Date(p.createdAt).toLocaleDateString("ko-KR") : "",
            });
          }
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);

        // 열 너비 설정
        ws["!cols"] = [
          { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 12 },
          { wch: 12 }, { wch: 12 }, { wch: 12 },
          { wch: 12 }, { wch: 12 }, { wch: 12 },
          { wch: 12 }, { wch: 12 }, { wch: 12 },
          { wch: 14 }, { wch: 12 },
          { wch: 18 }, { wch: 14 },
          { wch: 12 },
        ];

        XLSX.utils.book_append_sheet(wb, ws, "마진계산");
        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

        const filename = `마진계산_${new Date().toISOString().slice(0, 10)}.xlsx`;
        return new Response(buf, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
      }
    }

    // API: 마진 상품 수식 포함 엑셀 내보내기 (엑셀에서 값 편집 시 자동 재계산)
    if (url.pathname === "/api/margin-products/export-formula" && req.method === "GET") {
      try {
        const products = loadMarginProducts();
        if (products.length === 0) {
          return Response.json({ error: "저장된 상품이 없습니다" }, { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
        }
        const buf = createMarginFormulaExport(products);
        const filename = `마진계산_수식포함_${new Date().toISOString().slice(0, 10)}.xlsx`;
        return new Response(buf, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
      }
    }

    // API: 마진 상품 일괄 계산 (엑셀)
    if (url.pathname === "/api/margin-bulk" && req.method === "POST") {
      try {
        const body = await req.json() as { products: MarginInput[] };
        const results = body.products.map(p => ({ ...p, calc: calcMargin(p) }));
        // 저장
        const existing = loadMarginProducts();
        for (const r of results) {
          (r as any).id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          (r as any).createdAt = new Date().toISOString();
          existing.push(r);
        }
        saveMarginProducts(existing);
        return Response.json({ ok: true, results, total: results.length }, { headers: { "Access-Control-Allow-Origin": "*" } });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
      }
    }

    // API: 상세페이지 블록 미리보기 (프롬프트 승인용)
    if (url.pathname === "/api/detail-page/preview" && req.method === "POST") {
      try {
        const body = await req.json() as { product: string; mode: string; style: string; platform: string };
        const BLOCKS_LITE     = ["히어로","셀링포인트","시즐컷","배송","CTA"];
        const BLOCKS_STANDARD = ["히어로","셀링포인트","시즐컷","원재료","소셜프루프","배송","CTA"];
        const BLOCKS_FULL     = ["히어로","셀링포인트","시즐컷","원재료","제조공정","맛설명","소셜프루프","보관해동","배송","CTA"];
        const modeMap: Record<string,string[]> = { lite: BLOCKS_LITE, standard: BLOCKS_STANDARD, full: BLOCKS_FULL, prompt: BLOCKS_STANDARD };
        const blockNames = modeMap[body.mode] ?? BLOCKS_STANDARD;
        const p = body.product;
        const defaultCopy: Record<string,string> = {
          "히어로":    `${p} — 신선한 맛 그대로`,
          "셀링포인트": `${p}를 선택해야 하는 3가지 이유`,
          "시즐컷":    `한 입 베어물면 알 수 있어요`,
          "원재료":    `좋은 재료가 맛의 시작입니다`,
          "제조공정":  `위생적인 과정, 믿을 수 있는 품질`,
          "맛설명":    `${p}의 달콤함과 풍미를 느껴보세요`,
          "소셜프루프": `구매 고객 만족도 ★4.9 / 재구매율 76%`,
          "보관해동":  `냉장 보관 / 유통기한 O일`,
          "배송":      `신선 보냉 포장 · 당일 출고`,
          "CTA":       `지금 바로 주문하세요! 오늘만 특가`,
          "FAQ":       `자주 묻는 질문`,
          "가격구성":  `합리적인 구성으로 더 알뜰하게`,
          "브랜드스토리": `믿음으로 만든 ${p}`,
          "영양정보":  `${p} 영양 성분표`,
          "법적표기":  `원재료명 및 성분 표시`,
          "조리법":    `맛있게 먹는 방법`,
        };
        const blocks = blockNames.map((name, i) => ({
          num: i + 1,
          name,
          copy: defaultCopy[name] ?? `${p} — ${name}`,
          hint: `블록 ${i+1}: ${name} 섹션`,
        }));
        return Response.json({ ok: true, blocks, product: p, style: body.style, platform: body.platform, mode: body.mode }, { headers: { "Access-Control-Allow-Origin": "*" } });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
      }
    }

    // API: 상세페이지 생성 (SSE 스트리밍 + 병렬)
    if (url.pathname === "/api/detail-page/generate" && req.method === "POST") {
      const body = await req.json() as {
        product: string; platform: string; style: string; mode: string; apiKey: string;
        quality?: number; blocks?: { num: number; name: string; copy: string }[];
      };
      if (!body.product || !body.apiKey) {
        return Response.json({ error: "상품명과 API 키가 필요합니다." }, { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });
      }

      const scriptPath = join(import.meta.dir, "gemini-image.py");
      const safeProduct = body.product.replace(/[/\\?%*:|"<>]/g, "_");
      const outputDir = join(DATA_DIR, "detail-pages", safeProduct);
      mkdirSync(outputDir, { recursive: true });

      const platform = (body.platform || "alwayz") === "naver" ? "smartstore" : (body.platform || "alwayz");
      const isPromptOnly = body.mode === "prompt";

      // 블록 목록: 미리보기에서 받은 blocks 우선, 없으면 기본 세트
      let blocks: { num: number; name: string; copy: string }[];
      if (body.blocks && body.blocks.length > 0) {
        blocks = body.blocks;
      } else {
        const BLOCKS_LITE     = ["히어로","셀링포인트","시즐컷","배송","CTA"];
        const BLOCKS_STANDARD = ["히어로","셀링포인트","시즐컷","원재료","소셜프루프","배송","CTA"];
        const BLOCKS_FULL     = ["히어로","셀링포인트","시즐컷","원재료","제조공정","맛설명","소셜프루프","보관해동","배송","CTA"];
        const modeMap: Record<string,string[]> = { lite: BLOCKS_LITE, standard: BLOCKS_STANDARD, full: BLOCKS_FULL, prompt: BLOCKS_STANDARD };
        const names = modeMap[body.mode] ?? BLOCKS_STANDARD;
        blocks = names.map((name, i) => ({ num: i+1, name, copy: `${body.product} — ${name}` }));
      }

      const enc = new TextEncoder();
      const quality = body.quality ? String(body.quality) : null;
      const apiKey = body.apiKey;
      const style = body.style || "clean";

      const stream = new ReadableStream({
        async start(controller) {
          const send = (obj: object) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

          // 30초마다 heartbeat (idle 타임아웃 방지)
          const heartbeat = setInterval(() => {
            try { controller.enqueue(enc.encode(`: heartbeat\n\n`)); } catch {}
          }, 30_000);

          send({ type: "start", total: blocks.length, product: body.product });

          // 병렬 생성
          await Promise.all(blocks.map(async (block) => {
            send({ type: "generating", num: block.num, name: block.name });
            try {
              const args = ["python3", scriptPath,
                "--product", body.product,
                "--block", block.name,
                "--block-num", String(block.num),
                "--copy", block.copy || `${body.product} — ${block.name}`,
                "--style", style,
                "--platform", platform,
                "--output", outputDir,
              ];
              if (isPromptOnly) args.push("--prompt-only");
              if (quality) args.push("--quality", quality);

              const proc = Bun.spawn(args, {
                env: { ...process.env, GEMINI_API_KEY: apiKey },
                stdout: "pipe", stderr: "pipe",
              });
              const exitCode = await proc.exited;
              const stderr = await new Response(proc.stderr).text();
              if (exitCode === 0) {
                if (isPromptOnly) {
                  // 프롬프트 파일 읽어서 전송
                  const promptFile = join(outputDir, `${String(block.num).padStart(2,"0")}_${block.name}_prompt.txt`);
                  const promptText = existsSync(promptFile) ? readFileSync(promptFile, "utf-8") : "";
                  send({ type: "done", num: block.num, name: block.name, promptText });
                } else {
                  const filename = `${String(block.num).padStart(2,"0")}_${block.name}.jpg`;
                  send({ type: "done", num: block.num, name: block.name,
                    path: `/data/detail-pages/${safeProduct}/${filename}` });
                }
              } else {
                send({ type: "failed", num: block.num, name: block.name, error: stderr.slice(0, 200) });
              }
            } catch (e: any) {
              send({ type: "failed", num: block.num, name: block.name, error: e.message });
            }
          }));

          // 생성된 이미지 목록 수집 + 합본
          try {
            const { readdirSync } = await import("fs");
            const images = readdirSync(outputDir)
              .filter(f => f.match(/^\d+_.*\.(jpg|jpeg|png|webp)$/i))
              .sort()
              .map(f => `/data/detail-pages/${safeProduct}/${f}`);

            // Pillow로 합본 생성
            const combineScript = `
from PIL import Image
import pathlib, re, functools
d = pathlib.Path(r'${outputDir}')
fs = sorted([f for f in d.iterdir() if re.match(r'\\d+_.*\\.(jpg|jpeg|png|webp)$', f.name, re.I)])
if fs:
    imgs = [Image.open(f).convert('RGB') for f in fs]
    c = Image.new('RGB', (imgs[0].width, sum(i.height for i in imgs)), (255,255,255))
    y = 0
    for i in imgs:
        c.paste(i, (0, y)); y += i.height
    c.save(r'${outputDir}/combined_전체.jpg', quality=85)
    print('combined ok')
`.trim();

            const combineProc = Bun.spawn(["python3", "-c", combineScript],
              { stdout: "pipe", stderr: "pipe" });
            await combineProc.exited;

            send({ type: "complete", images,
              combined: existsSync(join(outputDir, "combined_전체.jpg"))
                ? `/data/detail-pages/${safeProduct}/combined_전체.jpg` : null });
          } catch (_) {
            send({ type: "complete", images: [], combined: null });
          }

          clearInterval(heartbeat);
          controller.close();
        }
      });

      return new Response(stream, { headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      }});
    }

    // API: 상세페이지 API 키 저장/조회
    if (url.pathname === "/api/detail-page/apikey" && req.method === "POST") {
      const body = await req.json() as { apiKey: string };
      const envPath = join(import.meta.dir, ".env");
      const existing = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
      const updated = existing.replace(/^GEMINI_API_KEY=.*/m, "").trim();
      writeFileSync(envPath, (updated ? updated + "\n" : "") + `GEMINI_API_KEY=${body.apiKey}\n`);
      return Response.json({ ok: true }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (url.pathname === "/api/detail-page/apikey" && req.method === "GET") {
      const envPath = join(import.meta.dir, ".env");
      if (existsSync(envPath)) {
        const content = readFileSync(envPath, "utf-8");
        const match = content.match(/^GEMINI_API_KEY=(.+)$/m);
        if (match) return Response.json({ apiKey: match[1].trim() }, { headers: { "Access-Control-Allow-Origin": "*" } });
      }
      return Response.json({ apiKey: "" }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    // 정적 파일 서빙
    const filePath = url.pathname === "/" ? "/dashboard.html" : url.pathname;
    const fullPath = join(import.meta.dir, filePath);

    if (existsSync(fullPath)) {
      const file = Bun.file(fullPath);
      return new Response(file);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`
╔══════════════════════════════════════════╗
║  🚀 상품 서포터 v2.5 실행 중!            ║
║                                          ║
║  대시보드: http://localhost:${PORT}           ║
║                                          ║
║  사용법:                                  ║
║  1. 브라우저에서 위 주소 열기             ║
║  2. 엑셀 파일 드래그앤드롭               ║
║  3. 상품 선택 → 클로드 코드 자동 연동    ║
║                                          ║
║  종료: Ctrl+C                            ║
╚══════════════════════════════════════════╝
`);

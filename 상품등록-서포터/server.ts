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
const TOSS = { sales: 0.08, payment: 0.016 };
const DELIVERY: Record<string, number> = { light: 3000, medium: 3500, heavy: 4500 };

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

function prettyPrice(raw: number): number {
  const r = Math.round(raw / 100) * 100;
  const last3 = r % 1000;
  if (last3 >= 750) return r - last3 + 900;
  if (last3 >= 250) return r - last3 + 800;
  return r - last3 + 900 - 1000;
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
    const delCost = cost > 10000 ? DELIVERY.heavy : cost > 5000 ? DELIVERY.medium : DELIVERY.light;

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

// ── Bun 서버 ──
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST", "Access-Control-Allow-Headers": "Content-Type" } });
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
║  🚀 상품 서포터 v2 실행 중!              ║
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

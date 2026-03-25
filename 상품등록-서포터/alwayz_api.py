"""
올웨이즈 판매자센터 API 클라이언트
- 로그인, 상품 등록, 상품 조회, 주문 확인 등 자동화
- 누구든 자기 계정으로 사용 가능
"""

import requests
import json
import os
from pathlib import Path


class AlwayzSellerAPI:
    BASE_URL = "https://alwayz-seller-back.ilevit.com"
    ASSET_URL = "https://assets.ilevit.com"

    def __init__(self):
        self.token = None
        self.seller_id = None
        self.session = requests.Session()

    # ─── 인증 ───────────────────────────────────────────────

    def login(self, login_id: str, password: str) -> dict:
        """로그인 후 JWT 토큰 획득"""
        r = self.session.post(
            f"{self.BASE_URL}/sellers/login",
            json={"loginId": login_id, "password": password},
        )
        r.raise_for_status()
        data = r.json()
        self.token = data.get("data", {}).get("token") or data.get("token")
        if not self.token:
            # 응답 구조가 다를 수 있으므로 전체 데이터에서 탐색
            for key in ("accessToken", "access_token"):
                self.token = data.get("data", {}).get(key) or data.get(key)
                if self.token:
                    break
        if not self.token:
            raise ValueError(f"토큰을 찾을 수 없습니다. 응답: {json.dumps(data, ensure_ascii=False)}")

        # JWT에서 seller ID 추출
        import base64
        payload = self.token.split(".")[1]
        payload += "=" * (4 - len(payload) % 4)
        decoded = json.loads(base64.b64decode(payload))
        self.seller_id = decoded.get("seller", {}).get("id")

        self.session.headers.update({"x-access-token": self.token})
        return {"seller_id": self.seller_id, "token_preview": self.token[:20] + "..."}

    def _headers(self):
        return {"x-access-token": self.token}

    def _get(self, path: str, params: dict = None) -> dict:
        r = self.session.get(f"{self.BASE_URL}{path}", params=params)
        r.raise_for_status()
        return r.json()

    def _post(self, path: str, json_data: dict = None, files=None) -> dict:
        if files:
            r = self.session.post(f"{self.BASE_URL}{path}", files=files)
        else:
            r = self.session.post(f"{self.BASE_URL}{path}", json=json_data)
        r.raise_for_status()
        return r.json()

    # ─── 대시보드 ───────────────────────────────────────────

    def get_dashboard(self) -> dict:
        """대시보드 정보 (매출, 정산 등)"""
        return self._get("/sellers/dashboardInfo")

    def get_order_status_counts(self) -> dict:
        """주문 현황 요약 (팀 모집 완료, 상품 준비, 발송중, 배송중 등)"""
        return self._get("/sellers/orders/status-counts")

    def get_seller_score(self) -> dict:
        """판매자 점수/등급 정보"""
        return self._get("/sellers/score/period-calculated")

    # ─── 주문 관리 ──────────────────────────────────────────

    def get_orders(self, status: str = None, page: int = 1, limit: int = 20) -> dict:
        """
        주문 목록 조회
        status: TEAM_GATHERING_FINISHED, PRODUCT_PREPARING, SHIPPING,
                DELIVERING, DELIVERED, CANCEL_REQUESTED, RETURN_REQUESTED 등
        """
        params = {"page": page, "limit": limit}
        if status:
            params["status"] = status
        return self._get("/sellers/orders", params=params)

    # ─── 카테고리 ───────────────────────────────────────────

    def get_categories(self) -> dict:
        """전체 카테고리 트리 조회"""
        return self._get("/sellers/categories")

    def find_category(self, keyword: str) -> list:
        """키워드로 카테고리 검색"""
        cats = self.get_categories()
        results = []
        for large in cats.get("data", []):
            large_name = large["largeCategoryNames"]["kr"]
            for medium in large.get("mediumCategories", []):
                medium_name = medium["mediumCategoryNames"]["kr"]
                for small in medium.get("smallCategories", []):
                    small_name = small["smallCategoryNames"]["kr"]
                    full_name = f"{large_name} > {medium_name} > {small_name}"
                    if keyword in full_name:
                        results.append({
                            "full_name": full_name,
                            "largeCategoryId": large["_id"],
                            "mediumCategoryId": medium["_id"],
                            "smallCategoryId": small["_id"],
                        })
        return results

    # ─── 이미지 업로드 ──────────────────────────────────────

    def upload_image(self, image_path: str) -> str:
        """
        이미지 파일 업로드 후 URL 반환
        image_path: 로컬 이미지 파일 경로
        """
        with open(image_path, "rb") as f:
            files = {"image": (os.path.basename(image_path), f, "image/jpeg")}
            r = self.session.post(f"{self.BASE_URL}/images", files=files)
            r.raise_for_status()
            data = r.json()
        # 응답에서 이미지 URL 추출
        return data.get("data", {}).get("uri") or data.get("data", {}).get("url", "")

    def upload_images(self, image_paths: list) -> list:
        """여러 이미지 업로드"""
        return [self.upload_image(p) for p in image_paths]

    # ─── 상품 관리 ──────────────────────────────────────────

    def get_item(self, item_id: str) -> dict:
        """상품 상세 조회"""
        return self._get("/sellers/items", params={"itemId": item_id})

    def get_shipping_companies(self) -> list:
        """사용 가능한 택배사 목록"""
        return self._get("/sellers/shipping-companies")

    def register_item(self, item_data: dict) -> dict:
        """
        상품 등록

        item_data 필수 필드:
        {
            "categoryInfo": {
                "largeCategoryId": 3,       # 식품=3, 패션=0 등
                "mediumCategoryId": 42,
                "smallCategoryId": 280,
            },
            "itemTitle": "상품명",
            "optionsInfo": {
                "optionNames": ["중량"],     # 옵션 그룹명
                "totalOptions": [
                    [
                        {"name": "3kg", "img": None},
                        {"name": "5kg", "img": None},
                    ]
                ],
                "optionPrices": [
                    [
                        {
                            "individualPurchasePrice": 19800,
                            "teamPurchasePrice": 14800,
                            "stockNumber": 100,
                        },
                        {
                            "individualPurchasePrice": 29800,
                            "teamPurchasePrice": 22800,
                            "stockNumber": 100,
                        },
                    ]
                ],
            },
            "mainImageUris": ["https://..."],
            "detailImageUris": ["https://...", ...],
            "shippingInfo": {
                "freeShipping": True,
                "shippingMethod": "순차배송",
                "shippingFee": 0,
                "shippingFeeInfo": "무료배송, 도서산간 추가 배송비 ...",
                "returnFee": 5000,
                "returnFeeInfo": "5000원 ...",
                "shippingCompany": "CJ대한통운",
                "shippingDays": 3,
            },
            "commonMetaDataInfoList": [...],  # 제조자, 원산지 등
        }
        """
        return self._post("/sellers/items", json_data=item_data)

    # ─── 헬퍼: 간편 상품 등록 ───────────────────────────────

    def build_item_data(
        self,
        title: str,
        category_ids: dict,
        options: list,
        main_image_uri: str,
        detail_image_uris: list,
        shipping_company: str = "CJ대한통운",
        shipping_days: int = 3,
        return_fee: int = 5000,
        jeju_fee: int = 3000,
        rural_fee: int = 5000,
        manufacturer: str = "",
        origin_country: str = "한국",
        as_name: str = "",
        as_phone: str = "",
        production_date: str = "2025.01",
        keywords: list = None,
        purchase_limit: int = 10,
        team_size: int = 2,
    ) -> dict:
        """
        간편하게 상품 데이터 구성

        options 형식:
        [
            {
                "option_name": "중량",       # 옵션 그룹명
                "choices": [
                    {"name": "3kg", "team_price": 14800, "individual_price": 19800, "stock": 100},
                    {"name": "5kg", "team_price": 22800, "individual_price": 29800, "stock": 100},
                ]
            }
        ]
        """
        # 옵션 구조 변환
        option_names = [opt["option_name"] for opt in options]
        total_options = []
        option_prices_matrix = []

        for opt in options:
            group_options = [{"name": c["name"], "img": None} for c in opt["choices"]]
            total_options.append(group_options)

            group_prices = [
                {
                    "individualPurchasePrice": c["individual_price"],
                    "teamPurchasePrice": c["team_price"],
                    "stockNumber": c.get("stock", 100),
                }
                for c in opt["choices"]
            ]
            option_prices_matrix.append(group_prices)

        # 도서산간 배송비 정보
        rural_areas = [
            {"ruralAreaName": "인천 중구 섬지역", "startPostNumber": "22386", "endPostNumber": "22388", "shippingFee": str(rural_fee)},
            {"ruralAreaName": "인천 강화 섬지역", "startPostNumber": "23004", "endPostNumber": "23010", "shippingFee": str(rural_fee)},
            {"ruralAreaName": "인천 옹진 섬지역1", "startPostNumber": "23100", "endPostNumber": "23116", "shippingFee": str(rural_fee)},
            {"ruralAreaName": "인천 옹진 섬지역2", "startPostNumber": "23124", "endPostNumber": "23136", "shippingFee": str(rural_fee)},
            {"ruralAreaName": "충남 당진 섬지역", "startPostNumber": "31708", "endPostNumber": "31708", "shippingFee": str(rural_fee)},
            {"ruralAreaName": "충남 태안 섬지역", "startPostNumber": "32133", "endPostNumber": "32133", "shippingFee": str(rural_fee)},
            {"ruralAreaName": "충남 보령 섬지역", "startPostNumber": "33411", "endPostNumber": "33411", "shippingFee": str(rural_fee)},
            {"ruralAreaName": "경북 울릉도 전지역", "startPostNumber": "40200", "endPostNumber": "40240", "shippingFee": str(rural_fee)},
            {"ruralAreaName": "부산 강서구 섬지역", "startPostNumber": "46768", "endPostNumber": "46771", "shippingFee": str(rural_fee)},
            {"ruralAreaName": "경남 사천 섬지역", "startPostNumber": "52570", "endPostNumber": "52571", "shippingFee": str(rural_fee)},
            {"ruralAreaName": "경남 통영 섬지역", "startPostNumber": "53031", "endPostNumber": "53104", "shippingFee": str(rural_fee)},
            {"ruralAreaName": "경남 거제 섬지역", "startPostNumber": "53325", "endPostNumber": "53325", "shippingFee": str(rural_fee)},
            {"ruralAreaName": "전남 여수 섬지역", "startPostNumber": "59650", "endPostNumber": "59766", "shippingFee": str(rural_fee)},
            {"ruralAreaName": "전남 고흥 섬지역", "startPostNumber": "59531", "endPostNumber": "59563", "shippingFee": str(rural_fee)},
            {"ruralAreaName": "전남 완도 섬지역", "startPostNumber": "59102", "endPostNumber": "59149", "shippingFee": str(rural_fee)},
            {"ruralAreaName": "전남 진도 섬지역", "startPostNumber": "58953", "endPostNumber": "58958", "shippingFee": str(rural_fee)},
            {"ruralAreaName": "전남 신안 전지역", "startPostNumber": "58800", "endPostNumber": "58866", "shippingFee": str(rural_fee)},
            {"ruralAreaName": "제주 전지역", "startPostNumber": "63000", "endPostNumber": "63644", "shippingFee": str(jeju_fee)},
        ]

        # 공통 메타데이터 (상품 주요정보)
        common_meta = [
            {"title": "제조자", "placeholder": "수입품의 경우 수입자 괄호로 함께 표기", "isNecessary": True, "contents": manufacturer},
            {"title": "제조국(원산지)", "placeholder": "", "isNecessary": True, "contents": origin_country},
            {"title": "취급시 주의사항(선택)", "placeholder": "", "isNecessary": False, "contents": ""},
            {"title": "제조연월(생산연월)", "placeholder": "", "isNecessary": True, "contents": production_date},
            {"title": "품질보증기준(선택)", "placeholder": "", "isNecessary": False, "contents": ""},
            {"title": "A/S 책임자", "placeholder": "", "isNecessary": True, "contents": as_name},
            {"title": "A/S 전화번호", "placeholder": "", "isNecessary": True, "contents": as_phone},
        ]

        item_data = {
            "categoryInfo": {
                "largeCategoryId": category_ids["largeCategoryId"],
                "mediumCategoryId": category_ids["mediumCategoryId"],
                "smallCategoryId": category_ids["smallCategoryId"],
            },
            "itemTitle": title,
            "optionsInfo": {
                "optionNames": option_names,
                "totalOptions": total_options,
                "optionPrices": option_prices_matrix,
            },
            "mainImageUris": [main_image_uri],
            "detailImageUris": detail_image_uris,
            "shippingInfo": {
                "freeShipping": True,
                "shippingMethod": "순차배송",
                "shippingFee": 0,
                "shippingFeeInfo": f"무료배송, 도서산간 추가 배송비 -제주 지역: {jeju_fee:,}원 -도서산간 지역: {rural_fee:,}원",
                "returnFee": return_fee,
                "returnFeeInfo": f"{return_fee:,}원 -단, 고객 단순 변심의 경우에만 발생 -도서산간 및 일부 지역 추가비용 발생",
                "ruralAreaShippingFeeInfo": rural_areas,
                "shippingCompany": shipping_company,
                "shippingDays": shipping_days,
            },
            "commonMetaDataInfoList": common_meta,
            "purchaseLimitCount": purchase_limit,
            "teamPurchaseNumber": team_size,
        }

        if keywords:
            item_data["searchKeywords"] = keywords

        return item_data


# ─── CLI 모드 ─────────────────────────────────────────────

def main():
    import argparse

    parser = argparse.ArgumentParser(description="올웨이즈 판매자센터 API CLI")
    parser.add_argument("--id", required=True, help="로그인 아이디")
    parser.add_argument("--pw", required=True, help="비밀번호")

    sub = parser.add_subparsers(dest="command")

    # 대시보드
    sub.add_parser("dashboard", help="대시보드 조회")

    # 주문 현황
    sub.add_parser("orders", help="주문 현황 조회")

    # 상품 조회
    p_item = sub.add_parser("item", help="상품 상세 조회")
    p_item.add_argument("item_id", help="상품 ID")

    # 카테고리 검색
    p_cat = sub.add_parser("category", help="카테고리 검색")
    p_cat.add_argument("keyword", help="검색 키워드")

    # 상품 등록 (JSON 파일)
    p_reg = sub.add_parser("register", help="상품 등록 (JSON 파일)")
    p_reg.add_argument("json_file", help="상품 데이터 JSON 파일 경로")

    args = parser.parse_args()

    api = AlwayzSellerAPI()
    print("로그인 중...")
    result = api.login(args.id, args.pw)
    print(f"로그인 성공! Seller ID: {result['seller_id']}")

    if args.command == "dashboard":
        dash = api.get_dashboard()
        orders = api.get_order_status_counts()
        print("\n━━━ 대시보드 ━━━")
        print(json.dumps(dash.get("data", {}), indent=2, ensure_ascii=False)[:2000])
        print("\n━━━ 주문 현황 ━━━")
        print(json.dumps(orders.get("data", {}), indent=2, ensure_ascii=False))

    elif args.command == "orders":
        orders = api.get_orders()
        data = orders.get("data", [])
        print(f"\n━━━ 주문 목록 ({len(data)}건) ━━━")
        for o in data[:10]:
            info = o.get("itemInfo", {})
            print(f"  - {info.get('itemTitle', 'N/A')} | 상태: {o.get('status', 'N/A')}")

    elif args.command == "item":
        item = api.get_item(args.item_id)
        print(json.dumps(item.get("data", {}), indent=2, ensure_ascii=False)[:3000])

    elif args.command == "category":
        results = api.find_category(args.keyword)
        print(f"\n━━━ '{args.keyword}' 카테고리 검색 결과 ({len(results)}건) ━━━")
        for r in results:
            print(f"  {r['full_name']} (L:{r['largeCategoryId']} M:{r['mediumCategoryId']} S:{r['smallCategoryId']})")

    elif args.command == "register":
        with open(args.json_file, "r", encoding="utf-8") as f:
            item_data = json.load(f)
        result = api.register_item(item_data)
        print("\n━━━ 상품 등록 결과 ━━━")
        print(json.dumps(result, indent=2, ensure_ascii=False))

    else:
        parser.print_help()


if __name__ == "__main__":
    main()

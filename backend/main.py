from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any
from urllib.parse import urlencode, urljoin

from curl_cffi import AsyncSession
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from vinted import VintedClient


app = FastAPI(title="re:trouve API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://feuille2cedric.github.io",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ],
    allow_methods=["GET"],
    allow_headers=["*"],
)

MARKETS = {"fr", "be", "nl", "de", "es", "it", "co.uk", "com"}
SOLD_STATUSES = {"sold", "closed", "deleted", "hidden", "reserved"}
logger = logging.getLogger(__name__)

LOCALE_HEADERS = {
    "fr": "fr-FR,fr;q=0.9",
    "be": "fr-BE,fr;q=0.9",
    "nl": "nl-NL,nl;q=0.9",
    "de": "de-DE,de;q=0.9",
    "es": "es-ES,es;q=0.9",
    "it": "it-IT,it;q=0.9",
    "co.uk": "en-GB,en;q=0.9",
    "com": "en-US,en;q=0.9",
}


def nested(data: dict[str, Any], *path: str, default: Any = None) -> Any:
    value: Any = data
    for key in path:
        if not isinstance(value, dict):
            return default
        value = value.get(key)
    return default if value is None else value


def number(value: Any) -> float | None:
    if isinstance(value, dict):
        value = value.get("amount")
    try:
        return float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return None


async def fetch_catalog_items(
    catalog_url: str,
    base_url: str,
    market: str,
    params: list[tuple[str, str]],
) -> list[dict[str, Any]]:
    """Use the maintained client first, then retry without its HEAD cookie probe."""
    try:
        async with VintedClient() as client:
            return await client.search_items(catalog_url, per_page=96, raw_data=True)
    except Exception as error:
        logger.warning("Vinted client failed, trying GET fallback: %s", error)

    api_host = "api.www.vinted.com" if market == "com" else f"api.vinted.{market}"
    api_url = f"https://{api_host}/svc-catalogue/items"
    api_params = dict(params)
    api_params.update({"page": "1", "per_page": "96", "time": str(int(time.time()))})
    locale = LOCALE_HEADERS.get(market, "en-US,en;q=0.9")
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": locale,
        "Cache-Control": "no-cache",
        "DNT": "1",
        "Referer": base_url,
        "X-Money-Object": "true",
        "locale": locale.split(",", 1)[0],
    }
    async with AsyncSession(headers=headers) as session:
        landing = await session.get(base_url, impersonate="chrome", verify=True)
        landing.raise_for_status()
        response = await session.get(
            api_url,
            params=api_params,
            impersonate="chrome",
            verify=True,
        )
        response.raise_for_status()
        payload = response.json()
        items = payload.get("items", [])
        return items if isinstance(items, list) else []


def item_url(item: dict[str, Any], base_url: str) -> str:
    value = item.get("url") or item.get("path") or ""
    return urljoin(f"{base_url}/", str(value))


def item_photo(item: dict[str, Any]) -> str:
    photo = item.get("photo") or {}
    if isinstance(photo, str):
        return photo
    return str(photo.get("url") or photo.get("full_size_url") or "")


def item_is_available(item: dict[str, Any]) -> bool:
    status = str(item.get("status") or nested(item, "status", "title") or "").lower()
    if status in SOLD_STATUSES:
        return False
    if item.get("is_visible") is False or item.get("can_buy") is False:
        return False
    return True


def normalize_item(item: dict[str, Any], base_url: str) -> dict[str, Any] | None:
    if not item_is_available(item):
        return None
    price = number(item.get("price") or item.get("total_item_price"))
    if price is None:
        return None
    user = item.get("user") if isinstance(item.get("user"), dict) else {}
    uploaded = item.get("created_at_ts") or item.get("uploaded_at") or 0
    if isinstance(uploaded, str):
        try:
            uploaded = int(datetime.fromisoformat(uploaded.replace("Z", "+00:00")).timestamp())
        except ValueError:
            uploaded = 0
    return {
        "id": str(item.get("id") or item_url(item, base_url)),
        "title": str(item.get("title") or "Annonce Vinted"),
        "type": str(item.get("category") or ""),
        "brand": str(item.get("brand_title") or nested(item, "brand", "title") or "Sans marque"),
        "size": str(item.get("size_title") or nested(item, "size", "title") or ""),
        "color": str(item.get("color") or ""),
        "price": price,
        "country": str(user.get("country_title") or user.get("country_code") or ""),
        "condition": str(item.get("status_title") or nested(item, "status", "title") or "État non indiqué"),
        "sellerRating": number(user.get("feedback_reputation")),
        "reviewCount": int(user.get("feedback_count") or 0),
        "image": item_photo(item),
        "url": item_url(item, base_url),
        "createdAt": int(uploaded or 0),
    }


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/search")
async def search(
    type: str = "",
    gender: str = "",
    brand: str = "",
    details: str = "",
    size: str = "",
    minPrice: float | None = Query(default=None, ge=0),
    maxPrice: float | None = Query(default=None, ge=0),
    color: str = "",
    minRating: float | None = Query(default=None, ge=0, le=5),
    allowUnrated: bool = True,
    market: str = "fr",
) -> dict[str, list[dict[str, Any]]]:
    market = market if market in MARKETS else "fr"
    base_url = f"https://www.vinted.{market}"
    search_text = " ".join(filter(None, [gender, brand, details, type, color])).strip()
    params: list[tuple[str, str]] = [("search_text", search_text), ("order", "relevance")]
    if minPrice is not None:
        params.append(("price_from", str(minPrice)))
    if maxPrice is not None:
        params.append(("price_to", str(maxPrice)))
    catalog_url = f"{base_url}/catalog?{urlencode(params)}"

    try:
        raw_items = await fetch_catalog_items(catalog_url, base_url, market, params)
    except Exception as error:
        logger.exception("Vinted search failed")
        raise HTTPException(status_code=502, detail=type(error).__name__) from error

    expected_size = size.casefold().strip()
    items: list[dict[str, Any]] = []
    for raw_item in raw_items:
        item = normalize_item(raw_item, base_url)
        if not item:
            continue
        if expected_size and item["size"].casefold().strip() != expected_size:
            continue
        if minPrice is not None and item["price"] < minPrice:
            continue
        if maxPrice is not None and item["price"] > maxPrice:
            continue
        rating = item["sellerRating"]
        reviews = item["reviewCount"]
        if reviews == 0 and not allowUnrated:
            continue
        if minRating is not None and reviews > 0 and (rating is None or rating < minRating):
            continue
        items.append(item)

    return {"items": items}

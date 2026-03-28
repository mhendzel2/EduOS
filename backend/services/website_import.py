from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_META_DESCRIPTION_RE = re.compile(
    r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']',
    re.IGNORECASE | re.DOTALL,
)
_SCRIPT_STYLE_RE = re.compile(r"<(script|style|noscript)[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")


def normalize_site_url(site_url: str) -> str:
    raw = str(site_url or "").strip()
    if not raw:
        raise ValueError("Website URL is required.")
    if not re.match(r"^https?://", raw, re.IGNORECASE):
        raw = f"https://{raw}"

    parsed = urlparse(raw)
    if not parsed.netloc:
        raise ValueError("Website URL must include a valid hostname.")

    path = parsed.path.rstrip("/")
    normalized = parsed._replace(path=path, params="", query="", fragment="")
    return normalized.geturl()


def _local_tag_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _extract_title(html_text: str) -> str:
    match = _TITLE_RE.search(html_text)
    if not match:
        return ""
    return html.unescape(match.group(1)).strip()


def _extract_meta_description(html_text: str) -> str:
    match = _META_DESCRIPTION_RE.search(html_text)
    if not match:
        return ""
    return html.unescape(match.group(1)).strip()


def _extract_text_content(html_text: str) -> str:
    stripped = _SCRIPT_STYLE_RE.sub(" ", html_text)
    stripped = _TAG_RE.sub(" ", stripped)
    stripped = html.unescape(stripped)
    stripped = _WHITESPACE_RE.sub(" ", stripped)
    return stripped.strip()


def _same_site(base_url: str, candidate_url: str) -> bool:
    base = urlparse(base_url)
    candidate = urlparse(candidate_url)
    return candidate.scheme in {"http", "https"} and candidate.netloc == base.netloc


async def _fetch_text(client: httpx.AsyncClient, url: str) -> tuple[str, str]:
    response = await client.get(url)
    response.raise_for_status()
    return response.text, response.headers.get("content-type", "")


async def _collect_sitemap_urls(
    client: httpx.AsyncClient,
    sitemap_url: str,
    *,
    site_url: str,
    limit: int,
    visited: set[str],
) -> list[str]:
    if sitemap_url in visited or len(visited) > 24:
        return []
    visited.add(sitemap_url)

    xml_text, content_type = await _fetch_text(client, sitemap_url)
    if "xml" not in content_type and "<urlset" not in xml_text and "<sitemapindex" not in xml_text:
        return []

    root = ET.fromstring(xml_text)
    tag = _local_tag_name(root.tag)
    urls: list[str] = []

    if tag == "urlset":
        for child in root:
            if _local_tag_name(child.tag) != "url":
                continue
            for field in child:
                if _local_tag_name(field.tag) != "loc":
                    continue
                candidate = (field.text or "").strip()
                if candidate and _same_site(site_url, candidate):
                    urls.append(candidate)
                if len(urls) >= limit:
                    return urls[:limit]
        return urls[:limit]

    if tag == "sitemapindex":
        for child in root:
            if _local_tag_name(child.tag) != "sitemap":
                continue
            sitemap_loc = ""
            for field in child:
                if _local_tag_name(field.tag) == "loc":
                    sitemap_loc = (field.text or "").strip()
                    break
            if not sitemap_loc or not _same_site(site_url, sitemap_loc):
                continue
            nested = await _collect_sitemap_urls(
                client,
                sitemap_loc,
                site_url=site_url,
                limit=limit - len(urls),
                visited=visited,
            )
            urls.extend(nested)
            if len(urls) >= limit:
                return urls[:limit]
    return urls[:limit]


async def discover_site_urls(site_url: str, *, max_pages: int) -> list[str]:
    normalized_site_url = normalize_site_url(site_url)
    limit = max(1, min(int(max_pages), 100))
    homepage = normalized_site_url
    sitemap_url = urljoin(f"{homepage}/", "sitemap.xml")

    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        urls: list[str] = []
        try:
            urls = await _collect_sitemap_urls(client, sitemap_url, site_url=homepage, limit=limit, visited=set())
        except Exception:
            urls = []

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in [homepage, *urls]:
        normalized = normalize_site_url(candidate)
        if normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
        if len(deduped) >= limit:
            break
    return deduped


async def fetch_site_pages(site_url: str, *, max_pages: int) -> dict[str, Any]:
    normalized_site_url = normalize_site_url(site_url)
    urls = await discover_site_urls(normalized_site_url, max_pages=max_pages)
    pages: list[dict[str, Any]] = []

    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        for url in urls:
            try:
                html_text, content_type = await _fetch_text(client, url)
            except Exception:
                continue
            if "html" not in content_type and "<!doctype html" not in html_text.lower() and "<html" not in html_text.lower():
                continue

            title = _extract_title(html_text) or urlparse(url).path.strip("/") or urlparse(url).netloc
            abstract = _extract_meta_description(html_text)
            content = _extract_text_content(html_text)
            if not content:
                continue

            pages.append(
                {
                    "title": title[:180],
                    "abstract": abstract[:500],
                    "content": content,
                    "source_type": "website_page",
                    "source_identifier": urlparse(url).path or "/",
                    "source_url": url,
                    "citation": url,
                    "authors": [],
                    "published_at": "",
                    "metadata": {"site_url": normalized_site_url},
                }
            )

    return {
        "normalized_site_url": normalized_site_url,
        "selected_pages": len(urls),
        "pages": pages,
    }
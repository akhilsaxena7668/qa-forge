"""
QAForge — Deep SEO Extractor v2.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Performs a comprehensive, deterministic, browser-aligned SEO
extraction from the raw HTTP response + HTTP headers.

Extraction strategy:
  1. Fetch page with realistic browser headers (follow redirects)
  2. Parse the full <head> with BeautifulSoup for exact DOM values
  3. Inspect HTTP response headers (HSTS, CSP, X-Frame, etc.)
  4. Fetch /robots.txt separately
  5. Fetch XML sitemap(s) found in robots.txt or /sitemap.xml
  6. Extract headings, images, links, canonical, OG, Twitter cards
  7. Never infer / fabricate — report exactly what was found
"""

import asyncio
import re
import json
from datetime import datetime
from typing import Optional
from urllib.parse import urljoin, urlparse

import httpx

try:
    from bs4 import BeautifulSoup
    BS4_AVAILABLE = True
except ImportError:
    BS4_AVAILABLE = False
    print("[SEO Extractor] WARNING: beautifulsoup4 not installed. Falling back to regex-only mode.")


# ── helpers ───────────────────────────────────────────────────────────────────

def _tag_text(tag) -> str:
    """Return stripped inner text of a BeautifulSoup tag, or ''."""
    if tag is None:
        return ""
    return tag.get_text(separator=" ", strip=True)


def _attr(tag, attr: str, default=None):
    if tag is None:
        return default
    return tag.get(attr, default)


def _abs_url(base: str, href: str) -> str:
    if not href:
        return ""
    return urljoin(base, href)


def _char_count(s: str) -> int:
    return len(s) if s else 0


def _status_label(n: int) -> str:
    if n == 0:
        return "Error/Timeout"
    if 200 <= n < 300:
        return "OK"
    if 300 <= n < 400:
        return "Redirect"
    if n == 404:
        return "Not Found"
    if n >= 400:
        return f"Error {n}"
    return str(n)


def _regex_title(html: str) -> str:
    m = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
    return m.group(1).strip() if m else ""


def _regex_meta(html: str, name: str) -> str:
    """Regex fallback for meta tag extraction (name/property first, content second, and vice versa)."""
    patterns = [
        rf'<meta[^>]*(?:name|property)\s*=\s*["\'](?:{re.escape(name)})["\'][^>]*content\s*=\s*["\']([^"\']*)["\']',
        rf'<meta[^>]*content\s*=\s*["\']([^"\']*)["\'][^>]*(?:name|property)\s*=\s*["\'](?:{re.escape(name)})["\']',
    ]
    for pat in patterns:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            return m.group(1)
    return ""


BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}


# ── robots.txt fetcher ────────────────────────────────────────────────────────

async def fetch_robots(client: httpx.AsyncClient, base_url: str) -> dict:
    robots_url = urljoin(base_url.rstrip("/") + "/", "robots.txt")
    result = {
        "url": robots_url,
        "status_code": 0,
        "raw": "",
        "present": False,
        "disallow_all": False,
        "disallow_rules": [],
        "allow_rules": [],
        "sitemap_declarations": [],
        "user_agents": [],
        "errors": [],
    }
    try:
        r = await client.get(robots_url, timeout=8.0, follow_redirects=True)
        result["status_code"] = r.status_code
        if r.status_code == 200:
            result["present"] = True
            raw = r.text
            result["raw"] = raw[:3000]  # truncate for storage
            lines = raw.splitlines()
            current_ua = []
            for line in lines:
                line = line.strip()
                if line.startswith("#") or not line:
                    continue
                if line.lower().startswith("user-agent:"):
                    ua = line[len("user-agent:"):].strip()
                    current_ua.append(ua)
                    if ua not in result["user_agents"]:
                        result["user_agents"].append(ua)
                elif line.lower().startswith("disallow:"):
                    path = line[len("disallow:"):].strip()
                    result["disallow_rules"].append({"user_agent": current_ua[-1] if current_ua else "*", "path": path})
                    if path == "/":
                        result["disallow_all"] = True
                elif line.lower().startswith("allow:"):
                    path = line[len("allow:"):].strip()
                    result["allow_rules"].append({"user_agent": current_ua[-1] if current_ua else "*", "path": path})
                elif line.lower().startswith("sitemap:"):
                    sm = line[len("sitemap:"):].strip()
                    if sm:
                        result["sitemap_declarations"].append(sm)
    except Exception as e:
        result["errors"].append(str(e))
    return result


# ── sitemap fetcher ───────────────────────────────────────────────────────────

async def fetch_sitemap(client: httpx.AsyncClient, sitemap_url: str) -> dict:
    result = {
        "url": sitemap_url,
        "status_code": 0,
        "present": False,
        "is_index": False,
        "url_count": 0,
        "sample_urls": [],
        "errors": [],
    }
    try:
        r = await client.get(sitemap_url, timeout=10.0, follow_redirects=True)
        result["status_code"] = r.status_code
        if r.status_code == 200:
            result["present"] = True
            text = r.text
            # Count <url> entries (standard sitemap)
            url_count = len(re.findall(r'<url>', text, re.IGNORECASE))
            # Count <sitemap> entries (sitemap index)
            sm_count = len(re.findall(r'<sitemap>', text, re.IGNORECASE))
            if sm_count > 0:
                result["is_index"] = True
                result["url_count"] = sm_count
            else:
                result["url_count"] = url_count
            # Extract sample URLs
            locs = re.findall(r'<loc>\s*(.*?)\s*</loc>', text, re.IGNORECASE)
            result["sample_urls"] = locs[:10]
    except Exception as e:
        result["errors"].append(str(e))
    return result


# ── main page extractor ───────────────────────────────────────────────────────

async def extract_seo_data(url: str, depth: str = "standard") -> dict:
    """
    Perform a full technical SEO extraction for a given URL.
    Returns a rich structured dict with every SEO signal extracted
    directly from the HTTP response — no fabrication.
    """
    result = {
        "url": url,
        "final_url": url,
        "status_code": 0,
        "status_label": "Error/Timeout",
        "fetch_error": None,
        "redirect_chain": [],
        "is_https": url.startswith("https://"),
        "response_time_ms": None,
        "html_size_bytes": None,
        # head signals
        "title": None,
        "title_char_count": 0,
        "title_issues": [],
        "meta_description": None,
        "meta_description_char_count": 0,
        "meta_description_issues": [],
        "meta_robots": None,
        "meta_googlebot": None,
        "meta_bingbot": None,
        "canonical": None,
        "canonical_issues": [],
        # OG
        "og": {},
        "og_issues": [],
        # Twitter
        "twitter": {},
        "twitter_issues": [],
        # headings
        "headings": {"h1": [], "h2": [], "h3": [], "h4": [], "h5": [], "h6": []},
        "heading_issues": [],
        # images
        "images": [],
        "image_issues": [],
        "image_stats": {},
        # links
        "internal_links": [],
        "external_links": [],
        "link_issues": [],
        "link_stats": {},
        # other head tags
        "viewport": None,
        "charset": None,
        "lang": None,
        "hreflang": [],
        "has_schema": False,
        "schema_types": [],
        # response headers
        "response_headers": {},
        "security_headers": {},
        # robots / sitemap
        "robots_txt": {},
        "sitemaps": [],
        # misc
        "word_count": 0,
        "crawled_at": datetime.now().isoformat(),
    }

    parsed = urlparse(url)
    base_origin = f"{parsed.scheme}://{parsed.netloc}"

    try:
        start = asyncio.get_event_loop().time()
        async with httpx.AsyncClient(
            verify=False,
            headers=BROWSER_HEADERS,
            follow_redirects=True,
            timeout=httpx.Timeout(12.0),
        ) as client:
            resp = await client.get(url)
            elapsed_ms = int((asyncio.get_event_loop().time() - start) * 1000)

            result["status_code"] = resp.status_code
            result["status_label"] = _status_label(resp.status_code)
            result["final_url"] = str(resp.url)
            result["is_https"] = result["final_url"].startswith("https://")
            result["response_time_ms"] = elapsed_ms

            # Track redirect chain
            for r in resp.history:
                result["redirect_chain"].append({
                    "url": str(r.url),
                    "status_code": r.status_code,
                })

            html = resp.text
            result["html_size_bytes"] = len(resp.content)

            # ── HTTP response headers ─────────────────────────────────────
            headers_dict = dict(resp.headers)
            result["response_headers"] = {k.lower(): v for k, v in headers_dict.items()}
            sec_hdr_keys = [
                "strict-transport-security",
                "content-security-policy",
                "x-frame-options",
                "x-content-type-options",
                "referrer-policy",
                "permissions-policy",
                "x-xss-protection",
                "server",
                "x-powered-by",
                "access-control-allow-origin",
            ]
            for key in sec_hdr_keys:
                val = headers_dict.get(key) or headers_dict.get(key.title())
                result["security_headers"][key] = val if val else None

            # ── Parse HTML ────────────────────────────────────────────────
            if BS4_AVAILABLE:
                # Try html5lib first (best parser for quirky HTML), fallback to html.parser
                try:
                    import html5lib
                    soup = BeautifulSoup(html, "html5lib")
                except ImportError:
                    soup = BeautifulSoup(html, "html.parser")
                _parse_with_bs4(soup, html, url, result, base_origin)
            else:
                _parse_with_regex(html, url, result, base_origin)

            # ── robots.txt & sitemap ──────────────────────────────────────
            robots = await fetch_robots(client, base_origin)
            result["robots_txt"] = robots

            # Determine sitemap URLs to check
            sm_urls_to_check = list(robots.get("sitemap_declarations", []))
            # Always try /sitemap.xml if not already listed
            default_sm = base_origin.rstrip("/") + "/sitemap.xml"
            if default_sm not in sm_urls_to_check:
                sm_urls_to_check.insert(0, default_sm)

            # Fetch up to 2 sitemaps
            for sm_url in sm_urls_to_check[:2]:
                sm_data = await fetch_sitemap(client, sm_url)
                result["sitemaps"].append(sm_data)

    except httpx.ConnectError as e:
        result["fetch_error"] = f"Connection error: {e}"
    except httpx.TimeoutException:
        result["fetch_error"] = "Request timed out after 12 seconds."
    except Exception as e:
        result["fetch_error"] = str(e)

    return result


# ── BS4-based extraction ──────────────────────────────────────────────────────

def _parse_with_bs4(soup, html: str, url: str, result: dict, base_origin: str):
    parsed = urlparse(url)
    domain = parsed.netloc

    # ── <html lang> ──────────────────────────────────────────────────────
    html_tag = soup.find("html")
    result["lang"] = _attr(html_tag, "lang")

    # ── Charset ──────────────────────────────────────────────────────────
    charset_tag = soup.find("meta", charset=True)
    if charset_tag:
        result["charset"] = charset_tag.get("charset")
    else:
        ct_tag = soup.find("meta", attrs={"http-equiv": re.compile(r"content-type", re.I)})
        if ct_tag:
            ct_val = _attr(ct_tag, "content", "")
            m = re.search(r"charset\s*=\s*([^\s;]+)", ct_val, re.I)
            result["charset"] = m.group(1) if m else None

    # ── Title ─────────────────────────────────────────────────────────────
    title_tags = soup.find_all("title")
    if len(title_tags) == 0:
        result["title"] = None
        result["title_issues"].append("MISSING: No <title> tag found")
    elif len(title_tags) > 1:
        texts = [t.get_text() for t in title_tags]
        result["title"] = title_tags[0].get_text()
        result["title_issues"].append(f"MULTIPLE: {len(title_tags)} <title> tags found: {texts}")
    else:
        raw_title = title_tags[0].get_text()
        result["title"] = raw_title
        if not raw_title.strip():
            result["title_issues"].append("EMPTY: <title> tag exists but is empty")
        elif raw_title != raw_title.strip():
            result["title_issues"].append(
                f"WHITESPACE: Title has leading/trailing whitespace: {repr(raw_title)}"
            )

    if result["title"] is not None:
        result["title_char_count"] = _char_count(result["title"])
        tc = result["title_char_count"]
        if 0 < tc < 30:
            result["title_issues"].append(f"TOO_SHORT: {tc} chars (recommended 50-60)")
        elif tc > 70:
            result["title_issues"].append(f"TOO_LONG: {tc} chars (recommended 50-60, risk of truncation)")

    # ── Meta description ──────────────────────────────────────────────────
    desc_tags = soup.find_all("meta", attrs={"name": re.compile(r"^description$", re.I)})
    if len(desc_tags) == 0:
        result["meta_description"] = None
        result["meta_description_issues"].append("MISSING: No meta description tag found")
    elif len(desc_tags) > 1:
        contents = [_attr(t, "content", "") for t in desc_tags]
        result["meta_description"] = contents[0]
        result["meta_description_issues"].append(f"MULTIPLE: {len(desc_tags)} meta description tags found")
    else:
        content = _attr(desc_tags[0], "content")
        result["meta_description"] = content
        if content is None:
            result["meta_description_issues"].append("MISSING_CONTENT: Tag present but has no content attribute")
        elif not content.strip():
            result["meta_description_issues"].append("EMPTY: Meta description is empty")
        elif content != content.strip():
            result["meta_description_issues"].append("WHITESPACE: Meta description has leading/trailing whitespace")

    if result["meta_description"] is not None:
        result["meta_description_char_count"] = _char_count(result["meta_description"])
        dc = result["meta_description_char_count"]
        if 0 < dc < 150:
            result["meta_description_issues"].append(f"TOO_SHORT: {dc} chars (description should be 150–160 chars)")
        elif dc > 160:
            result["meta_description_issues"].append(f"TOO_LONG: {dc} chars (description should be 150–160 chars, may be truncated in SERPs)")

    # ── Meta robots ────────────────────────────────────────────────────────
    robots_tag = soup.find("meta", attrs={"name": re.compile(r"^robots$", re.I)})
    result["meta_robots"] = _attr(robots_tag, "content")
    googlebot_tag = soup.find("meta", attrs={"name": re.compile(r"^googlebot$", re.I)})
    result["meta_googlebot"] = _attr(googlebot_tag, "content")
    bingbot_tag = soup.find("meta", attrs={"name": re.compile(r"^bingbot$", re.I)})
    result["meta_bingbot"] = _attr(bingbot_tag, "content")

    # Check for noindex/nofollow
    for robots_val in [result["meta_robots"], result["meta_googlebot"]]:
        if robots_val:
            rv_lower = robots_val.lower()
            if "noindex" in rv_lower:
                result["title_issues"].append(f"NOINDEX: Page is marked noindex ({robots_val})")
            if "nofollow" in rv_lower:
                result["link_issues"].append(f"NOFOLLOW: Page robots meta uses nofollow ({robots_val})")

    # ── Canonical ─────────────────────────────────────────────────────────
    canonical_tags = soup.find_all("link", rel=lambda r: r and "canonical" in r)
    if len(canonical_tags) == 0:
        result["canonical"] = None
        result["canonical_issues"].append("MISSING: No canonical tag found")
    elif len(canonical_tags) > 1:
        hrefs = [_attr(t, "href", "") for t in canonical_tags]
        result["canonical"] = hrefs[0]
        result["canonical_issues"].append(f"MULTIPLE: {len(canonical_tags)} canonical tags found: {hrefs}")
    else:
        href = _attr(canonical_tags[0], "href", "")
        result["canonical"] = href
        if not href:
            result["canonical_issues"].append("EMPTY: Canonical tag present but href is empty")
        else:
            # Check if canonical matches current URL
            final_url = result.get("final_url", url)
            abs_canonical = _abs_url(final_url, href)
            if abs_canonical != final_url:
                result["canonical_issues"].append(
                    f"POINTS_ELSEWHERE: Canonical ({abs_canonical}) differs from current URL ({final_url})"
                )
            if href.startswith("http://") and result["is_https"]:
                result["canonical_issues"].append("HTTP_CANONICAL_ON_HTTPS: Canonical uses HTTP while page is HTTPS")
            if not href.startswith("http"):
                result["canonical_issues"].append(f"RELATIVE: Canonical is a relative URL ({href})")

    # ── Viewport ──────────────────────────────────────────────────────────
    vp_tag = soup.find("meta", attrs={"name": re.compile(r"^viewport$", re.I)})
    result["viewport"] = _attr(vp_tag, "content")

    # ── Hreflang ──────────────────────────────────────────────────────────
    hreflang_tags = soup.find_all("link", rel=lambda r: r and "alternate" in r)
    for t in hreflang_tags:
        hl = _attr(t, "hreflang")
        href = _attr(t, "href")
        if hl:
            result["hreflang"].append({"lang": hl, "href": href})

    # ── Open Graph ────────────────────────────────────────────────────────
    og_tags = soup.find_all("meta", property=re.compile(r"^og:", re.I))
    og_seen = {}
    for tag in og_tags:
        prop = _attr(tag, "property", "").lower()
        content = _attr(tag, "content", "")
        if prop in og_seen:
            result["og_issues"].append(f"DUPLICATE: {prop} appears multiple times")
        og_seen[prop] = content
    result["og"] = og_seen

    required_og = ["og:title", "og:description", "og:type", "og:url", "og:image"]
    for key in required_og:
        if key not in result["og"]:
            result["og_issues"].append(f"MISSING: {key}")
        elif not result["og"][key]:
            result["og_issues"].append(f"EMPTY: {key} is present but empty")

    # Check og:image URL
    if "og:image" in result["og"]:
        img_url = result["og"]["og:image"]
        if img_url and not img_url.startswith("http"):
            result["og_issues"].append(f"RELATIVE_IMAGE: og:image is not an absolute URL ({img_url})")

    # Check for og:image:alt
    if "og:image" in result["og"] and "og:image:alt" not in result["og"]:
        result["og_issues"].append("MISSING: og:image:alt (recommended for accessibility)")

    # ── Twitter Cards ─────────────────────────────────────────────────────
    twitter_tags = soup.find_all("meta", attrs={"name": re.compile(r"^twitter:", re.I)})
    tw_seen = {}
    for tag in twitter_tags:
        name = _attr(tag, "name", "").lower()
        content = _attr(tag, "content", "")
        if name in tw_seen:
            result["twitter_issues"].append(f"DUPLICATE: {name} appears multiple times")
        tw_seen[name] = content
    result["twitter"] = tw_seen

    required_twitter = ["twitter:card", "twitter:title", "twitter:description"]
    for key in required_twitter:
        if key not in result["twitter"]:
            result["twitter_issues"].append(f"MISSING: {key}")
        elif not result["twitter"][key]:
            result["twitter_issues"].append(f"EMPTY: {key} is present but empty")

    valid_cards = {"summary", "summary_large_image", "app", "player"}
    if "twitter:card" in result["twitter"]:
        card_val = result["twitter"]["twitter:card"].lower().strip()
        if card_val not in valid_cards:
            result["twitter_issues"].append(f"INVALID: twitter:card value '{card_val}' is not a valid card type")

    # ── Headings ──────────────────────────────────────────────────────────
    for level in range(1, 7):
        tags = soup.find_all(f"h{level}")
        texts = []
        for t in tags:
            txt = t.get_text(separator=" ", strip=True)
            texts.append(txt)
            if not txt:
                result["heading_issues"].append(f"EMPTY_H{level}: Empty <h{level}> tag found")
        result["headings"][f"h{level}"] = texts

    h1s = result["headings"]["h1"]
    if len(h1s) == 0:
        result["heading_issues"].append("MISSING_H1: No <h1> tag found on page")
    elif len(h1s) > 1:
        result["heading_issues"].append(f"MULTIPLE_H1: {len(h1s)} <h1> tags found: {h1s[:5]}")

    # Check for duplicate headings
    for level in range(1, 4):
        texts = result["headings"][f"h{level}"]
        if len(texts) != len(set(texts)) and texts:
            dupes = [t for t in set(texts) if texts.count(t) > 1]
            result["heading_issues"].append(f"DUPLICATE_H{level}: Duplicate headings: {dupes[:3]}")

    # Check heading hierarchy skip
    present_levels = [l for l in range(1, 7) if result["headings"][f"h{l}"]]
    for i in range(len(present_levels) - 1):
        if present_levels[i + 1] - present_levels[i] > 1:
            result["heading_issues"].append(
                f"HIERARCHY_SKIP: Heading jumps from H{present_levels[i]} to H{present_levels[i+1]}"
            )

    # ── Images ────────────────────────────────────────────────────────────
    img_tags = soup.find_all("img")
    for img in img_tags:
        src = _attr(img, "src", "")
        srcset = _attr(img, "srcset")
        alt_present = img.has_attr("alt")
        alt_val = _attr(img, "alt")  # could be "" or None
        title_present = img.has_attr("title")
        title_val = _attr(img, "title")  # could be "" or None
        width = _attr(img, "width")
        height = _attr(img, "height")
        loading = _attr(img, "loading")
        decoding = _attr(img, "decoding")

        issues = []
        if not alt_present:
            issues.append("MISSING_ALT: alt attribute is absent")
        elif alt_val == "":
            issues.append("EMPTY_ALT: alt=\"\" (decorative or unlabelled)")
        elif len(alt_val) > 125:
            issues.append(f"ALT_TOO_LONG: alt text is {len(alt_val)} chars (recommend ≤125)")

        if not title_present:
            issues.append("MISSING_TITLE: title attribute is absent")
        elif title_val == "":
            issues.append("EMPTY_TITLE: title=\"\" is empty")

        if not src:
            issues.append("MISSING_SRC: src attribute is absent or empty")
        elif not src.startswith("http") and not src.startswith("data:") and not src.startswith("//"):
            issues.append(f"RELATIVE_SRC: Image src is relative ({src[:80]})")

        if not width or not height:
            issues.append("NO_DIMENSIONS: width/height not specified (may cause CLS)")

        abs_src = _abs_url(result["final_url"], src) if src else ""
        result["images"].append({
            "src": src,
            "abs_src": abs_src,
            "srcset": srcset,
            "alt_present": alt_present,
            "alt": alt_val,
            "title_present": title_present,
            "title": title_val,
            "width": width,
            "height": height,
            "loading": loading,
            "decoding": decoding,
            "issues": issues,
        })

    # Aggregate image stats
    total_imgs = len(result["images"])
    missing_alt = sum(1 for i in result["images"] if not i["alt_present"])
    empty_alt = sum(1 for i in result["images"] if i["alt_present"] and i["alt"] == "")
    with_alt = sum(1 for i in result["images"] if i["alt_present"] and i["alt"])
    missing_title = sum(1 for i in result["images"] if not i["title_present"])
    empty_title = sum(1 for i in result["images"] if i["title_present"] and (i["title"] or "") == "")
    with_title = sum(1 for i in result["images"] if i["title_present"] and i["title"])

    result["image_stats"] = {
        "total": total_imgs,
        "missing_alt": missing_alt,
        "empty_alt": empty_alt,
        "with_alt": with_alt,
        "missing_title": missing_title,
        "empty_title": empty_title,
        "with_title": with_title,
    }

    if total_imgs > 0:
        if missing_alt > 0:
            result["image_issues"].append(f"MISSING_ALT: {missing_alt}/{total_imgs} images have no alt attribute")
        if empty_alt > 0:
            result["image_issues"].append(f"EMPTY_ALT: {empty_alt}/{total_imgs} images have alt=\"\" (decorative or unlabelled)")
        if missing_title > 0:
            result["image_issues"].append(f"MISSING_TITLE: {missing_title}/{total_imgs} images have no title attribute")
        no_lazy = sum(1 for i in result["images"] if i.get("loading") != "lazy")
        if no_lazy > 3:
            result["image_issues"].append(f"NO_LAZY_LOADING: {no_lazy}/{total_imgs} images missing loading=\"lazy\"")

    # ── Links ─────────────────────────────────────────────────────────────
    link_tags = soup.find_all("a", href=True)
    internal_count = 0
    external_count = 0
    empty_anchor_count = 0

    for a in link_tags[:250]:  # cap at 250 for perf
        href = _attr(a, "href", "").strip()
        if not href or href.startswith("javascript:") or href.startswith("mailto:") or href.startswith("tel:") or href.startswith("#"):
            continue

        abs_href = _abs_url(result["final_url"], href)
        link_domain = urlparse(abs_href).netloc
        anchor_text = a.get_text(separator=" ", strip=True)
        rel = _attr(a, "rel", [])
        if isinstance(rel, str):
            rel = rel.split()
        rel_lower = [r.lower() for r in rel]

        is_internal = link_domain == domain or link_domain == ""
        is_nofollow = "nofollow" in rel_lower
        is_sponsored = "sponsored" in rel_lower
        is_ugc = "ugc" in rel_lower
        target = _attr(a, "target")

        title_present = a.has_attr("title")
        title_val = _attr(a, "title")
        alt_present = a.has_attr("alt")
        alt_val = _attr(a, "alt")

        inner_img = a.find("img")
        has_img = inner_img is not None
        img_src = _attr(inner_img, "src") if has_img else None
        img_alt = _attr(inner_img, "alt") if has_img else None
        img_alt_present = inner_img.has_attr("alt") if has_img else False
        img_title = _attr(inner_img, "title") if has_img else None

        l_issues = []
        if not title_present:
            l_issues.append("MISSING_TITLE: title attribute is absent")
        elif title_val == "":
            l_issues.append("EMPTY_TITLE: title=\"\" is empty")

        if has_img:
            if not img_alt_present:
                l_issues.append("IMAGE_LINK_MISSING_ALT: Inner <img> has no alt attribute")
            elif img_alt == "":
                l_issues.append("IMAGE_LINK_EMPTY_ALT: Inner <img> has empty alt=\"\"")

        if not anchor_text and not has_img:
            l_issues.append("EMPTY_ANCHOR: Link has no anchor text")
            empty_anchor_count += 1
        elif not anchor_text and has_img and not img_alt:
            l_issues.append("UNLABELLED_IMAGE_LINK: Image link has no text and no image alt")

        entry = {
            "href": href,
            "abs_href": abs_href,
            "anchor_text": anchor_text,
            "title_present": title_present,
            "title": title_val,
            "alt_present": alt_present,
            "alt": alt_val,
            "has_img": has_img,
            "img_src": img_src,
            "img_alt": img_alt,
            "img_alt_present": img_alt_present,
            "img_title": img_title,
            "rel": rel_lower,
            "target": target,
            "is_nofollow": is_nofollow,
            "is_sponsored": is_sponsored,
            "is_ugc": is_ugc,
            "issues": l_issues,
        }

        if is_internal:
            internal_count += 1
            result["internal_links"].append(entry)
        else:
            external_count += 1
            result["external_links"].append(entry)

    all_links = result["internal_links"] + result["external_links"]
    tot_links = len(all_links)
    links_missing_title = sum(1 for l in all_links if not l.get("title_present"))
    links_empty_title = sum(1 for l in all_links if l.get("title_present") and (l.get("title") or "") == "")
    links_with_title = sum(1 for l in all_links if l.get("title_present") and l.get("title"))
    img_links = [l for l in all_links if l.get("has_img")]
    img_links_count = len(img_links)
    img_links_missing_alt = sum(1 for l in img_links if not l.get("img_alt_present") or not l.get("img_alt"))
    img_links_with_alt = sum(1 for l in img_links if l.get("img_alt_present") and l.get("img_alt"))

    result["link_stats"] = {
        "total": tot_links,
        "internal": internal_count,
        "external": external_count,
        "missing_title": links_missing_title,
        "empty_title": links_empty_title,
        "with_title": links_with_title,
        "empty_anchor": empty_anchor_count,
        "image_links_total": img_links_count,
        "image_links_missing_alt": img_links_missing_alt,
        "image_links_with_alt": img_links_with_alt,
    }

    if links_missing_title > 0 and tot_links > 0:
        result["link_issues"].append(f"MISSING_TITLE: {links_missing_title}/{tot_links} links have no title attribute")
    if empty_anchor_count > 0:
        result["link_issues"].append(f"EMPTY_ANCHOR: {empty_anchor_count} links have no anchor text")
    if img_links_missing_alt > 0:
        result["link_issues"].append(f"IMAGE_LINK_MISSING_ALT: {img_links_missing_alt}/{img_links_count} image-links have missing/empty alt on the inner image")
    if internal_count == 0:
        result["link_issues"].append("NO_INTERNAL_LINKS: No internal links found on page")

    # ── Schema.org ────────────────────────────────────────────────────────
    schema_scripts = soup.find_all("script", type="application/ld+json")
    result["has_schema"] = len(schema_scripts) > 0
    for s in schema_scripts:
        try:
            sd = json.loads(s.string or "{}")
            st = sd.get("@type") or sd.get("@graph", [{}])[0].get("@type")
            if st and st not in result["schema_types"]:
                result["schema_types"].append(st if isinstance(st, str) else str(st))
        except Exception:
            result["schema_types"].append("(parse error)")

    # ── Word count (body text) ─────────────────────────────────────────────
    body = soup.find("body")
    if body:
        body_text = body.get_text(separator=" ", strip=True)
        result["word_count"] = len(body_text.split())


# ── regex-only fallback (when BS4 not available) ──────────────────────────────

def _parse_with_regex(html: str, url: str, result: dict, base_origin: str):
    """Minimal regex fallback when BeautifulSoup is not installed."""
    result["title"] = _regex_title(html) or None
    result["title_char_count"] = _char_count(result["title"] or "")

    result["meta_description"] = _regex_meta(html, "description") or None
    result["meta_description_char_count"] = _char_count(result["meta_description"] or "")
    if result["meta_description"]:
        dc = result["meta_description_char_count"]
        if 0 < dc < 150:
            result["meta_description_issues"].append(f"TOO_SHORT: {dc} chars (description should be 150–160 chars)")
        elif dc > 160:
            result["meta_description_issues"].append(f"TOO_LONG: {dc} chars (description should be 150–160 chars, may be truncated in SERPs)")
    else:
        result["meta_description_issues"].append("MISSING: No meta description tag found")

    result["meta_robots"] = _regex_meta(html, "robots") or None
    result["canonical"] = re.search(r'<link[^>]*rel=["\']canonical["\'][^>]*href=["\'](.*?)["\']', html, re.I)
    if result["canonical"]:
        result["canonical"] = result["canonical"].group(1)

    result["viewport"] = _regex_meta(html, "viewport") or None
    result["has_schema"] = bool(re.search(r'application/ld\+json', html, re.I))
    result["headings"]["h1"] = re.findall(r'<h1[^>]*>(.*?)</h1>', html, re.I | re.DOTALL)

    for og_k in ["og:title", "og:description", "og:image", "og:url", "og:type"]:
        v = _regex_meta(html, og_k)
        if v:
            result["og"][og_k] = v

    # Image stats
    img_total = len(re.findall(r'<img\s', html, re.I))
    img_no_alt = len(re.findall(r'<img(?![^>]*alt=)[^>]*>', html, re.I))
    img_no_title = len(re.findall(r'<img(?![^>]*title=)[^>]*>', html, re.I))
    result["image_stats"] = {
        "total": img_total,
        "missing_alt": img_no_alt,
        "empty_alt": 0,
        "with_alt": max(0, img_total - img_no_alt),
        "missing_title": img_no_title,
        "empty_title": 0,
        "with_title": max(0, img_total - img_no_title),
    }
    result["image_issues"] = []
    if img_no_alt:
        result["image_issues"].append(f"MISSING_ALT: {img_no_alt}/{img_total} images missing alt attribute")
    if img_no_title:
        result["image_issues"].append(f"MISSING_TITLE: {img_no_title}/{img_total} images missing title attribute")

    # Link stats
    link_matches = re.findall(r'<a\s+[^>]*href=["\']([^"\']*)["\'][^>]*>(.*?)</a>', html, re.I | re.DOTALL)
    tot_links = len(link_matches)
    links_no_title = len(re.findall(r'<a(?![^>]*title=)[^>]*href=[^>]*>', html, re.I))
    result["link_stats"] = {
        "total": tot_links,
        "internal": tot_links,
        "external": 0,
        "missing_title": links_no_title,
        "empty_title": 0,
        "with_title": max(0, tot_links - links_no_title),
        "empty_anchor": sum(1 for _, text in link_matches if not text.strip()),
        "image_links_total": sum(1 for _, text in link_matches if '<img' in text.lower()),
        "image_links_missing_alt": 0,
        "image_links_with_alt": 0,
    }

    h1_count = len(result["headings"]["h1"])
    if h1_count == 0:
        result["heading_issues"].append("MISSING_H1: No <h1> found")
    elif h1_count > 1:
        result["heading_issues"].append(f"MULTIPLE_H1: {h1_count} <h1> tags")

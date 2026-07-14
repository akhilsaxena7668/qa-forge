import asyncio
import httpx
import re
from urllib.parse import urljoin, urlparse

class AsyncCrawler:
    def __init__(self, start_url: str, depth_level: str = "standard"):
        self.start_url = start_url.rstrip('/')
        self.domain = urlparse(start_url).netloc
        self.visited = set()
        self.to_visit = [self.start_url]
        self.results = []
        self.depth_level = depth_level

        # Standard = homepage only (1 page)
        # Deep     = up to 25 internal pages
        # Paranoid = up to 50 internal pages
        if depth_level == "paranoid":
            self.max_pages = 50
        elif depth_level == "deep":
            self.max_pages = 25
        else:
            self.max_pages = 1   # Standard: homepage only

    async def fetch(self, client: httpx.AsyncClient, url: str):
        if url in self.visited or len(self.visited) >= self.max_pages:
            return

        self.visited.add(url)
        print(f"[Crawler] Fetching ({len(self.visited)}/{self.max_pages}): {url}")
        try:
            resp = await client.get(url, timeout=8.0, follow_redirects=True)
            html = resp.text

            # Extract title
            title_match = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
            title = title_match.group(1).strip() if title_match else ""

            # Extract meta description (both attribute orders)
            desc_match = re.search(
                r'<meta[^>]*name=["\']description["\'][^>]*content=["\'](.*?)["\']'
                r'|<meta[^>]*content=["\'](.*?)["\'][^>]*name=["\']description["\']',
                html, re.IGNORECASE
            )
            desc = ""
            if desc_match:
                desc = (desc_match.group(1) or desc_match.group(2) or "").strip()

            # Count headings
            h1_count = len(re.findall(r'<h1[\s>]', html, re.IGNORECASE))
            img_count = len(re.findall(r'<img\s', html, re.IGNORECASE))
            img_no_alt = len(re.findall(r'<img(?![^>]*alt=)[^>]*>', html, re.IGNORECASE))
            has_canonical = bool(re.search(r'<link[^>]*rel=["\']canonical["\']', html, re.IGNORECASE))
            has_viewport = bool(re.search(r'<meta[^>]*name=["\']viewport["\']', html, re.IGNORECASE))
            has_og = bool(re.search(r'<meta[^>]*property=["\']og:', html, re.IGNORECASE))
            has_schema = bool(re.search(r'application/ld\+json', html, re.IGNORECASE))

            self.results.append({
                "url": str(resp.url),
                "status_code": resp.status_code,
                "title": title[:120],
                "description": desc[:250],
                "h1_count": h1_count,
                "img_count": img_count,
                "img_missing_alt": img_no_alt,
                "has_canonical": has_canonical,
                "has_viewport": has_viewport,
                "has_og_tags": has_og,
                "has_schema": has_schema,
            })

            # Only extract and queue internal links if we want more pages
            if self.max_pages > 1:
                links = re.findall(r'href=["\'](.*?)["\']', html)
                for link in links:
                    link = link.strip()
                    if not link or link.startswith('#') or link.startswith('mailto:') or link.startswith('javascript:') or link.startswith('tel:'):
                        continue
                    # Skip common non-HTML resource paths
                    if re.search(r'\.(jpg|jpeg|png|gif|webp|svg|css|js|pdf|zip|ico|woff|ttf)(\?|$)', link, re.IGNORECASE):
                        continue
                    full_url = urljoin(str(resp.url), link).rstrip('/')
                    full_url = full_url.split('#')[0].split('?')[0]  # strip fragments + query params
                    if urlparse(full_url).netloc == self.domain:
                        if full_url not in self.visited and full_url not in self.to_visit:
                            self.to_visit.append(full_url)

        except Exception as e:
            print(f"[Crawler] Error fetching {url}: {e}")
            self.results.append({
                "url": url,
                "status_code": 0,
                "title": "Fetch Error",
                "description": str(e)[:150],
            })

    async def run(self):
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; QAForgeBot/1.0; +https://qaforge.io/bot)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        }
        async with httpx.AsyncClient(verify=False, headers=headers) as client:
            while self.to_visit and len(self.visited) < self.max_pages:
                # Batch size: 5 for deep/paranoid, 1 for standard
                batch_size = 5 if self.max_pages > 1 else 1
                batch = self.to_visit[:batch_size]
                self.to_visit = self.to_visit[batch_size:]
                tasks = [self.fetch(client, u) for u in batch]
                await asyncio.gather(*tasks)

        print(f"[Crawler] Done. Visited {len(self.results)} pages.")
        return self.results


async def crawl_website(url: str, depth: str) -> list:
    crawler = AsyncCrawler(url, depth)
    return await crawler.run()

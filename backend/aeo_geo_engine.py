"""
QAForge — AEO & GEO Audit Engine v1.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Comprehensive Answer Engine Optimization (AEO) and Generative
Engine Optimization (GEO) Audit Engine.

Evaluates how well a website is prepared for:
  • Google AI Overviews & Gemini Search
  • Perplexity AI
  • ChatGPT Search & OpenAI Operator
  • Microsoft Copilot
  • Voice Assistants (Siri, Google Assistant, Alexa)

Extraction Strategy:
  1. AI Bot Crawlability (inspect robots.txt for GPTBot, PerplexityBot, ClaudeBot, etc.)
  2. Direct Answer Signals (Q&A patterns, 40-70 word answer blocks, lists, tables)
  3. Factual & Statistical Density (empirical data, percentages, citations)
  4. Entity Disambiguation & E-E-A-T (JSON-LD Organization, Person, sameAs, dates)
  5. Semantic HTML Architecture (article, main, section, heading depth)
  6. Multimodal AI Readiness (vision-ready descriptive alt text, OG tags)
  7. AI Synthesis via Gemini (Simulated AI Overviews, winnable queries, gaps)
"""

import asyncio
import re
import json
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any
from urllib.parse import urljoin, urlparse

import httpx

try:
    from bs4 import BeautifulSoup
    BS4_AVAILABLE = True
except ImportError:
    BS4_AVAILABLE = False


BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
}

AI_BOTS = [
    {
        "id": "gptbot",
        "name": "GPTBot",
        "company": "OpenAI",
        "purpose": "ChatGPT Search & Model Training",
        "user_agents": ["gptbot"]
    },
    {
        "id": "chatgpt_user",
        "name": "ChatGPT-User",
        "company": "OpenAI",
        "purpose": "Live User-Triggered Browsing in ChatGPT",
        "user_agents": ["chatgpt-user"]
    },
    {
        "id": "perplexity",
        "name": "PerplexityBot",
        "company": "Perplexity AI",
        "purpose": "Perplexity AI Answer Engine & Citations",
        "user_agents": ["perplexitybot"]
    },
    {
        "id": "claudebot",
        "name": "ClaudeBot / Anthropic",
        "company": "Anthropic",
        "purpose": "Claude AI Search & Retrieval",
        "user_agents": ["claudebot", "anthropic-ai"]
    },
    {
        "id": "google_extended",
        "name": "Google-Extended",
        "company": "Google",
        "purpose": "Google Gemini & Vertex AI Grounding",
        "user_agents": ["google-extended"]
    },
    {
        "id": "applebot",
        "name": "Applebot-Extended",
        "company": "Apple",
        "purpose": "Apple Intelligence & Siri Web Answers",
        "user_agents": ["applebot-extended", "applebot"]
    },
    {
        "id": "meta",
        "name": "Meta-ExternalAgent",
        "company": "Meta",
        "purpose": "Meta AI Assistant Search & Synthesis",
        "user_agents": ["meta-externalagent", "facebookexternalhit"]
    },
    {
        "id": "bytespider",
        "name": "Bytespider",
        "company": "ByteDance",
        "purpose": "TikTok / Doubao AI Search",
        "user_agents": ["bytespider"]
    },
    {
        "id": "cohere",
        "name": "cohere-ai",
        "company": "Cohere",
        "purpose": "Enterprise RAG & Citations",
        "user_agents": ["cohere-ai"]
    },
    {
        "id": "ccbot",
        "name": "CCBot",
        "company": "Common Crawl",
        "purpose": "Open Web Foundation Data for LLMs",
        "user_agents": ["ccbot"]
    }
]

QUESTION_STARTERS = (
    "what", "how", "why", "when", "where", "who", "which",
    "can", "could", "should", "does", "do", "is", "are", "will", "would", "best"
)


def _parse_robots_ai_rules(robots_text: str) -> Dict[str, Dict[str, Any]]:
    """Parse robots.txt specifically for AI crawler permissions."""
    lines = robots_text.splitlines() if robots_text else []
    blocks = []
    current_agents = []
    current_rules = []

    for line in lines:
        raw = line.split("#")[0].strip()
        if not raw:
            continue
        lower = raw.lower()
        if lower.startswith("user-agent:"):
            ua = lower[len("user-agent:"):].strip()
            if current_rules and current_agents:
                blocks.append((current_agents, current_rules))
                current_agents = [ua]
                current_rules = []
            else:
                current_agents.append(ua)
        elif lower.startswith("disallow:"):
            path = raw[len("disallow:"):].strip()
            current_rules.append(("disallow", path))
        elif lower.startswith("allow:"):
            path = raw[len("allow:"):].strip()
            current_rules.append(("allow", path))

    if current_agents:
        blocks.append((current_agents, current_rules))

    # Evaluate each AI bot
    bot_results = {}
    for bot in AI_BOTS:
        b_id = bot["id"]
        bot_uas = set(bot["user_agents"])
        matched_rules = None

        # Check for explicit UA match first
        for uas, rules in blocks:
            for u in uas:
                if u in bot_uas:
                    matched_rules = rules
                    break
            if matched_rules is not None:
                break

        # Fallback to wildcard '*'
        if matched_rules is None:
            for uas, rules in blocks:
                if "*" in uas:
                    matched_rules = rules
                    break

        status = "allowed"
        rule_desc = "Allowed (no blocking rules detected)"
        if matched_rules:
            # Check for disallow /
            disallows = [p for act, p in matched_rules if act == "disallow"]
            allows = [p for act, p in matched_rules if act == "allow"]
            if "/" in disallows and "/" not in allows:
                status = "blocked"
                rule_desc = "Explicitly blocked (Disallow: /)"
            elif any(d for d in disallows if d != ""):
                status = "restricted"
                rule_desc = f"Partially restricted ({len(disallows)} Disallow path(s))"
            elif "" in disallows and not allows:
                status = "allowed"
                rule_desc = "Allowed (Disallow: empty)"

        bot_results[b_id] = {
            "id": b_id,
            "name": bot["name"],
            "company": bot["company"],
            "purpose": bot["purpose"],
            "status": status,
            "rule": rule_desc,
        }

    return bot_results


async def extract_aeo_geo_signals(url: str, target_query: Optional[str] = None) -> Dict[str, Any]:
    """Deterministically extracts AEO & GEO signals from live HTTP response."""
    parsed = urlparse(url)
    base_origin = f"{parsed.scheme}://{parsed.netloc}"
    robots_url = urljoin(base_origin, "/robots.txt")

    result = {
        "url": url,
        "final_url": url,
        "status_code": 0,
        "target_query": target_query or "",
        "page_title": "",
        "meta_description": "",
        "word_count": 0,
        "ai_bots": {},
        "ai_bots_summary": {"allowed": 0, "blocked": 0, "restricted": 0, "total": len(AI_BOTS)},
        "direct_answers": [],
        "question_headings": [],
        "lists_stats": {"unordered": 0, "ordered": 0, "total_items": 0},
        "tables_count": 0,
        "definition_lists_count": 0,
        "statistics_found": [],
        "external_citations": [],
        "dates_found": [],
        "schemas": {"types": [], "has_faq": False, "has_howto": False, "has_org": False, "has_author": False, "same_as": []},
        "semantic_structure": {"has_article": False, "has_main": False, "has_section": False, "semantic_elements": []},
        "multimodal": {"total_images": 0, "descriptive_alt_count": 0, "has_og_image": False, "og_image_url": ""},
        "fetch_error": None,
    }

    try:
        async with httpx.AsyncClient(verify=False, headers=BROWSER_HEADERS, follow_redirects=True, timeout=8.0) as client:
            # Fetch page and robots.txt concurrently
            req_page = client.get(url)
            req_robots = client.get(robots_url)
            resp_page, resp_robots = await asyncio.gather(req_page, req_robots, return_exceptions=True)

            if isinstance(resp_page, Exception):
                result["fetch_error"] = str(resp_page)
                return result

            result["status_code"] = resp_page.status_code
            result["final_url"] = str(resp_page.url)
            html = resp_page.text

            # Parse robots.txt for AI bots
            robots_txt = resp_robots.text if not isinstance(resp_robots, Exception) and resp_robots.status_code == 200 else ""
            ai_bots_map = _parse_robots_ai_rules(robots_txt)
            result["ai_bots"] = ai_bots_map
            for b in ai_bots_map.values():
                st = b["status"]
                if st in result["ai_bots_summary"]:
                    result["ai_bots_summary"][st] += 1

            # Parse HTML with BeautifulSoup (or regex fallback)
            if BS4_AVAILABLE:
                soup = BeautifulSoup(html, "html.parser")

                # Title & Meta Description
                t_tag = soup.find("title")
                result["page_title"] = t_tag.get_text().strip() if t_tag else ""

                m_desc = soup.find("meta", attrs={"name": re.compile(r"description", re.I)})
                if m_desc and m_desc.get("content"):
                    result["meta_description"] = m_desc["content"].strip()

                # OpenGraph Image
                og_img = soup.find("meta", attrs={"property": "og:image"}) or soup.find("meta", attrs={"name": "og:image"})
                if og_img and og_img.get("content"):
                    result["multimodal"]["has_og_image"] = True
                    result["multimodal"]["og_image_url"] = og_img["content"]

                # JSON-LD Schemas
                schema_scripts = soup.find_all("script", attrs={"type": "application/ld+json"})
                for s in schema_scripts:
                    try:
                        s_data = json.loads(s.get_text())
                        items = s_data if isinstance(s_data, list) else [s_data]
                        for item in items:
                            if isinstance(item, dict):
                                stype = item.get("@type", "")
                                if isinstance(stype, list):
                                    result["schemas"]["types"].extend(stype)
                                elif stype:
                                    result["schemas"]["types"].append(stype)

                                if "FAQPage" in str(stype):
                                    result["schemas"]["has_faq"] = True
                                if "HowTo" in str(stype):
                                    result["schemas"]["has_howto"] = True
                                if "Organization" in str(stype):
                                    result["schemas"]["has_org"] = True
                                if any(k in str(item) for k in ("author", "Person")):
                                    result["schemas"]["has_author"] = True
                                if "sameAs" in item:
                                    same = item["sameAs"]
                                    if isinstance(same, list):
                                        result["schemas"]["same_as"].extend(same)
                                    elif isinstance(same, str):
                                        result["schemas"]["same_as"].append(same)
                    except Exception:
                        pass

                # Semantic HTML Elements
                for sem in ["article", "main", "section", "header", "footer", "aside", "nav"]:
                    if soup.find(sem):
                        result["semantic_structure"]["semantic_elements"].append(sem)
                        if sem == "article":
                            result["semantic_structure"]["has_article"] = True
                        if sem == "main":
                            result["semantic_structure"]["has_main"] = True
                        if sem == "section":
                            result["semantic_structure"]["has_section"] = True

                # Lists, Tables, Definition Lists
                uls = soup.find_all("ul")
                ols = soup.find_all("ol")
                result["lists_stats"]["unordered"] = len(uls)
                result["lists_stats"]["ordered"] = len(ols)
                result["lists_stats"]["total_items"] = len(soup.find_all("li"))
                result["tables_count"] = len(soup.find_all("table"))
                result["definition_lists_count"] = len(soup.find_all("dl"))

                # Images & Alt
                imgs = soup.find_all("img")
                result["multimodal"]["total_images"] = len(imgs)
                desc_alts = [i for i in imgs if i.get("alt") and len(i.get("alt").strip()) >= 15]
                result["multimodal"]["descriptive_alt_count"] = len(desc_alts)

                # Question Headings & Direct Answer Snippets
                headings = soup.find_all(["h1", "h2", "h3", "h4"])
                for h in headings:
                    htext = h.get_text().strip()
                    if not htext:
                        continue
                    first_word = htext.split()[0].lower().rstrip("?,:") if htext.split() else ""
                    is_question = htext.endswith("?") or first_word in QUESTION_STARTERS

                    if is_question:
                        result["question_headings"].append(htext)

                    # Look for immediate sibling or child paragraph (Direct Answer Block)
                    nxt = h.find_next_sibling()
                    if nxt and nxt.name in ("p", "div", "ul", "ol"):
                        ans_text = nxt.get_text().strip()
                        w_count = len(ans_text.split())
                        # 30-80 words is the golden ratio for AI Overviews / voice answers
                        if 20 <= w_count <= 95:
                            result["direct_answers"].append({
                                "heading": htext,
                                "answer": ans_text[:350],
                                "word_count": w_count,
                                "is_ideal_length": 35 <= w_count <= 75,
                                "tag": nxt.name
                            })

                # Body text & statistics detection
                body = soup.find("body") or soup
                body_text = body.get_text(separator=" ", strip=True)
                words = body_text.split()
                result["word_count"] = len(words)

                # Empirical statistics (e.g. 98%, $500, 2,500, 2024-2026)
                stats = re.findall(r'\b(?:\$\d+[\d,]*(?:\.\d+)?|\d+(?:\.\d+)?%|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\b\d+\s*(?:million|billion|thousand|users|clients|projects|ms|sec)\b)', body_text, re.IGNORECASE)
                result["statistics_found"] = list(dict.fromkeys(stats))[:12]

                # Authoritative external citation links
                for a in soup.find_all("a", href=True):
                    href = a["href"].strip()
                    if href.startswith("http") and not href.startswith(base_origin):
                        if any(auth in href for auth in [".gov", ".edu", "wikipedia.org", "w3.org", "github.com", "doi.org", "research"]):
                            result["external_citations"].append({"text": a.get_text().strip()[:50], "url": href})

                # Dates
                time_tags = soup.find_all("time")
                for tt in time_tags:
                    dt = tt.get("datetime") or tt.get_text().strip()
                    if dt:
                        result["dates_found"].append(dt)
            else:
                # Regex fallback if bs4 is missing
                result["word_count"] = len(html.split())

    except Exception as e:
        result["fetch_error"] = str(e)

    return result


async def audit_aeo_geo(url: str, target_query: Optional[str] = None, ai_engine = None) -> Dict[str, Any]:
    """
    Complete AEO & GEO Audit with deterministic signal extraction
    combined with fast Gemini REST synthesis.
    """
    clean_url = url.strip()
    if not clean_url.startswith("http://") and not clean_url.startswith("https://"):
        clean_url = "https://" + clean_url

    # 1. Deterministic extraction
    sig = await extract_aeo_geo_signals(clean_url, target_query)

    # 2. Compute deterministic scores
    # AI Bot Accessibility (0-100)
    ai_allowed = sig["ai_bots_summary"]["allowed"]
    ai_total = sig["ai_bots_summary"]["total"]
    bot_score = round((ai_allowed / max(1, ai_total)) * 100)

    # Direct Answer Score (AEO)
    da_score = 0
    if sig["question_headings"]:
        da_score += min(30, len(sig["question_headings"]) * 10)
    if sig["direct_answers"]:
        da_score += min(35, len(sig["direct_answers"]) * 12)
    if sig["lists_stats"]["total_items"] > 5:
        da_score += 20
    if sig["tables_count"] > 0 or sig["definition_lists_count"] > 0:
        da_score += 15
    da_score = min(100, da_score)

    # Generative Citation Score (GEO)
    geo_score = 0
    if sig["word_count"] >= 300:
        geo_score += 25
    if len(sig["statistics_found"]) >= 3:
        geo_score += 25
    if sig["schemas"]["has_org"] or sig["schemas"]["has_faq"]:
        geo_score += 25
    if sig["semantic_structure"]["has_article"] or sig["semantic_structure"]["has_main"]:
        geo_score += 15
    if len(sig["schemas"]["same_as"]) > 0:
        geo_score += 10
    geo_score = min(100, geo_score)

    # Overall AI Engine Score
    overall_score = round((bot_score * 0.35) + (da_score * 0.35) + (geo_score * 0.30))

    # 3. AI synthesis via Gemini (using rest transport for 1.5s execution)
    prompt = f"""You are a World-Class AEO (Answer Engine Optimization) & GEO (Generative Engine Optimization) Specialist.
Analyze the following REAL extraction data for: {clean_url}
Target query focus: {target_query or "Brand & service core queries"}

REAL DATA SIGNALS:
- AI Crawlers: {sig['ai_bots_summary']['allowed']}/{sig['ai_bots_summary']['total']} allowed.
- Bot status: {', '.join([f"{b['name']}: {b['status']}" for b in list(sig['ai_bots'].values())[:6]])}
- Direct answer candidates: {len(sig['direct_answers'])} blocks found.
- Question headings: {sig['question_headings'][:5]}
- Word count: {sig['word_count']} words
- Lists: {sig['lists_stats']['unordered'] + sig['lists_stats']['ordered']} ({sig['lists_stats']['total_items']} items)
- Tables: {sig['tables_count']} | Definition lists: {sig['definition_lists_count']}
- Empirical statistics: {sig['statistics_found'][:6]}
- Schemas: {sig['schemas']['types']} | FAQ schema: {sig['schemas']['has_faq']} | Org: {sig['schemas']['has_org']}
- Entity sameAs: {sig['schemas']['same_as']}
- Title: {sig['page_title']}
- Meta description: {sig['meta_description']}

TASK:
Provide an expert evaluation of how this website performs in AI answer engines (ChatGPT Search, Perplexity AI, Google AI Overviews, Apple Intelligence).
Return a JSON object with:
{{
  "ai_overview_readiness": "High" or "Moderate" or "Low",
  "voice_search_readiness": "High" or "Moderate" or "Low",
  "chatgpt_search_readiness": "High" or "Moderate" or "Low",
  "perplexity_citation_readiness": "High" or "Moderate" or "Low",
  "simulated_ai_snippet": "A realistic 2-3 sentence answer of how ChatGPT or Perplexity would synthesize information about this site/service when asked by a user.",
  "query_opportunities": [
    "5 high-intent conversational/question queries this page could win in AI search (e.g. 'How does X work?', 'Best Y in Z')"
  ],
  "content_gaps": [
    "3 specific factual or structural questions AI models cannot currently answer from this page without guessing"
  ],
  "strengths": [
    "3 concrete strengths for AI discovery based on real data"
  ],
  "actionable_fixes": [
    {{
      "title": "Short title",
      "priority": "Critical" or "High" or "Medium",
      "category": "AEO Formatting" or "AI Bot Access" or "Knowledge Graph" or "Factual Density",
      "recommendation": "Concrete fix with exact instructions"
    }}
  ],
  "recommended_schema_snippet": "A ready-to-copy JSON-LD script snippet (FAQPage or Organization) tailored to this site."
}}

OUTPUT ONLY raw JSON. No markdown backticks, no preamble."""

    ai_data = {}
    model_name = "Deterministic Engine"
    if ai_engine:
        try:
            text, mname = await asyncio.to_thread(ai_engine._try, prompt, None, "flash")
            model_name = mname
            clean_txt = text.strip()
            if clean_txt.startswith("```"):
                clean_txt = re.sub(r"^```(?:json)?\s*", "", clean_txt)
                clean_txt = re.sub(r"\s*```$", "", clean_txt)
            ai_data = json.loads(clean_txt)
        except Exception as e:
            print(f"[AEO/GEO] AI generation error: {e}")
            ai_data = {
                "ai_overview_readiness": "Moderate" if overall_score >= 50 else "Low",
                "voice_search_readiness": "Moderate" if da_score >= 40 else "Low",
                "chatgpt_search_readiness": "High" if bot_score >= 70 else "Low",
                "perplexity_citation_readiness": "Moderate" if geo_score >= 50 else "Low",
                "simulated_ai_snippet": f"{sig['page_title'] or clean_url} provides web content with {sig['word_count']} words. AI models extract core information based on available headings and structured schema.",
                "query_opportunities": [
                    f"What services does {sig['page_title'] or 'this site'} offer?",
                    f"How to contact {urlparse(clean_url).netloc}?",
                    f"Reviews and overview of {sig['page_title'] or 'the website'}"
                ],
                "content_gaps": [
                    "Add structured FAQ schema to directly feed Google AI Overviews and Perplexity.",
                    "Include concise 45-60 word direct answer definitions under main headings."
                ],
                "strengths": [
                    f"Page is online with HTTP {sig['status_code']}",
                    f"Contains {sig['word_count']} words of indexed content",
                    f"{sig['ai_bots_summary']['allowed']} of {sig['ai_bots_summary']['total']} AI crawlers currently allowed in robots.txt"
                ],
                "actionable_fixes": [
                    {
                        "title": "Enable AI Crawlers in robots.txt",
                        "priority": "High" if bot_score < 70 else "Medium",
                        "category": "AI Bot Access",
                        "recommendation": "Ensure GPTBot and PerplexityBot are not blocked in robots.txt so your brand appears in ChatGPT Search and Perplexity."
                    },
                    {
                        "title": "Implement FAQPage JSON-LD Schema",
                        "priority": "High",
                        "category": "AEO Formatting",
                        "recommendation": "Add FAQPage schema with top customer questions and answers for direct inclusion in AI Overviews."
                    }
                ],
                "recommended_schema_snippet": '{\n  "@context": "https://schema.org",\n  "@type": "FAQPage",\n  "mainEntity": []\n}'
            }

    return {
        "scan_id": str(uuid.uuid4()),
        "url": clean_url,
        "target_query": target_query,
        "scanned_at": datetime.now().isoformat(),
        "model_used": model_name,
        "scores": {
            "overall_ai_score": overall_score,
            "bot_accessibility_score": bot_score,
            "direct_answer_score": da_score,
            "generative_citation_score": geo_score,
        },
        "readiness": {
            "ai_overviews": ai_data.get("ai_overview_readiness", "Moderate"),
            "voice_search": ai_data.get("voice_search_readiness", "Moderate"),
            "chatgpt_search": ai_data.get("chatgpt_search_readiness", "Moderate"),
            "perplexity": ai_data.get("perplexity_citation_readiness", "Moderate"),
        },
        "simulated_ai_snippet": ai_data.get("simulated_ai_snippet", ""),
        "query_opportunities": ai_data.get("query_opportunities", []),
        "content_gaps": ai_data.get("content_gaps", []),
        "strengths": ai_data.get("strengths", []),
        "actionable_fixes": ai_data.get("actionable_fixes", []),
        "recommended_schema_snippet": ai_data.get("recommended_schema_snippet", ""),
        "raw_signals": sig,
    }

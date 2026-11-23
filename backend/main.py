"""QAForge Gemini — FastAPI Backend v4.0"""

import os, json, uuid, base64, asyncio
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Load backend/.env
def _load_env():
    p = Path(__file__).parent / ".env"
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                if k.strip() and v.strip() and k.strip() not in os.environ:
                    os.environ[k.strip()] = v.strip()
_load_env()

from .ai_engine import AIEngine, MODEL_LABELS, MODEL_CHAIN
from .test_executor import TestExecutor
from .report_gen import ReportGenerator
from .models import GenerateRequest, ExecuteRequest, BugScanRequest, AppConfig, RangeConfig, ProxyRequest, ApiGenerateRequest, BugFormatRequest, SeoAuditRequest, AeoGeoAuditRequest
from .aeo_geo_engine import audit_aeo_geo


app = FastAPI(title="QAForge Gemini API", version="4.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

def _env(n):
    return os.environ.get(f"GEMINI_API_KEY_{n}", "")

from typing import Any

store: dict[str, Any] = {
    "suites":  {},
    "results": {},
    "scans":   {},
    "seo_audits": {},
    "active_seo_tasks": {},
    "active_seo_scans": {},
    "latest_seo_audit": None,
    "config": {
        "api_key_1":     _env(1),
        "api_key_2":     _env(2),
        "api_key_3":     _env(3),
        "api_key_4":     _env(4),
        "default_model": os.environ.get("DEFAULT_MODEL", "flash"),
    }
}

ai       = AIEngine(store)
executor = TestExecutor()
reporter = ReportGenerator()

REPORTS_DIR = Path("reports")
try:
    REPORTS_DIR.mkdir(exist_ok=True)
except OSError:
    REPORTS_DIR = Path("/tmp/reports")
    REPORTS_DIR.mkdir(exist_ok=True)

# ── Health ─────────────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    keys = ai._get_keys()
    return {
        "status": "ok",
        "version": "4.0.0",
        "api_connected": bool(keys),
        "keys_configured": len(keys),
        "model_status": ai.get_model_status(),
        "timestamp": datetime.now().isoformat(),
    }

# ── Config ─────────────────────────────────────────────────────────────────────
@app.get("/api/config")
async def get_config():
    cfg = dict(store["config"])
    for i in range(1, 5):
        k = str(cfg.get(f"api_key_{i}", ""))
        cfg[f"api_key_{i}"] = (k[:6] + "••••" + k[-3:]) if len(k) > 9 else ("••••••" if k else "")  # type: ignore
    cfg["keys_configured"] = len(ai._get_keys())
    cfg["model_status"] = ai.get_model_status()
    return cfg

@app.post("/api/config")
async def save_config(config: AppConfig):
    for i in range(1, 5):
        val = getattr(config, f"api_key_{i}", None)
        if val and "••" not in val:
            store["config"][f"api_key_{i}"] = val.strip()
    if config.default_model:
        store["config"]["default_model"] = config.default_model
    ai.reset_quota()
    keys = ai._get_keys()
    return {"status": "saved", "keys_configured": len(keys), "api_connected": bool(keys), "model_status": ai.get_model_status()}

@app.post("/api/quota/reset")
async def reset_quota():
    ai.reset_quota()
    return {"status": "reset", "model_status": ai.get_model_status()}

# ── Generate ───────────────────────────────────────────────────────────────────
@app.post("/api/generate/url")
async def gen_url(req: GenerateRequest):
    suite = await ai.generate_from_url(req)
    store["suites"][suite.id] = suite.dict()
    return suite

@app.post("/api/generate/text")
async def gen_text(req: GenerateRequest):
    suite = await ai.generate_from_text(req)
    store["suites"][suite.id] = suite.dict()
    return suite

@app.post("/api/generate/image")
async def gen_image(
    file: UploadFile = File(...),
    app_type: str = Form("web"),
    description: str = Form(""),
    focus_areas: str = Form(""),
    critical_count: int = Form(0),
    high_count: int = Form(0),
    min_tests: int = Form(10),
    max_tests: int = Form(20),
    is_multi_agent: bool = Form(False),
    agents: str = Form(""),
    depth: str = Form("standard"),
):
    data = await file.read()
    b64  = base64.b64encode(data).decode()
    rc   = RangeConfig(min_tests=min_tests, max_tests=max_tests)
    fa_list = [f.strip() for f in focus_areas.split(",") if f.strip()]
    agent_list = [a.strip() for a in agents.split(",") if a.strip()]
    suite = await ai.generate_from_image(b64, file.content_type or "image/png", app_type, description, fa_list, rc, is_multi_agent, agent_list, depth=depth)
    store["suites"][suite.id] = suite.dict()
    return suite

@app.post("/api/generate/video")
async def gen_video(
    file: UploadFile = File(...),
    app_type: str = Form("web"),
    description: str = Form(""),
    focus_areas: str = Form(""),
    critical_count: int = Form(0),
    high_count: int = Form(0),
    min_tests: int = Form(10),
    max_tests: int = Form(20),
    is_multi_agent: bool = Form(False),
    agents: str = Form(""),
    depth: str = Form("standard"),
):
    data = await file.read()
    b64  = base64.b64encode(data).decode()
    rc   = RangeConfig(min_tests=min_tests, max_tests=max_tests)
    fa_list = [f.strip() for f in focus_areas.split(",") if f.strip()]
    agent_list = [a.strip() for a in agents.split(",") if a.strip()]
    suite = await ai.generate_from_video(b64, file.content_type or "video/mp4", app_type, description, fa_list, rc, is_multi_agent, agent_list, depth=depth)
    store["suites"][suite.id] = suite.dict()
    return suite

@app.post("/api/generate/document")
async def gen_document(
    file: UploadFile = File(...),
    app_type: str = Form("web"),
    description: str = Form(""),
    focus_areas: str = Form(""),
    min_tests: int = Form(10),
    max_tests: int = Form(20),
    is_multi_agent: bool = Form(False),
    agents: str = Form(""),
    depth: str = Form("standard"),
):
    """Generate test cases from a requirements document (PDF, DOC/DOCX, PPT/PPTX, TXT, MD, CSV)."""
    data = await file.read()
    rc   = RangeConfig(min_tests=min_tests, max_tests=max_tests)
    fa_list = [f.strip() for f in focus_areas.split(",") if f.strip()]
    agent_list = [a.strip() for a in agents.split(",") if a.strip()]
    try:
        suite = await ai.generate_from_document(
            file_bytes=data,
            filename=file.filename or "document",
            mime_type=file.content_type or "application/octet-stream",
            app_type=app_type,
            description=description,
            focus_areas=fa_list,
            rc=rc,
            is_multi_agent=is_multi_agent,
            agents=agent_list,
            depth=depth,
        )
    except ValueError as e:
        raise HTTPException(422, str(e))
    store["suites"][suite.id] = suite.dict()
    return suite


@app.post("/api/generate/api")
async def gen_api(req: ApiGenerateRequest):
    suite = await ai.generate_from_api(req)
    store["suites"][suite.id] = suite.dict()
    return suite


# ── Bug Scan ───────────────────────────────────────────────────────────────────
@app.post("/api/scan/bugs")
async def bug_scan(req: BugScanRequest):
    result = await ai.bug_scan(req.app_type, req.description or "", req.url, getattr(req, "depth", "standard"), getattr(req, "categories", []))
    store["scans"][result["scan_id"]] = result
    return result

@app.get("/api/scans")
async def list_scans():
    return list(store["scans"].values())

@app.get("/api/scans/{sid}")
async def get_scan(sid: str):
    return _404(store["scans"], sid, "Scan")

@app.get("/api/scans/{sid}/download")
async def dl_scan(sid: str):
    scan = _404(store["scans"], sid, "Scan")
    p = REPORTS_DIR / f"scan_{str(sid)[:8]}.json"  # type: ignore
    p.write_text(json.dumps(scan, indent=2))
    return FileResponse(p, media_type="application/json", filename=p.name)

# ── Bug Format ─────────────────────────────────────────────────────────────────
@app.post("/api/format/bug")
async def format_bug(req: BugFormatRequest):
    result = await ai.format_bug(req.raw_text, req.app_type, req.severity, req.environment, req.module)
    return result

@app.post("/api/format/bug/image")
async def format_bug_image(
    raw_text:    str = Form(""),
    app_type:    str = Form("web"),
    severity:    str = Form(""),
    environment: str = Form(""),
    module:      str = Form("ui"),
    image:       Optional[UploadFile] = File(None),
):
    """Generate a professional bug report from an optional screenshot + optional text description."""
    image_b64  = None
    image_mime = None
    if image and image.filename:
        img_data   = await image.read()
        image_b64  = base64.b64encode(img_data).decode()
        image_mime = image.content_type or "image/png"

    result = await ai.format_bug(
        raw_text=raw_text,
        app_type=app_type,
        severity=severity or None,
        environment=environment or None,
        module=module or None,
        image_b64=image_b64,
        image_mime=image_mime,
    )
    return result


# ── SEO Audit ──────────────────────────────────────────────────────────────────
@app.post("/api/audit/seo")
async def seo_audit(req: SeoAuditRequest):
    clean_url = req.url.strip()
    key = f"{clean_url}_{req.depth}"

    # If already running, await the existing task so client disconnects/reconnects don't disrupt
    if key in store.get("active_seo_tasks", {}):
        task = store["active_seo_tasks"][key]
        try:
            return await task
        except Exception:
            pass  # If it failed previously, restart

    async def _execute_scan():
        res = await ai.seo_audit(clean_url, req.depth)
        store["seo_audits"][res["scan_id"]] = res
        store["latest_seo_audit"] = res
        return res

    scan_task = asyncio.create_task(_execute_scan())
    if "active_seo_tasks" not in store:
        store["active_seo_tasks"] = {}
    if "active_seo_scans" not in store:
        store["active_seo_scans"] = {}

    store["active_seo_tasks"][key] = scan_task
    store["active_seo_scans"][key] = {
        "url": clean_url,
        "depth": req.depth,
        "status": "running",
        "started_at": datetime.now().isoformat(),
        "scan_id": None,
    }

    try:
        result = await scan_task
        store["active_seo_scans"][key]["status"] = "completed"
        store["active_seo_scans"][key]["scan_id"] = result.get("scan_id")
        store["active_seo_scans"][key]["result"] = result
        return result
    except Exception as e:
        store["active_seo_scans"][key]["status"] = "failed"
        store["active_seo_scans"][key]["error"] = str(e)
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"SEO Audit failed: {e}")
    finally:
        store["active_seo_tasks"].pop(key, None)

@app.get("/api/audit/seo/status")
async def seo_audit_status(url: Optional[str] = None, depth: str = "standard"):
    if url:
        key = f"{url.strip()}_{depth}"
        if key in store.get("active_seo_scans", {}):
            return store["active_seo_scans"][key]
        # Check if it was already saved in seo_audits
        for sid, aud in reversed(list(store.get("seo_audits", {}).items())):
            if aud.get("url") == url.strip():
                return {"status": "completed", "result": aud, "scan_id": sid}

    active = [s for s in store.get("active_seo_scans", {}).values() if s.get("status") == "running"]
    return {
        "status": "running" if active else "idle",
        "active_scans": active,
        "latest": store.get("latest_seo_audit")
    }

@app.get("/api/audit/seo/latest")
async def get_latest_seo_audit():
    if store.get("latest_seo_audit"):
        return store["latest_seo_audit"]
    audits = list(store.get("seo_audits", {}).values())
    if audits:
        return audits[-1]
    return {"status": "none"}

@app.get("/api/audit/seo")
async def list_seo_audits():
    return list(store["seo_audits"].values())

@app.get("/api/audit/seo/{sid}")
async def get_seo_audit(sid: str):
    return _404(store["seo_audits"], sid, "SEO Audit")

# ── AEO & GEO Audit ────────────────────────────────────────────────────────────
@app.post("/api/audit/aeo-geo")
async def aeo_geo_audit_endpoint(req: AeoGeoAuditRequest):
    clean_url = req.url.strip()
    key = f"aeo_{clean_url}_{req.target_query or ''}"

    if key in store.get("active_aeo_tasks", {}):
        task = store["active_aeo_tasks"][key]
        try:
            return await task
        except Exception:
            pass

    async def _execute():
        res = await audit_aeo_geo(clean_url, req.target_query, ai_engine=ai)
        if "aeo_audits" not in store:
            store["aeo_audits"] = {}
        store["aeo_audits"][res["scan_id"]] = res
        store["latest_aeo_audit"] = res
        return res

    scan_task = asyncio.create_task(_execute())
    if "active_aeo_tasks" not in store:
        store["active_aeo_tasks"] = {}
    if "active_aeo_scans" not in store:
        store["active_aeo_scans"] = {}

    store["active_aeo_tasks"][key] = scan_task
    store["active_aeo_scans"][key] = {
        "url": clean_url,
        "target_query": req.target_query,
        "status": "running",
        "started_at": datetime.now().isoformat(),
        "scan_id": None,
    }

    try:
        result = await scan_task
        store["active_aeo_scans"][key]["status"] = "completed"
        store["active_aeo_scans"][key]["scan_id"] = result.get("scan_id")
        store["active_aeo_scans"][key]["result"] = result
        return result
    except Exception as e:
        store["active_aeo_scans"][key]["status"] = "failed"
        store["active_aeo_scans"][key]["error"] = str(e)
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"AEO/GEO Audit failed: {e}")
    finally:
        store["active_aeo_tasks"].pop(key, None)

@app.get("/api/audit/aeo-geo/status")
async def aeo_geo_status_endpoint(url: Optional[str] = None, target_query: Optional[str] = None):
    if url:
        key = f"aeo_{url.strip()}_{target_query or ''}"
        if key in store.get("active_aeo_scans", {}):
            return store["active_aeo_scans"][key]
        for sid, aud in reversed(list(store.get("aeo_audits", {}).items())):
            if aud.get("url") == url.strip():
                return {"status": "completed", "result": aud, "scan_id": sid}

    active = [s for s in store.get("active_aeo_scans", {}).values() if s.get("status") == "running"]
    return {
        "status": "running" if active else "idle",
        "active_scans": active,
        "latest": store.get("latest_aeo_audit")
    }

@app.get("/api/audit/aeo-geo/latest")
async def get_latest_aeo_geo_audit_endpoint():
    if store.get("latest_aeo_audit"):
        return store["latest_aeo_audit"]
    audits = list(store.get("aeo_audits", {}).values())
    if audits:
        return audits[-1]
    return {"status": "none"}

@app.get("/api/audit/aeo-geo/{sid}")
async def get_single_aeo_geo_audit_endpoint(sid: str):
    if "aeo_audits" not in store:
        store["aeo_audits"] = {}
    return _404(store["aeo_audits"], sid, "AEO/GEO Audit")


# ── Suites ─────────────────────────────────────────────────────────────────────
@app.get("/api/suites")
async def list_suites():
    return list(store["suites"].values())

@app.get("/api/suites/{sid}")
async def get_suite(sid: str):
    return _404(store["suites"], sid, "Suite")

@app.delete("/api/suites/{sid}")
async def del_suite(sid: str):
    store["suites"].pop(sid, None)
    return {"deleted": sid}

@app.get("/api/suites/{sid}/download")
async def dl_suite(sid: str):
    suite = _404(store["suites"], sid, "Suite")
    p = REPORTS_DIR / f"suite_{str(sid)[:8]}.json"  # type: ignore
    p.write_text(json.dumps(suite, indent=2))
    return FileResponse(p, media_type="application/json", filename=p.name)

# ── Execute ────────────────────────────────────────────────────────────────────
@app.post("/api/execute/{sid}")
async def execute(sid: str, req: ExecuteRequest, bg: BackgroundTasks):
    suite = _404(store["suites"], sid, "Suite")
    run_id = str(uuid.uuid4())
    store["results"][run_id] = {
        "run_id": run_id, "suite_id": sid, "suite_name": suite["name"],
        "environment": req.environment, "status": "running", "progress": 0,
        "started_at": datetime.now().isoformat(), "tests": [],
    }
    bg.add_task(_run, run_id, sid, req)
    return {"run_id": run_id, "status": "running"}

async def _run(run_id: str, sid: str, req: ExecuteRequest):
    suite = store["suites"][sid]
    tests = suite["tests"]
    results: list[dict[str, Any]] = []
    sem = asyncio.Semaphore(15) # Run 15 simulations in parallel

    async def run_with_progress(t):
        async with sem:
            res = await executor.run_test(t, req.environment, req.base_url)
            results.append(res)
            # Update combined state for the frontend poller
            store["results"][run_id]["tests"] = list(results)
            store["results"][run_id]["progress"] = round(len(results) / len(tests) * 100)
            return res

    await asyncio.gather(*(run_with_progress(t) for t in tests))
    passed = sum(1 for r in results if r["status"] == "pass")
    store["results"][run_id].update({
        "status": "completed", "completed_at": datetime.now().isoformat(),
        "summary": {
            "total": len(results), "passed": passed,
            "failed": len(results) - passed,
            "pass_rate": round(float(passed)/len(results)*100, 1) if results else 0.0,  # type: ignore
        }
    })

@app.get("/api/results")
async def list_results():
    return list(store["results"].values())

@app.get("/api/results/{run_id}")
async def get_result(run_id: str):
    return _404(store["results"], run_id, "Run")

# ── Reports ────────────────────────────────────────────────────────────────────
@app.post("/api/reports/{run_id}")
async def make_report(run_id: str, fmt: str = "html"):
    result = _404(store["results"], run_id, "Run")
    suite  = store["suites"].get(result["suite_id"], {})
    path   = reporter.generate(result, suite, fmt, REPORTS_DIR)
    return {"filename": path.name}

@app.get("/api/reports/download/{filename}")
async def dl_report(filename: str):
    path = REPORTS_DIR / filename
    if not path.exists():
        raise HTTPException(404, "Report not found")
    mmap = {".html":"text/html",".json":"application/json",
            ".xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
    return FileResponse(path, media_type=mmap.get(path.suffix,"application/octet-stream"), filename=filename)

# ── Helpers ────────────────────────────────────────────────────────────────────
def _404(d, key, label):
    if key not in d:
        raise HTTPException(404, f"{label} not found")
    return d[key]


# ── API PROXY (for CORS-restricted APIs) ──────────────────────────────────────
import httpx

@app.post("/api/proxy")
async def proxy_request(req: ProxyRequest):
    try:
        # Build cookies from the Cookie header if present
        jar = httpx.Cookies()
        req_headers = {k: v for k, v in (req.headers or {}).items() if k.lower() not in ('host', 'origin', 'referer')}
        cookie_hdr = req_headers.pop('cookie', req_headers.pop('Cookie', None))
        if cookie_hdr:
            for pair in cookie_hdr.split(';'):
                pair = pair.strip()
                if '=' in pair:
                    ck, cv = pair.split('=', 1)
                    jar.set(ck.strip(), cv.strip())

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, cookies=jar) as client:
            response = await client.request(
                method=req.method,
                url=req.url,
                headers=req_headers,
                content=req.body.encode() if req.body else None,
            )
            res_headers = dict(response.headers)

            # Extract Set-Cookie headers (httpx merges them; get raw from response)
            set_cookies = []
            for k, v in response.headers.multi_items():
                if k.lower() == 'set-cookie':
                    set_cookies.append(v)

            try:
                body = response.json()
            except Exception:
                body = response.text
            return {
                "status": response.status_code,
                "statusText": response.reason_phrase,
                "headers": res_headers,
                "body": body,
                "size": len(response.content),
                "set_cookies": set_cookies,
            }
    except httpx.TimeoutException:
        raise HTTPException(504, "Request timed out")
    except Exception as e:
        raise HTTPException(502, f"Proxy error: {str(e)}")

# ── BLOGS ──────────────────────────────────────────────────────────────────────
BLOG_CACHE_FILE = REPORTS_DIR / "daily_blogs.json"

DEFAULT_BLOGS = [
    {
        "id": "blog-001",
        "title": "Navigating the Frontier: Best Practices for AI Testing in Modern Software",
        "summary": "Artificial intelligence introduces non-deterministic behavior that traditional testing frameworks struggle to capture. Discover how modern QA teams are adapting their strategies to validate complex machine learning models effectively.",
        "content": "As software engineering increasingly relies on machine learning and artificial intelligence, the paradigm of quality assurance is undergoing a massive shift. Traditional testing relies heavily on deterministic inputs yielding expected outputs, but AI systems operate on probabilities, making bugs harder to isolate and reproduce. To ensure reliability, QA engineers must implement rigorous data validation, monitoring for data drift, and continuous evaluation pipelines that catch algorithmic bias and performance degradation before production deployment.\n\nAt Navoto, we have found that combining automated unit testing for model inputs with human-in-the-loop validation creates a robust safety net for complex AI deployments. Furthermore, establishing baseline benchmarks and continuous regression testing across edge-case data sets helps catch silent model degradation early. Ultimately, testing AI is not just about checking if code works; it is about verifying that the underlying models make fair, accurate, and consistent decisions in dynamic real-world environments.",
        "category": "AI",
        "read_time": "4 min read",
        "author": "Akhil Saxena",
        "author_role": "Software Tester at Navoto",
        "image_keyword": "artificial intelligence technology",
        "date": "Nov 23, 2026"
    },
    {
        "id": "blog-002",
        "title": "Beyond the Basics: Scaling Automation Testing for Enterprise Agility",
        "summary": "Test automation is no longer just a nice-to-have, but the backbone of continuous delivery pipelines. Learn how to design scalable, self-healing test suites that reduce maintenance overhead and accelerate release cycles.",
        "content": "In today's fast-paced development ecosystem, manual testing bottlenecks can severely hinder an organization's ability to release features quickly. Scaling automation testing requires a strategic approach that goes beyond simply recording and playing back test scripts. By adopting modular design patterns, leveraging containerized test environments, and integrating self-healing locators, engineering teams can drastically minimize the time spent fixing brittle tests.\n\nAt Navoto, our focus has shifted toward building resilient regression suites that run seamlessly within CI/CD pipelines, giving developers instant feedback. When automation is approached with architectural foresight, it transforms from a maintenance chore into a powerful driver of speed, confidence, and enterprise agility.",
        "category": "Automation",
        "read_time": "3 min read",
        "author": "Akhil Saxena",
        "author_role": "Software Tester at Navoto",
        "image_keyword": "software automation code",
        "date": "Nov 23, 2026"
    },
    {
        "id": "blog-003",
        "title": "From Manual to Automated: How AI is Transforming the QA Workflow",
        "summary": "The integration of generative AI and intelligent recorders is revolutionizing how QA professionals transition legacy manual tests into robust automated suites. Explore how this synergy saves time and elevates the tester's strategic value.",
        "content": "For years, the transition from manual testing to automation has been a daunting hurdle, often plagued by steep learning curves and resource constraints. Today, AI-powered tools are bridging this gap by automatically converting plain-text test cases, exploratory session recordings, and user stories into executable automation scripts.\n\nThis technological leap allows software testers to spend less time wrestling with syntax and more time focusing on complex exploratory scenarios, edge cases, and user experience. At Navoto, embracing AI-driven test generation has empowered our team to scale our test coverage exponentially without compromising on quality or deep human intuition. By letting AI handle the repetitive heavy lifting, testers are finally stepping into the strategic, high-impact roles they were always meant to hold.",
        "category": "Manual-AI",
        "read_time": "5 min read",
        "author": "Akhil Saxena",
        "author_role": "Software Tester at Navoto",
        "image_keyword": "futuristic technology testing",
        "date": "Nov 23, 2026"
    }
]

@app.get("/api/blogs")
async def get_daily_blogs():
    print(f"[QAForge] Blog request received.")
    today = datetime.now().strftime("%Y-%m-%d")

    # 1. Check in-memory process cache
    if "cached_blogs" in store and store.get("cached_blogs_date") == today:
        return store["cached_blogs"]

    # 2. Check disk caches (/tmp or reports)
    for p in [Path("/tmp/daily_blogs.json"), BLOG_CACHE_FILE]:
        try:
            if p.exists():
                cache = json.loads(p.read_text())
                if cache.get("date") == today and cache.get("blogs"):
                    store["cached_blogs"] = cache["blogs"]
                    store["cached_blogs_date"] = today
                    return cache["blogs"]
        except Exception:
            pass

    # 3. AI Generation
    try:
        blogs = await ai.generate_daily_blogs()
    except Exception as e:
        print(f"[QAForge] AI blog generation error: {e}")
        blogs = []

    if not blogs:
        blogs = DEFAULT_BLOGS

    store["cached_blogs"] = blogs
    store["cached_blogs_date"] = today

    for p in [Path("/tmp/daily_blogs.json"), BLOG_CACHE_FILE]:
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps({"date": today, "blogs": blogs}, indent=2))
        except Exception:
            pass

    return blogs


@app.get("/api/blogs/{blog_id}")
async def get_blog_detail(blog_id: str):
    print(f"[QAForge] Detail request for: {blog_id}")
    blogs = await get_daily_blogs()
    for b in blogs:
        if b.get("id") == blog_id:
            return b

    for b in DEFAULT_BLOGS:
        if b.get("id") == blog_id:
            return b

    # Graceful fallback: return the first blog rather than a 404
    if DEFAULT_BLOGS:
        return DEFAULT_BLOGS[0]

    raise HTTPException(status_code=404, detail="Blog post not found")

# ── PERFORMANCE TEST RESULTS ───────────────────────────────────────────────────
@app.post("/api/perf/results")
async def save_perf_result(result: dict):
    rid = str(uuid.uuid4())
    result["id"] = rid
    store.setdefault("perf_results", {})[rid] = result
    return {"id": rid, "status": "saved"}

@app.get("/api/perf/results")
async def list_perf_results():
    return list(store.get("perf_results", {}).values())

# ── Frontend ───────────────────────────────────────────────────────────────────
def _find_frontend() -> Path:
    # 1) Explicit env var (set by Windows launcher / Docker)
    env_dir = os.environ.get("QAFORGE_FRONTEND_DIR", "")
    if env_dir and Path(env_dir).exists():
        return Path(env_dir)
    # 2) Standard local layout: backend/../frontend
    candidate = Path(__file__).parent.parent / "frontend"
    if candidate.exists():
        return candidate
    # 3) Vercel serverless: walk up from __file__ to find repo root
    here = Path(__file__).resolve()
    for parent in here.parents:
        fe = parent / "frontend"
        if fe.exists():
            return fe
    return candidate   # fall back even if missing; StaticFiles will just not mount

_fe = _find_frontend()
print(f"[QAForge] Frontend directory: {_fe} (exists={_fe.exists()})")

@app.get("/author")
@app.get("/author.html")
async def get_author_page():
    p = _fe / "author.html"
    if p.exists():
        return FileResponse(p)
    raise HTTPException(status_code=404, detail="Author page not found")

@app.get("/blog")
@app.get("/blog.html")
async def get_blog_page():
    p = _fe / "blog.html"
    if p.exists():
        return FileResponse(p)
    raise HTTPException(status_code=404, detail="Blog page not found")

if _fe.exists():
    app.mount("/", StaticFiles(directory=str(_fe), html=True), name="frontend")


@app.on_event("startup")
def startup_event():
    try:
        from .brain_watcher import start_brain_watcher
        start_brain_watcher()
    except Exception as e:
        print(f"[QAForge Startup] Failed to start brain watcher: {e}")

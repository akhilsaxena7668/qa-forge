"""QAForge Gemini — FastAPI Backend v4.0"""

import os, json, uuid, base64
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
from .models import GenerateRequest, ExecuteRequest, BugScanRequest, AppConfig, RangeConfig, ProxyRequest, ApiGenerateRequest, BugFormatRequest, SeoAuditRequest


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
    "config": {
        "api_key_1":     _env(1),
        "api_key_2":     _env(2),
        "api_key_3":     _env(3),
        "api_key_4":     _env(4),
        "default_model": os.environ.get("DEFAULT_MODEL", "pro"),
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
    result = await ai.seo_audit(req.url, req.depth)
    store["seo_audits"][result["scan_id"]] = result
    return result

@app.get("/api/audit/seo")
async def list_seo_audits():
    return list(store["seo_audits"].values())

@app.get("/api/audit/seo/{sid}")
async def get_seo_audit(sid: str):
    return _404(store["seo_audits"], sid, "SEO Audit")

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

@app.get("/api/blogs")
async def get_daily_blogs():
    print(f"[QAForge] Blog request received. Cache: {BLOG_CACHE_FILE}")
    today = datetime.now().strftime("%Y-%m-%d")
    try:
        if BLOG_CACHE_FILE.exists():
            cache = json.loads(BLOG_CACHE_FILE.read_text())
            if cache.get("date") == today:
                print(f"[QAForge] Returning cached blogs (count: {len(cache.get('blogs', []))})")
                return cache.get("blogs", [])
    except Exception as e:
        print(f"[QAForge] Cache read failed: {e}")

    print("[QAForge] Cache empty or stale. Generating new blogs...")
    blogs = await ai.generate_daily_blogs()
    print(f"[QAForge] AI returned {len(blogs)} blogs")
    
    if blogs:
        try:
            BLOG_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
            BLOG_CACHE_FILE.write_text(json.dumps({"date": today, "blogs": blogs}, indent=2))
            print(f"[QAForge] Saved {len(blogs)} blogs to cache")
        except Exception as e:
            print(f"[QAForge] Cache write failed: {e}")
    else:
        print("[QAForge] No blogs generated to save")
    return blogs


@app.get("/api/blogs/{blog_id}")
async def get_blog_detail(blog_id: str):
    print(f"[QAForge] Detail request for: {blog_id}")
    today = datetime.now().strftime("%Y-%m-%d")
    try:
        if BLOG_CACHE_FILE.exists():
            cache = json.loads(BLOG_CACHE_FILE.read_text())
            if cache.get("date") == today:
                blogs = cache.get("blogs", [])
                for b in blogs:
                    if b.get("id") == blog_id:
                        return b
    except Exception as e:
        print(f"[QAForge] Detail fetch failed: {e}")
    
    # If not in cache, try to regenerate (or return 404)
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
_fe = Path(__file__).parent.parent / "frontend"
if _fe.exists():
    app.mount("/", StaticFiles(directory=str(_fe), html=True), name="frontend")

@app.on_event("startup")
def startup_event():
    try:
        from .brain_watcher import start_brain_watcher
        start_brain_watcher()
    except Exception as e:
        print(f"[QAForge Startup] Failed to start brain watcher: {e}")

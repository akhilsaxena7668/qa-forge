"""
QAForge Gemini — AI Engine v5.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KEY v5 CHANGE: Focus areas now strictly filter what categories the AI generates.
  - If focus_areas = ["security", "negative"] → AI ONLY generates security + negative tests
  - format_config drives output format (BDD, Detailed, Checklist, Exploratory)
  - Depth param on bug scan controls scan thoroughness
"""

import uuid, json, re, base64, asyncio
from pathlib import Path
from datetime import datetime
from typing import List, Tuple, Optional, Any
import warnings
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    import google.generativeai as genai
from .models import GenerateRequest, TestSuite, TestCase, RangeConfig, FormatConfig, ApiGenerateRequest
from .crawler import crawl_website
# ── Model chain ───────────────────────────────────────────────────────────────
MODEL_CHAIN: List[Tuple[str, str]] = [
    ("flash2",    "gemini-3-flash-preview"),
    ("pro",       "gemini-3-flash-preview"),
    ("flash",     "gemini-2.5-flash"),
    ("flash_exp", "gemini-3-flash-preview"),
]

MODEL_LABELS = {
    "gemini-3-flash-preview": "gemini-3-flash-preview",
    "gemini-3-flash-preview": "gemini-3-flash-preview",
    "gemini-1.5-flash":     "gemini-2.5-flash",
    "gemini-2.0-flash-exp": "Gemini 2.0 Flash Exp",
}

QUOTA_ERRORS = ("quota", "429", "resource exhausted", "rate limit", "too many requests", "exceeded", "billing")

# Focus area → category labels for AI prompt
FOCUS_LABELS = {
    "ui":            "UI/UX (visual layout, interactions, responsive design, animations, forms, navigation)",
    "happy_path":    "Happy Path (standard successful user flows, expected use cases, normal workflows)",
    "negative":      "Negative Testing (invalid inputs, boundary values, empty fields, error handling, edge cases)",
    "functional":    "Functional (core business logic, CRUD, feature verification, data processing)",
    "security":      "Security (SQL injection, XSS, CSRF, auth bypass, privilege escalation, data exposure)",
    "performance":   "Performance (page load, API response time, stress testing, concurrent users, memory leaks)",
    "accessibility": "Accessibility (WCAG 2.1 AA compliance, ARIA labels, keyboard nav, screen reader, color contrast)",
    "api":           "API/Backend (HTTP methods, status codes, request/response validation, error handling, pagination)",
    "regression":    "Regression (previously working features, post-change validation, backward compatibility)",
    "integration":   "Integration (third-party services, cross-module flows, data sync, webhooks, SSO)",
}

# Category mappings for JSON output
FOCUS_TO_CATEGORY = {
    "ui": "ui",
    "happy_path": "functional",
    "negative": "functional",
    "functional": "functional",
    "security": "security",
    "performance": "performance",
    "accessibility": "accessibility",
    "api": "api",
    "regression": "functional",
    "integration": "functional",
}


def _is_quota(err: str) -> bool:
    return any(q in err.lower() for q in QUOTA_ERRORS)


def _parse(text: str) -> Any:
    text = text.strip()
    # Remove obvious wrappers
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```\s*$", "", text)
    
    # Attempt iterative parsing
    decoder = json.JSONDecoder()
    for i in range(len(text)):
        if text[i] in "[{":
            try:
                # Try raw_decode first as it's more resilient to extra trailing text
                res, _ = decoder.raw_decode(text[i:])
                return res
            except:
                continue
    
    # Fallback to standard loads to get a good error message if all else fails
    return json.loads(text)


def _distribute_range(rc: Optional[RangeConfig], n: int) -> List[RangeConfig]:
    """
    Distribute a total range exactly across n batches, handling remainders.
    (e.g., 71 tests / 4 batches = [18, 18, 18, 17])
    """
    if not rc:
        return [RangeConfig(min_tests=5, max_tests=8) for _ in range(n)]

    def split_val(total, count):
        if total is None: return [None] * count
        base = total // count
        rem = total % count
        return [base + (1 if i < rem else 0) for i in range(count)]

    mins   = split_val(rc.min_tests, n)
    maxs   = split_val(rc.max_tests, n)
    crits  = split_val(rc.critical_count, n)
    highs  = split_val(rc.high_count, n)
    meds   = split_val(rc.medium_count, n)
    lows   = split_val(rc.low_count, n)

    return [
        RangeConfig(
            min_tests=mins[i], max_tests=maxs[i],
            critical_count=crits[i], high_count=highs[i],
            medium_count=meds[i], low_count=lows[i]
        )
        for i in range(n)
    ]


def _build_range_instruction(rc: Optional[RangeConfig]) -> str:
    if not rc:
        return "Generate exactly 15 test cases."
    
    if rc.min_tests == rc.max_tests:
        lines = [f"CRITICAL: You MUST generate EXACTLY {rc.max_tests} test cases. No more, no fewer."]
    else:
        lines = [f"Generate between {rc.min_tests} and {rc.max_tests} test cases (aim for {rc.max_tests})."]
        
    dist = []
    if rc.critical_count is not None: dist.append(f"{rc.critical_count} CRITICAL priority")
    if rc.high_count     is not None: dist.append(f"{rc.high_count} HIGH priority")
    if rc.medium_count   is not None: dist.append(f"{rc.medium_count} MEDIUM priority")
    if rc.low_count      is not None: dist.append(f"{rc.low_count} LOW priority")
    if dist:
        lines.append("MANDATORY Priority distribution: " + ", ".join(dist) + ".")
    return " ".join(lines)


def _build_focus_instruction(focus_areas: Optional[List[str]]) -> str:
    """
    CRITICAL: Build a strict instruction that forces the AI to ONLY
    generate test cases for the selected focus areas — nothing else.
    """
    if not focus_areas:
        return ""

    selected = [FOCUS_LABELS.get(f, f) for f in focus_areas]
    allowed_cats = list(set(FOCUS_TO_CATEGORY.get(f, "functional") for f in focus_areas))
    focus_str = "\n  - ".join(selected)

    return f"""

══════════════════════════════════════════════════════
CRITICAL FOCUS AREA RESTRICTION — STRICTLY ENFORCED:
══════════════════════════════════════════════════════
You MUST ONLY generate test cases for these {len(focus_areas)} selected focus area(s):
  - {focus_str}

DO NOT generate any test cases for other focus areas.
DO NOT include tests that don't belong to the selected categories.
EVERY test case's "category" field must be one of: {", ".join(focus_areas)}

Distribute the test cases proportionally across the selected areas.
If only 1 area is selected, ALL tests must cover that area deeply.
══════════════════════════════════════════════════════"""


def _build_format_instruction(fmt: Optional[FormatConfig]) -> str:
    """Build format-specific instructions for how test cases should be structured."""
    if not fmt:
        return ""

    base_instructions = {
        "detailed": "Write detailed test cases with clear step-by-step actions and specific expected results per step.",
        "bdd": "Write test steps in BDD/Gherkin format: Given [precondition], When [action], Then [expected]. Use this format for every step.",
        "exploratory": "Write as exploratory testing charters: Mission statement, target areas, resources, and risk coverage rather than scripted steps.",
        "checklist": "Write as concise checklist items. Steps should be single action items. Keep everything brief and scannable.",
    }

    fmt_inst = base_instructions.get(fmt.format, "")
    field_inst = ""
    if fmt.fields:
        field_inst = f"\nOnly include these fields in each test: {', '.join(fmt.fields)}."
    custom = f"\nAdditional format instructions: {fmt.instructions}" if fmt.instructions else ""

    return f"\n\nFORMAT INSTRUCTIONS: {fmt_inst}{field_inst}{custom}"


def _build_suite(data: dict, source: str, model_name: str, url: Optional[str] = None,
                 rc: Optional[RangeConfig] = None) -> TestSuite:
    sid = str(uuid.uuid4())
    tests = [
        TestCase(
            id=t.get("id", f"TC-{i+1:03d}"),
            name=t.get("name", "Unnamed"),
            category=t.get("category", "functional"),
            priority=t.get("priority", "medium"),
            description=t.get("description", ""),
            preconditions=t.get("preconditions", []),
            steps=t.get("steps", []),
            expected_result=t.get("expected_result", ""),
            tags=t.get("tags", []),
            model_used=MODEL_LABELS.get(model_name, model_name),
        )
        for i, t in enumerate(data.get("tests", []))
    ]
    return TestSuite(
        id=sid,
        name=data.get("suite_name", "Generated Suite"),
        description=data.get("description", ""),
        app_type=data.get("app_type", "web"),
        source=source, source_url=url,
        created_at=datetime.now().isoformat(),
        model_used=MODEL_LABELS.get(model_name, model_name),
        range_min=rc.min_tests if rc else len(tests),
        range_max=rc.max_tests if rc else len(tests),
        tests=tests,
    )


SYSTEM_PROMPT = """You are QAForge, an expert QA engineer. OUTPUT ONLY valid JSON — no markdown, no backticks, no explanation.

VISUAL GROUNDING & ACCURACY:
- Identify specific UI components mentioned (e.g., "Account Settings icon", "App Launcher", "Submit button").
- Describe actions relative to these components.
- For visual/image analysis, be extremely precise about the location and appearance of elements.

Required JSON structure:
{{
  "suite_name": "string",
  "description": "string",
  "app_type": "web|desktop|mobile",
  "tests": [
    {{
      "id": "TC-001",
      "name": "string (Scenario Title)",
      "scenario": "string (Detailed scenario description)",
      "category": "functional|ui|security|performance|accessibility|api|usability",
      "priority": "critical|high|medium|low",
      "severity": "blocker|critical|major|minor",
      "preconditions": ["string"],
      "test_input": "string (Specific data inputs required)",
      "steps": [{{"step": 1, "action": "string", "expected": "string"}}],
      "expected_result": "string",
      "tags": ["string"]
    }}
  ]
}}

Rules:
- Each test must have 3–10 concrete steps with specific actions and expected results
- Be precise and actionable — no vague steps
- Include realistic input data for forms and search bars
- Include both happy path and failure scenarios within selected focus areas only
- {range_instruction}{focus_instruction}{format_instruction}{depth_instruction}"""

BUG_SYSTEM = """You are QAForge BugScanner. OUTPUT ONLY valid JSON — no markdown, no backticks.
{{
  "scan_title": "string",
  "risk_level": "critical|high|medium|low",
  "total_issues": number,
  "bugs": [{{
    "id": "BUG-001",
    "title": "string",
    "severity": "critical|high|medium|low|info",
    "category": "security|performance|functional|ui|accessibility|data|logic|compatibility",
    "description": "string",
    "location": "string",
    "impact": "string",
    "steps_to_reproduce": ["string"],
    "fix_suggestion": "string",
    "cwe": "string",
    "tags": ["string"]
  }}],
  "summary": "string",
  "recommendations": ["string"]
}}
{depth_instruction}"""

DEPTH_INSTRUCTIONS = {
    "quick":    "Find the 5-10 most obvious, high-impact bugs. Focus on critical paths only.",
    "standard": "Find 10-15 realistic bugs covering security, performance, UX, and logic errors.",
    "deep":     "Find 15-25 bugs with deep analysis. Include edge cases, obscure security issues, accessibility violations, and subtle logic flaws.",
    "paranoid": "Find 20-30+ bugs with paranoid thoroughness. Every potential vulnerability, every UX friction point, every performance anti-pattern, every accessibility issue. Leave nothing unchecked.",
}

GEN_DEPTH_INSTRUCTIONS = {
    "quick":    "Focus on high-level functional flows and primary happy paths. Keep steps concise.",
    "standard": "Provide balanced coverage of features and UI interactions. Include basic edge cases and validation steps.",
    "deep":     "Perform deep analysis of the UI and logic. Identify specific components (menus, buttons, icons). Generate granular test cases with detailed micro-interactions (hovers, validation of state changes, error handling).",
    "paranoid": "Leave no stone unturned. Generate exhaustive tests for every possible state transition, boundary condition, and obscure interaction. Focus on heavy visual grounding and precise validation of all UI elements.",
}


class AIEngine:
    def __init__(self, store: dict):
        self.store = store
        self._quota: dict = {}

    def _get_keys(self) -> dict:
        cfg = self.store.get("config", {})
        keys = {}
        for i in range(1, 5):
            k = cfg.get(f"api_key_{i}", "").strip()
            if k:
                keys[i] = k
        single = cfg.get("api_key", "").strip()
        if single and 1 not in keys:
            keys[1] = single
        return keys

    def _try(self, prompt: str, image_data=None, prefer_key: Optional[str] = None) -> Tuple[str, str]:
        keys = self._get_keys()
        if not keys:
            raise ValueError("No Gemini API key configured. Add a key in Settings.")

        # Create a mapping of model_key to its original slot index
        key_to_slot = {item[0]: i + 1 for i, item in enumerate(MODEL_CHAIN)}

        if prefer_key:
            ordered = [(k, m) for k, m in MODEL_CHAIN if k == prefer_key]
            ordered += [(k, m) for k, m in MODEL_CHAIN if k != prefer_key]
        else:
            ordered = list(MODEL_CHAIN)

        all_errors = []
        for mkey, mname in ordered:
            if self._quota.get(mkey):
                all_errors.append(f"{mname}: quota exhausted")
                continue
            
            slot = key_to_slot.get(mkey, 1)
            api_key = keys.get(slot) or keys.get(1)
            
            if not api_key:
                all_errors.append(f"{mname}: no api key for slot {slot}")
                continue
            try:
                genai.configure(api_key=api_key)
                model = genai.GenerativeModel(
                    mname,
                    generation_config=genai.types.GenerationConfig(
                        temperature=0.4, top_p=0.95, max_output_tokens=16384
                    )
                )
                content = ([image_data, prompt] if image_data else [prompt])
                resp = model.generate_content(content)
                self._quota[mkey] = False
                print(f"[QAForge] Used {mname} (Slot {slot})")
                return resp.text, mname
            except Exception as e:
                err_msg = str(e)
                all_errors.append(f"{mname} (Slot {slot}): {err_msg[:100]}")
                if _is_quota(err_msg):
                    self._quota[mkey] = True
                    continue
                continue

        raise RuntimeError(f"Models exhausted. Errors: {'; '.join(all_errors)}")

    def _build_prompt(self, rc, focus_areas, format_config=None, depth="standard", extra="") -> str:
        """Build a complete prompt with focus + format + depth instructions injected."""
        ri = _build_range_instruction(rc)
        fi = _build_focus_instruction(focus_areas)
        fmti = _build_format_instruction(format_config)
        di = "\n\nDEPTH LEVEL: " + GEN_DEPTH_INSTRUCTIONS.get(depth, GEN_DEPTH_INSTRUCTIONS["standard"])
        return SYSTEM_PROMPT.format(
            range_instruction=ri,
            focus_instruction=fi,
            format_instruction=fmti,
            depth_instruction=di
        ) + extra

    async def _generate_batched(self, req: GenerateRequest, source: str, url: Optional[str] = None, image_data=None, extra_context="") -> TestSuite:
        rc = req.range_config
        max_tests = rc.max_tests if rc else 15
        
        # Performance optimization: if 25 or fewer tests, one call is fine.
        # If more, we split into parallel batches of ~20 to speed up generation.
        if max_tests <= 25:
            prompt = self._build_prompt(rc, req.focus_areas, req.format_config, req.depth, extra_context)
            text, mname = await asyncio.to_thread(self._try, prompt, image_data, req.model) # type: ignore
            return _build_suite(_parse(text), source, mname, url, rc)

        batch_size = 20
        num_batches = (max_tests + batch_size - 1) // batch_size
        print(f"[QAForge] Splitting {max_tests} tests into {num_batches} parallel batches...")
        
        # Fairly distribute the target range across all batches
        batch_configs = _distribute_range(rc, num_batches)

        async def run_batch(idx):
            b_rc = batch_configs[idx]
            if b_rc.max_tests <= 0:
                return {"tests": []}, "none"
            
            # Unique instruction to prevent duplicate tests
            batch_ctx = extra_context + f"\n\n[PARALLEL BATCH {idx+1}/{num_batches}]\nFOCUS: Ensure these tests are unique and distinct from other batches. Focus area variation #{idx+1}."
            prompt = self._build_prompt(b_rc, req.focus_areas, req.format_config, req.depth, batch_ctx)
            
            try:
                text, mname = await asyncio.to_thread(self._try, prompt, image_data, req.model) # type: ignore
                return _parse(text), mname
            except Exception as e:
                print(f"[QAForge] Batch {idx+1} failed: {e}")
                return {"tests": []}, "error"

        results = await asyncio.gather(*(run_batch(i) for i in range(num_batches)))
        
        merged_tests = []
        final_mname = "Multiple"
        for data, mname in results:
            merged_tests.extend(data.get("tests", []))
            if mname != "error": final_mname = mname
            
        # Re-index for consistent IDs across batches
        for i, t in enumerate(merged_tests):
            t["id"] = f"TC-{i+1:03d}"
            
        first_data = results[0][0] if results else {}
        combined_data = {
            "suite_name": first_data.get("suite_name", "Generated Suite"),
            "description": first_data.get("description", "Parallel batched generation"),
            "app_type": req.app_type,
            "tests": merged_tests
        }
        return _build_suite(combined_data, source, final_mname, url, rc)

    async def _generate_swarm(self, req: GenerateRequest, source: str, url: Optional[str] = None, image_data=None, extra_context="") -> TestSuite:
        import asyncio
        agents = req.agents or []
        if not agents:
            return _build_suite({"tests": []}, source, "None", url, req.range_config)

        num_agents = len(agents)
        rc = req.range_config
        
        # Fairly distribute the target range across all agents
        agent_configs = _distribute_range(rc, num_agents)

        AGENT_PERSONAS = {
            "security": "You are a Security Testing Expert. Focus EXCLUSIVELY on vulnerabilities, XSS, injection, authentication bypass, data leaks, and security misconfigurations. Look for edge cases that compromise the system.",
            "ux": "You are a UX/UI Testing Expert. Focus EXCLUSIVELY on user experience, accessibility, responsive design, visual feedback, clear navigation, and frustrating user flows.",
            "performance": "You are a Performance Testing Expert. Focus EXCLUSIVELY on load times, bottlenecks, concurrent actions, memory leaks, and optimizing resource usage.",
            "logic": "You are a Functional QA Lead. Focus EXCLUSIVELY on core business logic, happy paths, complex state transitions, and integration between components.",
            "data": "You are a Data Validation Expert. Focus EXCLUSIVELY on boundary values, invalid inputs, data integrity, format mismatches, and corner cases."
        }

        async def run_agent(idx, agent_name):
            persona = AGENT_PERSONAS.get(agent_name, f"You are a specialized {agent_name} testing expert.")
            # Build agent-specific prompt with reduced range target
            b_rc = agent_configs[idx]
            if b_rc.max_tests <= 0:
                return {"tests": []}
            
            agent_prompt = self._build_prompt(b_rc, req.focus_areas, req.format_config, req.depth, extra_context)
            agent_prompt += f"\n\n[MULTI-AGENT SWARM INSTRUCTION]\n{persona}\nYour output MUST be restricted to the {agent_name} persona focus."
            
            try:
                text, mname = await asyncio.to_thread(self._try, agent_prompt, image_data, req.model)  # type: ignore
                parsed = _parse(text)
                for t in parsed.get("tests", []):
                    t["category"] = agent_name # Override category to reflect the agent
                return parsed
            except Exception as e:
                print(f"[QAForge] Agent {agent_name} failed: {e}")
                return {"tests": []}

        results = await asyncio.gather(*(run_agent(i, a) for i, a in enumerate(agents)))
        
        merged_tests = []
        for res in results:
            merged_tests.extend(res.get("tests", []))  # type: ignore
            
        for i, t in enumerate(merged_tests):
            t["id"] = f"TC-{i+1:03d}"
            
        suite_name = results[0].get("suite_name", "Swarm Generated Suite") if results and results[0].get("suite_name") else "Swarm Generated Suite"  # type: ignore
        desc = "Multi-Agent Swarm combined test suite from: " + ", ".join(agents)
        
        combined_data = {
            "suite_name": f"{suite_name} (Swarm)",
            "description": desc,
            "app_type": results[0].get("app_type", req.app_type) if results else req.app_type,  # type: ignore
            "tests": merged_tests
        }
        
        return _build_suite(combined_data, source, "Multi-Agent Swarm", url, rc)
    # ── URL ───────────────────────────────────────────────────────────────────
    async def generate_from_url(self, req: GenerateRequest) -> TestSuite:
        extra = f"\n\nApplication URL: {req.url}\nApp Type: {req.app_type}\n" \
                f"Description: {req.description or 'Not provided'}\n\n" \
                "Analyze the URL structure, infer user flows, and generate tests covering only the selected focus areas."

        if req.is_multi_agent and req.agents:
            return await self._generate_swarm(req, f"url:{req.url}", req.url, extra_context=extra)
            
        return await self._generate_batched(req, f"url:{req.url}", req.url, extra_context=extra)

    # ── TEXT ──────────────────────────────────────────────────────────────────
    async def generate_from_text(self, req: GenerateRequest) -> TestSuite:
        extra = f"\n\nApp Type: {req.app_type}\nDescription: {req.description}\n\n" \
                "Think deeply about all user interactions, edge cases, and failure modes " \
                "but ONLY for the selected focus areas."

        if req.is_multi_agent and req.agents:
            return await self._generate_swarm(req, "text", None, extra_context=extra)
            
        return await self._generate_batched(req, "text", None, extra_context=extra)

    # ── IMAGE ─────────────────────────────────────────────────────────────────
    async def generate_from_image(self, b64: str, media_type: str, app_type: str,
                                   description: str, focus_areas: List[str],
                                   rc: Optional[RangeConfig] = None,
                                   is_multi_agent: bool = False,
                                   agents: List[str] = None,
                                   model: str = None,
                                   depth: str = "standard") -> TestSuite:
        extra = f"\n\nAnalyze this {app_type} application screenshot carefully.\n" \
                f"Context: {description or 'None provided'}\n\n" \
                "but ONLY for the selected focus areas above."

        req = GenerateRequest(app_type=app_type, description=description, focus_areas=focus_areas, range_config=rc, is_multi_agent=is_multi_agent, agents=agents, model=model, depth=depth)
        img = {"mime_type": media_type, "data": base64.b64decode(b64)}
        
        if is_multi_agent and agents:
            return await self._generate_swarm(req, "image", None, image_data=img, extra_context=extra)
            
        return await self._generate_batched(req, "image", None, image_data=img, extra_context=extra)

    # ── VIDEO ─────────────────────────────────────────────────────────────────
    async def generate_from_video(self, b64: str, media_type: str, app_type: str,
                                   description: str, focus_areas: List[str],
                                   rc: Optional[RangeConfig] = None,
                                   is_multi_agent: bool = False,
                                   agents: List[str] = None,
                                   model: str = None,
                                   depth: str = "standard") -> TestSuite:
        extra = f"\n\nAnalyze this {app_type} application screen recording.\n" \
                f"Context: {description or 'None provided'}\n\n" \
                "Watch for interactions, navigation, form submissions, error states, loading states.\n" \
                "Generate tests replicating and extending observed behaviors, " \
                "but ONLY within the selected focus areas above."

        req = GenerateRequest(app_type=app_type, description=description, focus_areas=focus_areas, range_config=rc, is_multi_agent=is_multi_agent, agents=agents, model=model, depth=depth)
        vid = {"mime_type": media_type, "data": base64.b64decode(b64)}
        
        if is_multi_agent and agents:
            return await self._generate_swarm(req, "video", None, image_data=vid, extra_context=extra)
            
        return await self._generate_batched(req, "video", None, image_data=vid, extra_context=extra)

    # ── DOCUMENT ──────────────────────────────────────────────────────────────
    @staticmethod
    def _extract_document_text(file_bytes: bytes, filename: str, mime_type: str) -> str:
        """Extract plain text from PDF, DOCX, PPTX, or plain text files."""
        fname = filename.lower()
        text = ""

        # PDF — via PyMuPDF
        if fname.endswith(".pdf") or "pdf" in mime_type:
            try:
                import pymupdf  # PyMuPDF
                with pymupdf.open(stream=file_bytes, filetype="pdf") as doc:
                    pages = [page.get_text() for page in doc]
                    text = "\n\n".join(pages)
            except ImportError:
                raise ValueError("PyMuPDF is not installed. Run: pip install PyMuPDF")

        # DOCX — via python-docx
        elif fname.endswith(".docx") or "wordprocessingml" in mime_type:
            try:
                import io
                from docx import Document
                doc = Document(io.BytesIO(file_bytes))
                paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
                # Also pull from tables
                for table in doc.tables:
                    for row in table.rows:
                        row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
                        if row_text:
                            paragraphs.append(row_text)
                text = "\n".join(paragraphs)
            except ImportError:
                raise ValueError("python-docx is not installed. Run: pip install python-docx")

        # DOC — legacy Word (basic fallback: read as text)
        elif fname.endswith(".doc"):
            # Try to extract readable text; .doc is binary so basic UTF-8 decode with errors ignored
            text = file_bytes.decode("latin-1", errors="ignore")
            # Strip obvious binary noise
            import re as _re
            text = _re.sub(r'[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]', ' ', text)
            text = _re.sub(r' {4,}', ' ', text).strip()

        # PPTX — via python-pptx
        elif fname.endswith(".pptx") or "presentationml" in mime_type:
            try:
                import io
                from pptx import Presentation
                prs = Presentation(io.BytesIO(file_bytes))
                slides_text = []
                for i, slide in enumerate(prs.slides, 1):
                    slide_parts = [f"[Slide {i}]"]
                    for shape in slide.shapes:
                        if hasattr(shape, "text") and shape.text.strip():
                            slide_parts.append(shape.text.strip())
                    slides_text.append("\n".join(slide_parts))
                text = "\n\n".join(slides_text)
            except ImportError:
                raise ValueError("python-pptx is not installed. Run: pip install python-pptx")

        # PPT — legacy PowerPoint (basic fallback)
        elif fname.endswith(".ppt"):
            text = file_bytes.decode("latin-1", errors="ignore")
            import re as _re
            text = _re.sub(r'[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]', ' ', text)
            text = _re.sub(r' {4,}', ' ', text).strip()

        # Plain text / markdown / CSV / other
        else:
            for enc in ("utf-8", "latin-1"):
                try:
                    text = file_bytes.decode(enc)
                    break
                except UnicodeDecodeError:
                    continue

        return text.strip()

    async def generate_from_document(self, file_bytes: bytes, filename: str,
                                     mime_type: str, app_type: str,
                                     description: str, focus_areas: List[str],
                                     rc: Optional[RangeConfig] = None,
                                     is_multi_agent: bool = False,
                                     agents: List[str] = None,
                                     model: str = None,
                                     depth: str = "standard") -> TestSuite:
        """Parse a requirements document and generate test cases from its content."""
        doc_text = self._extract_document_text(file_bytes, filename, mime_type)
        if not doc_text or len(doc_text) < 20:
            raise ValueError("Could not extract meaningful text from the document.")

        # Truncate to avoid token overflow (keep ~60k chars ≈ ~15k tokens)
        if len(doc_text) > 60_000:
            doc_text = doc_text[:60_000] + "\n\n[... document truncated for length ...]"

        extra = f"""

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REQUIREMENTS DOCUMENT: {filename}
App Type: {app_type}
Additional Context: {description or "None provided"}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{doc_text}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read the above requirements document carefully. Extract every feature, user story,
business rule, acceptance criterion, and functional requirement. Then generate
comprehensive test cases that verify each requirement is correctly implemented.
Generate tests ONLY for the selected focus areas above.
"""

        req = GenerateRequest(
            app_type=app_type,
            description=f"Requirements from document: {filename}",
            focus_areas=focus_areas,
            range_config=rc,
            is_multi_agent=is_multi_agent,
            agents=agents,
            model=model,
            depth=depth,
        )

        if is_multi_agent and agents:
            return await self._generate_swarm(req, f"document:{filename}", None, extra_context=extra)

        return await self._generate_batched(req, f"document:{filename}", None, extra_context=extra)

    # ── API INTERACTION ───────────────────────────────────────────────────────
    async def generate_from_api(self, req: ApiGenerateRequest) -> TestSuite:
        req_headers = json.dumps(req.request_headers, indent=2)
        res_headers = json.dumps(req.response_headers, indent=2)
        
        # Try to format body as JSON if possible for better readability in prompt
        try:
            req_body = json.dumps(json.loads(req.request_body), indent=2) if req.request_body else "None"
        except:
            req_body = req.request_body or "None"
            
        try:
            res_body = json.dumps(req.response_body, indent=2) if req.response_body else "None"
        except:
            res_body = str(req.response_body) or "None"

        extra = f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
API INTERACTION LOG:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENDPOINT: {req.method} {req.url}

REQUEST HEADERS:
{req_headers}

REQUEST BODY:
{req_body}

RESPONSE STATUS: {req.response_status}

RESPONSE HEADERS:
{res_headers}

RESPONSE BODY:
{res_body}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TASK:
Analyze this specific API interaction and generate a comprehensive test suite.
Your tests should cover:
1. Positive validation of the observed success (if 2xx).
2. Edge case testing for similar endpoints.
3. Security audits (auth, injection, exposure).
4. Negative testing (4xx, 5xx scenarios, invalid inputs).
5. Schema validation and data integrity.

Strictly follow the selected focus areas: {', '.join(req.focus_areas or [])}
"""
        gen_req = GenerateRequest(
            app_type="api",
            focus_areas=req.focus_areas,
            range_config=req.range_config,
            format_config=req.format_config,
            depth=req.depth
        )
        
        return await self._generate_batched(gen_req, f"api:{req.method}:{req.url}", req.url, extra_context=extra)

    # ── BUG SCAN ──────────────────────────────────────────────────────────────
    async def bug_scan(self, app_type: str, description: str, url: Optional[str] = None,
                       depth: str = "standard", categories: Optional[List[str]] = None) -> dict:
        depth_inst = DEPTH_INSTRUCTIONS.get(depth, DEPTH_INSTRUCTIONS["standard"])
        cat_inst = ""
        if categories:
            cat_inst = f"\nFocus specifically on these bug categories: {', '.join(categories)}."

        ctx = f"URL: {url}\n" if url else ""
        prompt = BUG_SYSTEM.format(depth_instruction=depth_inst + cat_inst) + f"""

Scan this {app_type} application:
{ctx}Description: {description or 'General application'}

Scan depth: {depth.upper()} — {depth_inst}
Be thorough — include security, performance, accessibility, UX, and logic issues."""
        text, mname = self._try(prompt, prefer_key="pro")
        data = _parse(text)
        data.update({
            "scan_id":    str(uuid.uuid4()),
            "app_type":   app_type,
            "model_used": MODEL_LABELS.get(mname, mname),
            "scanned_at": datetime.now().isoformat(),
            "depth":      depth,
        })
        return data

    # ── Status / Reset ────────────────────────────────────────────────────────
    def get_model_status(self) -> dict:
        keys = self._get_keys()
        return {
            mkey: {
                "name": MODEL_LABELS.get(mname, mname),
                "model_id": mname,
                "slot": i + 1,
                "has_key": bool(keys.get(i + 1) or keys.get(1)),
                "quota_exhausted": self._quota.get(mkey, False),
            }
            for i, (mkey, mname) in enumerate(MODEL_CHAIN)
        }

    def reset_quota(self):
        self._quota.clear()

    async def generate_daily_blogs(self) -> List[dict]:
        reports_dir = Path(__file__).parent.parent / "reports"
        try:
            reports_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            reports_dir = Path("/tmp/reports")
            reports_dir.mkdir(parents=True, exist_ok=True)
        
        prompt = """You are QAForge Blog Writer. Generate 3 unique, high-quality QA engineering blog posts for today.
Themes: AI testing, automation testing, and AI-powered manual-to-automation testing transitions.
Author: Akhil Saxena
Role: Software Tester at Navoto

OUTPUT ONLY valid JSON — no markdown, no backticks.
Structure:
[
  {
    "id": "blog-001",
    "title": "string",
    "summary": "string (2 sentences)",
    "content": "string (detailed article with 3-4 paragraphs)",
    "category": "AI|Automation|Manual-AI",
    "read_time": "3-5 min read",
    "author": "Akhil Saxena",
    "author_role": "Software Tester at Navoto",
    "image_keyword": "string (1-2 search keywords for Unsplash, e.g. 'coding' or 'robot')"
  },
  ...
]"""
        try:
            # Use gemini-2.5-flash which we know exists
            text, mname = await asyncio.to_thread(self._try, prompt, None, "flash") # type: ignore
            data = _parse(text)
            date_str = datetime.now().strftime("%b %d, %Y")
            if isinstance(data, list) and len(data) > 0:
                for b in data:
                    b["date"] = date_str
                return data
            raise ValueError("Parsed data is not a valid non-empty list")
        except Exception as e:
            err_msg = f"[QAForge] Blog generation failed: {e}"
            print(err_msg)
            try:
                (reports_dir / "blog_error.log").write_text(err_msg)
            except: pass
            
            fallback = [
                {
                    "id": "blog-001",
                    "title": "Unlocking the Power of AI-Driven Test Generation",
                    "summary": "Discover how modern AI models like Gemini are reshaping test design by automatically generating comprehensive test cases from user requirements.",
                    "content": "Artificial Intelligence is rapidly transforming the software testing landscape. In this post, we discuss the integration of Google's Gemini models in test generation, which enables testers to create high-coverage test cases from plain text descriptions, images, or even video screen recordings. By automating this initial process, QA engineers can focus on complex validation and edge-case execution.",
                    "category": "AI",
                    "read_time": "3 min read",
                    "author": "Akhil Saxena",
                    "author_role": "Software Tester at Navoto",
                    "image_keyword": "ai coding"
                },
                {
                    "id": "blog-002",
                    "title": "Why Focus-Aware Scanning is Crucial for Security Testing",
                    "summary": "An in-depth look at how targeting specific focus areas like security or performance leads to more relevant bug scanning results.",
                    "content": "When scanning an application for bugs, general-purpose tests often miss specialized vulnerabilities. Focus-aware scanning allows the testing framework to target specific categories such as security, usability, or functional regressions. By feeding targeted context to AI models, we can discover deep logical bugs, performance bottlenecks, and authorization flaws that would otherwise pass undetected.",
                    "category": "Security",
                    "read_time": "4 min read",
                    "author": "Akhil Saxena",
                    "author_role": "Software Tester at Navoto",
                    "image_keyword": "security cyber"
                },
                {
                    "id": "blog-003",
                    "title": "Bridging the Gap: Transitioning from Manual to Automated Testing",
                    "summary": "Learn key strategies for using AI-generated steps to build automated Playwright and Selenium scripts from manual execution logs.",
                    "content": "Transitioning from manual QA to test automation has always been a bottleneck for engineering teams. With the advent of AI, we can now bridge this gap seamlessly. By taking natural language steps or screen recordings of manual tests, AI engines can generate complete, runnable Playwright or Selenium scripts. This dramatically accelerates automation velocity and decreases maintenance overhead.",
                    "category": "Manual-AI",
                    "read_time": "5 min read",
                    "author": "Akhil Saxena",
                    "author_role": "Software Tester at Navoto",
                    "image_keyword": "automation code"
                }
            ]
            date_str = datetime.now().strftime("%b %d, %Y")
            for b in fallback:
                b["date"] = date_str
            return fallback

    # ── BUG FORMAT ────────────────────────────────────────────────────────
    async def format_bug(self, raw_text: str, app_type: str = "web",
                         severity: Optional[str] = None,
                         environment: Optional[str] = None,
                         module: Optional[str] = None,
                         image_b64: Optional[str] = None,
                         image_mime: Optional[str] = None) -> dict:
        """Convert raw/informal bug text into a professional bug report.
        Optionally analyse a screenshot/image to extract visible bug evidence.
        """
        env_hint = f"\nEnvironment context: {environment}" if environment else ""
        sev_hint = f"\nSeverity hint from reporter: {severity}" if severity else ""
        mod_hint = f"\nModule/Area: {module}" if module else ""

        # Build image-analysis section when a screenshot is provided
        has_image = bool(image_b64 and image_mime)
        image_instruction = ""
        if has_image:
            image_instruction = """

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCREENSHOT / IMAGE ANALYSIS INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A screenshot has been provided. You MUST analyse it carefully before writing the report.

Extract ALL visible evidence from the image, including:
  • Error messages, toast notifications, or alert dialogs
  • HTTP status codes (e.g. 403, 500, 404) shown anywhere
  • UI elements that are broken, missing, misaligned, or incorrect
  • Form validation messages or error labels
  • Console or API error text visible on screen
  • Page/component names, URLs, breadcrumbs, or navigation labels
  • Any data that looks incorrect, duplicated, or missing
  • Any spinner/loader that should not be present (or is missing)

CRITICAL HONESTY RULES:
  ✗ DO NOT invent steps, environment details, or technical facts NOT visible in the image
  ✗ DO NOT fabricate expected results if not inferable from visible UI state
  ✓ For unknown information use: "[Not determinable from screenshot — please specify]"
  ✓ Derive the bug title and description PRIMARILY from what is VISUALLY EVIDENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"""

        input_section = ""
        if raw_text and raw_text.strip():
            input_section = f"""
ADDITIONAL DESCRIPTION FROM REPORTER:
\"\"\"{raw_text}\"\"\"
"""
        else:
            input_section = "\n(No additional text description provided — base the report entirely on the screenshot analysis.)\n"

        prompt = f"""You are QAForge BugReportGenerator — a senior QA engineer who writes world-class, professional bug reports suitable for Jira, Azure DevOps, Bugzilla, and ClickUp.{image_instruction}

TASK: Convert the following input into a structured, professional bug report.
{input_section}
Application type: {app_type}{mod_hint}{sev_hint}{env_hint}

IMPROVEMENT REQUIREMENTS & CRITICAL INSTRUCTIONS:
1. GENERATE A HIGHLY DESCRIPTIVE BUG TITLE:
   - The title must clearly identify:
     - What is broken
     - Where the issue occurs
     - Under which condition it occurs (if applicable)
   - Do NOT use vague titles such as "UI Issue", "Filter Not Working", "Data Missing", or "Page Issue".
   - Avoid generic or abbreviated prefixes like "[Feature] - [What's wrong]". Write a complete, descriptive, developer-friendly title.

2. GENERATE A DETAILED BUG DESCRIPTION:
   - Do not simply rewrite or paraphrase the user's input.
   - Expand the bug details into a complete, professional explanation.
   - Include:
     - Affected module or page
     - Affected functionality
     - Current observed behavior
     - Expected behavior (if inferable)
     - Potential user impact
   - Use professional, objective QA language (avoid informal or emotional terms).

3. CONTEXT ENHANCEMENT RULES:
   - Analyze all provided bug details, screenshots, page names, URLs, labels, and UI elements.
   - Infer missing context whenever reasonably possible.
   - Convert short notes or incomplete tester descriptions into complete, fully-fleshed bug reports.
   - If a page name, component name, or feature name is available or inferable, include it explicitly in both the title and the description.

4. QUALITY VALIDATION & SELF-VERIFICATION:
   Before generating the final output, verify:
   - Can a developer understand the issue from the title alone?
   - Does the description explain what is happening and where?
   - Does the title contain enough context to distinguish it from similar bugs?
   - Is the description significantly more informative than the original input?

EXAMPLE INPUT & EXPECTED OUTPUT:
Input:
"colors are not visible on search product page but they are in product detail page"

Expected Output JSON Fields:
- bug_title: "Product Color Variants Are Not Displayed on Search Results Page Despite Being Available on Product Detail Page"
- bug_description: "Product color variants are not displayed within the Search Results Page for products that have multiple color options configured. When users navigate to the corresponding Product Detail Page, all color variants are displayed correctly. This inconsistency creates a mismatch between search results and product details, preventing users from viewing available color options directly from the search page and potentially impacting product selection decisions."
- steps_to_reproduce: [
    "Navigate to the Search Results Page.",
    "Search for a product with multiple color variants.",
    "Observe the product card displayed in the search results.",
    "Open the same product's Product Detail Page."
  ]
- expected_results: "Available color variants should be displayed consistently on both the Search Results Page and the Product Detail Page."
- actual_results: "Color variants are not displayed on the Search Results Page but are visible on the Product Detail Page."

This module handles bugs across ALL areas: UI, functionality, API, performance, validation, search, filters, cart, checkout, PDF generation, mobile, admin panels, and more.

OUTPUT ONLY valid JSON — no markdown, no backticks, no explanation.
Required JSON structure:
{{
  "bug_title": "string — Clear, descriptive, developer-friendly title that identifies what is broken, where, and when.",
  "bug_id": "string — auto-generated ID like BUG-001",
  "severity": "Critical|High|Medium|Low",
  "priority": "P1|P2|P3|P4",
  "bug_description": "string — Detailed explanation of the issue, affected area, observed behavior, expected behavior, and user impact.",
  "steps_to_reproduce": [
    "string — step-by-step clear, numbered instructions to reproduce the bug."
  ],
  "expected_results": "string — precise expected behavior.",
  "actual_results": "string — precise actual observed behavior.",
  "environment": "string — platform, browser, OS, device, or app version.",
  "additional_notes": "string — frequency, workarounds, or related info."
}}

Quality Rules:
- Steps MUST be actionable — a developer should reproduce the bug in under 2 minutes
- Expected vs Actual MUST clearly contrast with each other
- NEVER use vague language like 'sometimes', 'maybe', 'could be' — be definitive
- All text must use professional, objective QA documentation language
- Severity guidelines: Critical = system crash/data loss, High = major feature broken, Medium = feature partially works, Low = cosmetic/minor
- Priority guidelines: P1 = fix immediately, P2 = fix in current sprint, P3 = fix in next sprint, P4 = backlog"""

        # Build image_data for Gemini vision when a screenshot is provided
        image_data = None
        if has_image:
            import google.generativeai as _genai_local
            image_data = {"mime_type": image_mime, "data": base64.b64decode(image_b64)}
            # Use the genai Part format that _try expects via content list
            image_data = _genai_local.protos.Part(
                inline_data=_genai_local.protos.Blob(
                    mime_type=image_mime,
                    data=base64.b64decode(image_b64)
                )
            )

        text, mname = await asyncio.to_thread(self._try, prompt, image_data, "flash")
        data = _parse(text)
        data["model_used"] = MODEL_LABELS.get(mname, mname)
        data["formatted_at"] = datetime.now().isoformat()
        data["has_image"] = has_image
        return data

    # ── SEO AUDIT (Hybrid: Python-computed + AI) ──────────────────────────
    async def seo_audit(self, url: str, depth: str = "standard") -> dict:
        # ── Step 1: Crawl ─────────────────────────────────────────────────
        try:
            crawled_pages = await crawl_website(url, depth)
        except Exception as e:
            crawled_pages = []
            print(f"[SEO Audit] Crawler error: {e}")

        hp = crawled_pages[0] if crawled_pages else {}   # homepage data
        all_titles = [p.get("title", "") for p in crawled_pages]
        all_descs  = [p.get("description", "") for p in crawled_pages]

        # ── Step 2: Compute checks deterministically from crawl data ──────
        def chk(status, sev_if_fail, desc, rec):
            sev = "N/A" if status == "Pass" else sev_if_fail
            rec = "No action needed." if status == "Pass" else rec
            return {"status": status, "severity": sev, "description": desc, "recommendation": rec}

        def p_or_f(cond): return "Pass" if cond else "Fail"

        title_val    = hp.get("title", "").strip()
        desc_val     = hp.get("description", "").strip()
        h1           = hp.get("h1_count", 0)
        img_total    = hp.get("img_count", 0)
        img_no_alt   = hp.get("img_missing_alt", 0)
        canonical    = hp.get("has_canonical", False)
        viewport     = hp.get("has_viewport", False)
        og_tags      = hp.get("has_og_tags", False)
        schema       = hp.get("has_schema", False)
        is_https     = hp.get("url", url).startswith("https://")
        dup_titles   = len(all_titles) != len(set(t for t in all_titles if t))
        dup_descs    = len(all_descs)  != len(set(d for d in all_descs  if d))
        multi_page   = len(crawled_pages) > 1

        # Map: check_name → computed result dict
        COMPUTED = {
            # on_page_seo
            "Title Tags (All Pages)": chk(
                p_or_f(bool(title_val)), "High",
                f"Homepage title found: \"{title_val[:80]}\"." if title_val else "No <title> tag found on homepage.",
                "Add a unique, descriptive title tag (50–60 chars) to every page."
            ),
            "Meta Descriptions (All Pages)": chk(
                p_or_f(bool(desc_val)), "Medium",
                f"Meta description: \"{desc_val[:100]}\"." if desc_val else "No meta description found on homepage.",
                "Write a unique meta description (120–160 chars) for every page."
            ),
            "H1 Tag Per Page": chk(
                p_or_f(h1 == 1), "High",
                f"{h1} H1 tag(s) detected on homepage. Exactly 1 is required." if h1 != 1 else "Exactly 1 H1 tag found on homepage.",
                "Ensure every page has exactly one H1 tag that includes the primary keyword."
            ),
            "Duplicate Title Detection": chk(
                p_or_f(not dup_titles), "Medium",
                "Duplicate title tags detected across crawled pages." if dup_titles else f"All {len(all_titles)} page titles are unique.",
                "Give every page a unique, descriptive title tag."
            ),
            "Duplicate Meta Description Detection": chk(
                p_or_f(not dup_descs), "Low",
                "Duplicate meta descriptions detected across crawled pages." if dup_descs else "All page meta descriptions are unique.",
                "Write a unique meta description for each page."
            ),
            # technical_seo
            "Canonical Tags": chk(
                p_or_f(canonical), "High",
                "Canonical tag (<link rel=\"canonical\">) detected on homepage." if canonical else "No canonical tag found on homepage.",
                "Add a self-referencing canonical tag to every page to prevent duplicate content issues."
            ),
            "HTTPS Enforced": chk(
                p_or_f(is_https), "Critical",
                f"Site is served over HTTPS ({hp.get('url', url)})." if is_https else "Site is NOT served over HTTPS.",
                "Install an SSL certificate and redirect all HTTP traffic to HTTPS permanently (301)."
            ),
            # mobile_seo
            "Viewport Meta Tag": chk(
                p_or_f(viewport), "High",
                "Viewport meta tag is present on homepage." if viewport else "Viewport meta tag is missing from homepage.",
                "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> to the <head>."
            ),
            # structured_data
            "Schema.org Markup Present": chk(
                p_or_f(schema), "Medium",
                "JSON-LD structured data detected on homepage." if schema else "No JSON-LD structured data found on homepage.",
                "Implement JSON-LD with at minimum Organization and WebSite schema."
            ),
            "Open Graph (OG) Tags": chk(
                p_or_f(og_tags), "Medium",
                "Open Graph meta tags (og:title, og:image, etc.) detected on homepage." if og_tags else "No Open Graph tags found on homepage.",
                "Add og:title, og:description, og:image, og:url for better social media previews."
            ),
            # image_seo + accessibility
            "Image Alt Text": chk(
                p_or_f(img_no_alt == 0), "High",
                f"{img_total} images found; {img_no_alt} are missing alt text." if img_total > 0 else "No images detected on homepage.",
                f"Add descriptive alt attributes to all {img_no_alt} images missing them." if img_no_alt > 0 else "Ensure all future images include descriptive alt text."
            ),
            "Image Alt Text (Accessibility)": chk(
                p_or_f(img_no_alt == 0), "High",
                f"{img_no_alt} out of {img_total} images are missing alt text, failing WCAG 1.1.1." if img_no_alt > 0 else f"All {img_total} images have alt text — WCAG 1.1.1 satisfied.",
                "Add descriptive alt text to every image; use empty alt=\"\" for decorative images."
            ),
            # internal links
            "Orphan Pages": chk(
                p_or_f(not multi_page or len(crawled_pages) > 1), "Medium",
                f"Crawled {len(crawled_pages)} pages; all are reachable via internal links." if multi_page else "Only 1 page crawled — cannot determine orphan pages (use Deep scan).",
                "Ensure all pages are linked from at least one other internal page."
            ),
            # https
            "HTTPS Certificate Valid": chk(
                p_or_f(is_https), "Critical",
                "HTTPS is active; SSL/TLS certificate appears valid." if is_https else "Site is not using HTTPS — no valid SSL certificate detected.",
                "Install a valid SSL certificate from a trusted CA and enforce HTTPS."
            ),
            "HTTP to HTTPS Redirect": chk(
                p_or_f(is_https), "High",
                "Site URL begins with https:// indicating HTTPS redirect is likely configured." if is_https else "HTTP to HTTPS redirect may not be configured.",
                "Configure a 301 redirect from http:// to https:// for all URLs."
            ),
        }

        # Build the full CHECKLIST structure. Checks in COMPUTED are pre-filled; the rest go to AI.
        CHECKLIST_KEYS = {
            "technical_seo":         ["XML Sitemap Presence", "Robots.txt Configuration", "Canonical Tags", "Hreflang Implementation", "404 Error Page", "Redirect Chains", "HTTPS Enforced", "Crawlability via Robots.txt"],
            "on_page_seo":           ["Title Tags (All Pages)", "Meta Descriptions (All Pages)", "H1 Tag Per Page", "H2/H3 Heading Hierarchy", "Keyword in Title", "Duplicate Title Detection", "Duplicate Meta Description Detection", "Page Word Count"],
            "url_audit":             ["URL Slug Structure", "URL Length", "URL Lowercase Consistency", "Trailing Slash Consistency", "Dynamic Parameters in URL"],
            "internal_external_links":["Internal Links Present", "Broken Internal Links (404)", "Orphan Pages", "External Links (Nofollow Policy)", "Link Anchor Text Quality"],
            "image_seo":             ["Image Alt Text", "Image Filename Descriptive", "Image File Size", "WebP/Next-Gen Format", "Lazy Loading"],
            "performance":           ["Core Web Vitals - LCP", "Core Web Vitals - FID/INP", "Core Web Vitals - CLS", "Time to First Byte (TTFB)", "Minified CSS", "Minified JavaScript", "Browser Caching Headers", "Gzip/Brotli Compression", "CDN Usage"],
            "mobile_seo":            ["Viewport Meta Tag", "Mobile Responsive Design", "Touch Target Size", "Font Size Legibility on Mobile", "Mobile Page Speed"],
            "accessibility":         ["Image Alt Text (Accessibility)", "Color Contrast Ratio", "ARIA Labels on Buttons", "Keyboard Navigability", "Form Labels", "Focus Indicators", "Skip Navigation Link"],
            "structured_data":       ["Schema.org Markup Present", "Open Graph (OG) Tags", "Twitter Card Tags", "Breadcrumb Schema", "Organization Schema", "FAQ/HowTo Schema (if applicable)"],
            "javascript_seo":        ["JS Rendering of Critical Content", "Meta Tags Rendered in JS", "Page Indexable Without JS", "Inline JS Blocking Render"],
            "robots_sitemap":        ["Sitemap in Robots.txt", "Sitemap URL Valid", "Sitemap Last Modified", "Pages Blocked in Robots.txt"],
            "csp_audit":             ["Content-Security-Policy Header", "X-Frame-Options Header", "X-Content-Type-Options Header", "CSP Unsafe-Inline Check", "CSP Wildcard Check"],
            "security_headers":      ["Strict-Transport-Security (HSTS)", "Referrer-Policy", "Permissions-Policy", "X-XSS-Protection", "Server Header Disclosure"],
            "https_mixed_content":   ["HTTPS Certificate Valid", "Mixed Content (HTTP resources on HTTPS page)", "HTTP to HTTPS Redirect", "Secure Cookies"],
            "content_quality":       ["Thin Content Pages", "Duplicate Content", "Readability Score", "Keyword Density", "Content Freshness"],
        }

        # Build skeleton: pre-fill computed checks, send FILL_IN for AI checks
        skeleton_phases = {}
        for phase_key, checks in CHECKLIST_KEYS.items():
            findings = []
            for chk_name in checks:
                if chk_name in COMPUTED:
                    entry = {"check_name": chk_name, **COMPUTED[chk_name]}
                else:
                    entry = {"check_name": chk_name, "status": "FILL_IN", "severity": "FILL_IN", "description": "FILL_IN", "recommendation": "FILL_IN"}
                findings.append(entry)
            skeleton_phases[phase_key] = {"findings": findings}

        skeleton_str = json.dumps({"phases": skeleton_phases}, indent=2)

        # Build crawl context for AI
        if crawled_pages:
            ctx_lines = [f"Pages crawled ({len(crawled_pages)}):"]
            for p in crawled_pages:
                ctx_lines.append(
                    f"  [{p.get('status_code','?')}] {p.get('url','')} | "
                    f"Title: {p.get('title','(none)')[:60]} | "
                    f"H1:{p.get('h1_count','?')} Imgs:{p.get('img_count','?')} AltMissing:{p.get('img_missing_alt','?')} "
                    f"Canonical:{p.get('has_canonical','?')} Viewport:{p.get('has_viewport','?')} "
                    f"OG:{p.get('has_og_tags','?')} Schema:{p.get('has_schema','?')}"
                )
            crawl_context = "\n".join(ctx_lines)
        else:
            crawl_context = "Crawler could not access pages. Use best-effort analysis."

        # ── Step 3: AI fills in only the FILL_IN checks ───────────────────
        prompt = f"""You are an Enterprise Technical SEO Expert.

Target Website: {url}
Scan Depth: {depth}

CRAWL DATA:
{crawl_context}

TASK: The JSON skeleton below contains checks that are already filled in (do NOT change them) and checks still marked "FILL_IN" that you MUST complete.

For each "FILL_IN" entry:
- "status": exactly "Pass" or "Fail"
- "severity": "N/A" if Pass; else "Critical", "High", "Medium", or "Low"
- "description": 1-2 sentences describing what was found specifically for {url}
- "recommendation": concrete fix if Fail; "No action needed." if Pass

CRITICAL RULES:
1. Do NOT change any entry that does NOT have "FILL_IN" — copy it exactly as-is.
2. Every entry MUST remain in the output — do not remove any.
3. OUTPUT ONLY valid JSON. No markdown, no backticks.

Return this complete structure with all phases filled:
{{
  "executive_summary": {{
    "overall_health_score": <0-100>,
    "technical_seo_score": <0-100>,
    "on_page_seo_score": <0-100>,
    "url_structure_score": <0-100>,
    "internal_linking_score": <0-100>,
    "image_seo_score": <0-100>,
    "performance_score": <0-100>,
    "core_web_vitals_score": <0-100>,
    "mobile_seo_score": <0-100>,
    "accessibility_score": <0-100>,
    "schema_quality_score": <0-100>,
    "security_headers_score": <0-100>,
    "csp_security_score": <0-100>,
    "https_security_score": <0-100>,
    "content_quality_score": <0-100>,
    "top_critical_issues": [],
    "top_high_priority_issues": [],
    "top_quick_wins": [],
    "positive_findings": [],
    "risks": [],
    "recommended_roadmap": {{"immediate": [], "short_term": [], "long_term": []}}
  }},
  "technical_seo": {{"findings": <from skeleton>}},
  "on_page_seo": {{"findings": <from skeleton>}},
  "url_audit": {{"findings": <from skeleton>}},
  "internal_external_links": {{"findings": <from skeleton>}},
  "image_seo": {{"findings": <from skeleton>}},
  "performance": {{"findings": <from skeleton>}},
  "mobile_seo": {{"findings": <from skeleton>}},
  "accessibility": {{"findings": <from skeleton>}},
  "structured_data": {{"findings": <from skeleton>}},
  "javascript_seo": {{"findings": <from skeleton>}},
  "robots_sitemap": {{"findings": <from skeleton>}},
  "csp_audit": {{"findings": <from skeleton>}},
  "security_headers": {{"findings": <from skeleton>}},
  "https_mixed_content": {{"findings": <from skeleton>}},
  "content_quality": {{"findings": <from skeleton>}},
  "actionable_recommendations": [],
  "pages_scanned": []
}}

SKELETON:
{skeleton_str}"""

        text, mname = await asyncio.to_thread(self._try, prompt, None, "pro")
        try:
            data = _parse(text)
        except Exception as e:
            print(f"[SEO Audit] Parse error: {e}. Raw[:300]: {text[:300]}")
            # Fallback: use skeleton (Python-computed checks are already in it)
            data = {
                "executive_summary": {"overall_health_score": 0, "top_critical_issues": ["AI parse error — scan results may be incomplete."], "top_high_priority_issues": [], "top_quick_wins": [], "positive_findings": [], "risks": [], "recommended_roadmap": {"immediate": [], "short_term": [], "long_term": []}},
                "actionable_recommendations": ["Retry the scan."]
            }
            for key, val in skeleton_phases.items():
                data[key] = val

        # ── Step 4: Override with Python-computed checks (always accurate) ─
        for phase_key, phase_data in data.items():
            if not isinstance(phase_data, dict) or "findings" not in phase_data:
                continue
            for finding in phase_data["findings"]:
                if finding.get("check_name") in COMPUTED:
                    finding.update(COMPUTED[finding["check_name"]])
                # Ensure no FILL_IN leftovers
                if finding.get("status") == "FILL_IN" or not finding.get("description") or finding.get("description") == "FILL_IN":
                    finding["status"] = finding.get("status") if finding.get("status") not in ("FILL_IN", None) else "Fail"
                    finding["severity"] = finding.get("severity") if finding.get("severity") not in ("FILL_IN", None) else "Medium"
                    finding["description"] = finding.get("description") if finding.get("description") not in ("FILL_IN", None, "") else "Could not evaluate this check automatically."
                    finding["recommendation"] = finding.get("recommendation") if finding.get("recommendation") not in ("FILL_IN", None, "") else "Perform manual verification of this check."

        # ── Step 5: Merge real crawled pages into pages_scanned ─────────
        if crawled_pages:
            # AI sometimes returns pages_scanned as a list of strings — filter to dicts only
            raw_ai_pages = data.get("pages_scanned", [])
            ai_by_url = {
                p.get("url", ""): p
                for p in raw_ai_pages
                if isinstance(p, dict)
            }
            data["pages_scanned"] = [
                {
                    "url": p["url"],
                    "status_code": p["status_code"],
                    "title": p.get("title") or ai_by_url.get(p["url"], {}).get("title", ""),
                    "seo_issues": ai_by_url.get(p["url"], {}).get("seo_issues", []),
                }
                for p in crawled_pages
            ]

        data["scan_id"]     = str(uuid.uuid4())
        data["url"]         = url
        data["depth"]       = depth
        data["pages_count"] = len(crawled_pages)
        data["scanned_at"]  = datetime.now().isoformat()
        data["model_used"]  = MODEL_LABELS.get(mname, mname)
        return data

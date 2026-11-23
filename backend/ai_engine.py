"""
QAForge Gemini — AI Engine v5.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KEY v5 CHANGE: Focus areas now strictly filter what categories the AI generates.
  - If focus_areas = ["security", "negative"] → AI ONLY generates security + negative tests
  - format_config drives output format (BDD, Detailed, Checklist, Exploratory)
  - Depth param on bug scan controls scan thoroughness
"""

import uuid, json, re, base64, asyncio
from urllib.parse import urlparse
from pathlib import Path
from datetime import datetime
from typing import List, Tuple, Optional, Any
import warnings
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    import google.generativeai as genai
from .models import GenerateRequest, TestSuite, TestCase, RangeConfig, FormatConfig, ApiGenerateRequest
from .crawler import crawl_website
from .seo_extractor import extract_seo_data
# ── Model chain ───────────────────────────────────────────────────────────────

# MODEL_CHAIN: List[Tuple[str, str]] = [
#     ("flash",     "gemini-2.5-flash"),
#     ("pro",       "gemini-2.5-pro"),
#     ("flash15",   "gemini-2.5-flash-lite"),
#     ("flash_exp", "gemini-flash-latest"),
# ]
# ── Model chain ───────────────────────────────────────────────────────────────
MODEL_CHAIN: List[Tuple[str, str]] = [
    ("flash",     "gemini-3.5-flash-lite"),  # Primary: Latest 3.5 generation (1.36s)
    ("pro",       "gemini-3.1-flash-lite"),  # Fallback 1: Latest 3.1 generation (1.21s)
    ("flash15",   "gemini-3-flash-preview"), # Fallback 2: Gen 3.0 preview (1.42s)
    ("flash_exp", "gemini-2.5-flash"),       # Fallback 3: Proven 1M token context anchor
]

MODEL_LABELS = {
    "gemini-3.8-flash":       "Gemini 3.8 Flash",
    "gemini-3.5-flash":       "Gemini 3.5 Flash",
    "gemini-3.5-flash-lite":  "Gemini 3.5 Flash Lite",
    "gemini-3.1-flash-lite":  "Gemini 3.1 Flash Lite",
    "gemini-3-flash-preview": "Gemini 3 Flash Preview",
    "gemini-2.5-flash":       "Gemini 2.5 Flash",
    "gemini-2.5-flash-lite":  "Gemini 2.5 Flash Lite",
    "gemini-flash-latest":    "Gemini Flash Latest",
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
            if k and k.startswith("AIza"):
                keys[i] = k
        single = cfg.get("api_key", "").strip()
        if single and 1 not in keys and single.startswith("AIza"):
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

        # If all models in the chain are flagged as quota-exhausted, auto-clear so we retry
        if all(self._quota.get(k) for k, _ in ordered):
            self._quota.clear()

        all_errors = []
        for mkey, mname in ordered:
            if self._quota.get(mkey):
                all_errors.append(f"{mname}: quota exhausted")
                continue

            preferred_slot = key_to_slot.get(mkey, 1)
            # Try the preferred slot first, then fall back to all other configured keys
            slots_to_try = [preferred_slot] + [s for s in sorted(keys.keys()) if s != preferred_slot]

            model_succeeded = False
            for slot in slots_to_try:
                api_key = keys.get(slot)
                if not api_key:
                    continue
                try:
                    genai.configure(api_key=api_key, transport="rest")
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
                        # Try next available key slot for this model before giving up
                        continue
                    else:
                        # Non-quota error, move to next model
                        break

            # If all slots failed with quota for this model, mark it
            if any(f"{mname} (Slot" in err and any(q in err.lower() for q in QUOTA_ERRORS) for err in all_errors):
                self._quota[mkey] = True

        # Emergency fallback models if the entire primary chain failed
        emergency_models = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite-preview", "gemini-flash-lite-latest"]
        for em_name in emergency_models:
            for slot, api_key in keys.items():
                try:
                    genai.configure(api_key=api_key, transport="rest")
                    model = genai.GenerativeModel(
                        em_name,
                        generation_config=genai.types.GenerationConfig(
                            temperature=0.4, top_p=0.95, max_output_tokens=16384
                        )
                    )
                    content = ([image_data, prompt] if image_data else [prompt])
                    resp = model.generate_content(content)
                    print(f"[QAForge] Used Emergency Fallback {em_name} (Slot {slot})")
                    return resp.text, em_name
                except Exception as e:
                    all_errors.append(f"{em_name} (Slot {slot}): {str(e)[:100]}")
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
        """
        v2.0 — Fully deterministic, technically deep SEO audit.

        Phase 1: Real HTTP fetch + BS4 DOM extraction via seo_extractor
        Phase 2: Deterministic checklist built from real extracted data
        Phase 3: AI fills only the checks that require AI judgment (content quality, CWV estimates, etc.)
        Phase 4: Python-computed checks always override AI answers for 100% accuracy
        """
        # ── Phase 1: Extract real data + Crawl concurrently if deep/paranoid ──
        crawl_task = None
        if depth in ("deep", "paranoid"):
            crawl_task = asyncio.create_task(crawl_website(url, depth))

        try:
            ex = await extract_seo_data(url, depth)
        except Exception as e:
            print(f"[SEO Audit] Extractor error: {e}")
            ex = {"url": url, "fetch_error": str(e), "status_code": 0}

        # ── Phase 2: Build deterministic checks from extracted data ───────
        def chk(status, sev_if_fail, desc, rec):
            sev = "N/A" if status == "Pass" else sev_if_fail
            rec = "No action needed." if status == "Pass" else rec
            return {"status": status, "severity": sev, "description": desc, "recommendation": rec}

        def p_or_f(cond):
            return "Pass" if cond else "Fail"

        def _join_issues(issues):
            return " | ".join(issues) if issues else ""

        # Convenience accessors
        final_url    = ex.get("final_url", url)
        is_https     = ex.get("is_https", False)
        status_code  = ex.get("status_code", 0)
        fetch_error  = ex.get("fetch_error")

        title        = ex.get("title")  # None = missing, "" = empty, str = value
        title_chars  = ex.get("title_char_count", 0)
        title_issues = ex.get("title_issues", [])

        meta_desc       = ex.get("meta_description")
        meta_desc_chars = ex.get("meta_description_char_count", 0)
        meta_desc_issues = ex.get("meta_description_issues", [])

        meta_robots  = ex.get("meta_robots")
        canonical    = ex.get("canonical")
        can_issues   = ex.get("canonical_issues", [])
        viewport     = ex.get("viewport")
        lang         = ex.get("lang")
        hreflang     = ex.get("hreflang", [])
        charset      = ex.get("charset")

        headings     = ex.get("headings", {})
        h1s          = headings.get("h1", [])
        h2s          = headings.get("h2", [])
        heading_issues = ex.get("heading_issues", [])

        images       = ex.get("images", [])
        image_issues = ex.get("image_issues", [])
        img_stats    = ex.get("image_stats", {})
        total_imgs   = img_stats.get("total", len(images))
        missing_alt  = img_stats.get("missing_alt", sum(1 for i in images if not i.get("alt_present")))
        empty_alt    = img_stats.get("empty_alt", sum(1 for i in images if i.get("alt_present") and i.get("alt") == ""))
        with_alt     = img_stats.get("with_alt", sum(1 for i in images if i.get("alt_present") and i.get("alt")))
        missing_img_title = img_stats.get("missing_title", sum(1 for i in images if not i.get("title_present")))
        empty_img_title   = img_stats.get("empty_title", sum(1 for i in images if i.get("title_present") and (i.get("title") or "") == ""))
        with_img_title    = img_stats.get("with_title", sum(1 for i in images if i.get("title_present") and i.get("title")))

        internal_links = ex.get("internal_links", [])
        external_links = ex.get("external_links", [])
        link_issues    = ex.get("link_issues", [])
        link_stats     = ex.get("link_stats", {})
        all_links      = internal_links + external_links
        total_links    = link_stats.get("total", len(all_links))
        links_missing_title = link_stats.get("missing_title", sum(1 for l in all_links if not l.get("title_present")))
        links_empty_title   = link_stats.get("empty_title", sum(1 for l in all_links if l.get("title_present") and (l.get("title") or "") == ""))
        links_with_title    = link_stats.get("with_title", sum(1 for l in all_links if l.get("title_present") and l.get("title")))
        links_empty_anchor  = link_stats.get("empty_anchor", sum(1 for l in all_links if not l.get("anchor_text") and not l.get("has_img")))
        img_links           = [l for l in all_links if l.get("has_img")]
        img_links_count     = link_stats.get("image_links_total", len(img_links))
        img_links_missing_alt = link_stats.get("image_links_missing_alt", sum(1 for l in img_links if not l.get("img_alt_present") or not l.get("img_alt")))
        img_links_with_alt  = link_stats.get("image_links_with_alt", sum(1 for l in img_links if l.get("img_alt_present") and l.get("img_alt")))

        og           = ex.get("og", {})
        og_issues    = ex.get("og_issues", [])
        twitter      = ex.get("twitter", {})
        twitter_issues = ex.get("twitter_issues", [])

        has_schema   = ex.get("has_schema", False)
        schema_types = ex.get("schema_types", [])

        robots_txt   = ex.get("robots_txt", {})
        sitemaps     = ex.get("sitemaps", [])

        sec_headers  = ex.get("security_headers", {})
        resp_headers = ex.get("response_headers", {})
        word_count   = ex.get("word_count", 0)
        redirect_chain = ex.get("redirect_chain", [])
        response_time_ms = ex.get("response_time_ms")

        # ── Build deterministic COMPUTED dict ────────────────────────────
        COMPUTED = {}

        # ── ON-PAGE SEO ──────────────────────────────────────────────────
        if title is None:
            COMPUTED["Title Tags (All Pages)"] = chk(
                "Fail", "High",
                "No <title> tag found on page.",
                "Add a unique, descriptive <title> tag (50–60 chars) to every page."
            )
        elif title.strip() == "":
            COMPUTED["Title Tags (All Pages)"] = chk(
                "Fail", "High",
                "<title> tag present but is empty.",
                "Add descriptive content to the <title> tag (50–60 chars)."
            )
        else:
            extra = f" Issues: {_join_issues(title_issues)}" if title_issues else ""
            COMPUTED["Title Tags (All Pages)"] = chk(
                p_or_f(not title_issues or all("TOO_" not in i and "MULTIPLE" not in i for i in title_issues)),
                "Medium",
                f'Title: "{title}" ({title_chars} chars).{extra}',
                f"Optimise title to 50–60 characters. {_join_issues(title_issues)}"
            )

        if meta_desc is None:
            COMPUTED["Meta Descriptions (All Pages)"] = chk(
                "Fail", "Medium",
                "No meta description tag found.",
                "Add a unique meta description (150–160 chars) to every page."
            )
        elif meta_desc.strip() == "":
            COMPUTED["Meta Descriptions (All Pages)"] = chk(
                "Fail", "Medium",
                "Meta description tag present but content is empty.",
                "Write a unique meta description (150–160 chars)."
            )
        else:
            if 0 < meta_desc_chars < 150 and not any("TOO_SHORT" in i for i in meta_desc_issues):
                meta_desc_issues.append(f"TOO_SHORT: {meta_desc_chars} chars (description should be 150–160 chars)")
            elif meta_desc_chars > 160 and not any("TOO_LONG" in i for i in meta_desc_issues):
                meta_desc_issues.append(f"TOO_LONG: {meta_desc_chars} chars (description should be 150–160 chars, may be truncated in SERPs)")

            extra = f" Issues: {_join_issues(meta_desc_issues)}" if meta_desc_issues else ""
            ok = (150 <= meta_desc_chars <= 160) and (
                not meta_desc_issues or all("TOO_" not in i and "MULTIPLE" not in i and "EMPTY" not in i for i in meta_desc_issues)
            )
            COMPUTED["Meta Descriptions (All Pages)"] = chk(
                p_or_f(ok), "Medium",
                f'Meta description: "{meta_desc[:160]}" ({meta_desc_chars} chars).{extra}',
                f"Description should be 150–160 characters. {_join_issues(meta_desc_issues)}"
            )

        if len(h1s) == 0:
            COMPUTED["H1 Tag Per Page"] = chk(
                "Fail", "High",
                "No <h1> tag found on page.",
                "Add exactly one descriptive <h1> per page containing the primary keyword."
            )
        elif len(h1s) > 1:
            COMPUTED["H1 Tag Per Page"] = chk(
                "Fail", "Medium",
                f"{len(h1s)} <h1> tags found: {h1s[:3]}",
                "Use only one <h1> per page. Demote secondary headings to <h2>."
            )
        else:
            COMPUTED["H1 Tag Per Page"] = chk(
                "Pass", "N/A",
                f'Exactly 1 <h1> found: "{h1s[0][:100]}"',
                "No action needed."
            )

        h2_desc = f"{len(h2s)} <h2> tag(s) found." if h2s else "No <h2> tags found."
        hi_extra = f" Issues: {_join_issues(heading_issues)}" if heading_issues else ""
        COMPUTED["H2/H3 Heading Hierarchy"] = chk(
            p_or_f(not heading_issues),
            "Low",
            f"{h2_desc}{hi_extra}",
            "Maintain a logical heading hierarchy (H1 → H2 → H3) without skipping levels."
        )

        # Duplicate detection (simplified for single-page audit)
        COMPUTED["Duplicate Title Detection"] = chk(
            "Pass", "N/A",
            "Single-page audit — duplicate title check requires Deep/Paranoid scan across multiple pages.",
            "Use Deep scan to check for duplicate titles across pages."
        )
        COMPUTED["Duplicate Meta Description Detection"] = chk(
            "Pass", "N/A",
            "Single-page audit — duplicate meta description check requires Deep/Paranoid scan.",
            "Use Deep scan to check for duplicate meta descriptions."
        )

        # ── TECHNICAL SEO ────────────────────────────────────────────────
        if canonical is None:
            COMPUTED["Canonical Tags"] = chk(
                "Fail", "High",
                "No canonical tag found on page.",
                'Add <link rel="canonical" href="..."> to the <head> of every page.'
            )
        elif canonical.strip() == "":
            COMPUTED["Canonical Tags"] = chk(
                "Fail", "High",
                "Canonical tag present but href is empty.",
                "Set the canonical href to the absolute URL of this page."
            )
        else:
            extra = f" Issues: {_join_issues(can_issues)}" if can_issues else ""
            COMPUTED["Canonical Tags"] = chk(
                p_or_f(not can_issues),
                "Medium",
                f'Canonical: "{canonical}".{extra}',
                f"Ensure canonical points to the correct absolute HTTPS URL. {_join_issues(can_issues)}"
            )

        COMPUTED["HTTPS Enforced"] = chk(
            p_or_f(is_https), "Critical",
            f"Site is served over {'HTTPS' if is_https else 'HTTP'} ({final_url}).",
            "Install an SSL certificate and redirect all HTTP traffic to HTTPS (301)."
        )

        has_hreflang = len(hreflang) > 0
        COMPUTED["Hreflang Implementation"] = chk(
            "Pass" if has_hreflang else "Fail",
            "Low",
            f"{len(hreflang)} hreflang tag(s) found: {[h['lang'] for h in hreflang[:5]]}" if has_hreflang else "No hreflang tags found.",
            "Add hreflang tags for each language/region your site targets."
        )

        has_robots = robots_txt.get("present", False)
        robots_status = robots_txt.get("status_code", 0)
        disallow_all = robots_txt.get("disallow_all", False)
        sitemap_in_robots = len(robots_txt.get("sitemap_declarations", [])) > 0

        COMPUTED["Robots.txt Configuration"] = chk(
            p_or_f(has_robots and not disallow_all),
            "High",
            f"robots.txt: {'present' if has_robots else 'NOT FOUND'} (HTTP {robots_status}). "
            + (f"Disallow all: {disallow_all}. " if disallow_all else "")
            + (f"Sitemap declared: {robots_txt.get('sitemap_declarations', [])}." if sitemap_in_robots else "No sitemap declared in robots.txt."),
            "Create a valid robots.txt that allows crawling of important pages and declares the sitemap URL."
        )

        COMPUTED["Crawlability via Robots.txt"] = chk(
            p_or_f(has_robots and not disallow_all),
            "Critical",
            ("Robots.txt blocks all crawlers (Disallow: /)." if disallow_all else
             "Robots.txt allows crawling." if has_robots else
             "robots.txt not found — crawlers assume all pages are allowed."),
            "Do not use 'Disallow: /' on production. Verify robots.txt allows Googlebot to crawl important pages."
        )

        sm_present = any(s.get("present") for s in sitemaps)
        sm_url_used = next((s.get("url") for s in sitemaps if s.get("present")), None)
        sm_count = next((s.get("url_count", 0) for s in sitemaps if s.get("present")), 0)
        COMPUTED["XML Sitemap Presence"] = chk(
            p_or_f(sm_present),
            "Medium",
            (f"Sitemap found at {sm_url_used} ({sm_count} URL(s) indexed)." if sm_present
             else f"No sitemap found at /sitemap.xml or in robots.txt."),
            "Create an XML sitemap and submit it to Google Search Console."
        )

        COMPUTED["Sitemap in Robots.txt"] = chk(
            p_or_f(sitemap_in_robots),
            "Low",
            (f"Sitemap declared in robots.txt: {robots_txt.get('sitemap_declarations', [])}." if sitemap_in_robots
             else "No Sitemap: directive found in robots.txt."),
            "Add 'Sitemap: https://example.com/sitemap.xml' to your robots.txt."
        )

        COMPUTED["Sitemap URL Valid"] = chk(
            p_or_f(sm_present),
            "Medium",
            (f"Sitemap at {sm_url_used} returned HTTP {next((s.get('status_code') for s in sitemaps if s.get('present')), 0)}." if sm_present
             else "Sitemap URL returned non-200 or was not found."),
            "Ensure your sitemap URL returns HTTP 200 and contains valid XML."
        )

        COMPUTED["Sitemap Last Modified"] = chk(
            "Fail", "Low",
            "Could not verify <lastmod> dates in sitemap without deeper inspection.",
            "Ensure your sitemap includes <lastmod> dates for all URLs."
        )

        # ── MOBILE SEO ───────────────────────────────────────────────────
        COMPUTED["Viewport Meta Tag"] = chk(
            p_or_f(bool(viewport)),
            "High",
            f"Viewport meta: {viewport}" if viewport else "Viewport meta tag is missing.",
            'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to <head>.'
        )

        # ── STRUCTURED DATA ──────────────────────────────────────────────
        COMPUTED["Schema.org Markup Present"] = chk(
            p_or_f(has_schema),
            "Medium",
            (f"JSON-LD structured data found. Schema types: {schema_types}." if has_schema
             else "No JSON-LD structured data found on page."),
            "Add JSON-LD with at minimum Organization and WebSite schema types."
        )

        # OG tags
        og_present = bool(og)
        og_required = ["og:title", "og:description", "og:image", "og:url", "og:type"]
        og_missing = [k for k in og_required if k not in og]
        og_desc_parts = []
        for k in og_required:
            if k in og:
                og_desc_parts.append(f'{k}="{str(og[k])[:80]}"')
        og_desc = "; ".join(og_desc_parts) if og_desc_parts else "No OG tags found."
        og_extra = f" Issues: {_join_issues(og_issues)}" if og_issues else ""
        COMPUTED["Open Graph (OG) Tags"] = chk(
            p_or_f(og_present and not og_missing),
            "Medium",
            f"{og_desc}.{og_extra}",
            f"{'Missing: ' + str(og_missing) + '. ' if og_missing else ''}Add all 5 required OG tags (title, description, image, url, type)."
        )

        # Twitter Cards
        tw_present = bool(twitter)
        tw_required = ["twitter:card", "twitter:title", "twitter:description"]
        tw_missing = [k for k in tw_required if k not in twitter]
        tw_desc_parts = []
        for k in tw_required:
            if k in twitter:
                tw_desc_parts.append(f'{k}="{str(twitter[k])[:60]}"')
        tw_desc = "; ".join(tw_desc_parts) if tw_desc_parts else "No Twitter Card tags found."
        tw_extra = f" Issues: {_join_issues(twitter_issues)}" if twitter_issues else ""
        COMPUTED["Twitter Card Tags"] = chk(
            p_or_f(tw_present and not tw_missing),
            "Low",
            f"{tw_desc}.{tw_extra}",
            f"{'Missing: ' + str(tw_missing) + '. ' if tw_missing else ''}Add twitter:card, twitter:title, twitter:description, and twitter:image."
        )

        # ── IMAGE SEO ────────────────────────────────────────────────────
        COMPUTED["Image Alt Text"] = chk(
            p_or_f(missing_alt == 0),
            "High",
            (f"{total_imgs} image(s) found; {missing_alt} missing alt attribute entirely, {empty_alt} with empty alt=\"\", {missing_img_title} missing title attribute." if total_imgs
             else "No <img> tags found on page."),
            f"Add descriptive alt attributes to {missing_alt} image(s). Use alt=\"\" only for decorative images."
        )
        COMPUTED["Image Title Attributes"] = chk(
            p_or_f(missing_img_title == 0 or total_imgs == 0),
            "Low",
            (f"{total_imgs} image(s) found; {missing_img_title} missing title attribute, {with_img_title} have title attribute." if total_imgs
             else "No images found."),
            f"Add title attributes to {missing_img_title} image(s) where supplementary tooltip context is beneficial."
        )
        COMPUTED["Image Alt Text (Accessibility)"] = chk(
            p_or_f(missing_alt == 0),
            "High",
            (f"{missing_alt}/{total_imgs} images violate WCAG 1.1.1 (missing alt). {empty_alt} have empty alt=\"\" (decorative)." if total_imgs
             else "No images found."),
            "Assign descriptive alt text to all informative images. Use alt=\"\" ONLY for decorative images."
        )

        lazy_count = sum(1 for i in images if i.get("loading") == "lazy")
        COMPUTED["Lazy Loading"] = chk(
            p_or_f(total_imgs == 0 or lazy_count >= max(1, total_imgs - 3)),
            "Low",
            (f"{lazy_count}/{total_imgs} images use loading=\"lazy\"." if total_imgs else "No images found."),
            "Add loading=\"lazy\" to all below-the-fold images to improve page load performance."
        )

        # ── INTERNAL/EXTERNAL LINKS ──────────────────────────────────────
        COMPUTED["Internal Links Present"] = chk(
            p_or_f(len(internal_links) > 0),
            "Medium",
            f"{len(internal_links)} internal link(s) found on page.",
            "Ensure every page links to other relevant internal pages for crawlability."
        )
        COMPUTED["Link Title Attributes"] = chk(
            p_or_f(links_missing_title == 0 or total_links == 0),
            "Low",
            (f"{total_links} link(s) evaluated; {links_missing_title} missing title attribute, {links_with_title} have title attribute." if total_links
             else "No links found."),
            "Add title attributes to links where additional context or tooltips improve navigation clarity."
        )
        nofollow_ext = sum(1 for l in external_links if l.get("is_nofollow"))
        COMPUTED["External Links (Nofollow Policy)"] = chk(
            "Pass", "N/A",
            f"{len(external_links)} external link(s); {nofollow_ext} have rel=nofollow.",
            "Apply rel=\"nofollow\" or rel=\"sponsored\" to paid/untrusted external links."
        )
        COMPUTED["Orphan Pages"] = chk(
            "Pass", "N/A",
            "Single-page scan — orphan page detection requires Deep/Paranoid crawl.",
            "Use Deep scan to identify pages not reachable via internal links."
        )
        link_anchor_issues = [l for l in internal_links + external_links if not l.get("anchor_text")]
        COMPUTED["Link Anchor Text Quality"] = chk(
            p_or_f(len(link_anchor_issues) == 0 and img_links_missing_alt == 0),
            "Medium",
            (f"{total_links} link(s); {len(link_anchor_issues)} have empty/missing anchor text, {img_links_missing_alt} image-links missing inner image alt." if total_links
             else f"All {total_links} links have descriptive anchor text."),
            "Use descriptive anchor text for all links and ensure image-links have alt text on the inner image."
        )
        COMPUTED["Image Link Alt Text"] = chk(
            p_or_f(img_links_missing_alt == 0),
            "High",
            (f"{img_links_count} image link(s) found (<a><img ...></a>); {img_links_missing_alt} missing alt attribute on inner image, {img_links_with_alt} with alt." if img_links_count
             else "No image links (<a><img>) found on page."),
            "Add alt text to images inside <a> tags so search engines and assistive technology understand the link destination."
        )

        # ── HTTPS + SECURITY HEADERS ─────────────────────────────────────
        COMPUTED["HTTPS Certificate Valid"] = chk(
            p_or_f(is_https and status_code > 0),
            "Critical",
            (f"HTTPS active; page returned HTTP {status_code}. Response time: {response_time_ms}ms." if is_https
             else "Site is NOT served over HTTPS."),
            "Install a valid SSL certificate from a trusted CA and enforce HTTPS."
        )
        COMPUTED["HTTP to HTTPS Redirect"] = chk(
            p_or_f(is_https),
            "High",
            (f"Site is HTTPS. {len(redirect_chain)} redirect(s) detected." if is_https
             else f"Site is HTTP. Redirect chain: {redirect_chain}"),
            "Configure a 301 permanent redirect from http:// to https:// for all URLs."
        )

        hsts_val = sec_headers.get("strict-transport-security")
        COMPUTED["Strict-Transport-Security (HSTS)"] = chk(
            p_or_f(bool(hsts_val)),
            "High",
            f"HSTS header: {hsts_val}" if hsts_val else "Strict-Transport-Security header is missing.",
            "Add 'Strict-Transport-Security: max-age=31536000; includeSubDomains; preload' header."
        )

        csp_val = sec_headers.get("content-security-policy")
        COMPUTED["Content-Security-Policy Header"] = chk(
            p_or_f(bool(csp_val)),
            "High",
            f"CSP header: {str(csp_val)[:200]}" if csp_val else "Content-Security-Policy header is missing.",
            "Implement a Content-Security-Policy header to prevent XSS and data injection attacks."
        )

        xframe_val = sec_headers.get("x-frame-options")
        COMPUTED["X-Frame-Options Header"] = chk(
            p_or_f(bool(xframe_val)),
            "Medium",
            f"X-Frame-Options: {xframe_val}" if xframe_val else "X-Frame-Options header is missing.",
            "Set 'X-Frame-Options: DENY' or 'SAMEORIGIN' to prevent clickjacking."
        )

        xcto_val = sec_headers.get("x-content-type-options")
        COMPUTED["X-Content-Type-Options Header"] = chk(
            p_or_f(bool(xcto_val)),
            "Medium",
            f"X-Content-Type-Options: {xcto_val}" if xcto_val else "X-Content-Type-Options header is missing.",
            "Set 'X-Content-Type-Options: nosniff' to prevent MIME-type sniffing attacks."
        )

        ref_val = sec_headers.get("referrer-policy")
        COMPUTED["Referrer-Policy"] = chk(
            p_or_f(bool(ref_val)),
            "Low",
            f"Referrer-Policy: {ref_val}" if ref_val else "Referrer-Policy header is missing.",
            "Set a Referrer-Policy header (e.g., 'strict-origin-when-cross-origin')."
        )

        perm_val = sec_headers.get("permissions-policy")
        COMPUTED["Permissions-Policy"] = chk(
            p_or_f(bool(perm_val)),
            "Low",
            f"Permissions-Policy: {str(perm_val)[:120]}" if perm_val else "Permissions-Policy header is missing.",
            "Add a Permissions-Policy header to restrict browser features like camera, microphone."
        )

        xxss_val = sec_headers.get("x-xss-protection")
        server_val = sec_headers.get("server")
        powered_val = sec_headers.get("x-powered-by")
        COMPUTED["X-XSS-Protection"] = chk(
            p_or_f(bool(xxss_val)),
            "Low",
            f"X-XSS-Protection: {xxss_val}" if xxss_val else "X-XSS-Protection header is missing (deprecated but still checked).",
            "Consider setting 'X-XSS-Protection: 1; mode=block' for older browsers."
        )
        COMPUTED["Server Header Disclosure"] = chk(
            p_or_f(not server_val and not powered_val),
            "Low",
            (f"Server: {server_val}" if server_val else "No Server header detected.") +
            (f" | X-Powered-By: {powered_val}" if powered_val else ""),
            "Remove or obscure Server and X-Powered-By headers to reduce information disclosure."
        )

        if csp_val:
            unsafe_inline = "unsafe-inline" in csp_val
            wildcard = "*" in csp_val.split("script-src")[-1].split(";")[0] if "script-src" in csp_val else False
            COMPUTED["CSP Unsafe-Inline Check"] = chk(
                p_or_f(not unsafe_inline), "High",
                f"CSP contains 'unsafe-inline': {unsafe_inline}. CSP: {str(csp_val)[:200]}",
                "Remove 'unsafe-inline' from CSP and use nonces or hashes instead."
            )
            COMPUTED["CSP Wildcard Check"] = chk(
                p_or_f(not wildcard), "Medium",
                f"CSP script-src wildcard detected: {wildcard}.",
                "Avoid '*' wildcards in script-src. Specify exact allowed origins."
            )
        else:
            COMPUTED["CSP Unsafe-Inline Check"] = chk(
                "Fail", "High",
                "No Content-Security-Policy header present — cannot evaluate unsafe-inline.",
                "Implement a Content-Security-Policy header without 'unsafe-inline' in script-src."
            )
            COMPUTED["CSP Wildcard Check"] = chk(
                "Fail", "Medium",
                "No Content-Security-Policy header present — cannot evaluate wildcards.",
                "Implement CSP and avoid wildcard (*) origins in script-src."
            )

        # Mixed content check
        mixed_content_likely = is_https  # Can only verify this via full browser — flag for AI
        COMPUTED["Mixed Content (HTTP resources on HTTPS page)"] = chk(
            "Fail" if not is_https else "Pass",
            "High",
            ("Page is HTTPS. Mixed content verification requires browser-level JS execution — see AI analysis." if is_https
             else "Page is HTTP — mixed content not applicable."),
            "Ensure all sub-resources (images, scripts, CSS) are served over HTTPS."
        )

        # Secure cookies cannot be verified via GET — flag for manual
        COMPUTED["Secure Cookies"] = chk(
            "Fail", "Medium",
            "Secure cookie flags (Secure, HttpOnly, SameSite) require server-side inspection or DevTools — cannot verify via HTTP GET.",
            "Set Secure, HttpOnly, and SameSite=Strict/Lax flags on all session/auth cookies."
        )

        # Pages blocked in robots.txt
        disallow_count = len(robots_txt.get("disallow_rules", []))
        COMPUTED["Pages Blocked in Robots.txt"] = chk(
            p_or_f(not disallow_all),
            "Critical" if disallow_all else "Low",
            (f"Disallow: / — ALL pages blocked from crawling." if disallow_all
             else f"{disallow_count} Disallow rule(s) in robots.txt. " +
                  (f"Sample: {[r['path'] for r in robots_txt.get('disallow_rules', [])[:3]]}" if disallow_count else "No pages blocked.")),
            "Review Disallow rules to ensure important pages are not accidentally blocked."
        )

        # Word count
        wc = word_count
        COMPUTED["Page Word Count"] = chk(
            p_or_f(wc >= 300),
            "Medium",
            f"Approximately {wc} words detected on page body.",
            "Aim for at least 300 words for non-trivial pages. Thin content may rank poorly."
        )

        # URL analysis
        parsed_url = urlparse(final_url)
        url_path = parsed_url.path
        has_uppercase = url_path != url_path.lower()
        has_spaces = " " in url_path or "%20" in url_path
        url_len = len(final_url)
        has_params = bool(parsed_url.query)
        trailing_slash = url_path.endswith("/") and url_path != "/"

        COMPUTED["URL Slug Structure"] = chk(
            p_or_f(not has_uppercase and not has_spaces),
            "Medium",
            f"URL: {final_url} ({url_len} chars). Uppercase: {has_uppercase}. Spaces: {has_spaces}.",
            "Use lowercase, hyphen-separated URL slugs. Avoid underscores, spaces, or special characters."
        )
        COMPUTED["URL Length"] = chk(
            p_or_f(url_len <= 100),
            "Low",
            f"URL length: {url_len} characters.",
            "Keep URLs under 100 characters for readability and crawl efficiency."
        )
        COMPUTED["URL Lowercase Consistency"] = chk(
            p_or_f(not has_uppercase),
            "Medium",
            f"URL path case: {'contains uppercase' if has_uppercase else 'all lowercase'}.",
            "Enforce lowercase URLs via server-side redirect to prevent duplicate content."
        )
        COMPUTED["Trailing Slash Consistency"] = chk(
            "Pass", "N/A",
            f"Trailing slash: {'present' if trailing_slash else 'absent'}. Consistency across pages requires multi-page scan.",
            "Pick one trailing slash convention and enforce it with 301 redirects site-wide."
        )
        COMPUTED["Dynamic Parameters in URL"] = chk(
            p_or_f(not has_params),
            "Low",
            f"Query parameters: {'present — ' + parsed_url.query[:80] if has_params else 'not present in this URL'}.",
            "Use canonical tags or parameter handling in Search Console to prevent duplicate content from URL parameters."
        )

        # Redirect chains
        COMPUTED["Redirect Chains"] = chk(
            p_or_f(len(redirect_chain) <= 1),
            "Medium",
            (f"{len(redirect_chain)} redirect(s) detected: {[r['url'] for r in redirect_chain[:3]]}." if redirect_chain
             else "No redirects detected — direct 200 response."),
            "Reduce redirect chains to a single 301. Multiple hops slow crawling and lose link equity."
        )

        # 404 error page — we can't verify without navigating to a non-existent page
        COMPUTED["404 Error Page"] = chk(
            "Fail", "Low",
            "Custom 404 page verification requires navigating to a non-existent URL — cannot auto-verify from homepage.",
            "Create a custom 404 error page with navigation links back to key pages."
        )

        # ── Build skeleton ────────────────────────────────────────────────
        CHECKLIST_KEYS = {
            "technical_seo":          ["XML Sitemap Presence", "Robots.txt Configuration", "Canonical Tags", "Hreflang Implementation", "404 Error Page", "Redirect Chains", "HTTPS Enforced", "Crawlability via Robots.txt"],
            "on_page_seo":            ["Title Tags (All Pages)", "Meta Descriptions (All Pages)", "H1 Tag Per Page", "H2/H3 Heading Hierarchy", "Keyword in Title", "Duplicate Title Detection", "Duplicate Meta Description Detection", "Page Word Count"],
            "url_audit":              ["URL Slug Structure", "URL Length", "URL Lowercase Consistency", "Trailing Slash Consistency", "Dynamic Parameters in URL"],
            "internal_external_links":["Internal Links Present", "Link Title Attributes", "Link Anchor Text Quality", "Image Link Alt Text", "Broken Internal Links (404)", "Orphan Pages", "External Links (Nofollow Policy)"],
            "image_seo":              ["Image Alt Text", "Image Title Attributes", "Image Filename Descriptive", "Image File Size", "WebP/Next-Gen Format", "Lazy Loading"],
            "performance":            ["Core Web Vitals - LCP", "Core Web Vitals - FID/INP", "Core Web Vitals - CLS", "Time to First Byte (TTFB)", "Minified CSS", "Minified JavaScript", "Browser Caching Headers", "Gzip/Brotli Compression", "CDN Usage"],
            "mobile_seo":             ["Viewport Meta Tag", "Mobile Responsive Design", "Touch Target Size", "Font Size Legibility on Mobile", "Mobile Page Speed"],
            "accessibility":          ["Image Alt Text (Accessibility)", "Color Contrast Ratio", "ARIA Labels on Buttons", "Keyboard Navigability", "Form Labels", "Focus Indicators", "Skip Navigation Link"],
            "structured_data":        ["Schema.org Markup Present", "Open Graph (OG) Tags", "Twitter Card Tags", "Breadcrumb Schema", "Organization Schema", "FAQ/HowTo Schema (if applicable)"],
            "javascript_seo":         ["JS Rendering of Critical Content", "Meta Tags Rendered in JS", "Page Indexable Without JS", "Inline JS Blocking Render"],
            "robots_sitemap":         ["Sitemap in Robots.txt", "Sitemap URL Valid", "Sitemap Last Modified", "Pages Blocked in Robots.txt"],
            "csp_audit":              ["Content-Security-Policy Header", "X-Frame-Options Header", "X-Content-Type-Options Header", "CSP Unsafe-Inline Check", "CSP Wildcard Check"],
            "security_headers":       ["Strict-Transport-Security (HSTS)", "Referrer-Policy", "Permissions-Policy", "X-XSS-Protection", "Server Header Disclosure"],
            "https_mixed_content":    ["HTTPS Certificate Valid", "Mixed Content (HTTP resources on HTTPS page)", "HTTP to HTTPS Redirect", "Secure Cookies"],
            "content_quality":        ["Thin Content Pages", "Duplicate Content", "Readability Score", "Keyword Density", "Content Freshness"],
        }

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

        # Build rich context string for AI
        og_summary = "; ".join(f"{k}={repr(str(v)[:60])}" for k, v in og.items() if v) or "None"
        tw_summary = "; ".join(f"{k}={repr(str(v)[:60])}" for k, v in twitter.items() if v) or "None"
        hdr_summary = "; ".join(f"{k}={repr(str(v)[:80])}" for k, v in sec_headers.items() if v) or "None"

        crawl_context = f"""REAL EXTRACTION DATA (do NOT contradict this):
- URL: {final_url}
- HTTP Status: {status_code} ({ex.get('status_label', '')})
- HTTPS: {is_https}
- Redirects: {len(redirect_chain)} ({redirect_chain})
- Response time: {response_time_ms}ms
- HTML size: {ex.get('html_size_bytes', 0)} bytes
- Title: {repr(title)} ({title_chars} chars) | Issues: {title_issues}
- Meta description: {repr(str(meta_desc)[:160]) if meta_desc else 'MISSING'} ({meta_desc_chars} chars) | Issues: {meta_desc_issues}
- Meta robots: {repr(meta_robots)}
- Canonical: {repr(canonical)} | Issues: {can_issues}
- Viewport: {repr(viewport)}
- Lang: {repr(lang)}
- Hreflang tags: {len(hreflang)}
- Charset: {repr(charset)}
- H1s ({len(h1s)}): {h1s[:3]}
- H2s ({len(h2s)}): {[t[:60] for t in h2s[:5]]}
- Heading issues: {heading_issues}
- Total images: {total_imgs} | Missing alt: {missing_alt} | Empty alt: {empty_alt}
- Internal links: {len(internal_links)} | External links: {len(external_links)}
- Link issues: {link_issues}
- Open Graph: {og_summary}
- OG issues: {og_issues}
- Twitter Cards: {tw_summary}
- Twitter issues: {twitter_issues}
- Schema.org: {has_schema} | Types: {schema_types}
- Word count: {word_count}
- robots.txt: present={has_robots}, status={robots_status}, disallow_all={disallow_all}
  Disallow rules ({len(robots_txt.get('disallow_rules', []))}): {[r['path'] for r in robots_txt.get('disallow_rules', [])[:5]]}
  Sitemap declarations: {robots_txt.get('sitemap_declarations', [])}
- Sitemaps checked: {[(s.get('url'), s.get('status_code'), s.get('url_count')) for s in sitemaps]}
- Security headers: {hdr_summary}"""

        # ── Phase 3: AI fills summary & high-level insights ──────────────
        prompt = f"""You are an Enterprise Technical SEO Expert performing a real-data-backed audit.

Target Website: {url}
Scan Depth: {depth}

{crawl_context}

Return a valid JSON object with the executive summary and recommendations based on the REAL data:
{{
  "executive_summary": {{
    "overall_health_score": <int 0-100 based on real data>,
    "technical_seo_score": <int 0-100>,
    "on_page_seo_score": <int 0-100>,
    "url_structure_score": <int 0-100>,
    "internal_linking_score": <int 0-100>,
    "image_seo_score": <int 0-100>,
    "performance_score": <int 0-100>,
    "core_web_vitals_score": <int 0-100>,
    "mobile_seo_score": <int 0-100>,
    "accessibility_score": <int 0-100>,
    "schema_quality_score": <int 0-100>,
    "security_headers_score": <int 0-100>,
    "csp_security_score": <int 0-100>,
    "https_security_score": <int 0-100>,
    "content_quality_score": <int 0-100>,
    "top_critical_issues": ["<concrete critical issue 1>", "<concrete critical issue 2>", "<concrete critical issue 3>"],
    "top_high_priority_issues": ["<concrete high priority issue 1>", "<concrete high priority issue 2>"],
    "top_quick_wins": ["<concrete quick win 1>", "<concrete quick win 2>", "<concrete quick win 3>"],
    "positive_findings": ["<positive finding 1>", "<positive finding 2>"],
    "risks": ["<risk 1>", "<risk 2>"],
    "recommended_roadmap": {{"immediate": [], "short_term": [], "long_term": []}}
  }},
  "actionable_recommendations": []
}}

OUTPUT ONLY valid JSON. No markdown, no backticks, no explanation."""

        try:
            text, mname = await asyncio.to_thread(self._try, prompt, None, "flash")
            data = _parse(text)
            if not isinstance(data, dict):
                data = {}
            for wrapper_key in ("seo_report", "report", "audit", "seo_audit", "data", "result"):
                if isinstance(data.get(wrapper_key), dict):
                    data = data[wrapper_key]
                    break
            for alt_key in ("executiveSummary", "summary", "audit_summary", "overview", "exec_summary"):
                if alt_key in data and "executive_summary" not in data:
                    data["executive_summary"] = data.pop(alt_key)
            if "overall_health_score" in data and "executive_summary" not in data:
                data["executive_summary"] = {
                    k: v for k, v in data.items() if k not in skeleton_phases and k != "phases"
                }
        except Exception as e:
            print(f"[SEO Audit] AI/Parse fallback: {e}")
            mname = "Deterministic Engine (AI offline)"
            data = {
                "executive_summary": {
                    "overall_health_score": 0,
                    "top_critical_issues": ["AI analysis unavailable — Python-computed checks are still 100% accurate."],
                    "top_high_priority_issues": [], "top_quick_wins": [],
                    "positive_findings": [], "risks": [],
                    "recommended_roadmap": {"immediate": [], "short_term": [], "long_term": []}
                },
                "actionable_recommendations": ["Deterministic checks completed successfully. Ensure Gemini API quota is available for full AI insights."]
            }
            for key, val in skeleton_phases.items():
                data[key] = val

        # ── Phase 4: Ensure all skeleton phases exist and Python-computed checks override AI
        if "phases" in data and isinstance(data["phases"], dict):
            for pk, pv in data["phases"].items():
                data[pk] = pv

        for key, val in skeleton_phases.items():
            if key not in data or not isinstance(data[key], dict) or "findings" not in data[key]:
                data[key] = val

        all_findings = []
        phase_scores = {}
        for phase_key, phase_data in data.items():
            if not isinstance(phase_data, dict) or "findings" not in phase_data:
                continue
            p_findings = phase_data["findings"]
            for finding in p_findings:
                cname = finding.get("check_name", "")
                if cname in COMPUTED:
                    finding.update(COMPUTED[cname])
                # Patch any remaining FILL_IN leftovers
                if finding.get("status") in ("FILL_IN", None, ""):
                    finding["status"] = "Fail"
                if finding.get("severity") in ("FILL_IN", None, ""):
                    finding["severity"] = "Medium"
                if finding.get("description") in ("FILL_IN", None, ""):
                    finding["description"] = "Could not evaluate this check automatically."
                if finding.get("recommendation") in ("FILL_IN", None, ""):
                    finding["recommendation"] = "Perform manual verification of this check."
            all_findings.extend(p_findings)
            p_pass = sum(1 for f in p_findings if (f.get("status") or "").lower() == "pass")
            p_tot = len(p_findings)
            if p_tot > 0:
                phase_scores[phase_key] = round((p_pass / p_tot) * 100)

        # ── Phase 4b: Ensure executive_summary ALWAYS exists and is fully populated ──
        if not isinstance(data.get("executive_summary"), dict):
            data["executive_summary"] = {}

        ex_sum = data["executive_summary"]
        total_checks = len(all_findings)
        total_pass = sum(1 for f in all_findings if (f.get("status") or "").lower() == "pass")
        calc_health = round((total_pass / max(1, total_checks)) * 100) if total_checks else 70

        if not isinstance(ex_sum.get("overall_health_score"), (int, float)) or ex_sum["overall_health_score"] <= 0:
            ex_sum["overall_health_score"] = calc_health
        else:
            ex_sum["overall_health_score"] = int(ex_sum["overall_health_score"])

        score_mappings = [
            ("technical_seo_score", "technical_seo"),
            ("on_page_seo_score", "on_page_seo"),
            ("url_structure_score", "url_audit"),
            ("internal_linking_score", "internal_external_links"),
            ("image_seo_score", "image_seo"),
            ("performance_score", "performance"),
            ("core_web_vitals_score", "performance"),
            ("mobile_seo_score", "mobile_seo"),
            ("accessibility_score", "accessibility"),
            ("schema_quality_score", "structured_data"),
            ("security_headers_score", "security_headers"),
            ("csp_security_score", "csp_audit"),
            ("https_security_score", "https_mixed_content"),
            ("content_quality_score", "content_quality"),
        ]
        for score_key, phase_k in score_mappings:
            if not isinstance(ex_sum.get(score_key), (int, float)):
                ex_sum[score_key] = phase_scores.get(phase_k, calc_health)
            else:
                ex_sum[score_key] = int(ex_sum[score_key])

        critical_fails = [
            f"{f.get('check_name')}: {f.get('description', '')}"
            for f in all_findings
            if (f.get("status") or "").lower() == "fail" and (f.get("severity") or "").lower() in ("critical", "high")
        ]
        med_fails = [
            f"{f.get('check_name')}: {f.get('description', '')}"
            for f in all_findings
            if (f.get("status") or "").lower() == "fail" and (f.get("severity") or "").lower() == "medium"
        ]
        passes = [
            f"{f.get('check_name')}: {f.get('description', '')}"
            for f in all_findings
            if (f.get("status") or "").lower() == "pass"
        ]

        if not ex_sum.get("top_critical_issues") or not isinstance(ex_sum["top_critical_issues"], list):
            ex_sum["top_critical_issues"] = critical_fails[:3] or ["No critical issues detected."]

        if not ex_sum.get("top_high_priority_issues") or not isinstance(ex_sum["top_high_priority_issues"], list):
            ex_sum["top_high_priority_issues"] = med_fails[:3] or ["Review phase findings for minor recommendations."]

        if not ex_sum.get("top_quick_wins") or not isinstance(ex_sum["top_quick_wins"], list):
            qw = [f.get("recommendation") for f in all_findings if (f.get("status") or "").lower() == "fail" and f.get("recommendation") and f.get("recommendation") != "No action needed."]
            ex_sum["top_quick_wins"] = qw[:3] or ["Maintain existing SEO best practices."]

        if not ex_sum.get("positive_findings") or not isinstance(ex_sum["positive_findings"], list):
            ex_sum["positive_findings"] = passes[:3] or ["Website is online and accessible."]

        if not ex_sum.get("risks") or not isinstance(ex_sum["risks"], list):
            ex_sum["risks"] = [f"SEO/Security Risk: {c}" for c in critical_fails[:2]] or ["Ensure continuous monitoring."]

        if not isinstance(ex_sum.get("recommended_roadmap"), dict):
            ex_sum["recommended_roadmap"] = {
                "immediate": [f.get("recommendation") for f in all_findings if (f.get("severity") or "").lower() in ("critical", "high") and (f.get("status") or "").lower() == "fail"][:3],
                "short_term": [f.get("recommendation") for f in all_findings if (f.get("severity") or "").lower() == "medium" and (f.get("status") or "").lower() == "fail"][:3],
                "long_term": ["Implement Core Web Vitals optimizations and comprehensive schema markup."],
            }
        else:
            for road_k in ("immediate", "short_term", "long_term"):
                if not isinstance(ex_sum["recommended_roadmap"].get(road_k), list):
                    ex_sum["recommended_roadmap"][road_k] = []

        # ── Phase 5: Attach full raw extraction data ──────────────────────
        data["raw_extraction"] = {
            "url": final_url,
            "status_code": status_code,
            "title": title,
            "title_char_count": title_chars,
            "title_issues": title_issues,
            "meta_description": meta_desc,
            "meta_description_char_count": meta_desc_chars,
            "meta_description_issues": meta_desc_issues,
            "meta_robots": meta_robots,
            "meta_googlebot": ex.get("meta_googlebot"),
            "canonical": canonical,
            "canonical_issues": can_issues,
            "viewport": viewport,
            "lang": lang,
            "charset": charset,
            "hreflang": hreflang,
            "headings": headings,
            "heading_issues": heading_issues,
            "og": og,
            "og_issues": og_issues,
            "twitter": twitter,
            "twitter_issues": twitter_issues,
            "has_schema": has_schema,
            "schema_types": schema_types,
            # Images summary and real data
            "total_images": total_imgs,
            "images_missing_alt": missing_alt,
            "images_empty_alt": empty_alt,
            "images_with_alt": with_alt,
            "images_missing_title": missing_img_title,
            "images_empty_title": empty_img_title,
            "images_with_title": with_img_title,
            "images": images[:250],
            "image_stats": img_stats,
            # Links summary and real data
            "total_links": total_links,
            "internal_links_count": len(internal_links),
            "external_links_count": len(external_links),
            "links_missing_title": links_missing_title,
            "links_empty_title": links_empty_title,
            "links_with_title": links_with_title,
            "links_empty_anchor": links_empty_anchor,
            "image_links_count": img_links_count,
            "image_links_missing_alt": img_links_missing_alt,
            "image_links_with_alt": img_links_with_alt,
            "internal_links": internal_links[:250],
            "external_links": external_links[:150],
            "link_stats": link_stats,
            "word_count": word_count,
            "redirect_chain": redirect_chain,
            "response_time_ms": response_time_ms,
            "is_https": is_https,
            "security_headers": sec_headers,
            "robots_txt": robots_txt,
            "sitemaps": sitemaps,
            "fetch_error": fetch_error,
        }

        # Multi-page crawl support if depth is deep or paranoid
        scanned_list = [
            {
                "url": final_url,
                "status_code": status_code,
                "title": title or "(missing)",
                "seo_issues": (
                    title_issues[:2] +
                    meta_desc_issues[:2] +
                    heading_issues[:2] +
                    image_issues[:2]
                )[:6],
            }
        ]
        if crawl_task:
            try:
                crawled_pages = await asyncio.wait_for(crawl_task, timeout=12.0)
                if crawled_pages and len(crawled_pages) > 1:
                    scanned_list = [
                        {
                            "url": p.get("url", ""),
                            "status_code": p.get("status_code", 200),
                            "title": p.get("title") or "(missing)",
                            "seo_issues": p.get("issues", []) if "issues" in p else (
                                (["Missing Title"] if not p.get("title") else []) +
                                (["Missing Meta Description"] if not p.get("description") else (
                                    ["Short Meta Description (<150 chars)"] if len(p.get("description", "")) < 150 else []
                                )) +
                                (["No H1 Tag"] if p.get("h1_count", 0) == 0 else []) +
                                ([f"{p.get('img_missing_alt', 0)} Images Missing Alt"] if p.get("img_missing_alt", 0) > 0 else [])
                            )[:4],
                        }
                        for p in crawled_pages
                    ]
            except Exception as e:
                print(f"[SEO Audit] Crawl error for {depth}: {e}")

        data["pages_scanned"] = scanned_list
        data["pages_count"] = len(scanned_list)

        data["scan_id"]     = str(uuid.uuid4())
        data["url"]         = url
        data["depth"]       = depth
        data["scanned_at"]  = datetime.now().isoformat()
        data["model_used"]  = MODEL_LABELS.get(mname, mname)
        return data

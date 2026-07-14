"""QAForge Gemini — Data Models v5.0"""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel


class TestCase(BaseModel):
    id: str                 # Test Case ID
    name: str               # Scenario Title
    category: str = "functional"
    priority: str = "medium"
    severity: str = "major"  # Severity
    description: str = ""   # Scenario Description
    preconditions: List[str] = [] # Pre-Condition
    test_input: str = ""    # Input
    steps: List[Dict[str, Any]] = [] # Test steps
    expected_result: str = ""
    actual_result: str = "" # Actual Result (populated on execution)
    status: str = "pending" # Status (pass, fail, skip, pending)
    browser: str = ""       # Browser (populated on execution)
    screen: str = ""        # Screen (populated on execution)
    created_by: str = "AI Engine" # Created By
    tags: List[str] = []
    model_used: str = ""


class TestSuite(BaseModel):
    id: str
    name: str
    description: str = ""
    app_type: str = "web"
    source: str = ""
    source_url: Optional[str] = None
    created_at: str = ""
    model_used: str = ""
    range_min: int = 0
    range_max: int = 0
    tests: List[TestCase] = []


class RangeConfig(BaseModel):
    min_tests: int = 10
    max_tests: int = 20
    critical_count: Optional[int] = None
    high_count: Optional[int] = None
    medium_count: Optional[int] = None
    low_count: Optional[int] = None


class FormatConfig(BaseModel):
    format: str = "detailed"            # detailed | bdd | exploratory | checklist
    fields: List[str] = []
    instructions: Optional[str] = None  # custom AI formatting instructions


class GenerateRequest(BaseModel):
    url: Optional[str] = None
    description: Optional[str] = None
    app_type: str = "web"
    # CRITICAL: only generate tests for selected focus areas
    focus_areas: Optional[List[str]] = []
    format_config: Optional[FormatConfig] = None
    model: Optional[str] = None
    range_config: Optional[RangeConfig] = None
    is_multi_agent: bool = False
    agents: Optional[List[str]] = []
    depth: Optional[str] = "standard"


class ExecuteRequest(BaseModel):
    environment: str = "staging"
    base_url: Optional[str] = None


class BugScanRequest(BaseModel):
    app_type: str = "web"
    description: Optional[str] = None
    url: Optional[str] = None
    depth: Optional[str] = "standard"
    categories: Optional[List[str]] = []


class AppConfig(BaseModel):
    api_key_1: Optional[str] = None
    api_key_2: Optional[str] = None
    api_key_3: Optional[str] = None
    api_key_4: Optional[str] = None
    default_model: Optional[str] = None
    max_tests: Optional[int] = None

class BlogPost(BaseModel):
    id: str
    title: str
    summary: str
    category: str
    date: str
    read_time: str
    image_url: Optional[str] = None


class ProxyRequest(BaseModel):
    url: str
    method: str = "GET"
    headers: Optional[Dict[str, str]] = {}
    body: Optional[str] = None


class ApiGenerateRequest(BaseModel):
    url: str
    method: str
    request_headers: Optional[Dict[str, str]] = {}
    request_body: Optional[str] = None
    response_status: int
    response_headers: Optional[Dict[str, str]] = {}
    response_body: Optional[Any] = None
    focus_areas: Optional[List[str]] = ["api", "security", "negative"]
    range_config: Optional[RangeConfig] = None
    format_config: Optional[FormatConfig] = None
    depth: str = "standard"


class BugFormatRequest(BaseModel):
    raw_text: str
    app_type: str = "web"
    severity: Optional[str] = None          # pre-set severity hint
    environment: Optional[str] = None       # e.g. staging, production
    module: Optional[str] = None            # ui, api, cart, checkout, mobile, admin, etc.

class SeoAuditRequest(BaseModel):
    url: str
    depth: Optional[str] = "standard"


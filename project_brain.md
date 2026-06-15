# Project Overview
QAForge is a comprehensive testing platform designed to streamline quality assurance workflows. It provides tools for both manual and automated testing, integrating seamlessly into existing development pipelines. The platform aims to enhance test coverage, reduce bugs in production, and improve overall software reliability.

# Project Structure

- `backend/`: API services and AI backend
  - `__init__.py` - [New File]
  - `ai_engine.py` - Gemini AI integration (4 specialized models, prompt engineering)
  - `antivirus.py` - Security file scanner (simulated file safety analysis)
  - `brain_watcher.py` - [New File]
  - `main.py` - FastAPI application (routes, middleware, configuration)
  - `models.py` - Pydantic data schemas (TestPlan, TestCase, ExecResult)
  - `report_gen.py` - Report builder (generates Excel with charts, HTML, JSON)
  - `test_dummy_server.py` - Mock HTTP endpoint for testing proxy setups
  - `test_executor.py` - Test case execution engine (simulations and runs)
  - `test_proxy.py` - HTTP requests proxy executor (handles routing client URLs)
- `frontend/`: Single Page Application (SPA) web client
  - `app.html` - Main QA application dashboard and UI
  - `assets/akhil.jpg` - [New File]
  - `assets/app-debug.apk` - [New File]
  - `assets/blog_ai.png` - [New File]
  - `assets/blog_automation.png` - [New File]
  - `assets/blog_manual_ai.png` - [New File]
  - `assets/blog_security.png` - [New File]
  - `assets/icon-128.png` - [New File]
  - `assets/icon-144.png` - [New File]
  - `assets/icon-152.png` - [New File]
  - `assets/icon-192.png` - [New File]
  - `assets/icon-384.png` - [New File]
  - `assets/icon-512.png` - [New File]
  - `assets/icon-72.png` - [New File]
  - `assets/icon-96.png` - [New File]
  - `assets/icon-maskable-192.png` - [New File]
  - `assets/icon-maskable-512.png` - [New File]
  - `assets/icon.svg` - [New File]
  - `blog.html` - [New File]
  - `css/app.css` - Main dashboard and component stylesheet
  - `fix_config.py` - [New File]
  - `fix_themes.py` - [New File]
  - `index.html` - App landing page (with particle engine)
  - `js/api-tester.js` - Web UI client script for API test workspace
  - `js/app.js` - Application core logic, API integration, UI handlers
  - `js/landing.js` - Landing page animation & particle system code
  - `js/perf-tester.js` - Performance testing module scripts
  - `js/test.js` - Minor JS scripting utility
  - `manifest.json` - PWA configuration settings
  - `offline.html` - Service worker offline fallback page
  - `patch_ui.py` - [New File]
  - `sw.js` - Service worker file caching logic
  - `update_css.py` - [New File]
  - `update_ui.py` - [New File]
- `scripts/`: Development scripts
  - `scale_css.py` - CSS stylesheet responsive scaler
- `reports/`: Output directory for generated HTML, Excel, and JSON reports
  - `blog_debug.log` - [New File]
  - `blog_error.log` - [New File]
  - `daily_blogs.json` - [New File]
  - `quarantine/875578fa_report_73184f0e_20260324_210823.xlsx` - [New File]
  - `quarantine/f5b958f9_genai_init.py` - [New File]
  - `report_73184f0e_20260324_210823.xlsx` - [New File]
  - `scan_087023eb.json` - [New File]
  - `suite_fdc2be8c.json` - [New File]
- Root files:
  - `README.md` - Setup and execution guide
  - `debug_swarm.py` - Debug script to test multi-model swarms
  - `error.log` - [New File]
  - `genai_init.py` - Quick setup initializer for Google Gemini API key
  - `package-lock.json` - [New File]
  - `qaforge_launcher.py` - Interactive/standalone server launcher wrapper
  - `requirements.txt` - Python project dependencies
  - `run.py` - Standard launcher script to run backend server
  - `start.sh` - Simple startup bash shell script


# Objectives
- Unify manual and automated testing processes.
- Provide real-time analytics and reporting on test execution.
- Integrate with popular CI/CD tools for continuous testing.
- Enable client-side performance testing with visual dashboards.
- Facilitate easy creation and management of test cases.
- Reduce time-to-market by accelerating the QA phase.
- Ensure high availability and scalability of the testing infrastructure.

# Target Users
- Quality Assurance (QA) Engineers
- Software Developers
- Product Managers
- DevOps Engineers
- Automation Test Engineers

# Core Features
1. Test Case Management (Creation, Execution, Tracking)
2. Native Client-Side Performance Testing Module
3. Real-time Analytics and Custom Dashboards
4. CI/CD Pipeline Integration (Jenkins, GitHub Actions, etc.)
5. Automated Bug Tracking and Reporting
6. Proxy-based HTTP Request Execution
7. Test History Persistence and Result Exports

# Constraints
- Budget: Strict adherence to the allocated development and infrastructure budget.
- Tech: Must utilize modern web technologies and ensure cross-browser compatibility.
- Timeline: Core features must be delivered within the upcoming two quarters.

# Architecture Notes
- Modular, component-based frontend architecture for maintainability.
- Scalable backend microservices to handle concurrent testing loads.
- Client-side execution engine for performance testing to minimize server costs.
- Secure API endpoints with robust authentication and authorization.

# Open Questions
- What are the specific performance targets for the client-side testing engine?
- Which third-party integrations should be prioritized in the first release?
- How will large volumes of test history data be efficiently archived and retrieved?

import os
import re
import time
import threading
from pathlib import Path

def get_project_root() -> Path:
    return Path(__file__).parent.parent

def scan_files(root: Path):
    ignore_dirs = {'.git', '.gemini', '__pycache__', 'node_modules', '.venv', 'venv'}
    ignore_files = {'.DS_Store', 'project_brain.md'}
    
    root_files = []
    category_files = {
        'backend': [],
        'frontend': [],
        'scripts': [],
        'reports': []
    }
    
    # Scan root files
    try:
        for entry in os.scandir(root):
            if entry.is_file() and not entry.name.startswith('.'):
                if entry.name not in ignore_files:
                    root_files.append(entry.name)
    except Exception as e:
        print(f"[Brain Watcher] Error scanning root files: {e}")
        
    # Scan categories recursively
    for folder in category_files.keys():
        folder_path = root / folder
        if not folder_path.exists():
            continue
        try:
            for r, dirs, files in os.walk(folder_path):
                dirs[:] = [d for d in dirs if d not in ignore_dirs and not d.startswith('.')]
                for f in files:
                    if f not in ignore_files and not f.startswith('.') and not f.endswith('.pyc'):
                        full_path = Path(r) / f
                        rel_path = full_path.relative_to(folder_path)
                        category_files[folder].append(str(rel_path))
        except Exception as e:
            print(f"[Brain Watcher] Error scanning category {folder}: {e}")
            
    # Sort everything for stability
    root_files.sort()
    for folder in category_files:
        category_files[folder].sort()
        
    return root_files, category_files

def update_project_brain():
    root = get_project_root()
    brain_path = root / 'project_brain.md'
    if not brain_path.exists():
        return

    try:
        content = brain_path.read_text(encoding='utf-8')
    except Exception as e:
        print(f"[Brain Watcher] Error reading project_brain.md: {e}")
        return

    # Split by section headers
    parts = re.split(r'^(#\s+.*)$', content, flags=re.MULTILINE)
    
    structure_index = -1
    for i, part in enumerate(parts):
        if part.strip() == '# Project Structure':
            structure_index = i + 1
            break
            
    if structure_index == -1:
        print("[Brain Watcher] '# Project Structure' section not found in project_brain.md")
        return

    old_structure = parts[structure_index]
    
    # Parse existing descriptions
    desc_map = {}
    for line in old_structure.splitlines():
        # Match - `key` - description or - `key`: description
        m = re.search(r'^\s*-\s*`([^`]+)`\s*(?:-|:)\s*(.*)$', line)
        if m:
            key = m.group(1).strip()
            desc = m.group(2).strip()
            desc_map[key] = desc
        else:
            # Support lines like "  - UI scripts: update_ui.py..."
            # Check if there is a description in parenthesis at the end
            m_alt = re.search(r'^\s*-\s*([^:]+):\s*(.*)$', line)
            if m_alt:
                key = m_alt.group(1).strip()
                desc = m_alt.group(2).strip()
                desc_map[key] = desc

    # Scan current file system state
    root_files, category_files = scan_files(root)
    
    # Default descriptions for category headings
    defaults = {
        'backend/': 'API services and AI backend',
        'frontend/': 'Single Page Application (SPA) web client',
        'scripts/': 'Development scripts',
        'reports/': 'Output directory for generated HTML, Excel, and JSON reports'
    }

    # Rebuild Project Structure markdown content
    new_structure_lines = ["\n"]
    
    # 1. Folders categories
    for folder in ['backend', 'frontend', 'scripts', 'reports']:
        heading_key = f"{folder}/"
        heading_desc = desc_map.get(heading_key, defaults.get(heading_key, ""))
        new_structure_lines.append(f"- `{heading_key}`: {heading_desc}")
        
        # Add files in this folder
        for file_rel in category_files[folder]:
            # Look up by relative path, filename, or alternative keys
            desc = desc_map.get(file_rel, desc_map.get(os.path.basename(file_rel), "[New File]"))
            new_structure_lines.append(f"  - `{file_rel}` - {desc}")
            
    # 2. Root files
    new_structure_lines.append("- Root files:")
    for rf in root_files:
        desc = desc_map.get(rf, "[New File]")
        new_structure_lines.append(f"  - `{rf}` - {desc}")
        
    new_structure_lines.append("\n\n")
    
    new_structure = "\n".join(new_structure_lines)
    
    # If content has not changed, don't write to avoid triggering file change loops
    if old_structure.strip() == new_structure.strip():
        return
        
    parts[structure_index] = new_structure
    updated_content = "".join(parts)
    
    try:
        brain_path.write_text(updated_content, encoding='utf-8')
        print("[Brain Watcher] project_brain.md has been automatically updated with directory changes.")
    except Exception as e:
        print(f"[Brain Watcher] Error writing updated project_brain.md: {e}")

def get_dir_fingerprint(root: Path):
    # Return a hashable representation of the directory structure
    root_files, category_files = scan_files(root)
    return (tuple(root_files), tuple((k, tuple(v)) for k, v in category_files.items()))

def start_brain_watcher():
    def watch():
        print("[Brain Watcher] Started background project structure monitor.")
        root = get_project_root()
        last_fingerprint = None
        while True:
            try:
                current_fingerprint = get_dir_fingerprint(root)
                if current_fingerprint != last_fingerprint:
                    update_project_brain()
                    last_fingerprint = current_fingerprint
            except Exception as e:
                print(f"[Brain Watcher] Watch error: {e}")
            time.sleep(3)

    t = threading.Thread(target=watch, daemon=True)
    t.start()

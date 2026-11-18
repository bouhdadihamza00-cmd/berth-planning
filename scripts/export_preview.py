"""Build a single-file, server-free preview from the current operational database."""
import base64
import json
import mimetypes
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.main import stats
from backend.store import PERMISSIONS


def build(output):
    output = Path(output).resolve()
    if ROOT.resolve() not in output.parents or "exports" not in output.relative_to(ROOT).parts:
        raise ValueError("Private previews must be written under the ignored exports/ directory")
    output.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(f'file:{ROOT / "data/portops.db"}?mode=ro', uri=True)
    c.row_factory = sqlite3.Row
    ports = [dict(json.loads(r['data']), id=r['id'], org_id=r['org_id'], revision=r['revision']) for r in c.execute('SELECT * FROM ports')]
    snapshots = {}
    for p in ports:
        p['integration'] = {k: v for k, v in p.get('integration', {}).items() if k in ['enabled', 'provider', 'service', 'refresh_seconds', 'freshness_minutes', 'radius_km']}
        groups = {}
        for r in c.execute('SELECT * FROM records WHERE port_id=?', (p['id'],)):
            # Only operational records used by the preview. No uploads, credentials, users or audit payloads.
            if r['kind'] not in ['berths','equipment','calls','alerts','delays','drafts','versions','notifications','scenarios','zones','source_plans','source_issues']:
                continue
            groups.setdefault(r['kind'], []).append(dict(json.loads(r['data']), id=r['id'], revision=r['revision']))
        for kind in ['berths','equipment','calls','alerts','delays','drafts','versions','notifications','scenarios','zones','source_plans','source_issues']:
            groups.setdefault(kind, [])
        snapshots[p['id']] = dict(port=p, stats=stats(c,p['id']), **groups, ais={'positions':[], 'enabled':False, 'provider':'preview','status':'Offline preview','message':'Live AIS requires the running application.'})
    c.close()
    payload = dict(ports=ports, snapshots=snapshots, permissions=PERMISSIONS)
    front = ROOT / 'frontend'
    html = (front / 'index.html').read_text()
    def css(match):
        name = match[1].split('?')[0].replace('/assets/', '').lstrip('/')
        file = front / name
        body = file.read_text()
        def asset(m):
            target = file.parent / m[1]
            if not target.is_file(): return m[0]
            return 'url(data:' + (mimetypes.guess_type(target)[0] or 'application/octet-stream') + ';base64,' + base64.b64encode(target.read_bytes()).decode() + ')'
        body = re.sub(r'url\([\'"]?([^\)\'" ]+)[\'"]?\)', asset, body)
        return '<style>' + body + '</style>'
    html = re.sub(r'<link rel="stylesheet" href="([^"]+)"\s*/>', css, html)
    html = re.sub(r'<script[^>]+src="[^"]+"[^>]*></script>', '', html)
    scripts = []
    for name in ['leaflet.js','leaflet.draw.js','lucide.js']:
        scripts.append((front/'vendor'/name).read_text())
    scripts.append('window.PORTSIDE_PREVIEW_DATA=' + json.dumps(payload, ensure_ascii=False) + ';')
    scripts.append((ROOT/'scripts/preview-runtime.js').read_text())
    # Preserve module scope using a tiny synchronous module registry. No fetch or file URL imports.
    scripts.append('const __modules = {};')
    seen = set()
    def module(name):
        if name in seen: return
        source = (front/name).read_text()
        deps = re.findall(r'import\s*\{([\s\S]*?)\}\s*from\s*[\'"]\./([^\'"?]+)(?:\?[^\'"]*)?[\'"];', source)
        for _, dep in deps: module(dep)
        source = re.sub(r'import\s*\{([\s\S]*?)\}\s*from\s*[\'"]\./([^\'"?]+)(?:\?[^\'"]*)?[\'"];', lambda m:'const {' + m[1] + '} = __modules[' + json.dumps(m[2]) + '];', source)
        exports = re.findall(r'export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)', source)
        source = re.sub(r'\bexport\s+', '', source)
        scripts.append('__modules['+json.dumps(name)+'] = ('+('async ' if name == 'app.js' else '')+'() => {\n'+source+'\nreturn {'+','.join(exports)+'};\n})();')
        seen.add(name)
    module('app.js')
    html = html.replace('</body>', '\n'.join('<script>'+s.replace('</script', '<\\/script')+'</script>' for s in scripts) + '\n</body>')
    output.write_text(html)
    print(f'{output}: {output.stat().st_size:,} bytes; {len(ports)} ports, {sum(len(s["calls"]) for s in snapshots.values())} vessel calls')

if __name__ == '__main__':
    build(Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'exports/Portside-preview.html')

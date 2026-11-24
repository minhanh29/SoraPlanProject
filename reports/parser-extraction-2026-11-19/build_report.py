"""Build an offline report from existing logs and local parser source. No API calls."""
import ast
import base64
import hashlib
import html
import json
import re
import statistics
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SOURCE = ROOT / 'backend/plan_parsing_worker/app/services/parser_service.py'
LOGS = Path('/tmp/soraplan-parser-logs.json')
source = SOURCE.read_text()
constants = {}
for node in ast.parse(source).body:
    if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
        for target in node.targets:
            if isinstance(target, ast.Name):
                constants[target.id] = node.value.value

def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))

def ms(a, b):
    return round((timestamp(b) - timestamp(a)).total_seconds() * 1000, 3)

entries = sorted(json.loads(LOGS.read_text()), key=lambda e: e['timestamp'])
runs = []
current = None
request = None
for entry in entries:
    text = entry.get('textPayload', '')
    at = entry['timestamp']
    http = entry.get('httpRequest', {})
    if http.get('requestUrl', '').endswith('/tasks/parse-plan'):
        request = {'at': at, 'latency_ms': float(http['latency'].rstrip('s')) * 1000, 'cold': False}
    if request and 'Starting new instance.' in text:
        request['cold'] = True
    if 'Received parse plan task for jobId=' in text:
        current = {'run': len(runs) + 1, 'received_at': at, 'request': dict(request or {}), 'calls': [], 'reviews': []}
        current['local_time'] = timestamp(at).astimezone(timezone(timedelta(hours=7))).strftime('%d %b · %H:%M ICT')
        runs.append(current)
    if current is None:
        continue
    if 'Downloading plan image from signedUrl' in text:
        current['download_at'] = at
    if 'Pre-parsing step:' in text:
        current['download_end_at'] = at
    if 'Cropped upload for job' in text:
        current['corners_skipped'] = True
    match = re.search(r'Loaded floor plan image: (\d+)x(\d+) \((\w+), (\d+) bytes\)', text)
    if match:
        current['image'] = dict(zip(['width', 'height', 'format', 'bytes'], [int(match[1]), int(match[2]), match[3], int(match[4])]))
        current['image_loaded_at'] = at
    if 'Calling Gemini with model:' in text:
        current['extract_marker_at'] = at
    if '"event": "gemini_plan_call"' in text:
        payload = json.loads(text[text.index('{'):])
        current['calls'].append({'at': at, 'model': payload['model'], 'latency_ms': payload['latencyMs'], 'tokens': payload['tokens']})
    match = re.search(r'Plan review round (\d+): (\{.*?\}) \((.*)\)', text)
    if match:
        current['reviews'].append({'round': int(match[1]), 'edits': ast.literal_eval(match[2]), 'summary': match[3]})
    if 'Successfully completed plan parsing job' in text:
        current['finished_at'] = at

for run in runs:
    calls = run['calls']
    run['extract_span_ms'] = ms(run['extract_marker_at'], calls[0]['at'])
    run['pre_timer_residual_ms'] = round(run['extract_span_ms'] - calls[0]['latency_ms'], 3)
    run['review_bridge_ms'] = round(ms(calls[0]['at'], calls[1]['at']) - calls[1]['latency_ms'], 3)
    run['review2_bridge_ms'] = round(ms(calls[1]['at'], calls[2]['at']) - calls[2]['latency_ms'], 3)
    run['finalize_ms'] = ms(calls[-1]['at'], run['finished_at'])
    run['worker_app_ms'] = ms(run['received_at'], run['finished_at'])
    run['cold_wait_ms'] = ms(run['request']['at'], run['received_at'])
    run['boundary_total_ms'] = ms(run['request']['at'], run['finished_at'])

data = {
    'title': 'Plan extraction: timing, model input/output, and optimization',
    'date': '2026-11-19', 'updated_date': '2026-11-20', 'timezone': 'Asia/Ho_Chi_Minh (UTC+07)',
    'source': {'path': str(SOURCE.relative_to(ROOT)), 'sha256': hashlib.sha256(source.encode()).hexdigest(),
               'runtime_revision': 'soraplan-plan-parsing-worker-00011-bz6',
               'caveat': 'Local parser file is modified. Prompt/request reconstruction reflects this source snapshot, not a verified deployed prompt.'},
    'method': 'Existing successful Gemini latency logs plus differences between surrounding Cloud Logging timestamps. No new model requests.',
    'missing': ['original extraction JSON', 'exact wire request and deployed prompt', 'thinking-token count', 'first-token latency', 'SDK retry spans', 'individual local operation spans', 'provider-internal phase timings'],
    'runs': runs,
    'summary': {'count': len(runs), 'extraction_mean_s': statistics.mean(r['calls'][0]['latency_ms'] / 1000 for r in runs),
                'extraction_median_s': statistics.median(r['calls'][0]['latency_ms'] / 1000 for r in runs)},
    'illustration': {
        'source': 'samples/floorplan_1.png',
        'width': 2732, 'height': 1908,
        'sha256': hashlib.sha256((ROOT / 'samples/floorplan_1.png').read_bytes()).hexdigest(),
        'caveat': 'Repository example, not a verified copy of the measured request image. All overlays and example coordinates are manually authored, not original model output.',
    },
}
HERE.mkdir(parents=True, exist_ok=True)
(HERE / 'evidence.json').write_text(json.dumps(data, indent=2) + '\n')
extract_prompt = constants['SYSTEM_INSTRUCTION'] + constants['CROPPED_INSTRUCTION']
(HERE / 'extraction-prompt.txt').write_text(extract_prompt)
(HERE / 'review-prompt.txt').write_text(constants['REVIEW_INSTRUCTION'])
template = (HERE / 'report.template.html').read_text()
template = template.replace('__MODEL_TASKS__', (HERE / 'model-tasks.html').read_text())
template = template.replace('__SAMPLE_IMAGE__', 'data:image/png;base64,' + base64.b64encode((ROOT / 'samples/floorplan_1.png').read_bytes()).decode())
template = template.replace('__REPORT_DATA__', json.dumps(data).replace('<', '\\u003c'))
template = template.replace('__EXTRACTION_PROMPT__', html.escape(extract_prompt))
template = template.replace('__REVIEW_PROMPT__', html.escape(constants['REVIEW_INSTRUCTION']))
(HERE / 'report.html').write_text(template)
print(json.dumps({'runs': len(runs), 'report_bytes': (HERE / 'report.html').stat().st_size, 'latest_extraction_ms': runs[-1]['calls'][0]['latency_ms'], 'latest_marker_span_ms': runs[-1]['extract_span_ms']}, indent=2))

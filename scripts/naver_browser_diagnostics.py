"""Bounded public-navigation telemetry; never records headers or response bodies."""
import asyncio
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit


class StageTimeout(asyncio.TimeoutError):
    def __init__(self, stage):
        self.stage = stage


class BrowserTrace:
    def __init__(self):
        self.file = os.environ.get('NAVER_BROWSER_TRACE_FILE')
        self.enabled = bool(self.file) or os.environ.get('NAVER_BROWSER_DIAGNOSTICS') == '1'
        self.started = time.monotonic()
        self.count = 0
        self.request = 0
        self.phase = 'browser_start'
        self.completed = None
        self.waiting = 'document_request'
        self.deadline = None
        self.counters = {}

    def emit(self, event, **fields):
        if not self.enabled or self.count >= 1500 and event not in ['operation_failed','operation_complete','failure_state','failure_state_unavailable']:
            return
        self.count += 1
        value = {'version': 1, 'at': datetime.now(timezone.utc).isoformat(), 'event': event, 'request': self.request,
                 'elapsedMs': round((time.monotonic()-self.started)*1000), **fields}
        line = json.dumps(value, ensure_ascii=False)
        if self.file:
            with open(self.file, 'a', encoding='utf-8') as output:
                output.write(line+'\n')
                output.flush()
        if os.environ.get('NAVER_BROWSER_DIAGNOSTICS') == '1':
            print(line, file=sys.stderr, flush=True)

    def begin(self, seconds, mode, complex_no):
        self.request += 1
        self.phase = 'operation_start'
        self.completed = None
        self.waiting = 'document_request'
        self.counters = {'documentRequests': 0, 'documentResponses': 0, 'listRequests': 0, 'listResponses': 0}
        self.deadline = time.monotonic()+max(.01, seconds)
        self.emit('operation_start', mode=mode, complexNo=complex_no, budgetMs=round(seconds*1000))

    def remaining(self):
        return max(0, self.deadline-time.monotonic())

    async def step(self, stage, operation, limit=5):
        self.phase = stage
        started = time.monotonic()
        self.emit('stage_start', stage=stage)
        try:
            result = await asyncio.wait_for(operation, timeout=min(limit, self.remaining()))
        except asyncio.TimeoutError:
            self.emit('stage_timeout', stage=stage, durationMs=round((time.monotonic()-started)*1000))
            raise StageTimeout(stage)
        self.completed = stage
        self.emit('stage_complete', stage=stage, durationMs=round((time.monotonic()-started)*1000))
        return result

    def summary(self, phase=None):
        return {'version': 1, 'phase': phase or self.phase, 'lastCompleted': self.completed,
                'waitingFor': self.waiting, **self.counters}

    @staticmethod
    def location(url):
        value = urlsplit(url)
        return {'host': value.hostname or '', 'path': value.path[:180]}

    async def failure_state(self, tab, phase):
        self.emit('operation_failed', **self.summary(phase))
        try:
            state = await asyncio.wait_for(tab.evaluate("JSON.stringify({url:location.origin+location.pathname,readyState:document.readyState,bodyChars:document.body?.innerText.length||0,articleLinks:document.querySelectorAll('a[href*=\"/articles/\"]').length,blocked:/자동입력\\s*방지|비정상적인\\s*접근|captcha|Too Many Requests/i.test(document.body?.innerText||'')})"), timeout=2)
            state = json.loads(state)
            self.emit('failure_state', **self.location(state.pop('url')), **state)
        except Exception as error:
            self.emit('failure_state_unavailable', errorClass=type(error).__name__)
        if self.file and os.environ.get('NAVER_BROWSER_SCREENSHOTS') == '1':
            screenshot = str(Path(self.file).with_suffix('.png'))
            try:
                await asyncio.wait_for(tab.save_screenshot(screenshot, format='png'), timeout=2)
                self.emit('failure_screenshot', file=Path(screenshot).name)
            except Exception as error:
                self.emit('failure_screenshot_unavailable', errorClass=type(error).__name__)


def network_error(value):
    match = re.search(r'net::ERR_[A-Z_]+', value or '')
    return match.group(0) if match else 'network_failure'

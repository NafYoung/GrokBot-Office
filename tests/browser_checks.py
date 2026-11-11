"""可选浏览器回归：python tests/browser_checks.py [--screenshots /tmp/office-shots]

需要 Python Playwright 和 Chromium；不加入办公室运行时依赖。
"""
import argparse
import json
import shutil
import socket
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import server
from office_report import OfficeClient


def run(screenshots=None):
    srv = server.make_server("127.0.0.1", 0, token="browser-test-token", persist=False)
    connections = []
    original_stream = srv.RequestHandlerClass.stream
    def track_stream(handler):
        connections.append(handler.connection)
        return original_stream(handler)
    srv.RequestHandlerClass.stream = track_stream
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    errors = []
    results = {}
    reporter = OfficeClient(base, token='browser-test-token')

    def publish(payload):
        # 使用交付给 Grokbot 的上报器，经认证 HTTP、SSE 到画面。
        assert reporter.report(payload)['ok']

    def shot(page, name):
        if screenshots:
            page.screenshot(path=str(screenshots / f"{name}.png"))

    def state(page, agent, expected):
        page.wait_for_function("([id, expected]) => window.office.agents.find(a => a.id === id).state === expected", arg=[agent, expected])

    def layout(page):
        return page.evaluate("""() => {
          const box = s => {const r=document.querySelector(s).getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:r.height}};
          const cards=[...document.querySelectorAll('.side > .card:not([hidden])')].map(e=>e.getBoundingClientRect());
          return {banner:box('#demoBanner'), stage:box('.stage'), activity:box('#activity'),
            overflow:document.documentElement.scrollWidth>innerWidth,
            cardsOverlap:cards.some((r,i)=>i>0 && r.top<cards[i-1].bottom),
            teamContained:box('#team').bottom <= document.querySelector('#team').parentElement.getBoundingClientRect().bottom};
        }""")

    try:
        with sync_playwright() as p:
            executable = shutil.which("chromium") or shutil.which("chromium-browser")
            browser = p.chromium.launch(executable_path=executable, headless=True)
            context = browser.new_context(viewport={"width": 1440, "height": 900})
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            requests = []
            page.on("request", lambda request: requests.append(request.url))
            event_posts = []
            page.on("request", lambda request: event_posts.append(request.url)
                    if request.method == 'POST' and request.url.endswith('/api/events') else None)
            # 页面加载成功但服务检查暂时失败，恢复后无需用户手动刷新。
            startup_attempts = []
            def fail_first_session(route):
                startup_attempts.append(1)
                if len(startup_attempts) == 1:
                    route.fulfill(status=503, body='temporarily unavailable')
                else:
                    route.continue_()
            page.route('**/api/session', fail_first_session)
            page.goto(base)
            page.wait_for_function('window.office.ui.feed === "noserver"')
            page.locator('#authForm').wait_for(state='visible')
            assert len(startup_attempts) >= 2
            page.unroute('**/api/session', fail_first_session)
            results['startup_retry'] = 'initial session failure retries automatically and reaches the login screen'
            assert page.evaluate('window.office.ui.feed') == 'locked'
            page.locator('#officeToken').fill('wrong')
            page.locator('#authForm button').click()
            page.locator('#authMessage').get_by_text('口令不正确，请重试。').wait_for()
            page.locator('#officeToken').fill('browser-test-token')
            page.locator('#authForm button').click()
            page.wait_for_function('window.office.ui.feed === "open"')
            assert page.locator('#officeToken').input_value() == ''
            assert not page.locator('#authForm').is_visible()
            assert page.evaluate('localStorage.length') == 0
            assert all('browser-test-token' not in url for url in requests)
            assert all('/api/office' not in url for url in requests)
            results['login'] = 'wrong token rejected; session unlocks SSE without storing token'

            # Daily life starts without making a single synthetic status event.
            page.wait_for_function('window.office.agents.some(a=>a.ambientStage === "doing")')
            daily_id = page.evaluate('window.office.agents.find(a=>a.ambientStage === "doing").id')
            page.locator(f'li[data-id="{daily_id}"]').click()
            page.locator('#selected .sel-loaf').get_by_text('日常动画', exact=False).wait_for()
            assert page.locator('#lifeHint').is_visible()
            assert page.evaluate('window.office.agents.every(a=>a.lastSeenTs == null && a.lastStatusTs == null && a.text === "")')
            assert page.locator('#activity li').count() == 0
            assert '0 工作中' in page.locator('#stats').inner_text()
            assert '0 空闲' in page.locator('#stats').inner_text()
            assert srv.hub.sequence == 0 and not event_posts
            shot(page, 'daily-without-reports')
            results['default_daily_life'] = 'unreported residents animate with daily labels; no fake contact, tasks, live counts or POSTs'

            page.locator('#integrationCard summary').click()
            page.locator('#generateIntegration').click()
            assert '请先选择' in page.locator('#integrationMessage').inner_text()
            page.select_option('#integrationAgent', 'guan')
            page.locator('#generateIntegration').click()
            page.locator('#integrationInstructions').wait_for(state='visible')
            instructions = page.locator('#integrationInstructions').input_value()
            assert base in instructions
            assert 'office_report.py' in instructions
            assert '--agent guan' in instructions
            assert '--agent grok' not in instructions
            assert 'browser-test-token' not in instructions
            assert '尚未修改 Grokbot' in page.locator('#integrationMessage').inner_text()
            assert srv.hub.sequence == 0
            shot(page, 'connection-setup')
            page.set_viewport_size({'width':390,'height':844})
            assert not layout(page)['overflow']
            page.locator('#integrationCard').scroll_into_view_if_needed()
            shot(page, 'connection-setup-mobile')
            page.set_viewport_size({'width':1440,'height':900})
            page.select_option('#integrationAgent', 'shiyan')
            assert page.locator('#integrationInstructions').is_hidden()
            assert page.locator('#integrationInstructions').input_value() == ''
            page.locator('#generateIntegration').click()
            page.locator('#integrationInstructions').wait_for(state='visible')
            assert '--agent shiyan' in page.locator('#integrationInstructions').input_value()
            page.locator('#integrationCard summary').click()
            results['setup'] = 'setup binds the selected bot, machine and port; changing bot clears old rules; no events or secrets generated'

            page.locator('#modeBadge').get_by_text('等待 Bot 上报', exact=True).wait_for()
            assert '名单来自工位配置' in page.locator('#feedBanner').inner_text()
            publish({'type':'handoff','agent':'eggbot','to':'grok','text':'只有在岗信息'})
            page.locator('#modeBadge').get_by_text('等待任务状态', exact=True).wait_for()

            publish({'agent':'grok', 'state':'coding', 'text':'开始任务'})
            state(page, 'grok', 'coding')
            page.locator('#modeBadge').get_by_text('已收到任务状态', exact=True).wait_for()
            publish({'agent':'grok', 'state':'idle', 'text':'任务完成'})
            state(page, 'grok', 'idle')
            page.locator('#team li[data-id="grok"] .tx').get_by_text('任务完成', exact=False).wait_for()
            for agent, expected in [('guan', 'browsing'), ('shiyan', 'terminal')]:
                OfficeClient(base, 'browser-test-token', agent=agent).report({'state': expected, 'text': agent + ' 的独立任务'})
                state(page, agent, expected)
                page.locator(f'li[data-id="{agent}"] .tx').get_by_text(agent + ' 的独立任务', exact=False).wait_for()
            assert page.evaluate('window.office.agents.find(a=>a.id==="grok").text') == '任务完成'
            shot(page, 'multiple-bots')
            for agent in ('guan', 'shiyan'):
                OfficeClient(base, 'browser-test-token', agent=agent).report({'state': 'idle', 'text': agent + ' 完成'})
                state(page, agent, 'idle')
            results['multiple_bots'] = 'main bot stays idle while two other bot statuses and descriptions update independently'
            results['http_to_gui'] = 'authenticated HTTP status reaches SSE and UI; configured names and handoff-only events do not imply task sync'
            publish({'type':'handoff','agent':'grok','to':'qiwen','text':'交接材料'})
            page.wait_for_function('window.office.agents[0].moving')
            publish({'agent':'grok','state':'error','text':'测试失败'})
            state(page, 'grok', 'error')
            assert '1 出错' in page.locator('#stats').inner_text()
            assert '0 工作中' in page.locator('#stats').inner_text()
            page.locator('#activity').get_by_text('测试失败', exact=False).wait_for()
            publish({'type':'handoff','agent':'eggbot','to':'grok','text':'按需交接'})
            page.reload()
            page.wait_for_function('window.office.ui.feed === "open" && window.office.agents.find(a=>a.id==="eggbot").lastSeenTs != null')
            assert '在岗 · 未上报状态' in page.locator('#aux').inner_text()
            assert '测试失败' in page.locator('#activity').inner_text()
            results['refresh'] = 'status, handoff-only presence and activity restored'

            context.set_offline(True)
            # Chromium 的离线模拟不总会关闭已建立的 SSE TCP 连接。
            connections[-1].shutdown(socket.SHUT_RDWR)
            page.wait_for_function('window.office.ui.feed === "closed"')
            publish({'agent':'grok','state':'needsYou','text':'断线期间的新任务'})
            context.set_offline(False)
            page.wait_for_function('window.office.ui.feed === "open"')
            state(page, 'grok', 'needsYou')
            assert '断线期间的新任务' in page.locator('#activity').inner_text()
            results['reconnect'] = 'latest status and missed history restored'
            results['desktop_live'] = layout(page)
            shot(page, 'desktop-live')
            page.locator('#demoBtn').click()
            page.wait_for_function('window.office.ui.mode === "demo"')
            page.wait_for_timeout(300)
            results['desktop_demo'] = layout(page)
            shot(page, 'desktop-demo')
            publish({'agent':'grok','state':'error','text':'演示期间收到的真实事件'})
            assert '演示期间收到的真实事件' not in page.locator('#activity').inner_text()
            page.locator('#demoBtn').click()
            state(page, 'grok', 'error')
            assert '演示期间收到的真实事件' in page.locator('#activity').inner_text()
            assert '【演示】' not in page.locator('#activity').inner_text()
            results['mode_switch'] = 'live snapshot restored without demo history'

            page.locator('#restBtn').click()
            page.wait_for_function('window.office.sim.demoRest && window.office.agents.some(a => a.moving)')
            assert '休息演示' in page.locator('#demoBanner').inner_text()
            assert page.evaluate('window.office.agents.filter(a=>a.demoActive).every(a=>a.state === "idle")')
            assert page.locator('#activity li').count() == 0
            assert not event_posts
            page.locator('#demoBtn').click()
            state(page, 'grok', 'error')
            results['rest_preview'] = 'idle animation runs without posting or inventing work events'
            publish({'agent':'newbee','state':'idle','text':'等待下一项任务'})
            page.wait_for_function('window.office.agents.find(a=>a.id==="newbee").moving && window.office.agents.find(a=>a.id==="newbee").ambient != null')
            publish({'agent':'newbee','state':'needsYou','text':'请确认新任务'})
            state(page, 'newbee', 'needsYou')
            assert page.evaluate('window.office.agents.find(a=>a.id==="newbee").ambient == null')
            results['live_idle'] = 'real idle starts a break; a new task immediately cancels it'

            for width, height in [(390,844),(320,568),(768,1024)]:
                page.set_viewport_size({'width':width,'height':height})
                page.wait_for_timeout(100)
                live=layout(page)
                assert not live['overflow'] and not live['cardsOverlap'] and live['teamContained'], live
                assert live['activity']['height'] >= 120, live
                results[f'{width}_live']=live
                if width == 390:
                    shot(page, 'mobile-live')
                page.locator('#demoBtn').click()
                page.wait_for_timeout(300)
                demo=layout(page)
                assert demo['banner']['height'] < 80, demo
                assert not demo['overflow'] and not demo['cardsOverlap'] and demo['teamContained'], demo
                assert demo['activity']['height'] >= 120, demo
                results[f'{width}_demo']=demo
                if width == 390:
                    shot(page, 'mobile-demo')
                page.locator('#demoBtn').click()
                state(page, 'grok', 'error')
                page.locator('#restBtn').click()
                page.wait_for_function('window.office.sim.demoRest')
                rest = layout(page)
                assert rest['banner']['height'] < 80 and not rest['overflow'] and not rest['cardsOverlap'], rest
                assert page.evaluate('''() => {
                  const buttons=document.querySelector('.demo-controls').getBoundingClientRect();
                  const stats=document.querySelector('#stats').getBoundingClientRect();
                  return buttons.bottom <= stats.top;
                }''')
                page.locator('#demoBtn').click()
                state(page, 'grok', 'error')
            for name in ['desktop_live','desktop_demo']:
                assert results[name]['activity']['height'] >= 120
                assert not results[name]['cardsOverlap']

            audit = context.new_page()
            audit.on('pageerror', lambda error: errors.append(str(error)))
            stream_attempts = []
            def fail_first_stream(route):
                stream_attempts.append(1)
                if len(stream_attempts) == 1:
                    route.fulfill(status=503, body='temporarily unavailable')
                else:
                    route.continue_()
            audit.route('**/api/events/stream', fail_first_stream)
            audit.goto(base + '/?stale=3&offline=30')
            audit.wait_for_function('window.office.ui.feed === "open"')
            assert len(stream_attempts) >= 2
            results['stream_retry'] = 'HTTP 503 permanently closing EventSource is retried automatically'
            publish({'agent':'shiyan','state':'coding','text':'过期后仍应保留的真实任务'})
            state(audit, 'shiyan', 'coding')
            audit.wait_for_function('window.office.agents.find(a=>a.id==="shiyan").taskPresence === "stale"')
            publish({'type':'handoff','agent':'shiyan','to':'guan','text':'新的交接活动'})
            audit.wait_for_function('''() => {
              const a=window.office.agents.find(a=>a.id==='shiyan');
              return a.presence==='fresh' && a.taskPresence==='stale' && a.activityKind==='handoff';
            }''')
            assert '在岗 · 任务状态过期' in audit.locator('li[data-id="shiyan"] .st').inner_text()
            assert '过期后仍应保留的真实任务' in audit.locator('li[data-id="shiyan"] .tx').inner_text()
            assert '0 工作中' in audit.locator('#stats').inner_text()
            assert '新鲜任务状态' not in audit.locator('#feedBanner').inner_text()
            audit.locator('li[data-id="shiyan"]').click()
            assert '任务上报：' in audit.locator('#selected').inner_text()
            shot(audit, 'stale-task-fresh-contact')
            audit.reload()
            audit.wait_for_function('window.office.ui.feed === "open" && window.office.agents.find(a=>a.id==="shiyan").lastStatusTs != null')
            assert '在岗 · 任务状态过期' in audit.locator('li[data-id="shiyan"] .st').inner_text()
            assert '0 工作中' in audit.locator('#stats').inner_text()
            publish({'agent':'shiyan','state':'terminal','text':'新的真实任务状态'})
            state(audit, 'shiyan', 'terminal')
            assert '1 工作中' in audit.locator('#stats').inner_text()
            results['task_freshness'] = 'handoff keeps task stale in scene, counts and restored snapshot; a real status makes it current'
            audit.close()

            daily = context.new_page()
            daily.on('pageerror', lambda error: errors.append(str(error)))
            daily.on('request', lambda request: event_posts.append(request.url)
                     if request.method == 'POST' and request.url.endswith('/api/events') else None)
            publish({'agent':'ziliao','state':'idle','text':'日常验收：上一项任务已结束'})
            daily.goto(base + '/?stale=1&offline=2')
            daily.wait_for_function('window.office.ui.feed === "open" && window.office.agents.find(a=>a.id==="ziliao").lastStatusTs != null')
            idle_ts = daily.evaluate('window.office.agents.find(a=>a.id==="ziliao").lastStatusTs')
            idle_seq = srv.hub.sequence
            daily.wait_for_function('''() => {
              const a=window.office.agents.find(a=>a.id==='ziliao');
              return a.presence === 'offline' && a.ambientStage === 'doing';
            }''')
            daily.locator('#aux li[data-id="ziliao"]').click()
            daily.locator('#selected .sel-loaf').get_by_text('日常动画', exact=False).wait_for()
            assert '离线' in daily.locator('#selected .sel-state').inner_text()
            assert '上一项任务已结束' in daily.locator('#selected .sel-text').inner_text()
            assert daily.evaluate('window.office.agents.find(a=>a.id==="ziliao").lastStatusTs') == idle_ts
            assert daily.evaluate('window.office.agents.find(a=>a.id==="ziliao").lastSeenTs') == idle_ts
            assert srv.hub.sequence == idle_seq
            shot(daily, 'daily-after-idle-expired')
            for width, height in [(390,844), (320,568)]:
                daily.set_viewport_size({'width':width,'height':height})
                bounds = layout(daily)
                assert not bounds['overflow'] and not bounds['cardsOverlap'], bounds
                assert daily.locator('#lifeHint').is_visible()
                if width == 390:
                    daily.locator('.stage').scroll_into_view_if_needed()
                    shot(daily, 'daily-mobile')
            publish({'type':'task','agent':'ziliao','taskId':'daily-acceptance','eventId':'daily-start','phase':'started',
                     'revision':1,'state':'coding','text':'日常验收：开始整理资料'})
            state(daily, 'ziliao', 'coding')
            assert daily.evaluate('window.office.agents.find(a=>a.id==="ziliao").ambient === null')
            assert daily.evaluate('window.office.agents.find(a=>a.id==="ziliao").ambientSpot === null')
            daily.wait_for_function('''() => {
              const a=window.office.agents.find(a=>a.id==='ziliao');
              return a.seated && a.cell.join() === a.seat.join();
            }''')
            publish({'type':'task','agent':'ziliao','taskId':'daily-acceptance','eventId':'daily-done','phase':'completed',
                     'revision':2,'text':'日常验收：资料整理完成'})
            state(daily, 'ziliao', 'idle')
            daily.wait_for_function('window.office.agents.find(a=>a.id==="ziliao").ambient != null')
            assert daily.evaluate('window.office.agents.find(a=>a.id==="ziliao").tasks[0].phase') == 'completed'
            assert not event_posts
            daily.close()
            results['persistent_daily_life'] = 'idle animations survive expiration; task start interrupts and returns to desk; completion resumes leisure without synthetic events'

            # Multi-task protocol through the actual CLI client, HTTP, SSE and detail UI.
            page.set_viewport_size({'width':1440,'height':1000})
            def task(task_id, phase, revision, text, **extra):
                publish(dict(type='task', agent='guan', taskId=task_id, phase=phase,
                             revision=revision, eventId=f'{task_id}.{revision}', text=text, **extra))
            task('browser-a', 'started', 1, '整理多智能体架构笔记', state='coding')
            task('browser-b', 'started', 1, '核对参考项目的事件接口', state='browsing')
            page.wait_for_function('window.office.agents.find(a=>a.id==="guan").tasks.length===2')
            page.locator('#team li[data-id="guan"]').click()
            page.locator('#selected .task-panel').get_by_text('2 项进行中').wait_for()
            task('browser-a', 'completed', 2, '架构笔记已整理')
            state(page, 'guan', 'browsing')
            page.locator('#selected .task-panel').get_by_text('1 项进行中').wait_for()
            task('browser-b', 'progress', 2, '<img src=x onerror="window.pwned=1">')
            page.locator('#selected .task-item').get_by_text('<img src=x onerror="window.pwned=1">', exact=True).wait_for()
            assert page.evaluate('window.pwned || false') is False
            assert page.locator('#selected img').count() == 0
            task('browser-b', 'progress', 3, '已核对任务开始与完成事件，正在确认异常处理')
            page.wait_for_function('window.office.agents.find(a=>a.id==="guan").tasks[0].revision===3')
            task_ts = page.evaluate('window.office.agents.find(a=>a.id==="guan").lastStatusTs')
            logs = page.locator('#activity li').count()
            publish({'type':'heartbeat','agent':'guan'})
            page.wait_for_function('window.office.agents.find(a=>a.id==="guan").diagnostic.lastHeartbeatAt != null')
            assert page.evaluate('window.office.agents.find(a=>a.id==="guan").lastStatusTs') == task_ts
            assert page.locator('#activity li').count() == logs
            try:
                reporter.report({'type':'task','agent':'guan','taskId':'missing','eventId':'bad-lifecycle',
                                 'phase':'completed','revision':2})
                raise AssertionError('missing started was accepted')
            except Exception as exc:
                from office_report import ReportError
                assert isinstance(exc, ReportError)
            page.locator('#selected .diagnostic-error').get_by_text('最近上报被拒绝', exact=False).wait_for()
            page.locator('#connectionCard summary').click()
            page.locator('#connectionStatus').get_by_text('等待配置', exact=True).wait_for()
            srv.hub.set_connector(state='partial', syncedAgents=1, lastSuccessAt=__import__('time').time(),
                                  message='测试网关：部分成员已匹配', unmappedNames=['未入席的测试成员'])
            page.locator('#connectionStatus').get_by_text('部分 Bot 未同步', exact=True).wait_for()
            shot(page, 'multi-task-diagnostics')
            page.set_viewport_size({'width':390,'height':844})
            assert not layout(page)['overflow']
            page.locator('#selected').scroll_into_view_if_needed()
            shot(page, 'multi-task-mobile')
            page.reload()
            page.wait_for_function('window.office.agents.find(a=>a.id==="guan").tasks.length===2')
            assert page.evaluate('window.office.agents.find(a=>a.id==="guan").tasks[0].revision') == 3
            page.locator('#demoBtn').click()
            page.wait_for_function('window.office.ui.mode === "demo"')
            assert page.locator('#connectionCard').is_hidden()
            assert page.locator('#selected .task-panel').count() == 0
            assert page.evaluate('window.office.agents.every(a=>a.tasks.length===0)')
            page.locator('#demoBtn').click()
            page.wait_for_function('window.office.agents.find(a=>a.id==="guan").tasks.length===2')
            task('browser-b', 'completed', 4, '接口核对完成')
            state(page, 'guan', 'idle')
            results['multi_task_diagnostics'] = 'parallel tasks, safe text, heartbeat freshness, rejection diagnostics, telemetry, reload and demo isolation passed'

            pending = context.new_page()
            pending.on('pageerror', lambda error: errors.append(str(error)))
            failures = []
            def fail_sessions(route):
                failures.append(1)
                route.fulfill(status=503, body='temporarily unavailable')
            pending.route('**/api/session', fail_sessions)
            pending.goto(base)
            pending.wait_for_function('window.office.ui.feed === "noserver"')
            pending.locator('#demoBtn').click()
            before = len(failures)
            pending.wait_for_timeout(1600)
            assert len(failures) == before
            assert pending.evaluate('window.office.ui.mode') == 'demo'
            pending.close()
            results['retry_cancellation'] = 'switching to demo cancels the pending live retry'
            assert not errors, errors
            results['page_errors']=errors
            browser.close()
    finally:
        srv.shutdown()
        srv.server_close()
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--screenshots', type=Path)
    args=parser.parse_args()
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)
    run(args.screenshots)

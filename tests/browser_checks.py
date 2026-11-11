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

    def publish(payload):
        srv.hub.publish(srv.hub.validate(payload))

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
            page.goto(base)
            page.locator('#authForm').wait_for(state='visible')
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

            publish({'agent':'grok', 'state':'coding', 'text':'开始任务'})
            state(page, 'grok', 'coding')
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

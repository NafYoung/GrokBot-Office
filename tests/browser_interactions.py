"""真实点击回归：python3 tests/browser_interactions.py [--screenshots /tmp/office-interactions]"""
import argparse
import json
import shutil
import sys
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import server
from office_report import OfficeClient


def run(shots=None):
    srv = server.make_server(port=0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{srv.server_port}'
    client = OfficeClient(url)
    errors, writes = [], []
    results = {}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=shutil.which('chromium') or shutil.which('chromium-browser'))
            context = browser.new_context(viewport={'width':1440,'height':1000}, has_touch=True)
            page = context.new_page()
            page.on('pageerror', lambda error:errors.append(str(error)))
            page.on('request', lambda r:writes.append(r.url) if r.method == 'POST' else None)
            page.goto(url)
            page.wait_for_function('window.office.ui.feed === "open"')
            # Delay autonomous choices so furniture occupancy is deterministic for input tests.
            page.evaluate('window.office.agents.forEach(a=>a.loafIn=1000)')

            def shot(name):
                if shots:
                    page.screenshot(path=str(shots / (name + '.png')), full_page=False)

            def canvas_point(x,y,z=0):
                return page.evaluate('''([x,y,z]) => {
                  const r=document.querySelector('#office').getBoundingClientRect();
                  const [px,py]=window.office.renderer.project(x,y,z);
                  return {x:r.left+px,y:r.top+py};
                }''', [x,y,z])

            def click_scene(x,y,z=0):
                point = canvas_point(x,y,z)
                page.mouse.click(point['x'],point['y'])

            def manual(expected):
                page.wait_for_function('(kind)=>window.office.agents.find(a=>a.id==="guan").manualAction===kind',arg=expected)

            click_scene(.5,3.5,1.3)
            page.locator('#actionFeedback').get_by_text('先选一个 Bot', exact=False).wait_for()
            assert srv.hub.sequence == 0
            # Select the actual robot head, not the side list.
            position = page.evaluate('''() => {
              const a=window.office.agents.find(a=>a.id==='guan');
              return [a.x,a.y,1.05];
            }''')
            click_scene(*position)
            page.wait_for_function('window.office.ui.selectedId === "guan"')
            assert page.locator('#actionName').inner_text() == '观世界'
            point=canvas_point(.5,3.5,1.3)
            page.mouse.move(point['x'],point['y'])
            assert '咖啡吧' in page.locator('#office').get_attribute('title')
            page.mouse.click(point['x'],point['y'])
            manual('coffee')
            page.wait_for_function('window.office.agents.find(a=>a.id==="guan").moving')
            assert page.locator('[data-scene-action="coffee"]').get_attribute('aria-pressed') == 'true'
            shot('coffee-route-desktop')
            page.locator('[data-scene-action="home"]').click()
            manual('home')
            page.wait_for_function('window.office.agents.find(a=>a.id==="guan").seated')
            click_scene(6.5,8.5,.95)
            manual('lounge')
            page.wait_for_function('window.office.agents.find(a=>a.id==="guan").ambientStage === "doing"')
            shot('sofa-desktop')
            # Seated visual position and hit testing must agree on the sofa cushion.
            seated = page.evaluate('''async () => {
              const {scenePosition}=await import('/src/ambient.js');
              const [x,y,z]=scenePosition(window.office.agents.find(a=>a.id==='guan'));
              return [x,y,z+1.05];
            }''')
            page.locator('#actionClose').click()
            click_scene(*seated)
            page.wait_for_function('window.office.ui.selectedId === "guan"')
            # Clicking the selected Bot's own desk sends it home.
            desk = page.evaluate('window.office.agents.find(a=>a.id==="guan").cfg.desk')
            click_scene(desk['x']+1,desk['y']+.5,1.14)
            manual('home')
            page.wait_for_function('window.office.agents.find(a=>a.id==="guan").seated')
            page.wait_for_timeout(600)
            assert page.evaluate('window.office.agents.find(a=>a.id==="guan").seated')
            assert srv.hub.sequence == 0 and len(srv.hub.recent) == 0 and not writes
            assert page.evaluate('window.office.agents.every(a=>a.lastSeenTs == null && a.lastStatusTs == null)')
            results['scene_clicks'] = 'robot, coffee bar, sofa and own desk respond to actual canvas clicks; no status event created'

            for width,height in [(390,844),(320,568)]:
                page.set_viewport_size({'width':width,'height':height})
                button=page.locator('[data-scene-action="stretch"]')
                button.scroll_into_view_if_needed()
                box=button.bounding_box()
                assert box['width'] >= 44 and box['height'] >= 44
                page.touchscreen.tap(box['x']+box['width']/2,box['y']+box['height']/2)
                manual('stretch')
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                bounds=page.evaluate('''() => {
                  const box=s=>document.querySelector(s).getBoundingClientRect();
                  return {stageBottom:box('.stage').bottom,dockTop:box('#actionDock').top,
                    dockBottom:box('#actionDock').bottom,sideTop:box('.side').top};
                }''')
                assert bounds['stageBottom'] <= bounds['dockTop'] and bounds['dockBottom'] <= bounds['sideTop'],bounds
                shot(f'controls-{width}')
                page.locator('[data-scene-action="home"]').click()
                manual('home')
                page.wait_for_function('window.office.agents.find(a=>a.id==="guan").seated')
            results['touch_layout'] = '390/320px controls remain touchable without horizontal overflow or covering the scene'
            page.set_viewport_size({'width':1440,'height':1000})
            page.locator('[data-scene-action="coffee"]').focus()
            page.keyboard.press('Enter')
            manual('coffee')
            assert page.evaluate('document.activeElement.dataset.sceneAction') == 'coffee'
            client.report({'agent':'guan','state':'coding','text':'交互验收：真实任务优先'})
            manual(None)
            page.locator('#actionNote').get_by_text('当前任务优先',exact=False).wait_for()
            assert page.locator('.action-buttons button:disabled').count() == 5
            assert page.evaluate('window.office.sim.sceneAction("guan","coffee").ok') is False
            assert page.evaluate('window.office.agents.find(a=>a.id==="guan").ambientSpot') is None
            shot('real-task-priority')
            page.keyboard.press('Escape')
            assert page.locator('#actionEmpty').is_visible()
            assert page.evaluate('window.office.ui.selectedId') is None
            page.locator('#team li[data-id="guan"]').click()
            assert page.locator('#actionName').inner_text() == '观世界'
            page.locator('#actionClose').click()
            assert page.locator('#actionEmpty').is_visible()
            assert srv.hub.sequence == 1 and not writes
            results['priority_and_keyboard'] = 'keyboard controls keep focus; real work cancels and disables leisure; Escape and close clear selection'
            assert not errors,errors
            results['page_errors']=errors
            browser.close()
    finally:
        srv.shutdown()
        srv.server_close()
    print(json.dumps(results,ensure_ascii=False,indent=2))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--screenshots',type=Path)
    args=parser.parse_args()
    if args.screenshots:
        args.screenshots.mkdir(parents=True,exist_ok=True)
    run(args.screenshots)

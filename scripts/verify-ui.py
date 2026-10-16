"""Optional real-browser visual smoke test (pip install playwright; Chromium required).

All assets are injected locally without external sites or API requests. Uses synthetic
trace data only; validates standalone theme previews and the host->iframe token bridge.
"""
from pathlib import Path
import os
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-output'
OUT.mkdir(exist_ok=True)


def inspect_sidebar(browser):
    html = (ROOT / 'demo/sidebar.html').read_text()
    html = re.sub(r'<link[^>]*rel="stylesheet"[^>]*>', '', html)
    html = re.sub(r'<script[^>]*\bsrc="[^"]+"[^>]*></script>', '', html)
    page = browser.new_page(viewport={'width': 440, 'height': 895}, device_scale_factor=2)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(html)
    page.add_style_tag(content=(ROOT / 'lib/sidebar.css').read_text())
    page.add_script_tag(content=(ROOT / 'lib/sidebar.js').read_text())
    assert page.locator('.step-head').count() == 4
    assert page.locator('#connection').is_hidden(), 'Synthetic preview must not show a Demo connection badge'
    assert '· demo' not in page.locator('.trace-footer').inner_text().lower()
    for theme in ['light', 'dark']:
        page.locator(f'[data-theme="{theme}"]').click()
        def shot(path):
            page.locator('.trace-shell').screenshot(
                path=str(OUT / path), style='.demo-toolbar { visibility: hidden !important; }')
        shot(f'sidebar-{theme}-v03.png')
        page.locator('.step-head').nth(1).click()
        assert page.locator('.step-content').count() == 1
        shot(f'sidebar-{theme}-expanded-v03.png')
        page.locator('.tool-btn').first.click()
        assert page.locator('.detail-code').count() >= 2
        shot(f'sidebar-{theme}-tool-v03.png')
        page.locator('.step-head').nth(1).click()
    page.locator('#searchButton').click()
    page.locator('#search').fill('jwt')
    assert page.locator('.step-head').count() >= 1
    assert page.locator('#progressText').inner_text() == '3 of 4 completed'
    page.set_viewport_size({'width': 330, 'height': 820})
    page.locator('#search').fill('')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.locator('.trace-shell').screenshot(path=str(OUT / 'sidebar-narrow-v03.png'), style='.demo-toolbar{visibility:hidden!important}')
    assert not errors, errors
    page.close()


def inspect_theme_bridge(browser):
    page = browser.new_page()
    page.set_content('''<style>
      .light{--dsw-alias-bg-base:#ffffff;--dsw-alias-label-primary:#242424}
      .dark{--dsw-alias-bg-base:#191b1f;--dsw-alias-label-primary:#eeeeef}
    </style><div id="host" class="light"></div>''')
    page.evaluate('''() => {
      window.__ModuleLoader__ = {load({factory}) {
        window.__plugin = factory(name => {
          if (name === 'react') return window.ReactStub;
          throw Error(name);
        });
      }};
      window.ReactStub = {
        createElement: (type, props, ...children) => ({type, props, children}),
        useRef: () => {
          const frame = document.createElement('iframe');
          document.getElementById('host').append(frame);
          return {current: frame};
        },
        useEffect: fn => {window.__teardown = fn();},
        useCallback: fn => fn,
      };
    }''')
    page.add_script_tag(content=(ROOT / 'lib/client.js').read_text())
    page.evaluate('''() => {
      let tab;
      const ctx = {
        effect: fn => fn(),
        inject: (_keys, fn) => fn({get:()=>({register:()=>()=>{}})}),
        slots: {
          inject: (_name, fn) => fn(),
          register: (props, component) => {
            if (props.name === 'sidebar.right.pane.tab') tab = component;
            return ()=>{};
          },
        },
      };
      window.__plugin.apply(ctx);
      const element = tab({sessionId:'example'});
      const root = element.type(element.props);
      window.__frame = root.children[0].props.ref.current;
    }''')
    def theme():
        return page.evaluate('''() => {
          const s = window.__frame.contentDocument.documentElement.style;
          return [s.getPropertyValue('--dsw-alias-bg-base'),
            s.getPropertyValue('--dsw-alias-label-primary'), s.colorScheme];
        }''')
    assert theme() == ['#ffffff', '#242424', 'light'], theme()
    page.locator('#host').evaluate("el=>{el.className='dark'}")
    page.wait_for_timeout(100)
    assert theme() == ['#191b1f', '#eeeeef', 'dark'], theme()
    page.close()


if __name__ == '__main__':
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=os.getenv('TRACE_CHROMIUM') or None, args=['--no-sandbox'])
        inspect_sidebar(browser)
        inspect_theme_bridge(browser)
        browser.close()
    print('Sidebar appearance, progressive disclosure, narrow width and DSH theme sync passed.')

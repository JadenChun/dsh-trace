// DSH Web client plugin: small docked entry to the full Trace Studio interface.
// Uses DSH's ModuleLoader contract, similar to the integration pattern in Think Flow (MIT).
window.__ModuleLoader__.load({
  id: 'dsh-trace-studio',
  factory: require => {
    const React = require('react');
    const TAB_ID = 'dsh-trace-studio';
    const KIND = 'trace-studio';
    const h = React.createElement;
    function Icon() { return h('svg', { viewBox: '0 0 24 24', width: 17, height: 17, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' },
      h('path', { d: 'M3 18h4l3-7 4 3 3-8 4 2' })); }
    // A DSH iframe does NOT inherit CSS variables from the host page. Copy the
    // host's semantic tokens to the same-origin iframe whenever theme changes.
    // The sidebar itself never hardcodes DSH light/dark palette values.
    const THEME_TOKENS = [
      '--dsw-alias-bg-base', '--dsw-alias-label-primary',
      '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary',
      '--dsw-alias-border-l2', '--dsw-alias-border-l3',
      '--dsw-alias-interactive-bg-hover', '--dsw-alias-markdown-code-block',
      '--dsw-alias-state-business-primary', '--dsw-alias-state-business-tertiary',
      '--dsw-alias-state-error-primary', '--dsw-alias-state-warn-primary',
      '--dsw-alias-state-success-primary', '--dsw-alias-scrollbar-bg-l2',
      '--dsw-font-xxxs-11', '--dsw-font-xxs-12',
      '--dsw-font-xxs-strong-12', '--dsw-font-xs-13',
      '--ds-font-family-default', '--ds-font-family-code',
    ];
    function isDarkColor(value) {
      const s = (value || '').trim();
      const hex = s.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i);
      let channels;
      if (hex) {
        const h6 = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1];
        channels = [0, 2, 4].map(i => parseInt(h6.slice(i, i + 2), 16));
      } else {
        const match = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
        if (match) channels = match.slice(1, 4).map(Number);
      }
      return channels ? ((channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722) < 128) : undefined;
    }
    function Viewer(props) {
      const id = props.sessionId || '';
      const iframeRef = React.useRef(null);
      const path = '/trace-studio/sidebar' + (id ? '?session=' + encodeURIComponent(id) : '');
      const syncTheme = React.useCallback(() => {
        const frame = iframeRef.current;
        if (!frame) return;
        let inner;
        try { inner = frame.contentDocument; } catch { return; } // non-same-origin embed
        if (!inner?.documentElement) return;
        const host = window.getComputedStyle(frame);
        const root = inner.documentElement;
        for (const token of THEME_TOKENS) {
          const value = host.getPropertyValue(token).trim();
          if (value) root.style.setProperty(token, value);
          else root.style.removeProperty(token);
        }
        const bg = host.getPropertyValue('--dsw-alias-bg-base');
        const dark = isDarkColor(bg);
        root.style.colorScheme = dark === undefined
          ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
          : (dark ? 'dark' : 'light');
      }, []);
      React.useEffect(() => {
        let pending = 0;
        const schedule = () => {
          if (pending) return;
          pending = window.requestAnimationFrame(() => { pending = 0; syncTheme(); });
        };
        const frame = iframeRef.current;
        if (!frame) return;
        const hostNodes = new Set([document.documentElement, document.body]);
        for (let node = frame; node; node = node.parentElement) hostNodes.add(node);
        const observers = [];
        for (const node of hostNodes) {
          if (!node) continue;
          const observer = new MutationObserver(schedule);
          observer.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'] });
          observers.push(observer);
        }
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        media.addEventListener?.('change', schedule);
        syncTheme();
        return () => {
          observers.forEach(observer => observer.disconnect());
          media.removeEventListener?.('change', schedule);
          if (pending) window.cancelAnimationFrame(pending);
        };
      }, [syncTheme]);
      return h('div', { style: { height: '100%', minHeight: 300, display: 'flex', flexDirection: 'column', background: 'var(--dsw-alias-bg-base, transparent)' } },
        h('iframe', { ref: iframeRef, onLoad: syncTheme, title: 'Agent trace', src: path, style: { border: 0, width: '100%', flex: 1 }, referrerPolicy: 'no-referrer' }));
    }
    function Tab(props) {
      return h(Viewer, { sessionId: props.sessionId || props.session?.id || '' });
    }
    const exports = {
      name: TAB_ID,
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => ctx.inject(['sidebarRightTabs'], scoped => {
          const tabs = scoped.get('sidebarRightTabs');
          return tabs.register({ id: TAB_ID, kind: KIND, title: () => 'Agent trace', guide: [{
            order: 50, id: TAB_ID, title: () => 'Agent trace', description: () => 'Inspect agent runs, tools and metadata', icon: Icon,
          }] });
        }), 'trace-studio: tab registration');
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab', key: TAB_ID,
          inject: sessionId => ({ sessionId }),
        }, Tab)), 'trace-studio: tab body');
        ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities', id: 'trace-studio:open', order: 12, registrant: 'dsh-trace-studio',
        }, function OpenTraceStudio() {
          return h('button', { type: 'button', title: 'Open agent trace', 'aria-label': 'Open agent trace',
            style: { cursor: 'pointer', display:'inline-flex', alignItems:'center', justifyContent:'center', width:24, height:24, border:0, borderRadius:6, padding:0, background:'transparent', color:'var(--dsw-alias-label-secondary, currentColor)' },
            onClick() { ctx.get?.('sidebarRight')?.openTab?.(KIND); } }, h(Icon));
        })), 'trace-studio: header link');
      },
    };
    return exports;
  },
});

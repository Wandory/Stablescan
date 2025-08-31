// Делает popup.html внутри iframe "резиновым" под ширину/высоту боковой панели,
// возвращает нижнюю навигацию и скролл контента по центру.
(function () {
  const iframe = document.getElementById('spFrame');
  if (!iframe) return;

  function injectCSS(doc) {
    const css = `
      :root, html, body {
        height: 100% !important;
        width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
      }
      #app, #app.popup, .popup, .container, .wrap, .root {
        width: 100% !important;
        max-width: none !important;
        height: 100% !important;
        display: flex !important;
        flex-direction: column !important;
      }
      header, .topbar, .header { flex: 0 0 auto !important; }
      main, #content, .content, .main, .page {
        flex: 1 1 auto !important;
        min-height: 0 !important;
        overflow: auto !important;
        -webkit-overflow-scrolling: touch;
      }
      nav, .navbar, .bottombar, .tabbar {
        flex: 0 0 auto !important;
        position: sticky !important;
        bottom: 0 !important;
        z-index: 10;
      }
      #app[style*="width"], .popup[style*="width"] { width: 100% !important; }
      [style*="max-width"] { max-width: none !important; }
      canvas, .chart, .chart-container { max-width: 100% !important; }
    `.trim();

    const style = doc.createElement('style');
    style.setAttribute('data-sidepanel-patch', '1');
    style.textContent = css;
    doc.documentElement.appendChild(style);
  }

  function nudgeResize(doc) {
    // Создаём событие в "мире" документа фрейма, если возможно
    const Ev = (doc.defaultView && doc.defaultView.Event) ? doc.defaultView.Event : Event;
    const ev = new Ev('resize');
    doc.defaultView && doc.defaultView.dispatchEvent(ev);
  }

  function onFrameReady() {
    let doc;
    try {
      doc = iframe.contentDocument || iframe.contentWindow?.document;
    } catch (e) {
      console.warn('Нет доступа к документу iframe:', e);
      return;
    }
    if (!doc) return;

    const apply = () => { injectCSS(doc); nudgeResize(doc); };

    if (doc.readyState === 'complete' || doc.readyState === 'interactive') {
      apply();
    } else {
      doc.addEventListener('DOMContentLoaded', apply, { once: true });
    }

    // Наблюдатель за изменениями размера внутри документа
    const RO1 = iframe.contentWindow?.ResizeObserver || window.ResizeObserver;
    const ro = RO1 ? new RO1(() => {}) : null;  // <-- колбэк обязателен
    try { if (ro && ro.observe) ro.observe(doc.documentElement); } catch (_) {}

    // Наблюдатель за изменением размеров самого iframe/панели
    const RO2 = window.ResizeObserver;
    const panelRO = RO2 ? new RO2(() => {}) : null;  // <-- колбэк обязателен
    try {
      if (panelRO && panelRO.observe) {
        panelRO.observe(iframe);
        panelRO.observe(document.documentElement);
      }
    } catch (_) {}

    window.addEventListener('resize', () => doc && nudgeResize(doc));
  }

  if (iframe.complete && iframe.contentDocument?.readyState !== 'loading') {
    onFrameReady();
  } else {
    iframe.addEventListener('load', onFrameReady, { once: false });
  }
})();

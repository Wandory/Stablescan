// sidepanel-launcher.js
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('openSidePanel');
  if (!btn || !chrome?.sidePanel) return;

  btn.addEventListener('click', async () => {
    try {
      // Берём активную вкладку текущего окна
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Включаем сайдпанель на этой вкладке и задаём путь
      if (tab?.id) {
        await chrome.sidePanel.setOptions({
          tabId: tab.id,
          path: 'sidebar.html',
          enabled: true
        });
        // Открываем панель в текущем окне
        await chrome.sidePanel.open({ windowId: tab.windowId });
      } else {
        // Фоллбек: включить глобально и открыть по текущему окну
        await chrome.sidePanel.setOptions({ path: 'sidebar.html', enabled: true });
        const win = await chrome.windows.getCurrent();
        await chrome.sidePanel.open({ windowId: win.id });
      }

      // Небольшая тактильная отдача
      btn.disabled = true;
      setTimeout(() => (btn.disabled = false), 600);
    } catch (e) {
      console.error('Side panel open failed:', e);
      alert('Не удалось открыть боковую панель. Проверь манифест и права — см. console.');
    }
  });
});

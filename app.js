/* app.js — popup logic (MV3) */

const CATEGORIES = ['USDT', 'USDC', 'USDE'];
const FAVORITES_KEY        = 'favorites';
const PREF_DARK            = 'pref:dark';
const PREF_LANG            = 'pref:lang';
const PREF_TOP_COLLAPSED   = 'pref_top_collapsed';

let currentCategory = 'USDT';
let favorites = new Set();
let allNews = [];
let chart;
let chartSeries = { usdt: [], usdc: [], usde: [], total: [] };
let activeChartKey = 'USDT';
let currentLang = 'ru';

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ===================== i18n ===================== */
const translations = {
  en: {
    marketTitle: 'Market Overview',
    favoritesTitle: 'Favorites',
    settingsTitle: 'SETTINGS',
    languageLabel: 'Language',
    darkModeLabel: 'Dark mode',
    sidePanel: 'Side Panel',
    searchPlaceholder: 'Search favorites…',
    noFavorites: 'Nothing in favorites yet.',
    noSearchResults: 'No results',
    loading: 'Loading…',
    open: 'Open',
    favorite: 'Favorite',
    navHome: 'Home', navFav: 'Favorites', navSettings: 'Settings',
    toggleTitle: 'Collapse/expand',
    justNow: 'just now',
    minAgo: (m)=>`${m}m ago`, hourAgo: (h)=>`${h}h ago`, dayAgo: (d)=>`${d}d ago`,
    marketCap: 'Market Cap'
  },
  zh: {
    marketTitle: '市场概览',
    favoritesTitle: '收藏',
    settingsTitle: '设置',
    languageLabel: '语言',
    darkModeLabel: '深色模式',
    sidePanel: '侧边面板',
    searchPlaceholder: '搜索收藏…',
    noFavorites: '收藏夹为空。',
    noSearchResults: '没有结果',
    loading: '加载中…',
    open: '打开',
    favorite: '收藏',
    navHome: '主页', navFav: '收藏', navSettings: '设置',
    toggleTitle: '折叠/展开',
    justNow: '刚刚',
    minAgo: (m)=>`${m} 分钟前`, hourAgo: (h)=>`${h} 小时前`, dayAgo: (d)=>`${d} 天前`,
    marketCap: '市值'
  },
  ru: {
    marketTitle: 'Обзор рынка',
    favoritesTitle: 'Избранное',
    settingsTitle: 'НАСТРОЙКИ',
    languageLabel: 'Язык',
    darkModeLabel: 'Тёмная тема',
    sidePanel: 'Боковая панель',
    searchPlaceholder: 'Поиск в избранном…',
    noFavorites: 'В избранном пока пусто.',
    noSearchResults: 'Ничего не найдено',
    loading: 'Загрузка…',
    open: 'Открыть',
    favorite: 'В избранное',
    navHome: 'Главная', navFav: 'Избранное', navSettings: 'Настройки',
    toggleTitle: 'Свернуть/развернуть',
    justNow: 'только что',
    minAgo: (m)=>`${m} мин назад`, hourAgo: (h)=>`${h} ч назад`, dayAgo: (d)=>`${d} дн назад`,
    marketCap: 'Капитализация'
  }
};
function tkey(key){ const pack = translations[currentLang] || translations.ru; return pack[key]; }

function updateLanguage() {
  const t = translations[currentLang] || translations.ru;
  [
    ['marketTitle','marketTitle'],
    ['favoritesTitle','favoritesTitle'],
    ['settingsTitle','settingsTitle'],
    ['languageLabel','languageLabel'],
    ['darkModeLabel','darkModeLabel']
  ].forEach(([id,key])=>{ const el=document.getElementById(id); if(el&&t[key]) el.textContent=t[key]; });

  const searchInput = document.getElementById('favSearch');
  if (searchInput) searchInput.placeholder = t.searchPlaceholder;
  const sidePanelBtn = document.getElementById('openSidePanel');
  if (sidePanelBtn) sidePanelBtn.textContent = t.sidePanel;
  const toggle = document.getElementById('topToggle');
  if (toggle) toggle.title = t.toggleTitle;

  document.getElementById('tab-home')?.setAttribute('title', t.navHome);
  document.getElementById('tab-fav')?.setAttribute('title', t.navFav);
  document.getElementById('tab-settings')?.setAttribute('title', t.navSettings);

  const cats = document.getElementById('categoriesSection');
  if (cats) cats.setAttribute('aria-label', currentLang==='ru' ? 'Категории новостей' : currentLang==='zh' ? '新闻分类' : 'News Categories');

  $$('.segmented .seg').forEach(b=> b.classList.toggle('active', b.dataset.lang === currentLang));

  if (document.getElementById('favorites')?.classList.contains('active')) renderFavorites().catch(()=>{});
}

/* ===================== helpers ===================== */
const fmtNum = (n) => {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n/1e12).toFixed(2)}t`;
  if (abs >= 1e9)  return `$${(n/1e9).toFixed(2)}b`;
  if (abs >= 1e6)  return `$${(n/1e6).toFixed(1)}m`;
  if (abs >= 1e3)  return `$${(n/1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
};

const timeAgo = (ts) => {
  if (!ts) return '';
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff/60000);
  if (m < 1) return tkey('justNow');
  if (m < 60) return tkey('minAgo')(m);
  const h = Math.floor(m/60);
  if (h < 24) return tkey('hourAgo')(h);
  const d = Math.floor(h/24);
  return tkey('dayAgo')(d);
};

function waitForChart() {
  return new Promise((resolve) => {
    const chk = () => (window.Chart ? resolve() : setTimeout(chk, 50));
    chk();
  });
}

/* ===================== Chart ===================== */
function makeChart() {
  const ctx = document.getElementById('capChart');
  if (!ctx) return;
  if (chart) { chart.destroy(); chart = null; }

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: tkey('marketCap'),
        data: [],
        borderColor: '#7fc8b5',
        backgroundColor: 'rgba(127, 200, 181, 0.10)',
        borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, tension: 0.25, fill: true
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' },
      scales: {
        x: {
          display: true,
          ticks: {
            maxRotation: 0, autoSkip: true,
            callback: (v,i)=> chart.data.labels?.[i] || '',
            color: 'rgba(107, 123, 120, 0.85)', font: { size: 10 }
          },
          grid: { color:'rgba(0,0,0,0.05)', drawBorder:false }, border:{ display:false }
        },
        y: {
          display: true, position: 'right',
          ticks: { callback: (v)=>fmtNum(Number(v)), maxTicksLimit:5, color:'rgba(107,123,120,0.8)', font:{size:10} },
          grid: { color:'rgba(0,0,0,0.05)', drawBorder:false }, border:{ display:false }
        }
      },
      plugins: {
        legend: { display:false },
        tooltip: {
          mode:'index', intersect:false,
          backgroundColor:'rgba(255,255,255,0.95)', titleColor:'#1b2b2a', bodyColor:'#1b2b2a',
          borderColor:'rgba(127,200,181,0.3)', borderWidth:1,
          callbacks: {
            title: (items)=> items?.length ? (chart.data.labels?.[items[0].dataIndex] || '') : '',
            label: (c)=> `${tkey('marketCap')}: ${fmtNum(c.parsed.y)}`
          }
        }
      },
      elements: { point:{ hoverBackgroundColor:'#7fc8b5', hoverBorderColor:'#ffffff', hoverBorderWidth:2 } }
    }
  });
}

function formatDM(ts){ const d=new Date(ts); const dd=String(d.getDate()).padStart(2,'0'); const mm=String(d.getMonth()+1).padStart(2,'0'); return `${dd}.${mm}`; }

function setChartSeries(key='USDT'){
  activeChartKey = key;
  const s = chartSeries[key.toLowerCase()] || [];
  if (!chart) return;

  const sorted=[...s].sort((a,b)=>a.t-b.t);
  chart.data.labels = sorted.map(p=>formatDM(p.t));
  chart.data.datasets[0].data = sorted.map(p=>p.v);

  const colors = {
    USDT:{ border:'#2ecc71', bg:'rgba(46,204,113,0.12)' },
    USDC:{ border:'#1e90ff', bg:'rgba(30,144,255,0.12)' },
    USDE:{ border:'#f1c40f', bg:'rgba(241,196,15,0.14)' }
  };
  const c = colors[key] || colors.USDT;
  chart.data.datasets[0].borderColor = c.border;
  chart.data.datasets[0].backgroundColor = c.bg;

  chart.update('none');

  $$('.chart-dots .dot').forEach(b=> b.classList.toggle('active', b.dataset.series===key));
}
function wireChartDots(){ $$('.chart-dots .dot').forEach(b=> b.addEventListener('click',()=> setChartSeries(b.dataset.series))); }

async function loadChart(){
  try{
    const r = await chrome.runtime.sendMessage({type:'GET_CHART'}).catch(()=>null);
    if (!r?.series) { console.warn('No chart data'); return; }
    const ser=r.series;
    chartSeries.usdt=ser.usdt||[]; chartSeries.usdc=ser.usdc||[]; chartSeries.usde=ser.usde||[]; chartSeries.total=ser.total||[];
    setChartSeries(activeChartKey);
  }catch(e){ console.error('Error loading chart:', e); }
}

/* ===================== News ===================== */
function cardHtml(n){
  const esc=(s)=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  const host=(n.source||(n.url?new URL(n.url).hostname.replace(/^www\./,""):"")||"").trim();
  const ago=n.ts?timeAgo(n.ts):''; const excerpt=(n.excerpt||n.description||n.text||n.summary||"").trim(); const lead=(n.lead||n.snippet||"").trim();
  const id=esc(n.id||n.url||""); const url=esc(n.url||"#"); const isFav=favorites.has(n.id||n.url);
  const PAD='var(--page-gutter, 16px)'; const openLbl=tkey('open')||'Open'; const favLbl=tkey('favorite')||'Favorite';

  return `
  <article class="card" data-id="${id}">
    <div class="card__head" style="display:flex;gap:8px;align-items:flex-start;padding:${PAD} ${PAD};">
      <h3 class="card__title" style="margin:0;line-height:1.25">${esc(n.title||"")}</h3>
      <button class="card__star" data-id="${id}" aria-pressed="${isFav?'true':'false'}" title="${esc(favLbl)}" style="margin-left:auto">${isFav?'★':'☆'}</button>
    </div>
    ${n.image?`<img class="card__media" src="${esc(n.image)}" alt="" style="display:block;width:100%;height:auto">`:""}
    ${lead?`<div class="card__body" style="padding:${PAD} ${PAD} 0 ${PAD};">${esc(lead)}</div>`:""}
    ${!lead&&excerpt?`<div class="card__body" style="padding:${PAD} ${PAD} 0 ${PAD};">${esc(excerpt)}</div>`:""}
    <div class="card__meta" style="display:flex;align-items:center;gap:10px;justify-content:space-between;padding:${PAD};">
      <div class="meta-left" style="display:flex;align-items:center;gap:8px;flex:1 1 auto;min-width:0">
        <span class="meta-source" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(host)}</span>
        ${ago?`<time class="meta-time" style="opacity:.75;white-space:nowrap">${esc(ago)}</time>`:''}
      </div>
      <button class="card__open" data-url="${url}">${esc(openLbl)}</button>
    </div>
  </article>`;
}

function renderNews(list){
  const host=$('#newsFeed'); if(!host) return;
  if(!list||!list.length){ host.innerHTML=`<div class="news-empty" style="padding:16px;color:#6c7b78">${tkey('noSearchResults')}</div>`; return; }
  host.innerHTML=list.map(cardHtml).join('');
}

async function loadNews(category='USDT'){
  const host=$('#newsFeed'); if(host) host.innerHTML=`<div class="news-empty" style="padding:16px;color:#6c7b78">${tkey('loading')}</div>`;
  const got=await chrome.runtime.sendMessage({type:'GET_NEWS',category}).catch(()=>null);
  allNews=(got?.items||[]).slice(0,90); renderNews(allNews);
  if(!allNews.length){
    await chrome.runtime.sendMessage({type:'REFRESH_ALL'}).catch(()=>null);
    const again=await chrome.runtime.sendMessage({type:'GET_NEWS',category}).catch(()=>null);
    allNews=(again?.items||[]).slice(0,90); renderNews(allNews);
  }
}

/* ===================== Favorites ===================== */
async function fetchAllCachedNews(){
  const arr=await Promise.all(CATEGORIES.map(c=>chrome.runtime.sendMessage({type:'GET_NEWS',category:c}).catch(()=>({items:[]}))));
  const flat=arr.flatMap(r=>r?.items||[]); const map=new Map(); for(const it of flat) map.set(it.id||it.url,it); return map;
}
function getFavSearchQuery(){ return ($('#favSearch')?.value||'').trim().toLowerCase(); }

async function renderFavorites(){
  const host=$('#favFeed'); if(!host) return;
  const cache=await fetchAllCachedNews(); const q=getFavSearchQuery();
  const arr=Array.from(favorites).map(id=>cache.get(id)).filter(Boolean).filter(n=>{
    if(!q) return true; const hay=[n.title,n.excerpt,n.description,n.text,n.source,n.url].filter(Boolean).join(' ').toLowerCase(); return hay.includes(q);
  });
  if(!arr.length){ host.innerHTML=`<div class="news-empty" style="padding:16px;color:#6c7b78">${q?(tkey('noSearchResults')):(tkey('noFavorites'))}</div>`; return; }
  host.innerHTML=arr.map(cardHtml).join('');
}
async function toggleFavorite(id){
  if(!id) return;
  favorites.has(id)?favorites.delete(id):favorites.add(id);
  await chrome.storage.local.set({[FAVORITES_KEY]:Array.from(favorites)});
  $$('.card .card__star').forEach(el=>{ if(el.dataset.id===id){ const on=favorites.has(id); el.textContent=on?'★':'☆'; el.setAttribute('aria-pressed',String(on)); }});
  renderFavorites().catch(()=>{});
}

/* ===================== UI wiring ===================== */
function wireBottomNav(){
  const tabs=$$('.bottom-nav .bn-item');
  tabs.forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id = btn.dataset.tab || btn.getAttribute('aria-controls') || '';
      if(!id) return;
      tabs.forEach(b=>{ const on=(b===btn); b.classList.toggle('active',on); b.setAttribute('aria-selected',String(on)); });
      $$('.view').forEach(v=>v.classList.toggle('active', v.id===id));
    });
  });
}
function wireCategories(){
  $$('.categories .pill').forEach(p=>{
    p.addEventListener('click',async ()=>{
      $$('.categories .pill').forEach(x=>x.classList.remove('active'));
      p.classList.add('active');
      currentCategory=p.dataset.category||'USDT';
      await loadNews(currentCategory);
    });
  });
}

async function initSettings(){
  try{
    const st=await chrome.storage.local.get([PREF_DARK, PREF_LANG]).catch(()=>({}));
    const isDark=!!st[PREF_DARK]; currentLang = st[PREF_LANG] || currentLang;
    document.documentElement.classList.toggle('dark',isDark);
    if($('#darkToggle')) $('#darkToggle').checked=isDark;

    updateLanguage();

    $('#darkToggle')?.addEventListener('change',async e=>{
      const on=e.target.checked; document.documentElement.classList.toggle('dark',on);
      await chrome.storage.local.set({[PREF_DARK]:on});
    });

    $$('.segmented .seg').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        currentLang = btn.dataset.lang || 'ru';
        updateLanguage();
        await chrome.storage.local.set({[PREF_LANG]: currentLang});
      });
    });

    // кнопка боковой панели
    const spBtn = document.getElementById('openSidePanel');
    if (spBtn) {
      spBtn.addEventListener('click', async () => {
        try {
          const res = await chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
          if (!res?.ok && chrome.sidePanel) {
            if (chrome.sidePanel.setOptions) {
              await chrome.sidePanel.setOptions({ path: 'sidebar.html', enabled: true });
            }
            const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(()=>null);
            if (win?.id) await chrome.sidePanel.open({ windowId: win.id }); else await chrome.sidePanel.open({});
          }
        } catch (err) { console.warn('OPEN_SIDE_PANEL fail', err); }
      });
    }
  }catch(e){ console.warn('initSettings error',e); }
}

function wireFeedActions(){
  document.addEventListener('click',(e)=>{
    const openBtn=e.target.closest('.card__open'); if(openBtn){ const url=openBtn.dataset.url; if(url) chrome.tabs.create({url}); }
    const star=e.target.closest('.card__star'); if(star){ const id=star.dataset.id; if(id) toggleFavorite(id); }
  });
}
function wireFavSearch(){ const inp=$('#favSearch'); if(!inp) return; inp.addEventListener('input',()=>{ renderFavorites().catch(()=>{}); }); }

/* ===== Collapsible Top Block ===== */
async function initTopCollapse(){
  const block=document.getElementById('topBlock'); const btn=document.getElementById('topToggle'); if(!block||!btn) return;
  const store=await chrome.storage.local.get([PREF_TOP_COLLAPSED]).catch(()=>({})); let collapsed=!!store[PREF_TOP_COLLAPSED];
  set(collapsed);
  btn.addEventListener('click',async ()=>{ collapsed=!collapsed; set(collapsed); await chrome.storage.local.set({[PREF_TOP_COLLAPSED]:collapsed}); });
  function set(c){ block.classList.toggle('collapsed',c); btn.setAttribute('aria-expanded',String(!c)); }
}

/* ===================== boot ===================== */
document.addEventListener('DOMContentLoaded', async () => {
  try{
    const st=await chrome.storage.local.get([FAVORITES_KEY]).catch(()=>({}));
    favorites=new Set(st[FAVORITES_KEY]||[]);
    wireBottomNav(); wireCategories(); wireFeedActions(); wireFavSearch(); await initSettings();
    await waitForChart(); makeChart(); wireChartDots();
    await initTopCollapse();
    await loadChart(); await loadNews(currentCategory); await renderFavorites();
  }catch(err){ console.error('bootstrap error',err); }
});

/* service-worker.js — MV3 background */

/* =========================
   КЭШИ, КОНСТАНТЫ
========================= */

// ===== Storage keys
const NEWS_KEY      = 'news-cache-rss-tags-v1';
const CHART_KEY     = 'chart-cache-v2-cmc';            // прежний кэш CMC
const CHART_KEY_CG  = 'chart-cache-v2-coingecko';      // новый кэш CG (добавлено)
const LAST_SYNC_KEY = 'last-sync';
const CMC_KEY_KEY   = 'CMC_KEY';

const CATEGORIES = ['USDT','USDC','USDE'];
const DAY_MS = 24*60*60*1000;

// 5 базовых доменов
const DOMAINS = [
  'coindesk.com',
  'cointelegraph.com',
  'cryptoslate.com',
  'cryptonews.com',
  'thedefiant.io'
];

// ====== Синонимы/регэкспы для фильтрации ======
const RX = {
  USDT: /\b(USDT|USDt|Tether)\b/i,
  USDC: /\b(USDC|USD\s*Coin)\b/i,
  USDE: /\b(USDE|USDe|sUSDe|Ethena|Ethena\s+Labs)\b/i
};

// ====== Кандидаты TAG RSS ======
const TAG_FEEDS = {
  // CoinDesk (Arc)
  coindesk: {
    USDT: [
      'https://www.coindesk.com/tag/tether/feed/',
      'https://www.coindesk.com/tag/usdt/feed/'
    ],
    USDC: [
      'https://www.coindesk.com/tag/usdc/feed/',
      'https://www.coindesk.com/tag/usd-coin/feed/'
    ],
    USDE: [
      'https://www.coindesk.com/tag/usde/feed/',
      'https://www.coindesk.com/tag/ethena/feed/'
    ]
  },

  // Cointelegraph
  cointelegraph: {
    USDT: [
      'https://cointelegraph.com/rss/tag/tether',
      'https://cointelegraph.com/rss/tag/usdt'
    ],
    USDC: [
      'https://cointelegraph.com/rss/tag/usdc',
      'https://cointelegraph.com/rss/tag/usd-coin'
    ],
    USDE: [
      'https://cointelegraph.com/rss/tag/usde',
      'https://cointelegraph.com/rss/tag/ethena'
    ]
  },

  // CryptoSlate
  cryptoslate: {
    USDT: [
      'https://cryptoslate.com/tag/tether/feed/',
      'https://cryptoslate.com/tag/usdt/feed/'
    ],
    USDC: [
      'https://cryptoslate.com/tag/usdc/feed/',
      'https://cryptoslate.com/tag/usd-coin/feed/'
    ],
    USDE: [
      'https://cryptoslate.com/tag/usde/feed/',
      'https://cryptoslate.com/tag/ethena/feed/'
    ]
  },

  // CryptoNews
  cryptonews: {
    USDT: [
      'https://cryptonews.com/tags/tether/feed/',
      'https://cryptonews.com/tags/usdt/feed/'
    ],
    USDC: [
      'https://cryptonews.com/tags/usdc/feed/',
      'https://cryptonews.com/tags/usd-coin/feed/'
    ],
    USDE: [
      'https://cryptonews.com/tags/usde/feed/',
      'https://cryptonews.com/tags/ethena/feed/'
    ]
  },

  // The Defiant
  thedefiant: {
    USDT: [
      'https://thedefiant.io/tag/tether/feed/',
      'https://thedefiant.io/tag/usdt/feed/'
    ],
    USDC: [
      'https://thedefiant.io/tag/usdc/feed/',
      'https://thedefiant.io/tag/usd-coin/feed/'
    ],
    USDE: [
      'https://thedefiant.io/tag/usde/feed/',
      'https://thedefiant.io/tag/ethena/feed/'
    ]
  }
};

// Бэкапные site-wide RSS
const SITE_FEEDS = {
  coindesk:      ['https://www.coindesk.com/arc/outboundfeeds/rss/'],
  cointelegraph: ['https://cointelegraph.com/rss'],
  cryptoslate:   ['https://cryptoslate.com/feed/'],
  cryptonews:    ['https://cryptonews.com/news/feed/'],
  thedefiant:    ['https://thedefiant.io/feed/']
};

/* =========================
   LIFECYCLE & MESSAGING
========================= */

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('refresh', { periodInMinutes: 60 });
  chrome.alarms.create('seed',    { when: Date.now() + 5_000 });
});

chrome.alarms.onAlarm.addListener(async a => {
  if (a.name === 'refresh' || a.name === 'seed') {
    try { await refreshAll(); } catch(e){ console.warn('refreshAll fail', e); }
  }
});

chrome.runtime.onMessage.addListener((msg,_s,send)=>{
  (async()=>{
    try{
      if (msg?.type === 'GET_NEWS') {
        return send(await getNews(msg.category));
      }
      if (msg?.type === 'REFRESH_ALL') {
        await refreshAll();
        return send({ok:true});
      }
      if (msg?.type === 'GET_CHART') {
        // Сначала CoinGecko (USDT/USDC/USDE + TOTAL 30d), если ошибка — фолбэк на старую CMC-серию
        let r = await getChartSeriesCG().catch(()=>null);
        if (!r || !r.series) r = await getChartSeriesCMC().catch(()=>({series:{usdt:[],usdc:[],usde:[],total:[]}}));
        return send(r);
      }
      return send({error:'unknown message'});
    }catch(e){
      return send({error:String(e?.message||e)});
    }
  })();
  return true;
});

/* =========================
   UTILS
========================= */
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const normalizeSpace = s => (s || '').replace(/\s+/g,' ').trim();
const stripTags      = s => normalizeSpace((s || '').replace(/<[^>]+>/g,''));
const inLastDays     = (ts,days) => {
  const t = Date.parse(ts || '');
  return Number.isFinite(t) && t <= Date.now()+5*60*1000 && (Date.now()-t) <= days*DAY_MS;
};

/* =========================
   RSS parsing (generic)
========================= */
function parseRssItems(xmlText, sourceHost){
  const items = [];
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;

  const pick = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (!m) return '';
    const raw = m[1];
    const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
    return normalizeSpace(cdata ? cdata[1] : raw);
  };
  const pickAttr = (block, tag, attr) => {
    const m = block.match(new RegExp(`<${tag}[^>]*\\b${attr}="([^"]+)"`, 'i'));
    return m ? m[1] : '';
  };
  const pickImg = (block) => {
    let u = pickAttr(block, 'media:content', 'url'); if (u) return u;
    const enc = block.match(/<enclosure\b[^>]*>/i);
    if (enc && /type="image\//i.test(enc[0])) {
      const m = enc[0].match(/\burl="([^"]+)"/i); if (m) return m[1];
    }
    const html = pick(block, 'content:encoded') || pick(block, 'description');
    const m = html.match(/<img[^>]*src="([^"]+)"/i);
    return m ? m[1] : '';
  };

  for (const it of xmlText.matchAll(itemRe)) {
    const block = it[0];
    const title = stripTags(pick(block, 'title'));
    const link  = stripTags(pick(block, 'link')) || stripTags(pick(block, 'guid'));
    const pub   = stripTags(pick(block, 'pubDate')) || stripTags(pick(block, 'dc:date'));
    const desc  = stripTags(pick(block, 'description'));
    const cont  = stripTags(pick(block, 'content:encoded'));
    const img   = pickImg(block);
    const excerpt = normalizeSpace((cont || desc || '').slice(0, 240));

    if (!title || !link) continue;
    items.push({
      id: link,
      title,
      url: link,
      source: sourceHost,
      ts: pub || null,
      image: img || null,
      excerpt,
      lang: 'en'
    });
  }
  return items;
}

async function fetchRSS(url){
  const res = await fetch(url, { cache:'no-store' });
  if (!res.ok) throw new Error('RSS HTTP '+res.status);
  const txt = await res.text();
  const host = new URL(url).hostname.replace(/^www\./,'');
  return parseRssItems(txt, host);
}

/* =========================
   Aggregation: Tag RSS -> Site RSS -> (optional) GDELT restricted
========================= */

async function collectTagRss(category){
  const acc = [];
  const tasks = [];

  for (const domain of Object.keys(TAG_FEEDS)) {
    const feeds = TAG_FEEDS[domain]?.[category] || [];
    for (const u of feeds) tasks.push(fetchRSS(u).catch(()=>[]));
  }
  const settled = await Promise.allSettled(tasks);
  for (const r of settled) if (r.status === 'fulfilled') acc.push(...r.value);

  return acc;
}

async function collectSiteRss(category){
  const acc = [];
  const tasks = [];
  for (const domain of Object.keys(SITE_FEEDS)) {
    for (const u of SITE_FEEDS[domain]) tasks.push(fetchRSS(u).catch(()=>[]));
  }
  const settled = await Promise.allSettled(tasks);
  for (const r of settled) if (r.status === 'fulfilled') acc.push(...r.value);
  const rx = RX[category];
  return acc.filter(n => rx.test(n.title) || rx.test(n.excerpt));
}

// ——— GDELT: только по этим 5 доменам (архив)
function gdeltQueryRestricted(category){
  const syn = category==='USDT' ? '(USDT OR USDt OR Tether)'
           : category==='USDC' ? '(USDC OR "USD Coin")'
           : '(USDE OR USDe OR sUSDe OR Ethena OR "Ethena Labs")';
  const dom = '(' + DOMAINS.map(d=>`domainis:${d}`).join(' OR ') + ')';
  return `${syn} AND ${dom}`;
}
async function fetchGDELT_ByCategoryRestricted(category, days){
  const q = encodeURIComponent(gdeltQueryRestricted(category));
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=ArtList&format=json&sort=DateDesc&timespan=${days}d&maxrecords=250`;
  const res = await fetch(url, { cache:'no-store' });
  if (!res.ok) throw new Error('GDELT HTTP '+res.status);
  const j = await res.json().catch(()=>({}));
  const arr = Array.isArray(j?.articles) ? j.articles : [];
  return arr.map(a=>({
    id:a.url, title:a.title||'', url:a.url,
    source:a.sourceCommonName||a.domain||'',
    ts:a.seenDate||a.date||null,
    image:a.socialImage||null,
    excerpt:'',
    lang:a.lang||'en'
  })).filter(n=>n.url && n.title);
}

// ——— Сбор финальной категории
async function buildCategory(category){
  const targetMin = 28;
  const rx = RX[category];

  // 1) Tag RSS 7 -> 30 -> 90
  let map = new Map();
  const tagAll = await collectTagRss(category);
  for (const days of [7, 30, 90]) {
    for (const n of tagAll) {
      if (!(rx.test(n.title) || rx.test(n.excerpt))) continue;
      if (!inLastDays(n.ts, days)) continue;
      if (!map.has(n.url)) map.set(n.url, n);
    }
    if (map.size >= targetMin) break;
  }

  // 2) Site-wide RSS 7 -> 30 -> 90
  if (map.size < targetMin) {
    const siteAll = await collectSiteRss(category);
    for (const days of [7, 30, 90]) {
      for (const n of siteAll) {
        if (!inLastDays(n.ts, days)) continue;
        if (!map.has(n.url)) map.set(n.url, n);
      }
      if (map.size >= targetMin) break;
    }
  }

  // 3) GDELT restricted 30 -> 90 -> 365
  if (map.size < targetMin) {
    for (const days of [30, 90, 365]) {
      try {
        const tail = await fetchGDELT_ByCategoryRestricted(category, days);
        for (const n of tail) {
          if (!rx.test(n.title)) continue;
          if (!inLastDays(n.ts, days)) continue;
          if (!map.has(n.url)) map.set(n.url, n);
          if (map.size >= targetMin) break;
        }
      } catch (e) {
        console.warn('GDELT restricted fail', category, e);
      }
      if (map.size >= targetMin) break;
    }
  }

  const list = Array.from(map.values())
    .sort((a,b)=> (Date.parse(b.ts||'')||0) - (Date.parse(a.ts||'')||0))
    .slice(0, 250);

  return list;
}

/* =========================
   Refresh / Get
========================= */
async function refreshAll(){
  // Новости
  const buckets = { USDT:[], USDC:[], USDE:[] };
  for (const c of CATEGORIES){
    try { buckets[c] = await buildCategory(c); }
    catch(e){ console.warn('buildCategory', c, e); buckets[c]=[]; }
  }
  const all = [...buckets.USDT, ...buckets.USDC, ...buckets.USDE];
  await chrome.storage.local.set({
    [NEWS_KEY]: { all, ...buckets },
    [LAST_SYNC_KEY]: Date.now()
  });

  // Графики CMC — оставлено как было
  try {
    const chartCMC = await refreshChartsFromCMC();
    await chrome.storage.local.set({ [CHART_KEY]: chartCMC });
  } catch(_){}

  // Графики CoinGecko (USDT/USDC/USDE + TOTAL) — добавлено
  try {
    const seriesCG = await refreshChartDataCG();
    await chrome.storage.local.set({ [CHART_KEY_CG]: { series: seriesCG, updated: Date.now() } });
  } catch(e){
    console.warn('CG charts refresh fail', e);
  }
}

async function getNews(category='USDT'){
  const s = await chrome.storage.local.get([NEWS_KEY, LAST_SYNC_KEY]);
  const cache = s[NEWS_KEY] || {};
  const list  = (cache[category] || []).slice(0, 250);
  return { items:list, lastSync: s[LAST_SYNC_KEY] || 0 };
}

/* =========================
   CHARTS (CMC — как прежде)
========================= */
async function fetchJsonCMC(path,{retries=2,timeout=25000,params={}}={}){
  const { CMC_KEY } = await chrome.storage.local.get([CMC_KEY_KEY]).then(s=>({CMC_KEY:s[CMC_KEY_KEY]}));
  if(!CMC_KEY) throw new Error('CMC API key not set');
  const url = new URL(`https://pro-api.coinmarketcap.com${path}`);
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,String(v)));
  for (let attempt=0; attempt<=retries; attempt++){
    try{
      const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),timeout);
      const res=await fetch(url.toString(),{
        signal: ctrl.signal, headers:{'X-CMC_PRO_API_KEY':CMC_KEY,'Accept':'application/json'}, cache:'no-store'
      });
      clearTimeout(t);
      if(!res.ok){
        if((res.status===429||res.status>=500)&&attempt<retries){await sleep(700*(attempt+1)); continue;}
        throw new Error('CMC HTTP '+res.status);
      }
      const j=await res.json();
      if(j.status && j.status.error_code) throw new Error(j.status.error_message || `CMC error ${j.status.error_code}`);
      return j;
    }catch(e){ if(attempt>=retries) throw e; await sleep(600*(attempt+1)); }
  }
}

async function cmcLatestBySymbols(symbols=[]){
  const j=await fetchJsonCMC('/v2/cryptocurrency/quotes/latest',{params:{symbol:symbols.join(','),convert:'USD'}});
  const out={}, data=j.data||{};
  for(const sym of symbols){
    const it=Array.isArray(data[sym])?data[sym][0]:data[sym];
    const q=it?.quote?.USD||{};
    out[sym]={id:it?.id,price:q.price??null,market_cap:q.market_cap??null,ts:q.last_updated||it?.last_updated||null};
  }
  return out;
}

async function cmcTotalStablecoinsCap(){
  let start=1, limit=5000, total=0, more=true;
  while(more){
    const j=await fetchJsonCMC('/v1/cryptocurrency/listings/latest',{params:{start,limit,convert:'USD',aux:'tags'}});
    const arr=j.data||[];
    for(const c of arr){ if((c.tags||[]).includes('stablecoin')) total += c?.quote?.USD?.market_cap || 0; }
    more = arr.length===limit; start += limit; if (start>15001) break;
  }
  return total;
}

async function refreshChartsFromCMC(){
  const latest   = await cmcLatestBySymbols(['USDT','USDC']);
  const totalCap = await cmcTotalStablecoinsCap();
  const stored   = await chrome.storage.local.get([CHART_KEY]).then(s=>s[CHART_KEY]||{usdt:[],usdc:[],total:[]});

  const dayKey = Math.floor(Date.now()/86400000), now=Date.now();
  const up = (arr,v)=>{ if(!Array.isArray(arr)) arr=[]; const i=arr.findIndex(p=>Math.floor(p.t/86400000)===dayKey);
    if(i>=0) arr[i]=v; else arr.push(v); if(arr.length>180) arr.splice(0,arr.length-180); return arr; };

  return {
    usdt: up(stored.usdt, {t:now, v:latest.USDT?.market_cap??null}),
    usdc: up(stored.usdc, {t:now, v:latest.USDC?.market_cap??null}),
    total: up(stored.total,{t:now, v:totalCap})
  };
}

async function getChartSeriesCMC(){
  const s = await chrome.storage.local.get([CHART_KEY, LAST_SYNC_KEY]);
  return { series: s[CHART_KEY] || {usdt:[],usdc:[],total:[]}, lastSync: s[LAST_SYNC_KEY] || 0 };
}

/* =========================
   CHARTS (CoinGecko — добавлено)
   USDT / USDC / USDE + TOTAL, 30 дней, дневной шаг
========================= */

// Идентификаторы в CoinGecko
const COINGECKO_IDS = {
  USDT: 'tether',
  USDC: 'usd-coin',
  USDE: 'ethena-usde'
};

async function fetchCoinGeckoHistoricalData(coinId, days = 30) {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  const res = await fetch(url, { cache:'no-store' });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const j = await res.json();
  const caps = Array.isArray(j?.market_caps) ? j.market_caps : [];
  return caps.map(([t, v]) => ({ t, v }));
}

async function buildChartSeriesCG(days = 30){
  const [usdt, usdc, usde] = await Promise.all([
    fetchCoinGeckoHistoricalData(COINGECKO_IDS.USDT, days).catch(()=>[]),
    fetchCoinGeckoHistoricalData(COINGECKO_IDS.USDC, days).catch(()=>[]),
    fetchCoinGeckoHistoricalData(COINGECKO_IDS.USDE, days).catch(()=>[])
  ]);

  // суммарная шкала времени
  const allTs = new Set();
  usdt.forEach(p=>allTs.add(p.t));
  usdc.forEach(p=>allTs.add(p.t));
  usde.forEach(p=>allTs.add(p.t));
  const ts = Array.from(allTs).sort((a,b)=>a-b);

  const total = ts.map(t=>{
    const u = (usdt.find(p=>p.t===t)?.v)||0;
    const c = (usdc.find(p=>p.t===t)?.v)||0;
    const e = (usde.find(p=>p.t===t)?.v)||0;
    return { t, v: u+c+e };
  });

  return { usdt, usdc, usde, total };
}

async function refreshChartDataCG(){
  const series = await buildChartSeriesCG(30);
  return series;
}

async function getChartSeriesCG(){
  const s = await chrome.storage.local.get([CHART_KEY_CG]);
  const cached = s[CHART_KEY_CG];
  if (cached?.series && cached.updated && (Date.now() - cached.updated) < 60*60*1000) {
    return { series: cached.series };
  }
  const series = await refreshChartDataCG();
  await chrome.storage.local.set({ [CHART_KEY_CG]: { series, updated: Date.now() } });
  return { series };
}

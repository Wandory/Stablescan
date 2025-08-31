function el(tag, cls, html){ const n=document.createElement(tag); if(cls) n.className=cls; if(html!=null) n.innerHTML=html; return n; }

function card(it){
  const root = el('article','sp-card');
  const head = el('div','sp-card__head');
  head.append(el('h3','sp-card__title', it.title));
  head.append(el('div','sp-card__meta', `${it.source||''} · ${it.ts ? new Date(it.ts).toLocaleString() : ''}`));
  root.append(head);

  if (it.image) {
    const img = el('img','sp-card__img'); img.src = it.image; img.alt = '';
    root.append(img);
  }

  const body = el('div','sp-card__body', it.excerpt || '');
  root.append(body);

  const actions = el('div','sp-card__actions');
  const a = el('a', '', 'Open');
  a.href = it.url; a.target = '_blank'; a.rel = 'noopener';
  actions.append(a);
  root.append(actions);

  return root;
}

function getAllNewsMap(){
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_NEWS', category: 'USDT' }, (a) => {
      chrome.runtime.sendMessage({ type: 'GET_NEWS', category: 'USDC' }, (b) => {
        chrome.runtime.sendMessage({ type: 'GET_NEWS', category: 'USDE' }, (c) => {
          const m = new Map();
          [a?.items||[], b?.items||[], c?.items||[]].flat().forEach(it => { if (it?.id) m.set(it.id, it); });
          resolve(m);
        });
      });
    });
  });
}

async function render(){
  const feed = document.getElementById('spFeed');
  const q = (document.getElementById('spSearch').value || '').trim().toLowerCase();
  feed.innerHTML = '';
  const map = await getAllNewsMap();
  const items = Array.from(map.values())
    .filter(it => !q || (it.title + ' ' + (it.excerpt||'')).toLowerCase().includes(q))
    .slice(0, 100);
  if (!items.length){ feed.append(el('div','sp-empty','Пока пусто.')); return; }
  const frag = document.createDocumentFragment();
  items.forEach(it => frag.append(card(it)));
  feed.append(frag);
}

document.getElementById('spRefresh').addEventListener('click', render);
document.getElementById('spSearch').addEventListener('input', render);
render().catch(()=>{});

import { requireUser, watchZonePlayers, ZONE_IDS, ZONE_CAPACITY } from './firebase.js';

const grid = document.getElementById('zoneGrid');
const note = document.getElementById('zoneNote');

(async function init() {
  const user = await requireUser();
  if (!user) { location.replace('sign-up.html'); return; }
  document.body.classList.remove('authing');
  renderZones();
})();

function renderZones() {
  for (const zoneId of ZONE_IDS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'zone-card';
    card.dataset.zone = zoneId;

    const title = document.createElement('div');
    title.className = 'zone-title';
    title.textContent = `${zoneId.replace('zone', '')}`;

    const count = document.createElement('div');
    count.className = 'zone-count';
    count.textContent = `0/${ZONE_CAPACITY}`;

    const bar = document.createElement('div');
    bar.className = 'zone-bar';
    const fill = document.createElement('div');
    fill.className = 'zone-bar-fill';
    bar.append(fill);

    card.append(title, count, bar);
    grid.append(card);

    card.addEventListener('click', () => {
      if (card.classList.contains('is-full')) {
        note.textContent = `${zoneId.replace('zone', 'Zona ')} to‘lgan (${ZONE_CAPACITY}/${ZONE_CAPACITY}). Boshqa zonani tanlang.`;
        return;
      }
      location.href = `player-game.html?zone=${encodeURIComponent(zoneId)}`;
    });

    // Zonadagi odamlar soni jonli (realtime) yangilanadi — boshqa kishi kirsa/chiqsa darhol ko'rinadi.
    watchZonePlayers(zoneId, (n) => {
      count.textContent = `${n}/${ZONE_CAPACITY}`;
      fill.style.width = `${Math.min(100, (n / ZONE_CAPACITY) * 100)}%`;
      const full = n >= ZONE_CAPACITY;
      card.classList.toggle('is-full', full);
    });
  }
}

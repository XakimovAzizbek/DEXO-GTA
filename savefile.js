// DEXO GTA: matnli faylni (zone.json, car.txt) saqlash oynasi.
// Ba'zi telefon brauzerlari va ilova ichidagi brauzerlar fayl yuklab olishni bo'sh saqlaydi,
// shuning uchun matnni nusxalash va oynadan to'g'ridan-to'g'ri ko'chirib olish yo'li ham bor.

const fmtSize = (n) => (n < 1024 ? `${n} bayt` : `${(n / 1024).toFixed(1)} KB`);

export function showSaveDialog({ name, text, type = 'text/plain', steps = [] }) {
  document.getElementById('saveDialog')?.remove();
  const bytes = new TextEncoder().encode(text).length;

  const wrap = document.createElement('div');
  wrap.className = 'save-dialog';
  wrap.id = 'saveDialog';
  const card = document.createElement('div');
  card.className = 'save-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', `${name} saqlash`);

  const title = document.createElement('h2');
  title.textContent = `${name} tayyor`;
  const info = document.createElement('p');
  info.textContent = `Hajmi: ${fmtSize(bytes)}. Fayl bo‘sh chiqsa, matnni nusxalab GitHub’da yopishtiring.`;

  const status = document.createElement('p');
  status.className = 'save-status';
  status.setAttribute('role', 'status');
  const say = (msg) => { status.textContent = msg; };

  const area = document.createElement('textarea');
  area.readOnly = true;
  area.value = text;
  area.setAttribute('aria-label', `${name} matni`);
  area.addEventListener('focus', () => area.select());

  const row = document.createElement('div');
  row.className = 'save-row';
  const button = (label, primary, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = primary ? 'save-btn save-btn--primary' : 'save-btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    row.append(b);
    return b;
  };

  button('Matnni nusxalash', true, async () => {
    try {
      await navigator.clipboard.writeText(text);
      say('Nusxalandi. Endi GitHub’da yopishtiring.');
    } catch {
      area.focus();
      area.select();
      area.setSelectionRange(0, text.length);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* qo'llanmaydi */ }
      say(ok ? 'Nusxalandi. Endi GitHub’da yopishtiring.' : 'Matn belgilandi: uzoq bosib “Nusxa olish” ni tanlang.');
    }
  });

  button('Faylni yuklab olish', false, () => {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    say('Yuklab olish boshlandi. Fayl bo‘sh chiqsa, “Matnni nusxalash” dan foydalaning.');
  });

  const file = typeof File === 'function' ? new File([text], name, { type }) : null;
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    button('Ulashish', false, async () => {
      try { await navigator.share({ files: [file], title: name }); say('Ulashildi.'); }
      catch { /* bekor qilindi */ }
    });
  }

  const close = () => { wrap.remove(); removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', onKey);
  button('Yopish', false, close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });

  card.append(title, info);
  if (steps.length) {
    const list = document.createElement('ol');
    for (const s of steps) {
      const li = document.createElement('li');
      li.textContent = s;
      list.append(li);
    }
    card.append(list);
  }
  card.append(row, status, area);
  wrap.append(card);
  document.body.append(wrap);
}

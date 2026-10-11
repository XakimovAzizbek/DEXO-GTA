(function () {
  'use strict';

  var TXT_FILE = 'home-glb.txt';

  var viewer = document.getElementById('viewer');
  var listEl = document.getElementById('list');
  var nameEl = document.getElementById('currentName');
  var loader = document.getElementById('loader');
  var loaderFill = document.getElementById('loaderFill');
  var loaderText = document.getElementById('loaderText');
  var messageEl = document.getElementById('message');
  var btnRotate = document.getElementById('btnRotate');
  var btnReset = document.getElementById('btnReset');
  var btnFull = document.getElementById('btnFull');

  var models = [];

  // ---------- txt faylni o'qish ----------
  // Format: name: uy glb: uy.glb
  function parseModels(text) {
    var result = [];
    var re = /name:\s*(.+?)\s*glb:\s*(\S+)/gi;
    var m;
    while ((m = re.exec(text)) !== null) {
      result.push({ name: m[1].trim(), glb: m[2].trim() });
    }
    return result;
  }

  function showMessage(text) {
    messageEl.textContent = text;
    messageEl.hidden = false;
    loader.classList.add('hide');
  }

  function hideMessage() {
    messageEl.hidden = true;
  }

  // ---------- ro'yxat ----------
  function renderList() {
    listEl.innerHTML = '';
    models.forEach(function (item, index) {
      var btn = document.createElement('button');
      btn.className = 'item';
      btn.textContent = item.name;
      btn.dataset.index = index;
      btn.addEventListener('click', function () {
        selectModel(index);
      });
      listEl.appendChild(btn);
    });
  }

  function selectModel(index) {
    var item = models[index];
    if (!item) return;

    hideMessage();
    loader.classList.remove('hide');
    loaderFill.style.width = '0%';
    loaderText.textContent = 'Yuklanmoqda...';

    nameEl.textContent = item.name;
    viewer.setAttribute('alt', item.name);
    viewer.src = item.glb;

    var buttons = listEl.querySelectorAll('.item');
    buttons.forEach(function (b) {
      b.classList.toggle('active', Number(b.dataset.index) === index);
    });
  }

  // ---------- model hodisalari ----------
  viewer.addEventListener('progress', function (e) {
    var p = Math.round((e.detail.totalProgress || 0) * 100);
    loaderFill.style.width = p + '%';
    loaderText.textContent = 'Yuklanmoqda... ' + p + '%';
  });

  viewer.addEventListener('load', function () {
    loader.classList.add('hide');
  });

  viewer.addEventListener('error', function () {
    showMessage('GLB fayl yuklanmadi. Fayl nomi va joylashuvini tekshiring.');
  });

  // ---------- tugmalar ----------
  btnRotate.addEventListener('click', function () {
    var on = viewer.hasAttribute('auto-rotate');
    if (on) {
      viewer.removeAttribute('auto-rotate');
    } else {
      viewer.setAttribute('auto-rotate', '');
    }
    btnRotate.classList.toggle('active', !on);
  });

  btnReset.addEventListener('click', function () {
    viewer.cameraOrbit = 'auto auto auto';
    viewer.cameraTarget = 'auto auto auto';
    viewer.fieldOfView = 'auto';
    if (typeof viewer.jumpCameraToGoal === 'function') {
      viewer.jumpCameraToGoal();
    }
  });

  btnFull.addEventListener('click', function () {
    var stage = viewer.parentElement;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (stage.requestFullscreen) {
      stage.requestFullscreen();
    }
  });

  // ---------- boshlash ----------
  function init() {
    fetch(TXT_FILE + '?v=' + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error('txt topilmadi');
        return res.text();
      })
      .then(function (text) {
        models = parseModels(text);
        if (!models.length) {
          showMessage(TXT_FILE + ' faylida model topilmadi.\nFormat: name: uy glb: uy.glb');
          return;
        }
        renderList();
        selectModel(0);
      })
      .catch(function () {
        showMessage(TXT_FILE + ' o\'qib bo\'lmadi. Saytni server orqali oching (file:// emas).');
      });
  }

  init();
})();

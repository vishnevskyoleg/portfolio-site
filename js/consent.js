/* Google Analytics 4 with Consent Mode and a small consent plate.
   The measurement ID comes from data-ga of this script tag (set in _pipeline/4_build_html.py); without it nothing happens.
   Until the visitor answers, Google Analytics runs without cookies (consent "denied": cookieless pings only).
   "Accept" turns analytics cookies on, "Decline" keeps them off; the answer is kept in this browser for a year.
   Ads storage stays denied in every case: the site shows no ads. */
(function () {
  var me = document.currentScript, id = me && me.getAttribute('data-ga');
  window.LFtrack = function () {};
  if (!id) return;
  var KEY = 'lf-consent', answer = null;
  try { var raw = localStorage.getItem(KEY); if (raw) { var o = JSON.parse(raw); if (o && o.t && Date.now() - o.t < 365 * 864e5) answer = o.v; } } catch (e) {}

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('consent', 'default', { analytics_storage: answer === 'yes' ? 'granted' : 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500 });
  gtag('js', new Date());
  gtag('config', id, { anonymize_ip: true });
  var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id); document.head.appendChild(s);
  window.LFtrack = function (name, params) { try { gtag('event', name, params || {}); } catch (e) {} };

  if (answer) return;
  var T = {
    en: { text: 'This site counts visits with Google Analytics. May it use cookies for that?', yes: 'Accept', no: 'Decline' },
    ru: { text: 'Сайт считает визиты через Google Analytics. Разрешить для этого cookies?', yes: 'Разрешить', no: 'Отказаться' }
  };
  function lang() { return document.documentElement.lang === 'ru' ? 'ru' : 'en'; }
  function build() {
    var box = document.createElement('div'); box.className = 'consent'; box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'Cookies');
    var p = document.createElement('p'); p.className = 'consent__text';
    var yes = document.createElement('button'); yes.type = 'button'; yes.className = 'consent__btn consent__btn--yes';
    var no = document.createElement('button'); no.type = 'button'; no.className = 'consent__btn';
    function words() { var t = T[lang()]; p.textContent = t.text; yes.textContent = t.yes; no.textContent = t.no; box.lang = lang(); }
    words();
    var row = document.createElement('div'); row.className = 'consent__row'; row.appendChild(yes); row.appendChild(no);
    box.appendChild(p); box.appendChild(row); document.body.appendChild(box);
    requestAnimationFrame(function () { box.classList.add('is-on'); });
    function done(v) {
      try { localStorage.setItem(KEY, JSON.stringify({ v: v, t: Date.now() })); } catch (e) {}
      gtag('consent', 'update', { analytics_storage: v === 'yes' ? 'granted' : 'denied' });
      box.classList.remove('is-on'); setTimeout(function () { box.remove(); }, 400);
    }
    yes.addEventListener('click', function () { done('yes'); });
    no.addEventListener('click', function () { done('no'); });
    /* the plate speaks the language the page is switched to */
    new MutationObserver(words).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();

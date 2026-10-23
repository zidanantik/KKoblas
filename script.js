document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector('.header__toggle');
  const nav    = document.querySelector('.header__nav');

  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      nav.classList.toggle('open', !open);
    });

    // close menu when a link is clicked
    nav.querySelectorAll('.nav__link').forEach(link => {
      link.addEventListener('click', () => {
        toggle.setAttribute('aria-expanded', 'false');
        nav.classList.remove('open');
      });
    });

    // close menu on outside click
    document.addEventListener('click', (e) => {
      if (!toggle.contains(e.target) && !nav.contains(e.target)) {
        toggle.setAttribute('aria-expanded', 'false');
        nav.classList.remove('open');
      }
    });
  }

  // Fade-in on scroll
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.about__photo-stack, .about__gallery, .about__content, .contact__card, .cta-card').forEach(el => {
    el.classList.add('fade-in');
    observer.observe(el);
  });

  // Service cards – staggered entrance + subtle float
  const serviceCards = document.querySelectorAll('.service-card');

  const cardObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const cards = entry.target.querySelectorAll('.service-card');
        cards.forEach((card, i) => {
          setTimeout(() => {
            card.classList.add('sc-visible');
          }, i * 120);
        });
        cardObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  const grid = document.querySelector('.services__grid');
  if (grid) {
    serviceCards.forEach(card => card.classList.add('sc-hidden'));
    cardObserver.observe(grid);
  }

  // Float animation on CTA card
  const ctaCard = document.querySelector('.cta-card');
  if (ctaCard) {
    let ctaFrame;
    function ctaFloat() {
      const y = Math.sin((Date.now() / 1000) / 5 * Math.PI * 2) * 6;
      ctaCard.style.setProperty('--float-y', y + 'px');
      ctaFrame = requestAnimationFrame(ctaFloat);
    }
    ctaCard.addEventListener('mouseenter', () => cancelAnimationFrame(ctaFrame));
    ctaCard.addEventListener('mouseleave', () => { ctaFrame = requestAnimationFrame(ctaFloat); });
    ctaFrame = requestAnimationFrame(ctaFloat);
  }

  // Subtle float animation on service cards
  serviceCards.forEach((card, i) => {
    const speed  = 4.5 + i * 0.7;
    const offset = i * 1.1;
    let frame;

    function floatTick() {
      const t = (Date.now() / 1000 + offset) % speed;
      const y = Math.sin((t / speed) * Math.PI * 2) * 5;
      card.style.setProperty('--float-y', y + 'px');
      frame = requestAnimationFrame(floatTick);
    }

    card.addEventListener('mouseenter', () => cancelAnimationFrame(frame));
    card.addEventListener('mouseleave', () => { frame = requestAnimationFrame(floatTick); });

    setTimeout(() => { frame = requestAnimationFrame(floatTick); }, i * 120 + 600);
  });
});

// ── Cookie Consent Banner & Google Consent Mode v2 ──
(function() {
  var banner = document.getElementById('cookieBanner');
  if (!banner) return;

  var consent = localStorage.getItem('kk_cookie_consent');

  if (!consent) {
    banner.hidden = false;
  }

  document.getElementById('cookieAccept')?.addEventListener('click', function() {
    localStorage.setItem('kk_cookie_consent', 'granted');
    banner.hidden = true;

    if (typeof gtag === 'function') {
      gtag('consent', 'update', {
        'ad_storage': 'granted',
        'ad_user_data': 'granted',
        'ad_personalization': 'granted',
        'analytics_storage': 'granted'
      });
    }
  });

  document.getElementById('cookieReject')?.addEventListener('click', function() {
    localStorage.setItem('kk_cookie_consent', 'denied');
    banner.hidden = true;

    if (typeof gtag === 'function') {
      gtag('consent', 'update', {
        'ad_storage': 'denied',
        'ad_user_data': 'denied',
        'ad_personalization': 'denied',
        'analytics_storage': 'denied'
      });
    }
  });
})();

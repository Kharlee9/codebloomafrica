  // Typewriter animation for hero "Confidence" and "Codebloom"
  const typewriterEl = document.getElementById('typewriter-text');
  if(typewriterEl){
    const words = ['Confidence', 'Codebloom'];
    let wordIndex = 0;
    let charIndex = 0;
    let isDeleting = false;
    const typingSpeed = 100;
    const deletingSpeed = 80;
    const pauseDuration = 4000;

    function typeWriter(){
      const currentWord = words[wordIndex];
      
      if(isDeleting){
        charIndex--;
      } else {
        charIndex++;
      }

      typewriterEl.textContent = currentWord.substring(0, charIndex);

      let speed = isDeleting ? deletingSpeed : typingSpeed;

      if(!isDeleting && charIndex === currentWord.length){
        speed = pauseDuration;
        isDeleting = true;
      } else if(isDeleting && charIndex === 0){
        isDeleting = false;
        wordIndex = (wordIndex + 1) % words.length;
        speed = 200;
      }

      setTimeout(typeWriter, speed);
    }

    typeWriter();
  }

  // FAQ accordion - only first item open on load
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach((item, index) => {
    if(index !== 0){
      item.classList.remove('open');
    }
    item.querySelector('.faq-q').addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      faqItems.forEach(i => i.classList.remove('open'));
      if(!isOpen) item.classList.add('open');
    });
  });

  // Count-up animation for stats
  const countEls = document.querySelectorAll('.stat-num[data-count-to]');
  const animateCount = (el) => {
    const target = parseInt(el.getAttribute('data-count-to'), 10);
    const suffix = el.getAttribute('data-suffix') || '';
    const duration = 1400;
    const start = performance.now();
    const easeOutQuad = t => t * (2 - t);

    function tick(now){
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutQuad(progress);
      const value = Math.round(eased * target);
      el.textContent = value + suffix;
      if(progress < 1){
        requestAnimationFrame(tick);
      } else {
        el.textContent = target + suffix;
      }
    }
    requestAnimationFrame(tick);
  };

  if(countEls.length){
    const statObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if(entry.isIntersecting){
          animateCount(entry.target);
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });

    countEls.forEach(el => statObserver.observe(el));
  }

  // Outcome count animation with step increments
  const outcomeEls = document.querySelectorAll('.outcome-count');
  const animateOutcomeCount = (el) => {
    const start = parseInt(el.getAttribute('data-count-from'), 10) || 0;
    const target = parseInt(el.getAttribute('data-count-to'), 10);
    const suffix = el.getAttribute('data-suffix') || '';
    const duration = parseInt(el.getAttribute('data-duration'), 10) || 10000;
    
    // Determine step size based on element
    let step = 1;
    if(suffix === '%') {
      step = 10;
    } else if(suffix === 'k+') {
      step = 10;
    }
    
    let current = start;
    const totalSteps = Math.ceil((target - start) / step);
    const interval = duration / totalSteps;
    
    const timer = setInterval(() => {
      current += step;
      if(current >= target){
        current = target;
        clearInterval(timer);
      }
      el.textContent = current + suffix;
    }, interval);
  };

  if(outcomeEls.length){
    const outcomeObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if(entry.isIntersecting){
          animateOutcomeCount(entry.target);
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });

    outcomeEls.forEach(el => outcomeObserver.observe(el));
  }

  // Stepped count spinner (increments in whole steps, e.g. hundreds)
  const stepEls = document.querySelectorAll('[data-count-step]');
  const animateStep = (el) => {
    const target = parseInt(el.getAttribute('data-count-to'), 10);
    const step = parseInt(el.getAttribute('data-count-step'), 10) || 1;
    const suffix = el.getAttribute('data-suffix') || '';
    let current = 0;
    const timer = setInterval(() => {
      current += step;
      if(current >= target){
        current = target;
        clearInterval(timer);
      }
      el.textContent = current.toLocaleString() + suffix;
    }, 90);
  };

  if(stepEls.length){
    const stepObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if(entry.isIntersecting){
          animateStep(entry.target);
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });

    stepEls.forEach(el => stepObserver.observe(el));
  }

  const burger = document.querySelector('.burger');
  const navLinks = document.querySelector('.nav-links');
  burger.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('open');
    burger.classList.toggle('open', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });

  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('open');
      burger.classList.remove('open');
      document.body.style.overflow = '';
    });
  });

  // Why CodeBloom image slider - autoplay + arrow + dot controls
  const whySlider = document.getElementById('whySlider');
  if(whySlider){
    const slides = Array.from(whySlider.querySelectorAll('.slide'));
    const dotsWrap = document.getElementById('whyDots');
    const prevBtn = document.getElementById('whyPrev');
    const nextBtn = document.getElementById('whyNext');
    let current = 0;
    let timer = null;
    const AUTOPLAY_MS = 3000;

    slides.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.setAttribute('aria-label', 'Go to slide ' + (i + 1));
      if(i === 0) dot.classList.add('active');
      dot.addEventListener('click', () => goTo(i));
      dotsWrap.appendChild(dot);
    });
    const dots = Array.from(dotsWrap.children);

    function render(){
      slides.forEach((s, i) => s.classList.toggle('active', i === current));
      dots.forEach((d, i) => d.classList.toggle('active', i === current));
    }

    function goTo(index){
      current = (index + slides.length) % slides.length;
      render();
      restart();
    }

    function next(){ goTo(current + 1); }
    function prev(){ goTo(current - 1); }

    function restart(){
      if(timer) clearInterval(timer);
      timer = setInterval(next, AUTOPLAY_MS);
    }

    nextBtn.addEventListener('click', next);
    prevBtn.addEventListener('click', prev);
    restart();
  }

  // Subtle scroll-reveal animation (fade + rise), respects reduced-motion
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!prefersReducedMotion){
    const revealTargets = document.querySelectorAll(
      'section .section-head, .school-card, .why-card, .step, .testi-card, ' +
      '.community-item, .outcome-card, .faq-item, .cta-box, .why-image, ' +
      '.community-visual, .stats-row'
    );
    revealTargets.forEach(el => el.classList.add('reveal'));

    const revealObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry, i) => {
        if(entry.isIntersecting){
          entry.target.style.transitionDelay = (i % 3) * 90 + 'ms';
          entry.target.classList.add('revealed');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

    revealTargets.forEach(el => revealObserver.observe(el));
  }

/* Lightweight local Motion-compatible adapter used by LiquidAssets. */
(() => {
  if (window.Motion) return;

  function inView(element, callback, options = {}) {
    const threshold = typeof options.amount === "number" ? options.amount : 0.15;
    if (!("IntersectionObserver" in window)) {
      callback();
      return () => {};
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) callback(entry);
      });
    }, { threshold });
    observer.observe(element);
    return () => observer.disconnect();
  }

  function animate(element, properties = {}, options = {}) {
    const y = properties.y;
    const scale = properties.scale;
    const opacity = properties.opacity;
    const fromY = Array.isArray(y) ? y[0] : null;
    const toY = Array.isArray(y) ? y[y.length - 1] : y;
    const toScale = Array.isArray(scale) ? scale[scale.length - 1] : scale;
    const duration = options.type === "spring" ? 560 : Math.max(1, (options.duration || 0.35) * 1000);
    const delay = Math.max(0, (options.delay || 0) * 1000);
    const easing = options.type === "spring" ? "cubic-bezier(.2,.85,.25,1)" : "ease-out";

    const current = getComputedStyle(element);
    const from = {};
    const to = {};
    if (opacity !== undefined) {
      from.opacity = current.opacity;
      to.opacity = Array.isArray(opacity) ? opacity[opacity.length - 1] : opacity;
    }
    if (y !== undefined || scale !== undefined) {
      const startY = fromY ?? 0;
      const endY = toY ?? 0;
      const endScale = toScale ?? 1;
      from.transform = `translateY(${startY}px) scale(1)`;
      to.transform = `translateY(${endY}px) scale(${endScale})`;
    }

    if (!element.animate) {
      Object.assign(element.style, to);
      return { cancel() {} };
    }
    const animation = element.animate([from, to], { duration, delay, easing, fill: "forwards" });
    animation.addEventListener("finish", () => Object.assign(element.style, to), { once: true });
    return animation;
  }

  window.Motion = { inView, animate };
})();

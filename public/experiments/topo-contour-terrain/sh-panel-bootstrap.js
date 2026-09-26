/**
 * Screenhouse SHPanel bootstrap.
 *
 * This file intentionally does not modify SHPanel. It supplies the same
 * project-level behavior around the canonical, byte-for-byte library:
 * - one Backquote-toggleable drawer per sketch;
 * - common animation, fullscreen, capture, and restart controls;
 * - automatic controls for window.LOOP_PARAMS schemas;
 * - a compatibility bridge for existing native dev-panel inputs.
 */
(function () {
  'use strict';

  if (window.__SH_PANEL_BOOTSTRAP__) return;
  window.__SH_PANEL_BOOTSTRAP__ = true;

  const runtime = { paused: false, timeScale: 1 };
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const pendingFrames = new Map();
  let frameId = 0;
  let realNow = performance.now();
  let virtualNow = realNow;

  window.requestAnimationFrame = function requestScreenhouseFrame(callback) {
    const id = ++frameId;
    const tick = (now) => {
      if (!pendingFrames.has(id)) return;
      if (runtime.paused) {
        realNow = now;
        pendingFrames.set(id, nativeRaf(tick));
        return;
      }
      const delta = Math.min(100, Math.max(0, now - realNow));
      realNow = now;
      virtualNow += delta * runtime.timeScale;
      pendingFrames.delete(id);
      callback(virtualNow);
    };
    pendingFrames.set(id, nativeRaf(tick));
    return id;
  };

  window.cancelAnimationFrame = function cancelScreenhouseFrame(id) {
    const nativeId = pendingFrames.get(id);
    if (nativeId !== undefined) nativeCancel(nativeId);
    pendingFrames.delete(id);
  };

  function textLabel(input, index) {
    const explicit = input.getAttribute('aria-label') || input.dataset.label || input.name;
    if (explicit) return explicit;
    if (input.id) {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label) return label.textContent.trim();
    }
    const wrappingLabel = input.closest('label');
    if (wrappingLabel) {
      const clone = wrappingLabel.cloneNode(true);
      clone.querySelectorAll('input, select, button, output').forEach((node) => node.remove());
      const value = clone.textContent.trim();
      if (value) return value;
    }
    return input.id || `Control ${index + 1}`;
  }

  function keyFor(item, index) {
    return item.key || item.prop || item.name || `parameter${index + 1}`;
  }

  function valueFor(api, item, key) {
    if (typeof api.get === 'function') {
      try { return api.get(key); } catch (_) {}
    }
    if (item.value !== undefined) return item.value;
    if (item.default !== undefined) return item.default;
    if (api.values && api.values[key] !== undefined) return api.values[key];
    return 0;
  }

  function folderFor(panel, folders, title) {
    const name = title || 'Parameters';
    if (!folders.has(name)) folders.set(name, panel.folder(name));
    return folders.get(name);
  }

  function addSchemaControls(panel, api) {
    if (!api || !Array.isArray(api.schema) || api.schema.length === 0) return 0;
    const folders = new Map();
    let count = 0;

    api.schema.forEach((item, index) => {
      const key = keyFor(item, index);
      const state = { [key]: valueFor(api, item, key) };
      const folder = folderFor(panel, folders, item.folder || item.group || item.category);
      const options = { label: item.label || item.title || key };
      let control;

      if (Array.isArray(item.options) || (item.options && typeof item.options === 'object')) {
        control = folder.select(state, key, { ...options, options: item.options });
      } else if (item.type === 'color' || /^#[0-9a-f]{3,8}$/i.test(String(state[key]))) {
        control = folder.color(state, key, options);
      } else if (item.type === 'checkbox' || item.type === 'boolean' || typeof state[key] === 'boolean') {
        control = folder.toggle(state, key, options);
      } else {
        const min = Number.isFinite(Number(item.min)) ? Number(item.min) : 0;
        const max = Number.isFinite(Number(item.max)) ? Number(item.max) : Math.max(1, Number(state[key]) * 2 || 1);
        const step = Number.isFinite(Number(item.step)) ? Number(item.step) : Math.max((max - min) / 100, 0.01);
        control = folder.slider(state, key, { ...options, min, max, step });
      }

      control.on('change', (event) => {
        if (typeof api.set === 'function') api.set(key, event.value);
        else if (api.values) api.values[key] = event.value;
        window.dispatchEvent(new CustomEvent('sh-panel-change', {
          detail: { key, value: event.value, source: 'schema' },
        }));
      });
      count += 1;
    });

    const actions = panel.folder('Actions', { expanded: false });
    let actionCount = 0;
    [['Reset parameters', 'reset'], ['Clear', 'clear'], ['Reseed', 'reseed']].forEach(([label, method]) => {
      if (typeof api[method] === 'function') {
        actions.button(label, () => api[method]());
        actionCount += 1;
      }
    });
    if (actionCount === 0) actions.el.remove();
    return count;
  }

  function candidateSource(input) {
    return input.closest([
      '.tp-dfwv', '.tp-rotv', '.lil-gui', '.dg', '.dev-panel', '.controls-panel',
      '#dev-panel', '#panel', '#controls', '.panel', '.controls', 'fieldset', 'details',
    ].join(','));
  }

  function addNativeControls(panel) {
    const inputs = [...document.querySelectorAll('input, select')].filter((input) => {
      if (input.closest('.sh-panel')) return false;
      if (input.type === 'hidden' || input.type === 'file' || input.disabled) return false;
      return input.matches('input[type="range"], input[type="color"], input[type="checkbox"], select');
    });
    if (inputs.length === 0) return 0;

    const folder = panel.folder('Parameters');
    const hiddenSources = new Set();
    inputs.forEach((input, index) => {
      const key = `native${index}`;
      const numeric = input.type === 'range';
      const state = { [key]: numeric ? Number(input.value) : input.type === 'checkbox' ? input.checked : input.value };
      const label = textLabel(input, index);
      let control;
      if (input.type === 'range') {
        control = folder.slider(state, key, {
          label,
          min: Number(input.min || 0),
          max: Number(input.max || 100),
          step: Number(input.step || 1),
        });
      } else if (input.type === 'color') {
        control = folder.color(state, key, { label });
      } else if (input.type === 'checkbox') {
        control = folder.toggle(state, key, { label });
      } else {
        const options = [...input.options].reduce((all, option) => {
          all[option.textContent.trim() || option.value] = option.value;
          return all;
        }, {});
        control = folder.select(state, key, { label, options });
      }
      control.on('change', (event) => {
        if (input.type === 'checkbox') input.checked = !!event.value;
        else input.value = String(event.value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const source = candidateSource(input);
      if (source) hiddenSources.add(source);
    });

    hiddenSources.forEach((source) => {
      source.dataset.shPanelSource = 'hidden';
      source.setAttribute('aria-hidden', 'true');
    });
    return inputs.length;
  }

  async function saveFrame() {
    const canvas = [...document.querySelectorAll('canvas')]
      .sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
    if (!canvas) return;
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return;
      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(blob);
      anchor.download = `${document.title || 'screenhouse-frame'}.png`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
    } catch (error) {
      console.warn('SHPanel could not save this canvas.', error);
    }
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }

  function init() {
    if (typeof window.SHPanel !== 'function') return;
    if (document.querySelector('.sh-panel')) {
      document.documentElement.dataset.shPanel = 'canonical';
      return;
    }

    const container = document.createElement('aside');
    container.id = 'sh-panel';
    container.setAttribute('aria-label', 'Screenhouse controls');
    document.body.appendChild(container);
    const panel = new window.SHPanel(container);

    const scene = panel.folder('Scene');
    scene.toggle(runtime, 'paused', { label: 'Pause animation' });
    scene.slider(runtime, 'timeScale', { label: 'Time scale', min: 0.1, max: 2, step: 0.05 });
    scene.button('Save frame', saveFrame);
    scene.button('Toggle fullscreen', toggleFullscreen);
    scene.button('Restart scene', () => location.reload());

    const count = addSchemaControls(panel, window.LOOP_PARAMS) || addNativeControls(panel);
    if (count === 0) {
      container.dataset.shPanelMode = 'scene-only';
    }

    window.SH_PANEL = { panel, runtime, source: window.LOOP_PARAMS || null };
    document.documentElement.dataset.shPanel = 'canonical';
    window.dispatchEvent(new CustomEvent('sh-panel-ready', { detail: window.SH_PANEL }));
  }

  const style = document.createElement('style');
  style.textContent = '[data-sh-panel-source="hidden"]{display:none!important}';
  document.head.appendChild(style);
  // Let bundled apps finish mounting their own controls before adaptation.
  window.addEventListener('load', () => setTimeout(init, 350), { once: true });
})();

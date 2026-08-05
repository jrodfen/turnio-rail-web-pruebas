/**
 * Matching de nombres de estación Excel Copérnico ↔ GTFS / operativa.
 * Usado por Enlazados (encaminamiento) y Mallas.
 */
(function (global) {
  'use strict';

  var STOP = {
    de: 1, del: 1, la: 1, las: 1, los: 1, el: 1, y: 1, the: 1,
    estación: 1, estacion: 1, apeadero: 1, andenes: 1
  };

  /** Alias: forma normalizada → forma canónica (también normalizada). */
  var ALIAS_A_CANON = {
    'sevilla s j': 'sevilla santa justa',
    'sevilla sj': 'sevilla santa justa',
    'sevilla s.j': 'sevilla santa justa',
    'sevilla santa justa': 'sevilla santa justa',
    'madrid p atocha almudena grand': 'madrid puerta de atocha almudena grandes',
    'madrid p atocha almudena grandes': 'madrid puerta de atocha almudena grandes',
    'madrid atocha almudena grand': 'madrid puerta de atocha almudena grandes',
    'madrid atocha almudena grandes': 'madrid puerta de atocha almudena grandes',
    'madrid puerta de atocha almudena grandes': 'madrid puerta de atocha almudena grandes',
    'madrid puerta atocha almudena grandes': 'madrid puerta de atocha almudena grandes',
    'madrid atocha': 'madrid puerta de atocha almudena grandes',
    'madrid atocha cer': 'madrid atocha cercanias',
    'madrid atocha cercanias': 'madrid atocha cercanias',
    'chamartin clara campoamor': 'madrid chamartin clara campoamor',
    'chamartin': 'madrid chamartin clara campoamor',
    'madrid chamartin': 'madrid chamartin clara campoamor',
    'madrid chamartin clara campoamor': 'madrid chamartin clara campoamor',
    'malaga maria zambrano': 'malaga maria zambrano',
    'malaga mz': 'malaga maria zambrano',
    'malaga': 'malaga maria zambrano',
    'antequera santa ana': 'antequera santa ana',
    'antequera av': 'antequera santa ana',
    'antequera': 'antequera santa ana',
    'barcelona sants': 'barcelona sants',
    'valencia nord': 'valencia nord',
    'valencia j sorolla': 'valencia joaquin sorolla',
    'valencia joaquin sorolla': 'valencia joaquin sorolla',
    'cordoba': 'cordoba',
    'granada': 'granada',
    'zaragoza delicias': 'zaragoza delicias',
    'alicante terminal': 'alacant terminal',
    'alacant terminal': 'alacant terminal',
    'dos hermanas': 'dos hermanas'
  };

  function normalizar(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' ')
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokensSignificativos_(n) {
    return normalizar(n).split(' ').filter(function (t) {
      return t && t.length > 1 && !STOP[t];
    });
  }

  function formasCanonicas_(nombre) {
    var n = normalizar(nombre);
    if (!n) return [];
    var out = {};
    out[n] = 1;
    if (ALIAS_A_CANON[n]) out[ALIAS_A_CANON[n]] = 1;
    /* Prefijos abreviados frecuentes en Excel. */
    if (/^sevilla s j\b/.test(n) || n === 'sevilla sj') out['sevilla santa justa'] = 1;
    if (/^madrid p atocha/.test(n) || /^madrid atocha/.test(n)) {
      out['madrid puerta de atocha almudena grandes'] = 1;
    }
    if (/^chamartin/.test(n)) out['madrid chamartin clara campoamor'] = 1;
    if (/^malaga\b/.test(n) && n.indexOf('zambrano') < 0) out['malaga maria zambrano'] = 1;
    return Object.keys(out);
  }

  function coinciden(a, b) {
    var formasA = formasCanonicas_(a);
    var formasB = formasCanonicas_(b);
    if (!formasA.length || !formasB.length) return false;
    var i, j;
    for (i = 0; i < formasA.length; i++) {
      for (j = 0; j < formasB.length; j++) {
        var x = formasA[i];
        var y = formasB[j];
        if (x === y) return true;
        if (x.length >= 6 && y.length >= 6 && (y.indexOf(x) >= 0 || x.indexOf(y) >= 0)) return true;
      }
    }
    /* Solape de tokens: ciudad + al menos otro token relevante, o ≥2 tokens fuertes. */
    var ta = tokensSignificativos_(formasA[0]);
    var tb = tokensSignificativos_(formasB[0]);
    if (ta.length && tb.length) {
      var setB = {};
      tb.forEach(function (t) { setB[t] = 1; });
      var comunes = ta.filter(function (t) { return setB[t]; });
      if (comunes.length >= 2) return true;
      /* "sevilla"+"justa" vs "sevilla"+"santa"+"justa" */
      if (comunes.length >= 1 && (ta.indexOf('justa') >= 0 && tb.indexOf('justa') >= 0)) return true;
      if (comunes.length >= 1 && (ta.indexOf('atocha') >= 0 && tb.indexOf('atocha') >= 0)) return true;
      if (comunes.length >= 1 && (ta.indexOf('sants') >= 0 && tb.indexOf('sants') >= 0)) return true;
      if (comunes.length >= 1 && (ta.indexOf('delicias') >= 0 && tb.indexOf('delicias') >= 0)) return true;
      if (comunes.length >= 1 && (ta.indexOf('chamartin') >= 0 && tb.indexOf('chamartin') >= 0)) return true;
      if (comunes.length >= 1 && (ta.indexOf('zambrano') >= 0 && tb.indexOf('zambrano') >= 0)) return true;
    }
    return false;
  }

  /**
   * Resuelve stop_ids GTFS a partir de un mapa { nombreVisible: [stopId,…] }.
   */
  function resolverStopIds(nombre, mapaNombreToIds) {
    if (!nombre || !mapaNombreToIds) return [];
    var exact = [];
    var alias = [];
    var parcial = [];
    var qFormas = formasCanonicas_(nombre);
    var q0 = qFormas[0] || '';
    Object.keys(mapaNombreToIds).forEach(function (key) {
      var ids = mapaNombreToIds[key] || [];
      if (!ids.length) return;
      var kFormas = formasCanonicas_(key);
      var k0 = kFormas[0] || '';
      var hitExact = false;
      var hitAlias = false;
      var i, j;
      for (i = 0; i < qFormas.length; i++) {
        for (j = 0; j < kFormas.length; j++) {
          if (qFormas[i] === kFormas[j]) {
            hitExact = true;
            break;
          }
        }
        if (hitExact) break;
      }
      if (hitExact) {
        exact = exact.concat(ids);
        return;
      }
      if (coinciden(nombre, key)) {
        hitAlias = true;
        alias = alias.concat(ids);
        return;
      }
      if (q0.length >= 6 && k0.length >= 6 && (k0.indexOf(q0) >= 0 || q0.indexOf(k0) >= 0)) {
        parcial = parcial.concat(ids);
      }
    });
    var ids = exact.length ? exact : (alias.length ? alias : parcial);
    var uniq = {};
    ids.forEach(function (id) { if (id) uniq[id] = true; });
    return Object.keys(uniq);
  }

  global.TurnioCxEstaciones = {
    normalizar: normalizar,
    coinciden: coinciden,
    formasCanonicas: formasCanonicas_,
    resolverStopIds: resolverStopIds
  };
})(window);

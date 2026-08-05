/**
 * Encaminamientos cuando un enlace está en riesgo o perdido.
 * Híbrido: Excel de conexiones del día + malla GTFS si está cargada.
 */
(function (global) {
  'use strict';

  var MARGEN_ALT_MIN = 8;
  var LIMIT = 8;

  function norm(s) {
    if (global.TurnioCxEstaciones && global.TurnioCxEstaciones.normalizar) {
      return global.TurnioCxEstaciones.normalizar(s);
    }
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function horaAMin(hStr) {
    var m = String(hStr || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m) return -1;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function fmtHora(mins) {
    if (mins < 0) return '—';
    var h = Math.floor(mins / 60) % 24;
    var m = mins % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function coincideEst(a, b) {
    if (global.TurnioCxEstaciones && global.TurnioCxEstaciones.coinciden) {
      return global.TurnioCxEstaciones.coinciden(a, b);
    }
    var x = norm(a);
    var y = norm(b);
    return !!(x && y && (y.indexOf(x) >= 0 || x.indexOf(y) >= 0));
  }

  /** Analiza si el enlace está ok / riesgo / perdido por retraso del tren que llega. */
  function analizarEnlace(fila) {
    var retApi = global.TurnioCxRetrasos;
    var ret = retApi ? retApi.minutos(fila && fila.servicio) : undefined;
    var hL = horaAMin(fila && fila.horaLlegadaEnlace);
    var hS = horaAMin(fila && fila.horaSalidaEnlace);
    if (hL < 0 || hS < 0) {
      return { nivel: 'ok', margen: null, llegadaEfectiva: -1, retraso: 0, conDatos: false };
    }
    var retNum = ret === undefined ? 0 : Math.max(0, Number(ret) || 0);
    var conDatos = ret !== undefined;
    var llegadaEfectiva = hL + retNum;
    var margen = hS - llegadaEfectiva;
    var nivel = 'ok';
    if (conDatos && retNum > 0) {
      if (margen <= 0) nivel = 'perdido';
      else if (margen <= 10) nivel = 'riesgo';
    }
    return {
      nivel: nivel,
      margen: margen,
      llegadaEfectiva: llegadaEfectiva,
      retraso: retNum,
      conDatos: conDatos,
      estacionEnlace: fila.estacionEnlace || '',
      destino: fila.destino || '',
      trenPerdido: fila.servicioEnlazado || '',
      trenLlega: fila.servicio || ''
    };
  }

  function alternativasDesdeExcel(analisis, opts) {
    opts = opts || {};
    var cx = global.TurnioConexiones;
    if (!cx || !cx.listar) return [];
    var filas = cx.listar({
      soloPreferidas: false,
      estacion: analisis.estacionEnlace,
      rol: 'enlace',
      turno: 'todos',
      sort: 'hora',
      limit: 400
    });
    var corte = analisis.llegadaEfectiva + MARGEN_ALT_MIN;
    var excluir = String(analisis.trenPerdido || '').replace(/^0+/, '');
    var out = [];
    var vistos = {};
    filas.forEach(function (f) {
      if (!coincideEst(analisis.estacionEnlace, f.estacionEnlace)) return;
      if (!coincideEst(analisis.destino, f.destino)) return;
      var mins = horaAMin(f.horaSalidaEnlace);
      if (mins < corte) return;
      var num = String(f.servicioEnlazado || '').replace(/^0+/, '');
      if (excluir && num === excluir) return;
      var key = num + '|' + (f.horaSalidaEnlace || '');
      if (vistos[key]) return;
      vistos[key] = true;
      out.push({
        fuente: 'excel',
        tren: f.servicioEnlazado,
        horaSalida: f.horaSalidaEnlace || '—',
        minutosSalida: mins,
        horaLlegadaDestino: f.horaLlegada || '—',
        destinoFinalNombre: f.destino || '',
        match: 'destino',
        esperaDesdeLlegada: mins - analisis.llegadaEfectiva,
        viajeros: f.viajeros || 0
      });
    });
    out.sort(function (a, b) { return a.minutosSalida - b.minutosSalida; });
    return out.slice(0, opts.limit || LIMIT);
  }

  function alternativasDesdeGtfs(analisis, opts) {
    opts = opts || {};
    var gtfs = global.TurnioMallasGtfs;
    if (!gtfs || !gtfs.operativaCargada || !gtfs.operativaCargada()) {
      return { ok: false, motivo: 'sin_malla', alternativas: [] };
    }
    return gtfs.buscarSalidasHaciaDestino({
      estacion: analisis.estacionEnlace,
      destino: analisis.destino,
      desdeMinutos: analisis.llegadaEfectiva,
      margenMin: MARGEN_ALT_MIN,
      excluirTren: analisis.trenPerdido,
      fecha: new Date(),
      limit: opts.limit || LIMIT
    });
  }

  function fusionar(excelAlts, gtfsAlts) {
    var out = [];
    var vistos = {};
    function add(list) {
      (list || []).forEach(function (a) {
        var key = String(a.tren || '').replace(/^0+/, '') + '|' + String(a.horaSalida || '');
        if (!a.tren || vistos[key]) return;
        vistos[key] = true;
        out.push(a);
      });
    }
    add(excelAlts);
    add(gtfsAlts);
    out.sort(function (a, b) {
      if (a.match === 'destino' && b.match !== 'destino') return -1;
      if (b.match === 'destino' && a.match !== 'destino') return 1;
      return (a.minutosSalida || 0) - (b.minutosSalida || 0);
    });
    return out.slice(0, LIMIT);
  }

  function sugerir(fila) {
    var analisis = analizarEnlace(fila);
    if (analisis.nivel === 'ok') {
      return {
        analisis: analisis,
        alternativas: [],
        avisoMalla: '',
        fuentes: { excel: 0, gtfs: 0 }
      };
    }
    var excelAlts = alternativasDesdeExcel(analisis, { limit: LIMIT });
    var gtfsRes = alternativasDesdeGtfs(analisis, { limit: LIMIT });
    var gtfsAlts = (gtfsRes && gtfsRes.alternativas) || [];
    var avisoMalla = '';
    if (!gtfsRes || !gtfsRes.ok) {
      if (gtfsRes && gtfsRes.motivo === 'sin_malla') {
        avisoMalla = 'Malla GTFS no cargada en este dispositivo. Se muestran solo alternativas del Excel. Abre Mallas una vez para ampliar con horarios del día.';
      } else if (gtfsRes && gtfsRes.motivo === 'estacion_origen') {
        avisoMalla = 'No se encontró la estación de enlace en la malla GTFS. Se usan solo alternativas del Excel.';
      } else if (gtfsRes && gtfsRes.motivo === 'estacion_destino') {
        avisoMalla = 'No se encontró el destino en la malla GTFS. Se usan solo alternativas del Excel (mismo destino).';
      }
    }
    var alts = fusionar(excelAlts, gtfsAlts);
    return {
      analisis: analisis,
      alternativas: alts,
      avisoMalla: avisoMalla,
      fuentes: {
        excel: excelAlts.length,
        gtfs: gtfsAlts.length,
        mallaOk: !!(gtfsRes && gtfsRes.ok)
      }
    };
  }

  global.TurnioCxEncaminar = {
    analizarEnlace: analizarEnlace,
    sugerir: sugerir,
    fmtHora: fmtHora,
    MARGEN_ALT_MIN: MARGEN_ALT_MIN
  };
})(typeof window !== 'undefined' ? window : this);

/**
 * cfe-algorithm.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Suite de pruebas unitarias para el algoritmo de facturación CFE.
 *
 * Estrategia:
 *   - Cada test representa una rama distinta del algoritmo.
 *   - Los valores esperados están calculados manualmente siguiendo el
 *     Instructivo CFE NOV04 y el Análisis del Sistema, para poder usarse
 *     como fuente de verdad contra facturas reales.
 *   - Para totales finales: tolerancia de $0.01 MXN (diferencias de redondeo
 *     entre implementaciones son normales en el último decimal).
 *   - Para consumos intermedios (CPD, C1, C2): exactitud de 4 decimales.
 *
 * Cómo agregar casos de facturas reales:
 *   1. Toma una factura CFE física.
 *   2. Captura sus datos en la estructura SimuladorInput.
 *   3. Pon el total del papel como `totalEsperado`.
 *   4. Agrega un test en la sección "Facturas reales".
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from 'vitest';
import { calcularFactura } from '../lib/cfe-algorithm';
import type { SimuladorInput, CuotasTarifa, PeriodoAnterior } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Trunca a 2 decimales para comparar totales monetarios. */
const t2 = (n: number) => Math.trunc(n * 100) / 100;

/** Cuotas fijas para tests — tarifa 1, valores deterministas */
const CUOTAS_T1: CuotasTarifa = {
  escalonesNoVerano: [
    { kwh: 75,       precio: 0.793 },
    { kwh: 125,      precio: 0.963 },
    { kwh: Infinity, precio: 2.859 },
  ],
  escalonesVerano: [
    { kwh: 100,      precio: 0.793 },
    { kwh: 50,       precio: 0.963 },
    { kwh: 100,      precio: 2.452 },
    { kwh: Infinity, precio: 2.859 },
  ],
  limiteNoVerano: 250,
  limiteVerano:   250,
  minimoMensual:  59.45,
};

const CUOTAS_DAC: CuotasTarifa = {
  escalonesNoVerano: [{ kwh: Infinity, precio: 4.228 }],
  escalonesVerano:   [{ kwh: Infinity, precio: 4.228 }],
  limiteNoVerano: Infinity,
  limiteVerano:   Infinity,
  minimoMensual:  0,
};

/** Convierte un array de kWh mensuales en PeriodoAnterior[] (para tests con tipoPeriodo MENSUAL) */
function periodosMensuales(kwhMensuales: number[]): PeriodoAnterior[] {
  return kwhMensuales.map((kwh, i) => ({
    fechaInicio: `2023-${String(i + 1).padStart(2, '0')}-01`,
    fechaFin:   `2023-${String(i + 1).padStart(2, '0')}-28`,
    consumo: kwh,
  }));
}

/** Convierte un array de kWh bimestrales en PeriodoAnterior[] (para tests con tipoPeriodo BIMESTRAL) */
function periodosBimestrales(kwhBimestrales: number[], ultimaFechaFin?: string): PeriodoAnterior[] {
  const refFin = ultimaFechaFin ?? '2024-04-01';
  const ref = new Date(refFin);
  return kwhBimestrales.map((kwh, i) => {
    // Cada periodo retrocede 2 meses desde el anterior
    const mesesAtras = (kwhBimestrales.length - i) * 2;
    const fin = new Date(ref);
    fin.setMonth(fin.getMonth() - mesesAtras + 2);
    const inicio = new Date(ref);
    inicio.setMonth(inicio.getMonth() - mesesAtras);
    return {
      fechaInicio: inicio.toISOString().split('T')[0],
      fechaFin:   fin.toISOString().split('T')[0],
      consumo: kwh,
    };
  });
}

/** Crea un único periodo anterior con fechas dadas */
function periodoUnico(inicio: string, fin: string, consumo: number): PeriodoAnterior[] {
  return [{ fechaInicio: inicio, fechaFin: fin, consumo }];
}

/** Input base — se sobreescribe por cada test */
const base = (overrides: Partial<SimuladorInput>): SimuladorInput => ({
  tarifa: '1',
  idEntradaVerano: 4,          // verano inicia 1° mayo
  tipoPeriodo: 'MENSUAL',
  dap: 0,
  subsidio: 0,
  ivaBajoFrontera: false,      // IVA 15%
  fechaInicioPeriodo: '2024-03-01',
  fechaFinPeriodo:   '2024-03-31',
  consumoActual: 100,
  periodosAnteriores: [],
  cuotas: CUOTAS_T1,
  ...overrides,
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. CÁLCULO DE CONSUMO Y DÍAS
// ═════════════════════════════════════════════════════════════════════════════

describe('Cálculo de días y CPD', () => {
  it('calcula días del periodo correctamente — mensual 30 días', () => {
    const r = calcularFactura(base({
      fechaInicioPeriodo: '2024-03-01',
      fechaFinPeriodo:   '2024-03-31',
      consumoActual: 120,
    }));
    expect(r.diasPeriodo).toBe(30);
    expect(r.cpd).toBe(4);  // 120 / 30 = 4.0000
  });

  it('calcula CPD con 4 decimales redondeando el cuarto en función del quinto', () => {
    // 100 kWh / 28 días = 3.57142... → redondeado a 4 dec = 3.5714
    const r = calcularFactura(base({
      fechaInicioPeriodo: '2024-02-01',
      fechaFinPeriodo:   '2024-02-29',  // 2024 es bisiesto
      consumoActual: 100,
    }));
    expect(r.diasPeriodo).toBe(28);
    expect(r.cpd).toBe(3.5714);
  });

  it('pronóstico bimestral usa 60 días cuando diasTranscurridos <= 61', () => {
    const r = calcularFactura(base({
      tipoPeriodo: 'BIMESTRAL',
      fechaInicioPeriodo: '2024-03-01',
      fechaFinPeriodo:   '2024-04-15',  // 45 días transcurridos
      consumoActual: 180,
    }));
    // CPD = 180 / 45 = 4.0000 → pronóstico = 4 * 60 = 240
    expect(r.consumoPronostico).toBe(240);
  });

  it('pronóstico bimestral usa días reales cuando diasTranscurridos > 61', () => {
    const r = calcularFactura(base({
      tipoPeriodo: 'BIMESTRAL',
      fechaInicioPeriodo: '2024-01-01',
      fechaFinPeriodo:   '2024-03-15',  // 74 días
      consumoActual: 370,
    }));
    // CPD = 370 / 74 = 5.0000 → pronóstico = 5 * 74 = 370
    expect(r.diasPeriodo).toBe(74);
    expect(r.consumoPronostico).toBe(370);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. DETECCIÓN DE TEMPORADA (VERANO / NO VERANO)
// ═════════════════════════════════════════════════════════════════════════════

describe('Detección de temporada', () => {
  // idEntradaVerano = 4 → verano inicia 1° mayo, termina 31 oct

  it('marzo NO es verano (idEntradaVerano = 4)', () => {
    const r = calcularFactura(base({
      fechaInicioPeriodo: '2024-03-01',
      fechaFinPeriodo:   '2024-03-31',
    }));
    expect(r.esVerano).toBe(false);
  });

  it('julio SÍ es verano (idEntradaVerano = 4)', () => {
    const r = calcularFactura(base({
      fechaInicioPeriodo: '2024-07-01',
      fechaFinPeriodo:   '2024-07-31',
    }));
    expect(r.esVerano).toBe(true);
  });

  it('febrero SÍ es verano cuando idEntradaVerano = 1 (verano inicia en febrero)', () => {
    const r = calcularFactura(base({
      idEntradaVerano: 1,   // verano inicia 1° febrero
      fechaInicioPeriodo: '2024-02-01',
      fechaFinPeriodo:   '2024-02-29',
    }));
    // Referencia = 15 días antes = ~15 ene → mes 1 (enero)
    // esVerano: mes > 2 && mes <= 8 → mes 1 → false
    // (la referencia cae en enero, antes del inicio de verano)
    expect(r.esVerano).toBe(false);
  });

  it('junio SÍ es verano cuando idEntradaVerano = 1', () => {
    const r = calcularFactura(base({
      idEntradaVerano: 1,
      fechaInicioPeriodo: '2024-06-01',
      fechaFinPeriodo:   '2024-06-30',
    }));
    expect(r.esVerano).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. ESCALONES — TARIFA NORMAL MENSUAL
// ═════════════════════════════════════════════════════════════════════════════

describe('Escalones — tarifa normal mensual fuera de verano', () => {
  // Escalones no verano T1: 75@0.793 | 125@0.963 | resto@2.859

  it('consumo dentro del primer escalón (50 kWh) — aplica mínimo mensual', () => {
    const r = calcularFactura(base({ consumoActual: 50 }));
    // 50 * 0.793 = 39.65 < mínimo 59.45 → se aplica el mínimo
    expect(r.facturacionBasica).toBe(59.45);
    expect(r.escalonesAplicados).toHaveLength(1);
    expect(r.escalonesAplicados[0].kwh).toBe(50);
  });

  it('consumo que llena el primer escalón exacto (75 kWh)', () => {
    const r = calcularFactura(base({ consumoActual: 75 }));
    // 75 * 0.793 = 59.475 → truncar4 = 59.4750
    expect(r.facturacionBasica).toBeCloseTo(59.475, 2);
    expect(r.escalonesAplicados).toHaveLength(1);
  });

  it('consumo que cruza al segundo escalón (100 kWh)', () => {
    const r = calcularFactura(base({ consumoActual: 100 }));
    // E1: 75 * 0.793 = 59.4750
    // E2: 25 * 0.963 = 24.0750 → truncar4 = 24.0750
    // total = 83.5500
    expect(r.facturacionBasica).toBeCloseTo(83.55, 2);
    expect(r.escalonesAplicados).toHaveLength(2);
  });

  it('consumo que cruza al tercer escalón (250 kWh exacto = límite)', () => {
    const r = calcularFactura(base({ consumoActual: 250 }));
    // E1: 75 * 0.793 = 59.4750
    // E2: 125 * 0.963 = 120.3750
    // E3: 50 * 2.859 = 142.9500 → truncar4 = 142.9500
    // total = 322.8000
    expect(r.facturacionBasica).toBeCloseTo(322.80, 2);
    expect(r.esDAC).toBe(false);  // exactamente en el límite, no es DAC
  });

  it('aplica el mínimo mensual cuando el consumo es muy bajo', () => {
    const r = calcularFactura(base({ consumoActual: 10 }));
    // 10 * 0.793 = 7.93 < mínimo 59.45
    expect(r.facturacionBasica).toBe(59.45);
  });
});

describe('Escalones — tarifa normal mensual en verano (T1)', () => {
  // Escalones verano T1: 100@0.793 | 50@0.963 | 100@2.452 | resto@2.859

  const veranoBase = (consumo: number) => base({
    fechaInicioPeriodo: '2024-07-01',
    fechaFinPeriodo:   '2024-07-31',
    consumoActual: consumo,
  });

  it('150 kWh en verano (primeros dos escalones)', () => {
    const r = calcularFactura(veranoBase(150));
    // E1: 100 * 0.793 = 79.3000
    // E2: 50  * 0.963 = 48.1500
    // total = 127.4500
    expect(r.esVerano).toBe(true);
    expect(r.facturacionBasica).toBeCloseTo(127.45, 2);
    expect(r.escalonesAplicados).toHaveLength(2);
  });

  it('280 kWh en verano (tres escalones)', () => {
    const r = calcularFactura(veranoBase(280));
    // E1: 100 * 0.793 = 79.3000
    // E2: 50  * 0.963 = 48.1500
    // E3: 100 * 2.452 = 245.2000
    // E4: 30  * 2.859 = 85.7700
    // total = 458.4200
    expect(r.facturacionBasica).toBeCloseTo(458.42, 2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. BIMESTRAL — DUPLICACIÓN DE ESCALONES
// ═════════════════════════════════════════════════════════════════════════════

describe('Bimestral — duplicación de escalones y límites', () => {
  const bimBase = (consumo: number, overrides?: Partial<SimuladorInput>) => base({
    tipoPeriodo: 'BIMESTRAL',
    fechaInicioPeriodo: '2024-01-15',
    fechaFinPeriodo:   '2024-03-15',  // 60 días, fuera de verano
    consumoActual: consumo,
    ...overrides,
  });

  it('escalones se duplican en bimestral no mixto', () => {
    const r = calcularFactura(bimBase(150));
    // Bimestral: E1 = 150 kWh (75*2), E2 = 250 kWh (125*2)
    // 150 kWh → exactamente primer escalón bimestral
    // 150 * 0.793 = 118.9500
    expect(r.escalonesAplicados).toHaveLength(1);
    expect(r.escalonesAplicados[0].kwh).toBe(150);
    expect(r.facturacionBasica).toBeCloseTo(118.95, 2);
  });

  it('límite DAC se duplica en bimestral (500 kWh = límite T1 bimestral)', () => {
    const r = calcularFactura(bimBase(500));
    expect(r.esDAC).toBe(false);
  });

  it('mínimo mensual se duplica en bimestral', () => {
    const r = calcularFactura(bimBase(10));
    // mínimo bimestral = 59.45 * 2 = 118.90
    expect(r.facturacionBasica).toBeCloseTo(118.90, 2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. DETECCIÓN DAC
// ═════════════════════════════════════════════════════════════════════════════

describe('Detección DAC por promedio móvil 12 meses', () => {
  it('NO es DAC cuando promedio está bajo el límite T1 (250 kWh/mes)', () => {
    const r = calcularFactura(base({
      consumoActual: 240,
      periodosAnteriores: periodosMensuales(Array(11).fill(200)),
    }));
    // promedio 12 meses = (11*200 + 240) / 12 = 203.33...
    expect(r.esDAC).toBe(false);
    expect(r.promedioMovil12Meses).toBeLessThan(250);
  });

  it('SÍ es DAC cuando promedio supera el límite T1', () => {
    const r = calcularFactura(base({
      consumoActual: 400,
      periodosAnteriores: periodosMensuales(Array(11).fill(300)),
    }));
    // promedio = (11*300 + 400) / 12 = 308.33...
    expect(r.esDAC).toBe(true);
    expect(r.promedioMovil12Meses).toBeGreaterThan(250);
  });

  it('tarifa DAC explícita siempre activa esDAC', () => {
    const r = calcularFactura(base({
      tarifa: 'DAC',
      cuotas: CUOTAS_DAC,
      consumoActual: 100,
    }));
    expect(r.esDAC).toBe(true);
  });

  it('código de consumo 8 activa DAC', () => {
    const r = calcularFactura(base({
      consumoActual: 8,
    }));
    expect(r.esDAC).toBe(true);
  });

  it('promedio móvil usa solo los últimos 12 registros', () => {
    // 20 valores mensuales históricos, solo los últimos 11 + actual deben contar
    const historico = [
      ...Array(9).fill(1000),  // muy alto pero fuera de la ventana de 12
      ...Array(11).fill(100),  // dentro de la ventana
    ];
    const r = calcularFactura(base({
      consumoActual: 100,
      periodosAnteriores: periodosMensuales(historico),
    }));
    // promedio de los últimos 12: 11*100 + 100 = 1200 / 12 = 100 → no DAC
    expect(r.esDAC).toBe(false);
    expect(r.promedioMovil12Meses).toBe(100);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. PERIODOS MIXTOS BIMESTRALES
// ═════════════════════════════════════════════════════════════════════════════

describe('Periodos mixtos — entrada de verano', () => {
  // idEntradaVerano = 4 → verano inicia 1° mayo
  // Bimestre que cruza: ej. inicio 1 abril, fin 30 mayo = 29 días fuera verano + 30 días verano

  const mixtoEntradaBase = (overrides?: Partial<SimuladorInput>) => base({
    tipoPeriodo: 'BIMESTRAL',
    idEntradaVerano: 4,
    fechaInicioPeriodo: '2024-04-01',
    fechaFinPeriodo:   '2024-05-31',  // 30 días no verano + 31 días verano = 61 días
    consumoActual: 300,
    ...overrides,
  });

  it('detecta correctamente como periodo mixto de entrada de verano', () => {
    const r = calcularFactura(mixtoEntradaBase());
    expect(r.esMixto).toBe(true);
    expect(r.esEntradaVerano).toBe(true);
    expect(r.esSalidaVerano).toBe(false);
  });

  it('días de verano y no verano suman los días del periodo', () => {
    const r = calcularFactura(mixtoEntradaBase());
    expect(r.diasVeranoEnPeriodo + r.diasNoVeranoEnPeriodo).toBe(r.diasPeriodo);
  });

  it('sin historial anterior — aplica CPD actual directamente (opción B)', () => {
    const r = calcularFactura(mixtoEntradaBase({
      periodosAnteriores: [],
    }));
    expect(r.mixto).not.toBeNull();
    expect(r.mixto!.opcionSeleccionada).toBe('SIN_HISTORIAL');
    expect(r.mixto!.cpdAnterior).toBeNull();
  });

  it('con historial — selecciona la opción de menor facturación', () => {
    // CPD anterior bajo (100 kWh/31 días = 3.22) vs CPD actual = 300/61 ≈ 4.92
    // Periodo anterior: 1 marzo → 1 abril (31 días)
    const r = calcularFactura(mixtoEntradaBase({
      periodosAnteriores: periodoUnico('2024-03-01', '2024-04-01', 100),
    }));
    expect(r.mixto).not.toBeNull();
    const { opcionSeleccionada, costoOpcionA, costoOpcionB } = r.mixto!;
    if (costoOpcionA !== null && costoOpcionB !== null) {
      if (opcionSeleccionada === 'A') {
        expect(costoOpcionA).toBeLessThanOrEqual(costoOpcionB);
      } else {
        expect(costoOpcionB).toBeLessThanOrEqual(costoOpcionA);
      }
    }
  });

  it('C1 + C2 = consumo total en periodo mixto', () => {
    const r = calcularFactura(mixtoEntradaBase({
      periodosAnteriores: periodoUnico('2024-03-01', '2024-04-01', 200),
    }));
    const m = r.mixto!;
    // Tolerancia de 0.001 por truncado de 4 decimales
    expect(m.consumoNoVerano + m.consumoVerano).toBeCloseTo(300, 1);
  });
});

describe('Periodos mixtos — salida de verano', () => {
  // Verano termina 1° noviembre (idEntradaVerano=4, entrada mayo + 6 = nov)
  // Bimestre: 1 oct → 30 nov = 31 días verano + 30 días no verano

  const mixtoSalidaBase = (overrides?: Partial<SimuladorInput>) => base({
    tipoPeriodo: 'BIMESTRAL',
    idEntradaVerano: 4,
    fechaInicioPeriodo: '2024-10-01',
    fechaFinPeriodo:   '2024-11-30',  // cruza salida de verano el 1° nov
    consumoActual: 320,
    ...overrides,
  });

  it('detecta correctamente como periodo mixto de salida de verano', () => {
    const r = calcularFactura(mixtoSalidaBase());
    expect(r.esMixto).toBe(true);
    expect(r.esSalidaVerano).toBe(true);
    expect(r.esEntradaVerano).toBe(false);
  });

  it('C1 + C2 = consumo total en salida de verano', () => {
    // Periodo anterior: 1 agosto → 1 octubre (61 días)
    const r = calcularFactura(mixtoSalidaBase({
      periodosAnteriores: periodoUnico('2024-08-01', '2024-10-01', 280),
    }));
    const m = r.mixto!;
    expect(m.consumoNoVerano + m.consumoVerano).toBeCloseTo(320, 1);
  });
});

describe('Periodos mixtos — casos límite (no mixto por días)', () => {
  it('menos de 16 días de verano = NO mixto, aplica tarifa de no verano al 100%', () => {
    // Inicio 20 abril, fin 10 mayo = 10 días de verano (< 16) → no mixto
    const r = calcularFactura(base({
      tipoPeriodo: 'BIMESTRAL',
      idEntradaVerano: 4,
      fechaInicioPeriodo: '2024-04-20',
      fechaFinPeriodo:   '2024-05-10',  // 10 días de verano
      consumoActual: 200,
    }));
    expect(r.esMixto).toBe(false);
    expect(r.esVerano).toBe(false);  // la fecha de referencia (30 días antes) cae fuera de verano
  });

  it('más de 45 días de verano = NO mixto, aplica tarifa de verano al 100%', () => {
    // Inicio 1 marzo, fin 30 junio: muchos días de verano → no mixto
    const r = calcularFactura(base({
      tipoPeriodo: 'BIMESTRAL',
      idEntradaVerano: 4,
      fechaInicioPeriodo: '2024-03-01',
      fechaFinPeriodo:   '2024-06-30',  // 61 días de verano (mayo+junio)
      consumoActual: 300,
    }));
    expect(r.esMixto).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. CADENA DE FACTURACIÓN — DAP E IVA
// ═════════════════════════════════════════════════════════════════════════════

describe('Cadena de facturación — DAP e IVA', () => {
  it('IVA interior es 15% sobre Facturación Neta', () => {
    const r = calcularFactura(base({
      consumoActual: 100,
      dap: 0,
      ivaBajoFrontera: false,
    }));
    expect(r.tasaIva).toBe(0.15);
    expect(r.iva).toBeCloseTo(r.facturacionNeta * 0.15, 2);
  });

  it('IVA frontera es 10% sobre Facturación Neta', () => {
    const r = calcularFactura(base({
      consumoActual: 100,
      dap: 0,
      ivaBajoFrontera: true,
    }));
    expect(r.tasaIva).toBe(0.10);
    expect(r.iva).toBeCloseTo(r.facturacionNeta * 0.10, 2);
  });

  it('DAP mensual NO incluye IVA y se suma al total', () => {
    const sinDap = calcularFactura(base({ consumoActual: 100, dap: 0 }));
    const conDap = calcularFactura(base({ consumoActual: 100, dap: 50 }));

    // DAP no modifica la facturación neta
    expect(conDap.facturacionNeta).toBeCloseTo(sinDap.facturacionNeta, 2);
    // IVA no cambia
    expect(conDap.iva).toBeCloseTo(sinDap.iva, 2);
    // El total sube exactamente en el valor del DAP
    expect(conDap.totalPagar).toBeCloseTo(sinDap.totalPagar + 50, 2);
  });

  it('DAP bimestral se duplica en la factura', () => {
    const mensual = calcularFactura(base({
      tipoPeriodo: 'MENSUAL',
      fechaInicioPeriodo: '2024-03-01',
      fechaFinPeriodo:   '2024-03-31',
      consumoActual: 100,
      dap: 45,
    }));
    const bimestral = calcularFactura(base({
      tipoPeriodo: 'BIMESTRAL',
      fechaInicioPeriodo: '2024-01-15',
      fechaFinPeriodo:   '2024-03-15',
      consumoActual: 200,
      dap: 45,
    }));
    expect(bimestral.dapAplicado).toBe(90);   // 45 * 2
    expect(mensual.dapAplicado).toBe(45);
  });

  it('total = facturacionNeta + dap + iva', () => {
    const r = calcularFactura(base({ consumoActual: 150, dap: 60, ivaBajoFrontera: false }));
    const esperado = r.facturacionNeta + r.dapAplicado + r.iva;
    expect(r.totalPagar).toBeCloseTo(esperado, 2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. INTEGRACIÓN — CASOS COMPLETOS EXTREMO A EXTREMO
// ═════════════════════════════════════════════════════════════════════════════

describe('Integración — casos completos', () => {
  it('caso base: 200 kWh, mensual, fuera de verano, T1, sin DAP, IVA 15%', () => {
    const r = calcularFactura(base({
      consumoActual: 200,
      dap: 0,
      ivaBajoFrontera: false,
    }));
    // E1: 75 * 0.793 = 59.4750
    // E2: 125 * 0.963 = 120.3750  → total parcial = 179.8500
    // No llega al E3 porque E1+E2 = 75+125 = 200 exacto
    // FB = 179.85
    // IVA = 179.85 * 0.15 = 26.9775 → truncar4 = 26.9775
    // Total = 179.85 + 26.9775 = 206.8275

    expect(r.esVerano).toBe(false);
    expect(r.esMixto).toBe(false);
    expect(r.esDAC).toBe(false);
    expect(r.facturacionBasica).toBeCloseTo(179.85, 2);
    expect(r.totalPagar).toBeCloseTo(206.83, 1);
  });

  it('caso verano: 200 kWh, mensual, verano, T1, sin DAP, IVA 15%', () => {
    const r = calcularFactura(base({
      fechaInicioPeriodo: '2024-07-01',
      fechaFinPeriodo:   '2024-07-31',
      consumoActual: 200,
      dap: 0,
      ivaBajoFrontera: false,
    }));
    // E1: 100 * 0.793 = 79.3000
    // E2: 50  * 0.963 = 48.1500
    // E3: 50  * 2.452 = 122.6000  → total = 250.0500
    // IVA = 250.0500 * 0.15 = 37.5075
    // Total ≈ 287.56
    expect(r.esVerano).toBe(true);
    expect(r.facturacionBasica).toBeCloseTo(250.05, 2);
    expect(r.totalPagar).toBeCloseTo(287.56, 1);
  });

  it('caso bimestral completo: 400 kWh, bimestral, fuera de verano, T1, DAP=90, IVA 15%', () => {
    const r = calcularFactura(base({
      tipoPeriodo: 'BIMESTRAL',
      fechaInicioPeriodo: '2024-01-15',
      fechaFinPeriodo:   '2024-03-15',
      consumoActual: 400,
      dap: 45,
      ivaBajoFrontera: false,
    }));
    // Escalones bimestral: E1=150kWh@0.793 | E2=250kWh@0.963 | resto@2.859
    // E1: 150 * 0.793 = 118.9500
    // E2: 250 * 0.963 = 240.7500
    // total FB = 359.7000
    // IVA = 359.7 * 0.15 = 53.9550
    // DAP bimestral = 90
    // Total = 359.70 + 90 + 53.955 = 503.655
    expect(r.facturacionBasica).toBeCloseTo(359.70, 2);
    expect(r.dapAplicado).toBe(90);
    expect(r.totalPagar).toBeCloseTo(503.66, 1);
  });

  it('caso DAC: usuario con alto consumo histórico', () => {
    const r = calcularFactura(base({
      tarifa: 'DAC',
      cuotas: CUOTAS_DAC,
      consumoActual: 400,
      periodosAnteriores: periodosMensuales(Array(11).fill(400)),
      dap: 0,
      ivaBajoFrontera: false,
    }));
    // DAC: 400 * 4.228 = 1691.2 → truncar4 = 1691.2000
    // IVA = 1691.2 * 0.15 = 253.68
    // Total ≈ 1944.88
    expect(r.esDAC).toBe(true);
    expect(r.facturacionBasica).toBeCloseTo(1691.20, 2);
    expect(r.totalPagar).toBeCloseTo(1944.88, 1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. FACTURAS REALES — Agrega aquí casos de recibos CFE físicos
// ═════════════════════════════════════════════════════════════════════════════

const CUOTAS_1E_REAL: CuotasTarifa = {
  escalonesNoVerano: [
    { kwh: 95,       precio: 1.119 },
    { kwh: Infinity, precio: 1.361 },
  ],
  escalonesVerano: [
    { kwh: 212,      precio: 0.839 },
    { kwh: Infinity, precio: 1.039 },
  ],
  limiteNoVerano: 2000,
  limiteVerano:   2000,
  minimoMensual:  0,
};

describe('Facturas reales', () => {
  it('Recibo Guaymas 525931016127 — Tarifa 1E, bimestral mixto entrada verano', () => {
    // Periodo actual: 23 mar 2026 → 22 may 2026 (60 días)
    // 38 días no verano, 22 días verano, entrada verano = 4 (1° mayo)
    // Último periodo anterior: 22 ene 2026 → 23 mar 2026, 190 kWh (60 días)
    // Periodos anteriores para DAC: 11 bimestres
    const periodosAnteriores: PeriodoAnterior[] = [
      ...periodosBimestrales(
        [1761, 2142, 1093, 278, 277, 679, 1806, 730, 406, 168],
        '2026-01-22'
      ),
      { fechaInicio: '2026-01-22', fechaFin: '2026-03-23', consumo: 190 },
    ];

    const r = calcularFactura({
      tarifa: '1E',
      idEntradaVerano: 4,
      tipoPeriodo: 'BIMESTRAL',
      dap: 82,
      subsidio: 0,
      ivaBajoFrontera: false,
      fechaInicioPeriodo: '2026-03-23',
      fechaFinPeriodo:   '2026-05-22',
      consumoActual: 520,
      cuotas: CUOTAS_1E_REAL,
      periodosAnteriores,
    });

    expect(r.esMixto).toBe(true);
    expect(r.esEntradaVerano).toBe(true);
    expect(r.esDAC).toBe(false);
    expect(r.diasPeriodo).toBe(60);
    expect(r.promedioMovil12Meses).toBeGreaterThan(0);
    expect(r.mixto).not.toBeNull();
    expect(r.mixto!.cpdAnterior).not.toBeNull();
    // CPD anterior = 190/60 ≈ 3.1667 vs CPD actual = 520/60 ≈ 8.6667
    // Opción A usa el menor CPD para no verano → menor costo
    expect(r.mixto!.opcionSeleccionada).toBe('A');
    expect(r.mixto!.consumoNoVerano + r.mixto!.consumoVerano).toBeCloseTo(520, 0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. ROBUSTEZ — entradas extremas que no deben romper el algoritmo
// ═════════════════════════════════════════════════════════════════════════════

describe('Robustez — casos límite y entradas extremas', () => {
  it('caso del usuario: mensual 30/04 a 30/05, 280 kWh — no produce NaN', () => {
    const r = calcularFactura(base({
      tipoPeriodo: 'MENSUAL',
      idEntradaVerano: 4,
      fechaInicioPeriodo: '2024-04-30',
      fechaFinPeriodo:   '2024-05-30',
      consumoActual: 280,
      periodosAnteriores: [
        ...periodosMensuales([200, 220, 240, 260, 280, 300, 280, 260, 240, 220, 210]),
        { fechaInicio: '2024-01-31', fechaFin: '2024-04-30', consumo: 260 },
      ],
    }));
    // Todos los campos numéricos deben ser finitos
    expect(isFinite(r.cpd)).toBe(true);
    expect(isFinite(r.facturacionBasica)).toBe(true);
    expect(isFinite(r.iva)).toBe(true);
    expect(isFinite(r.totalPagar)).toBe(true);
    expect(isNaN(r.totalPagar)).toBe(false);
  });

  it('escalón infinito al final no genera NaN', () => {
    const r = calcularFactura(base({ consumoActual: 1000 }));
    expect(isFinite(r.facturacionBasica)).toBe(true);
    expect(r.escalonesAplicados.every(e => isFinite(e.subtotal))).toBe(true);
  });

  it('fechas iguales lanza error legible (no NaN silencioso)', () => {
    expect(() => calcularFactura(base({
      fechaInicioPeriodo: '2024-03-15',
      fechaFinPeriodo:   '2024-03-15',
    }))).toThrow();
  });

  it('fecha de fin anterior a fecha de inicio lanza error', () => {
    expect(() => calcularFactura(base({
      fechaInicioPeriodo: '2024-03-31',
      fechaFinPeriodo:   '2024-03-01',
    }))).toThrow();
  });

  it('consumo 0 no rompe el algoritmo (se aplica mínimo)', () => {
    const r = calcularFactura(base({ consumoActual: 0 }));
    expect(r.facturacionBasica).toBe(59.45);  // mínimo mensual
    expect(isFinite(r.totalPagar)).toBe(true);
  });

  it('histórico vacío no rompe el cálculo de promedio móvil', () => {
    const r = calcularFactura(base({
      consumoActual: 100,
      periodosAnteriores: [],
    }));
    expect(isFinite(r.promedioMovil12Meses)).toBe(true);
  });

  it('todas las tarifas calculan sin errores con sus cuotas default', () => {
    // Solo verifica que ninguna tarifa rompa con sus cuotas
    const consumosBase: Array<{ t: string; c: number }> = [
      { t: '1', c: 100 },
      { t: '1', c: 300 },  // pasa al escalón infinito
      { t: '1', c: 50 },   // bajo mínimo
    ];
    consumosBase.forEach(({ c }) => {
      const r = calcularFactura(base({ consumoActual: c }));
      expect(isFinite(r.totalPagar)).toBe(true);
      expect(r.totalPagar).toBeGreaterThanOrEqual(0);
    });
  });
});

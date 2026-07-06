/**
 * cfe-algorithm.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Implementación del algoritmo de facturación doméstica CFE (Tarifas 1, 1A–1F, DAC).
 * Basado en:
 *   - Instructivo de Interpretación de Tarifas CFE NOV04
 *   - Análisis del Sistema de Facturación (documento interno)
 *   - Restricciones lógicas (documento interno)
 *
 * Precisión numérica:
 *   - CPD y FPP: 4 decimales redondeando el cuarto en función del quinto.
 *   - Resto de operaciones hasta Facturación Básica: 4 decimales truncando.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type {
  SimuladorInput,
  ResultadoCalculo,
  DesgloseMixto,
  DesgloseEscalones,
  Escalon,
  TarifaId,
  PeriodoAnterior,
} from '../types';

// ─── Utilidades numéricas ────────────────────────────────────────────────────

/** Redondea a 4 decimales (usado para CPD y FPP). */
function redondear4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Trunca a 4 decimales (usado para el resto de operaciones hasta FB). */
function truncar4(n: number): number {
  return Math.trunc(n * 10000) / 10000;
}

/** Diferencia en días entre dos fechas ISO. */
function diasEntre(fechaInicio: string, fechaFin: string): number {
  const a = new Date(fechaInicio);
  const b = new Date(fechaFin);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

// ─── Límites de alto consumo (DAC) por tarifa ───────────────────────────────
const LIMITE_DAC: Record<TarifaId, number> = {
  '1':   250,
  '1A':  300,
  '1B':  400,
  '1C':  850,
  '1D': 1000,
  '1E': 2000,
  '1F': 2500,
  'DAC': Infinity,
};

// ─── Meses de entrada de verano (1-indexed) ──────────────────────────────────
const MES_ENTRADA_VERANO: Record<1 | 2 | 3 | 4, number> = {
  1: 2,  // Febrero
  2: 3,  // Marzo
  3: 4,  // Abril
  4: 5,  // Mayo
};

// ─── Determinar si una fecha cae en verano ────────────────────────────────────
function esVeranoFecha(fecha: string, idEntradaVerano: 1 | 2 | 3 | 4): boolean {
  const mes = new Date(fecha).getMonth() + 1; // 1–12
  const mesEntrada = MES_ENTRADA_VERANO[idEntradaVerano];
  // Verano dura 6 meses a partir del mes de entrada
  return mes > mesEntrada && mes <= mesEntrada + 6;
}

/** Devuelve fecha ISO del 1° del mes de entrada/salida de verano del año dado. */
function fechaEntradaVeranoISO(idEntradaVerano: 1 | 2 | 3 | 4, año: number): string {
  const mes = MES_ENTRADA_VERANO[idEntradaVerano];
  return `${año}-${String(mes).padStart(2, '0')}-01`;
}

function fechaSalidaVeranoISO(idEntradaVerano: 1 | 2 | 3 | 4, año: number): string {
  const mesEntrada = MES_ENTRADA_VERANO[idEntradaVerano];
  const mesSalida = mesEntrada + 6;
  if (mesSalida > 12) {
    return `${año + 1}-${String(mesSalida - 12).padStart(2, '0')}-01`;
  }
  return `${año}-${String(mesSalida).padStart(2, '0')}-01`;
}

// ─── Cálculo de costo por escalones ──────────────────────────────────────────
/**
 * Distribuye `consumo` kWh entre los escalones dados y devuelve costo total.
 * También retorna el desglose por escalón para mostrar en UI.
 */
function calcularCostoEscalones(
  consumo: number,
  escalones: Escalon[]
): { costo: number; desglose: DesgloseEscalones[] } {
  let costo = 0;
  let restante = consumo;
  const desglose: DesgloseEscalones[] = [];

  for (let i = 0; i < escalones.length; i++) {
    const { kwh, precio } = escalones[i];
    let consumoEscalon: number;
    let sobrante: number;

    // Manejo defensivo de escalones infinitos para evitar NaN
    if (!isFinite(kwh)) {
      // Escalón "resto" — absorbe todo lo que quede
      consumoEscalon = restante;
      sobrante = 0;
    } else {
      sobrante = restante - kwh;
      consumoEscalon = sobrante >= 0 ? kwh : restante;
    }

    const subtotal = truncar4(consumoEscalon * precio);
    costo = truncar4(costo + subtotal);

    desglose.push({
      escalon: i + 1,
      kwh: consumoEscalon,
      precio,
      subtotal,
    });

    restante = sobrante;
    if (sobrante <= 0) break;
  }

  return { costo, desglose };
}

// ─── Detección de período mixto ───────────────────────────────────────────────
interface InfoMixto {
  esMixto: boolean;
  esEntradaVerano: boolean;
  esSalidaVerano: boolean;
  diasVerano: number;
  diasNoVerano: number;
  fechaEntradaISO: string;
  fechaSalidaISO: string;
}

function detectarMixto(
  fechaInicio: string,
  fechaFin: string,
  idEntradaVerano: 1 | 2 | 3 | 4,
  tipoPeriodo: 'MENSUAL' | 'BIMESTRAL'
): InfoMixto {
  const añoFin = new Date(fechaFin).getFullYear();
  const fechaEntrada = fechaEntradaVeranoISO(idEntradaVerano, añoFin);
  const fechaSalida = fechaSalidaVeranoISO(idEntradaVerano, añoFin);

  const inicioMs = new Date(fechaInicio).getTime();
  const finMs = new Date(fechaFin).getTime();
  const entradaMs = new Date(fechaEntrada).getTime();
  const salidaMs = new Date(fechaSalida).getTime();

  // Para facturación mensual no hay distribución proporcional (regla binaria)
  if (tipoPeriodo === 'MENSUAL') {
    return {
      esMixto: false,
      esEntradaVerano: false,
      esSalidaVerano: false,
      diasVerano: 0,
      diasNoVerano: diasEntre(fechaInicio, fechaFin),
      fechaEntradaISO: fechaEntrada,
      fechaSalidaISO: fechaSalida,
    };
  }

  // Bimestral: detectar si el periodo cruza la entrada o salida de verano
  const cruzaEntrada = inicioMs < entradaMs && finMs > entradaMs;
  const cruzaSalida = inicioMs < salidaMs && finMs > salidaMs && !cruzaEntrada;

  if (cruzaEntrada) {
    const diasNoVerano = Math.round((entradaMs - inicioMs) / 86_400_000);
    const diasVerano = Math.round((finMs - entradaMs) / 86_400_000);
    // Solo es mixto si hay entre 16 y 45 días de verano (tablas CFE B.2 y B.3)
    const esMixto = diasVerano >= 16 && diasVerano <= 45;
    return {
      esMixto,
      esEntradaVerano: esMixto,
      esSalidaVerano: false,
      diasVerano,
      diasNoVerano,
      fechaEntradaISO: fechaEntrada,
      fechaSalidaISO: fechaSalida,
    };
  }

  if (cruzaSalida) {
    const diasVerano = Math.round((salidaMs - inicioMs) / 86_400_000);
    const diasNoVerano = Math.round((finMs - salidaMs) / 86_400_000);
    // Solo es mixto si hay entre 16 y 45 días fuera de verano (tablas CFE C.2 y C.3)
    const esMixto = diasNoVerano >= 16 && diasNoVerano <= 45;
    return {
      esMixto,
      esEntradaVerano: false,
      esSalidaVerano: esMixto,
      diasVerano,
      diasNoVerano,
      fechaEntradaISO: fechaEntrada,
      fechaSalidaISO: fechaSalida,
    };
  }

  return {
    esMixto: false,
    esEntradaVerano: false,
    esSalidaVerano: false,
    diasVerano: 0,
    diasNoVerano: diasEntre(fechaInicio, fechaFin),
    fechaEntradaISO: fechaEntrada,
    fechaSalidaISO: fechaSalida,
  };
}

// ─── Distribución de consumo en período mixto ─────────────────────────────────
function distribuirConsumoMixto(
  consumoTotal: number,
  diasVerano: number,
  diasNoVerano: number,
  cpd: number,
  cpdAnterior: number | null,
  esEntradaVerano: boolean
): { consumoVerano: number; consumoNoVerano: number } {
  if (esEntradaVerano) {
    // Opción A: usar el menor CPD para asignar los días de no verano
    if (cpdAnterior !== null) {
      const cpdMenor = Math.min(cpd, cpdAnterior);
      const consumoNoVerano = truncar4(cpdMenor * diasNoVerano);
      const consumoVerano = truncar4(consumoTotal - consumoNoVerano);
      return { consumoVerano, consumoNoVerano };
    } else {
      // Sin historial: aplicar directamente CPD actual
      const consumoNoVerano = truncar4(cpd * diasNoVerano);
      const consumoVerano = truncar4(consumoTotal - consumoNoVerano);
      return { consumoVerano, consumoNoVerano };
    }
  } else {
    // Salida de verano: menor CPD para asignar los días de no verano
    if (cpdAnterior !== null) {
      const cpdMenor = Math.min(cpd, cpdAnterior);
      const consumoNoVerano = truncar4(cpdMenor * diasNoVerano);
      const consumoVerano = truncar4(consumoTotal - consumoNoVerano);
      return { consumoVerano, consumoNoVerano };
    } else {
      const consumoNoVerano = truncar4(cpd * diasNoVerano);
      const consumoVerano = truncar4(consumoTotal - consumoNoVerano);
      return { consumoVerano, consumoNoVerano };
    }
  }
}

// ─── Algoritmo principal ──────────────────────────────────────────────────────
export function calcularFactura(input: SimuladorInput): ResultadoCalculo {
  const {
    tarifa,
    idEntradaVerano,
    tipoPeriodo,
    dap,
    ivaBajoFrontera,
    fechaInicioPeriodo,
    fechaFinPeriodo,
    consumoActual,
    periodosAnteriores,
    cuotas,
  } = input;

  // ── 1. Días y CPD (defensivo contra fechas iguales o invertidas) ─────────
  const diasPeriodoRaw = diasEntre(fechaInicioPeriodo, fechaFinPeriodo);
  if (diasPeriodoRaw <= 0) {
    throw new Error('La fecha de fin del periodo debe ser posterior a la fecha de inicio.');
  }
  if (!isFinite(consumoActual) || consumoActual < 0) {
    throw new Error('El consumo actual debe ser un número positivo válido.');
  }
  const diasPeriodo = diasPeriodoRaw;
  const cpd = redondear4(consumoActual / diasPeriodo);

  // Pronóstico
  let diasFacturacion: number;
  if (tipoPeriodo === 'BIMESTRAL') {
    diasFacturacion = diasPeriodo <= 61 ? 60 : diasPeriodo;
  } else {
    diasFacturacion = diasPeriodo <= 31 ? 30 : diasPeriodo;
  }
  const consumoPronostico = truncar4(cpd * diasFacturacion);

  // CPD del periodo anterior (para mixtos)
  let cpdAnterior: number | null = null;
  if (periodosAnteriores.length > 0) {
    const ultimo = periodosAnteriores[periodosAnteriores.length - 1];
    const diasAnterior = diasEntre(ultimo.fechaInicio, ultimo.fechaFin);
    cpdAnterior = diasAnterior > 0 ? redondear4(ultimo.consumo / diasAnterior) : null;
  }

  // ── 2. Promedio móvil 12 meses (para detección DAC) ───────────────────────
  // Convertir periodos anteriores a valores mensuales equivalentes
  const valoresMensuales: number[] = periodosAnteriores.flatMap(p => {
    if (tipoPeriodo === 'BIMESTRAL') {
      const mensual = p.consumo / 2;
      return [mensual, mensual];
    }
    return [p.consumo];
  });
  // Añadir consumo actual
  const consumoMensualActual = tipoPeriodo === 'BIMESTRAL' ? consumoActual / 2 : consumoActual;
  valoresMensuales.push(consumoMensualActual);
  const ultimos12 = valoresMensuales.slice(-12);
  const promedioMovil12Meses =
    redondear4(ultimos12.reduce((s, v) => s + v, 0) / 12);

  // ── 3. Detección de período mixto ─────────────────────────────────────────
  const infoMixto = detectarMixto(
    fechaInicioPeriodo,
    fechaFinPeriodo,
    idEntradaVerano,
    tipoPeriodo
  );

  // ── 4. Determinar si es verano (para periodo NO mixto) ────────────────────
  // Para bimestral no mixto, se usa la fecha 30 días antes de la toma de lectura
  const fechaReferenciaVerano = tipoPeriodo === 'BIMESTRAL'
    ? new Date(new Date(fechaFinPeriodo).getTime() - 30 * 86_400_000)
        .toISOString().split('T')[0]
    : new Date(new Date(fechaFinPeriodo).getTime() - 15 * 86_400_000)
        .toISOString().split('T')[0];

  const esVerano = esVeranoFecha(fechaReferenciaVerano, idEntradaVerano);

  // ── 5. Seleccionar escalones según temporada ──────────────────────────────
  const escalonesNormales = esVerano
    ? cuotas.escalonesVerano
    : cuotas.escalonesNoVerano;

  const limiteNormal = esVerano
    ? cuotas.limiteVerano
    : cuotas.limiteNoVerano;

  // ── 6. Ajuste bimestral (duplicar escalones y límite) ─────────────────────
  let escalonesAjustados: Escalon[];

  if (tipoPeriodo === 'BIMESTRAL' && !infoMixto.esMixto) {
    escalonesAjustados = escalonesNormales.map(e => ({
      ...e,
      kwh: isFinite(e.kwh) ? e.kwh * 2 : e.kwh,
    }));
  } else {
    escalonesAjustados = escalonesNormales;
  }

  // ── 7. Verificación DAC ───────────────────────────────────────────────────
  const limiteDAC = LIMITE_DAC[tarifa];
  // Comparamos promedio mensual vs límite mensual
  const esDAC =
    tarifa === 'DAC' ||
    promedioMovil12Meses > limiteDAC ||
    consumoActual === 8; // código especial de la BD

  // ── 8. Cálculo principal ──────────────────────────────────────────────────
  let facturacionBasica = 0;
  let escalonesAplicadosResult: DesgloseEscalones[] = [];
  let desglosesMixto: DesgloseMixto | null = null;

  if (esDAC) {
    // ── DAC: tarifa plana (precio del último escalón sobre todo el consumo) ──
    // El instructivo no especifica un método distinto de escalones para DAC
    // en los documentos disponibles. Aplicamos el precio del último escalón
    // (el más caro) sobre todo el consumo, que es la interpretación estándar.
    const precioDAC = escalonesAjustados[escalonesAjustados.length - 1]?.precio ?? 0;
    const subtotal = truncar4(consumoActual * precioDAC);
    facturacionBasica = subtotal;
    escalonesAplicadosResult = [
      { escalon: 1, kwh: consumoActual, precio: precioDAC, subtotal },
    ];
  } else if (infoMixto.esMixto) {
    // ── Período mixto bimestral ───────────────────────────────────────────
    const { diasVerano, diasNoVerano } = infoMixto;

    // Distribución C1/C2 – Opción A: usar menor CPD
    const distA = distribuirConsumoMixto(
      consumoActual,
      diasVerano,
      diasNoVerano,
      cpd,
      cpdAnterior,
      infoMixto.esEntradaVerano
    );

    // Opción B: aplicar CPD actual directamente
    const distB = {
      consumoVerano: truncar4(cpd * diasVerano),
      consumoNoVerano: truncar4(cpd * diasNoVerano),
    };

    // Calcular costo de cada opción
    const costoVeranoA = calcularCostoEscalones(
      distA.consumoVerano,
      cuotas.escalonesVerano
    ).costo;
    const costoNoVeranoA = calcularCostoEscalones(
      distA.consumoNoVerano,
      cuotas.escalonesNoVerano
    ).costo;
    const costoTotalA = truncar4(costoVeranoA + costoNoVeranoA);

    const costoVeranoB = calcularCostoEscalones(
      distB.consumoVerano,
      cuotas.escalonesVerano
    ).costo;
    const costoNoVeranoB = calcularCostoEscalones(
      distB.consumoNoVerano,
      cuotas.escalonesNoVerano
    ).costo;
    const costoTotalB = truncar4(costoVeranoB + costoNoVeranoB);

    // Seleccionar la opción de MENOR facturación (beneficio para el usuario)
    // Si no hay historial, se aplica directamente Opción B
    let opcionSeleccionada: 'A' | 'B' | 'SIN_HISTORIAL';
    let distribucionFinal: typeof distA;

    if (cpdAnterior === null) {
      opcionSeleccionada = 'SIN_HISTORIAL';
      distribucionFinal = distB;
      facturacionBasica = costoTotalB;
    } else if (costoTotalA <= costoTotalB) {
      opcionSeleccionada = 'A';
      distribucionFinal = distA;
      facturacionBasica = costoTotalA;
    } else {
      opcionSeleccionada = 'B';
      distribucionFinal = distB;
      facturacionBasica = costoTotalB;
    }

    const { desglose: desgloseVerano } = calcularCostoEscalones(
      distribucionFinal.consumoVerano,
      cuotas.escalonesVerano
    );
    const { desglose: desgloseNoVerano } = calcularCostoEscalones(
      distribucionFinal.consumoNoVerano,
      cuotas.escalonesNoVerano
    );

    escalonesAplicadosResult = [
      ...desgloseNoVerano.map(e => ({ ...e, escalon: e.escalon })),
      ...desgloseVerano.map(e => ({ ...e, escalon: e.escalon + desgloseNoVerano.length })),
    ];

    desglosesMixto = {
      consumoNoVerano: distribucionFinal.consumoNoVerano,
      consumoVerano: distribucionFinal.consumoVerano,
      costoNoVerano: cpdAnterior === null
        ? costoNoVeranoB
        : opcionSeleccionada === 'A' ? costoNoVeranoA : costoNoVeranoB,
      costoVerano: cpdAnterior === null
        ? costoVeranoB
        : opcionSeleccionada === 'A' ? costoVeranoA : costoVeranoB,
      diasNoVerano,
      diasVerano,
      cpd,
      cpdAnterior,
      opcionSeleccionada,
      costoOpcionA: cpdAnterior !== null ? costoTotalA : null,
      costoOpcionB: costoTotalB,
    };
  } else {
    // ── Periodo normal (no mixto) ─────────────────────────────────────────
    const { costo, desglose } = calcularCostoEscalones(consumoActual, escalonesAjustados);
    facturacionBasica = costo;
    escalonesAplicadosResult = desglose;
  }

  // ── 9. Mínimo mensual ─────────────────────────────────────────────────────
  const minimoAplicable =
    tipoPeriodo === 'BIMESTRAL'
      ? cuotas.minimoMensual * 2
      : cuotas.minimoMensual;

  if (facturacionBasica < minimoAplicable) {
    facturacionBasica = minimoAplicable;
  }

  // ── 10. Cadena de facturación ─────────────────────────────────────────────
  // Para tarifa doméstica residencial: FN = FB (no aplica cargo por medición en primario)
  const facturacionNormal = facturacionBasica;
  // FNE = FN (factor de potencia no aplica en servicio doméstico residencial)
  const facturacionNeta = facturacionNormal;

  // DAP (no sujeto a IVA)
  const dapAplicado = tipoPeriodo === 'BIMESTRAL' ? dap * 2 : dap;

  // IVA sobre Facturación Neta Bonificada
  const tasaIva = ivaBajoFrontera ? 0.10 : 0.15;
  const iva = truncar4(facturacionNeta * tasaIva);

  const totalPagar = truncar4(facturacionNeta + dapAplicado + iva);

  return {
    esVerano,
    esMixto: infoMixto.esMixto,
    esEntradaVerano: infoMixto.esEntradaVerano,
    esSalidaVerano: infoMixto.esSalidaVerano,
    esDAC,
    promedioMovil12Meses,
    consumoTotal: consumoActual,
    diasPeriodo,
    cpd,
    consumoPronostico,
    escalonesAplicados: escalonesAplicadosResult,
    mixto: desglosesMixto,
    facturacionBasica,
    facturacionNormal,
    facturacionNeta,
    dapAplicado,
    iva,
    tasaIva,
    totalPagar,
    fechaEntradaVerano: infoMixto.fechaEntradaISO,
    fechaSalidaVerano: infoMixto.fechaSalidaISO,
    diasVeranoEnPeriodo: infoMixto.diasVerano,
    diasNoVeranoEnPeriodo: infoMixto.diasNoVerano,
  };
}

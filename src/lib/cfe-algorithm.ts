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
const NOMBRES_ESCALONES = ['Básico', 'Intermedio', 'Excedente'] as const;

function nombreEscalon(i: number, esDAC: boolean): 'Básico' | 'Intermedio' | 'Excedente' | 'DAC' {
  if (esDAC) return 'DAC';
  if (i < 1) return 'Básico';
  if (i === 1) return 'Intermedio';
  return 'Excedente';
}

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
    // (null: JSON.stringify convierte Infinity a null)
    if (kwh === null || !isFinite(kwh)) {
      // Escalón "resto" — absorbe todo lo que quede
      consumoEscalon = restante;
      sobrante = 0;
    } else {
      sobrante = restante - kwh;
      consumoEscalon = sobrante >= 0 ? kwh : Math.floor(restante);
      sobrante = restante - consumoEscalon;
    }

    const subtotal = truncar4(consumoEscalon * precio);
    costo = truncar4(costo + subtotal);

    desglose.push({
      escalon: i + 1,
      nombre: i >= NOMBRES_ESCALONES.length ? 'Excedente' : NOMBRES_ESCALONES[i],
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
    // El día de entrada de verano cuenta como verano, no como no verano
    const diasNoVerano = Math.round((entradaMs - inicioMs) / 86_400_000) - 1;
    const diasVerano = Math.round((finMs - entradaMs) / 86_400_000) + 1;
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
    const diasVerano = Math.round((salidaMs - inicioMs) / 86_400_000) + 1;
    const diasNoVerano = Math.round((finMs - salidaMs) / 86_400_000) - 1;
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
  const cpdBase = cpdAnterior !== null ? Math.min(cpd, cpdAnterior) : cpd;
  const consumoNoVerano = Math.floor(truncar4(cpdBase * diasNoVerano));
  const consumoVerano = consumoTotal - consumoNoVerano;
  return { consumoVerano, consumoNoVerano };
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
    consumoActual: rawConsumoActual,
    consumoAnterior: rawConsumoAnterior,
    fechaInicioPeriodoAnterior,
    historicoMensual,
    periodosAnteriores,
    cuotas,
    subsidio,
    apoyoEstatal,
    adeudoAnterior = 0,
    pagoPrevio = 0,
  } = input;

  // ── 0. Forzar consumo como entero (CFE nunca muestra decimales en kWh) ──
  const consumoActual = Math.floor(rawConsumoActual);
  const consumoAnterior = rawConsumoAnterior !== undefined ? Math.floor(rawConsumoAnterior) : undefined;

  // ── 1. Días y CPD (defensivo contra fechas invertidas) ─────────
  const diasPeriodo = diasEntre(fechaInicioPeriodo, fechaFinPeriodo);
  if (diasPeriodo < 0) {
    throw new Error('La fecha de fin no puede ser anterior a la fecha de inicio.');
  }
  if (!isFinite(consumoActual) || consumoActual < 0) {
    throw new Error('El consumo actual debe ser un número positivo válido.');
  }
  // Si el periodo es de 0 días, asumimos 1 día para evitar división entre 0
  const diasEfectivos = diasPeriodo || 1;
  const cpd = redondear4(consumoActual / diasEfectivos);

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
  if (consumoAnterior !== undefined && fechaInicioPeriodoAnterior !== undefined) {
    const diasAnterior = diasEntre(fechaInicioPeriodoAnterior, fechaInicioPeriodo);
    cpdAnterior = diasAnterior > 0 ? redondear4(consumoAnterior / diasAnterior) : null;
  } else if (periodosAnteriores.length > 0) {
    const ultimo = periodosAnteriores[periodosAnteriores.length - 1];
    const diasAnterior = diasEntre(ultimo.fechaInicio, ultimo.fechaFin);
    cpdAnterior = diasAnterior > 0 ? redondear4(ultimo.consumo / diasAnterior) : null;
  }

  // ── 2. Promedio móvil 12 meses (para detección DAC) ───────────────────────
  let valoresMensuales: number[];
  if (historicoMensual !== undefined && historicoMensual.length > 0) {
    valoresMensuales = [...historicoMensual];
  } else {
    valoresMensuales = periodosAnteriores.flatMap(p => {
      if (tipoPeriodo === 'BIMESTRAL') {
        const mensual = p.consumo / 2;
        return [mensual, mensual];
      }
      return [p.consumo];
    });
  }
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

  // ── 6. Ajuste bimestral (duplicar escalones) ─────────────────────────────
  let escalonesAjustados: Escalon[];

  if (tipoPeriodo === 'BIMESTRAL' && !infoMixto.esMixto) {
    escalonesAjustados = escalonesNormales.map(e => ({
      ...e,
      kwh: e.kwh === null || !isFinite(e.kwh) ? Infinity : e.kwh * 2,
    }));
  } else {
    escalonesAjustados = escalonesNormales;
  }

  // ── 7. Verificación DAC ───────────────────────────────────────────────────
  const limiteDAC = LIMITE_DAC[tarifa];
  const esDAC =
    tarifa === 'DAC' ||
    promedioMovil12Meses > limiteDAC ||
    consumoActual === 8;

  // ── 8. Cálculo principal ──────────────────────────────────────────────────
  let energiaEscalones = 0;
  let escalonesAplicadosResult: DesgloseEscalones[] = [];
  let escalonesNoVeranoResult: DesgloseEscalones[] = [];
  let escalonesVeranoResult: DesgloseEscalones[] = [];
  let desglosesMixto: DesgloseMixto | null = null;

  if (esDAC) {
    const precioDAC = escalonesAjustados[escalonesAjustados.length - 1]?.precio ?? 0;
    const subtotal = truncar4(consumoActual * precioDAC);
    const dacEscalon: DesgloseEscalones = { escalon: 1, nombre: 'DAC', kwh: consumoActual, precio: precioDAC, subtotal };
    energiaEscalones = subtotal;
    escalonesAplicadosResult = [dacEscalon];
    escalonesNoVeranoResult = esVerano ? [] : [dacEscalon];
    escalonesVeranoResult = esVerano ? [dacEscalon] : [];
  } else if (infoMixto.esMixto) {
    const { diasVerano, diasNoVerano } = infoMixto;

    const distA = distribuirConsumoMixto(
      consumoActual, diasVerano, diasNoVerano, cpd, cpdAnterior, infoMixto.esEntradaVerano
    );

    const consumoNoVeranoB = Math.floor(truncar4(cpd * diasNoVerano));
    const distB = {
      consumoNoVerano: consumoNoVeranoB,
      consumoVerano: consumoActual - consumoNoVeranoB,
    };

    const costoVeranoA = calcularCostoEscalones(distA.consumoVerano, cuotas.escalonesVerano).costo;
    const costoNoVeranoA = calcularCostoEscalones(distA.consumoNoVerano, cuotas.escalonesNoVerano).costo;
    const costoTotalA = truncar4(costoVeranoA + costoNoVeranoA);

    const costoVeranoB = calcularCostoEscalones(distB.consumoVerano, cuotas.escalonesVerano).costo;
    const costoNoVeranoB = calcularCostoEscalones(distB.consumoNoVerano, cuotas.escalonesNoVerano).costo;
    const costoTotalB = truncar4(costoVeranoB + costoNoVeranoB);

    let opcionSeleccionada: 'A' | 'B' | 'SIN_HISTORIAL';
    let distribucionFinal: typeof distA;

    if (cpdAnterior === null) {
      opcionSeleccionada = 'SIN_HISTORIAL';
      distribucionFinal = distB;
      energiaEscalones = costoTotalB;
    } else if (costoTotalA <= costoTotalB) {
      opcionSeleccionada = 'A';
      distribucionFinal = distA;
      energiaEscalones = costoTotalA;
    } else {
      opcionSeleccionada = 'B';
      distribucionFinal = distB;
      energiaEscalones = costoTotalB;
    }

    const { desglose: desgloseVerano } = calcularCostoEscalones(distribucionFinal.consumoVerano, cuotas.escalonesVerano);
    const { desglose: desgloseNoVerano } = calcularCostoEscalones(distribucionFinal.consumoNoVerano, cuotas.escalonesNoVerano);

    escalonesNoVeranoResult = desgloseNoVerano;
    escalonesVeranoResult = desgloseVerano;
    escalonesAplicadosResult = [
      ...desgloseNoVerano,
      ...desgloseVerano,
    ];

    desglosesMixto = {
      consumoNoVerano: distribucionFinal.consumoNoVerano,
      consumoVerano: distribucionFinal.consumoVerano,
      costoNoVerano: cpdAnterior === null ? costoNoVeranoB : opcionSeleccionada === 'A' ? costoNoVeranoA : costoNoVeranoB,
      costoVerano: cpdAnterior === null ? costoVeranoB : opcionSeleccionada === 'A' ? costoVeranoA : costoVeranoB,
      diasNoVerano, diasVerano, cpd, cpdAnterior, opcionSeleccionada,
      costoOpcionA: cpdAnterior !== null ? costoTotalA : null,
      costoOpcionB: costoTotalB,
    };
  } else {
    const { costo, desglose } = calcularCostoEscalones(consumoActual, escalonesAjustados);
    energiaEscalones = costo;
    escalonesAplicadosResult = desglose;
    escalonesNoVeranoResult = esVerano ? [] : desglose;
    escalonesVeranoResult = esVerano ? desglose : [];
  }

  // ── 9. Mínimo mensual ─────────────────────────────────────────────────────
  const minimoAplicable =
    tipoPeriodo === 'BIMESTRAL'
      ? cuotas.minimoMensual * 2
      : cuotas.minimoMensual;

  if (energiaEscalones < minimoAplicable) {
    energiaEscalones = minimoAplicable;
  }

  // ── 10. Cadena de facturación (nuevo orden) ───────────────────────────────
  // 10a. Cargo fijo de suministro (se duplica en bimestral, igual que DAP)
  const cargoFijoAplicado = tipoPeriodo === 'BIMESTRAL'
    ? cuotas.cargoFijoSuministro * 2
    : cuotas.cargoFijoSuministro;

  // 10b. Energía = escalones + cargoFijoSuministro
  const energia = truncar4(energiaEscalones + cargoFijoAplicado);

  // 10c. IVA (frontera 8%, interior 16%)
  const tasaIva = ivaBajoFrontera ? 0.08 : 0.16;
  const iva = truncar4(energia * tasaIva);

  // 10d. Facturación del periodo = energía + IVA
  const facturacionPeriodo = truncar4(energia + iva);

  // 10e. Apoyo estatal (valor positivo en input, se resta)
  const apoyoValor = apoyoEstatal !== null && apoyoEstatal !== undefined ? apoyoEstatal : (subsidio ?? 0);
  const apoyoEstatalAplicado = Math.max(0, apoyoValor);

  // 10f. Subtotal = facturación del periodo - apoyo estatal
  const subtotal = truncar4(facturacionPeriodo - apoyoEstatalAplicado);

  // 10g. DAP (no sujeto a IVA)
  const dapAplicado = tipoPeriodo === 'BIMESTRAL' ? dap * 2 : dap;

  // 10h. Total = subtotal + DAP + adeudoAnterior - pagoPrevio
  const totalPagar = truncar4(subtotal + dapAplicado + adeudoAnterior - pagoPrevio);

  // Aliases para retrocompatibilidad
  const facturacionBasica = energia;
  const facturacionNormal = energia;
  const facturacionNeta = energia;
  const subsidioAplicado = apoyoEstatalAplicado;

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
    escalonesNoVerano: escalonesNoVeranoResult,
    escalonesVerano: escalonesVeranoResult,
    mixto: desglosesMixto,
    facturacionBasica,
    facturacionNormal,
    facturacionNeta,
    facturacionPeriodo,
    dapAplicado,
    iva,
    tasaIva,
    subsidioAplicado,
    apoyoEstatalAplicado,
    adeudoAplicado: adeudoAnterior,
    pagoAplicado: pagoPrevio,
    totalPagar,
    fechaEntradaVerano: infoMixto.fechaEntradaISO,
    fechaSalidaVerano: infoMixto.fechaSalidaISO,
    diasVeranoEnPeriodo: infoMixto.diasVerano,
    diasNoVeranoEnPeriodo: infoMixto.diasNoVerano,
  };
}

// ─── Tarifas disponibles ────────────────────────────────────────────────────
export type TarifaId = '1' | '1A' | '1B' | '1C' | '1D' | '1E' | '1F' | 'DAC';

export type TipoPeriodo = 'MENSUAL' | 'BIMESTRAL';

// id_entradaVerano: mes del año en que inicia el verano (1=feb, 2=mar, 3=abr, 4=may)
export type IdEntradaVerano = 1 | 2 | 3 | 4;

// ─── Escalón individual ──────────────────────────────────────────────────────
export interface Escalon {
  kwh: number;       // kWh máximos en este escalón
  precio: number;    // $/kWh en este escalón
}

// ─── Estructura de cuotas por tarifa/mes ────────────────────────────────────
export interface CuotasTarifa {
  escalonesNoVerano: Escalon[];   // hasta 3 escalones
  escalonesVerano: Escalon[];     // hasta 4 escalones
  limiteNoVerano: number;         // kWh/mes antes de DAC fuera de verano
  limiteVerano: number;           // kWh/mes antes de DAC en verano
  minimoMensual: number;          // facturación mínima mensual ($)
}

// ─── Periodo anterior (para cálculo de promedio móvil y mixtos) ─────────────
export interface PeriodoAnterior {
  fechaInicio: string;  // ISO date "YYYY-MM-DD"
  fechaFin: string;     // ISO date "YYYY-MM-DD"
  consumo: number;      // kWh consumidos en el periodo
}

// ─── Inputs del simulador ────────────────────────────────────────────────────
export interface SimuladorInput {
  // Configuración del municipio
  tarifa: TarifaId;
  idEntradaVerano: IdEntradaVerano;
  tipoPeriodo: TipoPeriodo;
  dap: number;                    // DAP mensual en $
  ivaBajoFrontera: boolean;       // true = 10%, false = 15%

  // Periodo actual
  fechaInicioPeriodo: string;     // ISO date "YYYY-MM-DD"
  fechaFinPeriodo: string;        // ISO date "YYYY-MM-DD" (fecha de toma de lectura)
  consumoActual: number;          // kWh consumidos en el periodo actual

  // Periodos anteriores (del más antiguo al más reciente)
  // Si tipoPeriodo es BIMESTRAL, cada periodo debe ser bimestral
  // Si tipoPeriodo es MENSUAL, cada periodo debe ser mensual
  periodosAnteriores: PeriodoAnterior[];

  // Cuotas manuales (el usuario las ingresa para simular sin BD)
  cuotas: CuotasTarifa;
}

// ─── Resultado del cálculo ───────────────────────────────────────────────────
export interface DesgloseMixto {
  consumoNoVerano: number;
  consumoVerano: number;
  costoNoVerano: number;
  costoVerano: number;
  diasNoVerano: number;
  diasVerano: number;
  cpd: number;
  cpdAnterior: number | null;
  opcionSeleccionada: 'A' | 'B' | 'SIN_HISTORIAL';
  costoOpcionA: number | null;
  costoOpcionB: number | null;
}

export interface DesgloseEscalones {
  escalon: number;
  kwh: number;
  precio: number;
  subtotal: number;
}

export interface ResultadoCalculo {
  // Diagnóstico de temporada
  esVerano: boolean;
  esMixto: boolean;
  esEntradaVerano: boolean;
  esSalidaVerano: boolean;
  esDAC: boolean;
  promedioMovil12Meses: number;

  // Consumo
  consumoTotal: number;
  diasPeriodo: number;
  cpd: number;                    // consumo promedio diario
  consumoPronostico: number;

  // Desglose escalones (para periodo normal o cada sub-periodo en mixto)
  escalonesAplicados: DesgloseEscalones[];
  mixto: DesgloseMixto | null;

  // Facturación
  facturacionBasica: number;
  facturacionNormal: number;
  facturacionNeta: number;
  dapAplicado: number;
  iva: number;
  tasaIva: number;
  totalPagar: number;

  // Metadatos
  fechaEntradaVerano: string;
  fechaSalidaVerano: string;
  diasVeranoEnPeriodo: number;
  diasNoVeranoEnPeriodo: number;
}

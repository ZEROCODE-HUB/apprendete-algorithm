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

// ─── Región tarifaria ────────────────────────────────────────────────────────
export type RegionTarifaria = 'NOROESTE' | 'NORTE' | 'NORESTE' | 'CENTRAL' | 'SUR' | 'PENINSULAR' | 'BAJA_CALIFORNIA' | 'BAJA_CALIFORNIA_SUR';

// ─── Estructura de cuotas por tarifa/mes ────────────────────────────────────
export interface CuotasTarifa {
  escalonesNoVerano: Escalon[];   // hasta 3 escalones
  escalonesVerano: Escalon[];     // hasta 4 escalones
  limiteNoVerano: number;         // kWh/mes antes de DAC fuera de verano
  limiteVerano: number;           // kWh/mes antes de DAC en verano
  minimoMensual: number;          // facturación mínima mensual ($)
  cargoFijoSuministro: number;    // cargo fijo mensual ($) — aplica a todas las tarifas domésticas
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
  ivaBajoFrontera: boolean;       // true = 8%, false = 16%

  // Región tarifaria (reservado para futuros precios diferenciados)
  region?: RegionTarifaria;

  // Periodo actual
  fechaInicioPeriodo: string;     // ISO date "YYYY-MM-DD"
  fechaFinPeriodo: string;        // ISO date "YYYY-MM-DD" (fecha de toma de lectura)
  consumoActual: number;          // kWh consumidos en el periodo actual

  // Periodo anterior inmediato (alternativa moderna a periodosAnteriores)
  consumoAnterior?: number;       // kWh del periodo inmediato anterior
  fechaInicioPeriodoAnterior?: string;  // ISO date — inicio del periodo anterior

  // Historial mensual para promedio móvil (alternativa moderna a periodosAnteriores)
  historicoMensual?: number[];    // valores mensuales para DAC (últimos 11+actual=12)

  // Periodos anteriores (del más antiguo al más reciente)
  // Si tipoPeriodo es BIMESTRAL, cada periodo debe ser bimestral
  // Si tipoPeriodo es MENSUAL, cada periodo debe ser mensual
  periodosAnteriores: PeriodoAnterior[];

  // Cuotas manuales (el usuario las ingresa para simular sin BD)
  cuotas: CuotasTarifa;

  // Subsidio estatal (opcional) — reemplazado por apoyoEstatal
  subsidio: number;                  // $ por periodo

  // Apoyo estatal (opcional) — monto en $ del subsidio estatal (ej: Sonora)
  apoyoEstatal?: number | null;

  // Adeudo de periodo anterior y pago previo (para arrastres)
  adeudoAnterior?: number;
  pagoPrevio?: number;
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
  nombre: 'Básico' | 'Intermedio' | 'Excedente' | 'DAC';
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

  // Desglose escalones
  escalonesAplicados: DesgloseEscalones[];     // combinados (para vista simple)
  escalonesNoVerano: DesgloseEscalones[];      // solo no-verano (para vista detallada)
  escalonesVerano: DesgloseEscalones[];        // solo verano (para vista detallada)
  mixto: DesgloseMixto | null;

  // Facturación
  facturacionBasica: number;        // alias de energía (escalones + cargoFijoSuministro)
  facturacionNormal: number;        // alias de energía
  facturacionNeta: number;          // alias de energía
  facturacionPeriodo: number;       // energía + IVA (antes de apoyo y DAP)
  dapAplicado: number;
  iva: number;
  tasaIva: number;
  subsidioAplicado: number;          // $ del subsidio aplicado (0 si no hay)
  apoyoEstatalAplicado: number;      // apoyo estatal aplicado (se resta en subtotal)
  adeudoAplicado: number;            // adeudo de periodo anterior
  pagoAplicado: number;              // pago previo
  totalPagar: number;

  // Metadatos
  fechaEntradaVerano: string;
  fechaSalidaVerano: string;
  diasVeranoEnPeriodo: number;
  diasNoVeranoEnPeriodo: number;
}

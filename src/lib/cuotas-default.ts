/**
 * cuotas-default.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Cuotas de ejemplo para cada tarifa doméstica.
 * En producción estos valores se obtienen de la tabla cosostatrifas de la BD.
 * Los valores aquí son ilustrativos para pruebas del simulador.
 * El usuario puede modificarlos desde la interfaz.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { CuotasTarifa, TarifaId } from '../types';

export const CUOTAS_DEFAULT: Record<TarifaId, CuotasTarifa> = {
  '1': {
    escalonesNoVerano: [
      { kwh: 75,  precio: 0.793 },
      { kwh: 125, precio: 0.963 },
      { kwh: Infinity, precio: 2.859 },
    ],
    escalonesVerano: [
      { kwh: 100, precio: 0.793 },
      { kwh: 50,  precio: 0.963 },
      { kwh: 100, precio: 2.452 },
      { kwh: Infinity, precio: 2.859 },
    ],
    limiteNoVerano: 250,
    limiteVerano: 250,
    minimoMensual: 59.45,
    cargoFijoSuministro: 20,
  },
  '1A': {
    escalonesNoVerano: [
      { kwh: 100, precio: 0.793 },
      { kwh: 150, precio: 0.963 },
      { kwh: Infinity, precio: 2.859 },
    ],
    escalonesVerano: [
      { kwh: 150, precio: 0.793 },
      { kwh: 100, precio: 0.963 },
      { kwh: 150, precio: 2.452 },
      { kwh: Infinity, precio: 2.859 },
    ],
    limiteNoVerano: 300,
    limiteVerano: 300,
    minimoMensual: 79.27,
    cargoFijoSuministro: 22,
  },
  '1B': {
    escalonesNoVerano: [
      { kwh: 150, precio: 0.793 },
      { kwh: 150, precio: 0.963 },
      { kwh: Infinity, precio: 2.859 },
    ],
    escalonesVerano: [
      { kwh: 150, precio: 0.793 },
      { kwh: 150, precio: 0.963 },
      { kwh: 200, precio: 2.452 },
      { kwh: Infinity, precio: 2.859 },
    ],
    limiteNoVerano: 400,
    limiteVerano: 400,
    minimoMensual: 119.05,
    cargoFijoSuministro: 25,
  },
  '1C': {
    escalonesNoVerano: [
      { kwh: 175, precio: 0.793 },
      { kwh: 225, precio: 0.963 },
      { kwh: Infinity, precio: 2.859 },
    ],
    escalonesVerano: [
      { kwh: 300, precio: 0.793 },
      { kwh: 300, precio: 0.963 },
      { kwh: 350, precio: 2.452 },
      { kwh: Infinity, precio: 2.859 },
    ],
    limiteNoVerano: 850,
    limiteVerano: 850,
    minimoMensual: 138.78,
    cargoFijoSuministro: 28,
  },
  '1D': {
    escalonesNoVerano: [
      { kwh: 175, precio: 0.793 },
      { kwh: 225, precio: 0.963 },
      { kwh: Infinity, precio: 2.859 },
    ],
    escalonesVerano: [
      { kwh: 450, precio: 0.793 },
      { kwh: 350, precio: 0.963 },
      { kwh: 400, precio: 2.452 },
      { kwh: Infinity, precio: 2.859 },
    ],
    limiteNoVerano: 1000,
    limiteVerano: 1000,
    minimoMensual: 138.78,
    cargoFijoSuministro: 32,
  },
  '1E': {
    escalonesNoVerano: [
      { kwh: 175, precio: 0.793 },
      { kwh: 225, precio: 0.963 },
      { kwh: Infinity, precio: 2.859 },
    ],
    escalonesVerano: [
      { kwh: 600, precio: 0.793 },
      { kwh: 700, precio: 0.963 },
      { kwh: 900, precio: 2.452 },
      { kwh: Infinity, precio: 2.859 },
    ],
    limiteNoVerano: 2000,
    limiteVerano: 2000,
    minimoMensual: 138.78,
    cargoFijoSuministro: 39.10,
  },
  '1F': {
    escalonesNoVerano: [
      { kwh: 175, precio: 0.793 },
      { kwh: 225, precio: 0.963 },
      { kwh: Infinity, precio: 2.859 },
    ],
    escalonesVerano: [
      { kwh: 1000, precio: 0.793 },
      { kwh: 1000, precio: 0.963 },
      { kwh: 1000, precio: 2.452 },
      { kwh: Infinity, precio: 2.859 },
    ],
    limiteNoVerano: 2500,
    limiteVerano: 2500,
    minimoMensual: 138.78,
    cargoFijoSuministro: 40.02,
  },
  'DAC': {
    escalonesNoVerano: [
      { kwh: Infinity, precio: 4.228 },
    ],
    escalonesVerano: [
      { kwh: Infinity, precio: 4.228 },
    ],
    limiteNoVerano: Infinity,
    limiteVerano: Infinity,
    minimoMensual: 0,
    cargoFijoSuministro: 45,
  },
};

/**
 * app/api/calcular/route.ts
 * API endpoint POST /api/calcular
 * Recibe SimuladorInput, devuelve ResultadoCalculo
 */

import { NextRequest, NextResponse } from 'next/server';
import { calcularFactura } from '../../../lib/cfe-algorithm';
import type { SimuladorInput } from '../../../types';

export async function POST(req: NextRequest) {
  try {
    const body: SimuladorInput = await req.json();
    const resultado = calcularFactura(body);
    return NextResponse.json(resultado);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

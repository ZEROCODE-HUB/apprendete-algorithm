'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import type { SimuladorInput, ResultadoCalculo, TarifaId, CuotasTarifa, PeriodoAnterior, DesgloseEscalones, RegionTarifaria } from '../types';
import { CUOTAS_DEFAULT } from '../lib/cuotas-default';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS DE FORMATO — defensivos contra valores inválidos
// ═══════════════════════════════════════════════════════════════════════════

function safeNumber(n: unknown): number {
  if (typeof n !== 'number') return 0;
  if (!isFinite(n) || isNaN(n)) return 0;
  return n;
}

function fmt(n: unknown): string {
  const v = safeNumber(n);
  // 2 decimales con separador de miles, sin depender de Intl
  const parts = v.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

function fmtMXN(n: unknown): string {
  const v = safeNumber(n);
  const parts = v.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${parts.join('.')}`;
}

function fmtKWh(n: unknown): string {
  const v = safeNumber(n);
  if (!isFinite(v) || v >= 9e15) return '∞';
  const parts = v.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════

type IdEntradaVerano = 1 | 2 | 3 | 4;

const TARIFAS: TarifaId[] = ['1', '1A', '1B', '1C', '1D', '1E', '1F', 'DAC'];
const MESES_ENTRADA: Record<IdEntradaVerano, string> = {
  1: 'Febrero',
  2: 'Marzo',
  3: 'Abril',
  4: 'Mayo',
};
const REGIONES: RegionTarifaria[] = ['NOROESTE', 'NORTE', 'NORESTE', 'CENTRAL', 'SUR', 'PENINSULAR', 'BAJA_CALIFORNIA', 'BAJA_CALIFORNIA_SUR'];

// Fechas iniciales fijas (para evitar problemas de hidratación SSR)
const FECHA_HOY = '2024-05-30';
const FECHA_HACE_60 = '2024-03-31';
const FECHA_HACE_120 = '2024-01-31';

// ═══════════════════════════════════════════════════════════════════════════
// TIPO DEL ESTADO DEL FORMULARIO
// ═══════════════════════════════════════════════════════════════════════════

interface PeriodoAnteriorInput {
  fechaInicio: string;
  fechaFin: string;
  consumo: number;
}

interface FormState {
  tarifa: TarifaId;
  idEntradaVerano: IdEntradaVerano;
  tipoPeriodo: 'MENSUAL' | 'BIMESTRAL';
  region: RegionTarifaria;
  dap: number;
  apoyoEstatal: number;
  ivaBajoFrontera: boolean;
  fechaInicioPeriodo: string;
  fechaFinPeriodo: string;
  consumoActual: number;
  adeudoAnterior: number;
  pagoPrevio: number;
  periodosAnteriores: PeriodoAnteriorInput[];
}

const ESTADO_INICIAL: FormState = {
  tarifa: '1',
  idEntradaVerano: 4,
  tipoPeriodo: 'BIMESTRAL',
  region: 'NOROESTE',
  dap: 45,
  apoyoEstatal: 0,
  ivaBajoFrontera: false,
  fechaInicioPeriodo: FECHA_HACE_60,
  fechaFinPeriodo: FECHA_HOY,
  consumoActual: 280,
  adeudoAnterior: 0,
  pagoPrevio: 0,
  periodosAnteriores: [],
};

// ═══════════════════════════════════════════════════════════════════════════
// VALIDACIONES
// ═══════════════════════════════════════════════════════════════════════════

interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function validar(form: FormState, cuotas: CuotasTarifa): ValidationResult {
  const errors: string[] = [];

  // Fechas del periodo actual
  if (!form.fechaInicioPeriodo || !form.fechaFinPeriodo) {
    errors.push('Debes capturar las fechas de inicio y fin del periodo actual.');
  } else {
    const inicio = new Date(form.fechaInicioPeriodo);
    const fin = new Date(form.fechaFinPeriodo);
    if (isNaN(inicio.getTime()) || isNaN(fin.getTime())) {
      errors.push('Las fechas del periodo actual no son válidas.');
    } else if (inicio > fin) {
      errors.push('La fecha de inicio no puede ser posterior a la fecha de fin.');
    } else {
      const dias = Math.round((fin.getTime() - inicio.getTime()) / 86_400_000);
      if (form.tipoPeriodo === 'MENSUAL' && dias > 45) {
        errors.push(`El periodo mensual tiene ${dias} días (máximo permitido ~45).`);
      }
      if (form.tipoPeriodo === 'BIMESTRAL' && dias > 75) {
        errors.push(`El periodo bimestral tiene ${dias} días (máximo permitido ~75).`);
      }
    }
  }

  // Periodos anteriores
  const etiqueta = form.tipoPeriodo === 'BIMESTRAL' ? 'bimestral' : 'mensual';
  form.periodosAnteriores.forEach((p, i) => {
    const idx = i + 1;
    if (!p.fechaInicio || !p.fechaFin) {
      errors.push(`Periodo anterior #${idx}: faltan fechas.`);
      return;
    }
    const pInicio = new Date(p.fechaInicio);
    const pFin = new Date(p.fechaFin);
    if (isNaN(pInicio.getTime()) || isNaN(pFin.getTime())) {
      errors.push(`Periodo anterior #${idx}: fechas no válidas.`);
    } else if (pInicio > pFin) {
      errors.push(`Periodo anterior #${idx}: la fecha de inicio no puede ser posterior a la de fin.`);
    }
    if (p.consumo < 0 || !isFinite(p.consumo)) {
      errors.push(`Periodo anterior #${idx}: consumo inválido (${p.consumo}).`);
    }
  });

  // Coherencia: el último periodo anterior debe terminar antes del inicio del actual
  if (form.periodosAnteriores.length > 0 && form.fechaInicioPeriodo) {
    const ultimo = form.periodosAnteriores[form.periodosAnteriores.length - 1];
    if (ultimo.fechaFin && new Date(ultimo.fechaFin).getTime() >= new Date(form.fechaInicioPeriodo).getTime()) {
      errors.push(`El último periodo anterior termina después del inicio del periodo actual. Deben ser contiguos.`);
    }
  }

  // Consumo actual
  if (form.consumoActual < 0) {
    errors.push('El consumo actual no puede ser negativo.');
  }
  if (form.consumoActual > 100_000) {
    errors.push('El consumo actual es demasiado alto (límite: 100,000 kWh).');
  }

  // DAP
  if (form.dap < 0) {
    errors.push('El DAP no puede ser negativo.');
  }

  // Cuotas
  if (cuotas.escalonesNoVerano.length === 0 || cuotas.escalonesVerano.length === 0) {
    errors.push('Debe haber al menos un escalón configurado.');
  }
  cuotas.escalonesNoVerano.forEach((e, i) => {
    if (e.precio < 0 || isNaN(e.precio)) {
      errors.push(`El precio del escalón ${i + 1} fuera de verano no es válido.`);
    }
    if (e.kwh <= 0 && e.kwh !== Infinity) {
      errors.push(`Los kWh del escalón ${i + 1} fuera de verano deben ser positivos.`);
    }
  });
  cuotas.escalonesVerano.forEach((e, i) => {
    if (e.precio < 0 || isNaN(e.precio)) {
      errors.push(`El precio del escalón ${i + 1} de verano no es válido.`);
    }
    if (e.kwh <= 0 && e.kwh !== Infinity) {
      errors.push(`Los kWh del escalón ${i + 1} de verano deben ser positivos.`);
    }
  });

  if (cuotas.limiteNoVerano <= 0 || cuotas.limiteVerano <= 0) {
    errors.push('Los límites DAC deben ser positivos.');
  }
  if (cuotas.minimoMensual < 0) {
    errors.push('El mínimo mensual no puede ser negativo.');
  }

  return { ok: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

export default function SimuladorPage() {
  const [form, setForm] = useState<FormState>(ESTADO_INICIAL);
  const [cuotas, setCuotas] = useState<CuotasTarifa>(CUOTAS_DEFAULT['1']);
  const [resultado, setResultado] = useState<ResultadoCalculo | null>(null);
  const [cargando, setCargando] = useState(false);
  const [errores, setErrores] = useState<string[]>([]);

  // Helper para modificar un periodo anterior específico
  const updatePeriodo = useCallback((index: number, campo: keyof PeriodoAnteriorInput, valor: string | number) => {
    setForm(f => {
      const next = [...f.periodosAnteriores];
      next[index] = { ...next[index], [campo]: valor };
      return { ...f, periodosAnteriores: next };
    });
  }, []);

  const addPeriodo = useCallback(() => {
    setForm(f => ({
      ...f,
      periodosAnteriores: [...f.periodosAnteriores, { fechaInicio: '', fechaFin: '', consumo: 0 }],
    }));
  }, []);

  const removePeriodo = useCallback((index: number) => {
    setForm(f => ({
      ...f,
      periodosAnteriores: f.periodosAnteriores.filter((_, i) => i !== index),
    }));
  }, []);

  // Validación reactiva
  const validation = useMemo(() => validar(form, cuotas), [form, cuotas]);

  // Cambio de tarifa
  const handleTarifaChange = (t: TarifaId) => {
    setForm(f => ({ ...f, tarifa: t }));
    setCuotas(CUOTAS_DEFAULT[t]);
    setResultado(null);
  };

  // Helpers de cambio de form con tipado correcto
  const updateForm = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(f => ({ ...f, [key]: value }));
  };

  const calcular = async () => {
    setCargando(true);
    setErrores([]);
    setResultado(null);

    // Re-validar al momento de calcular
    const v = validar(form, cuotas);
    if (!v.ok) {
      setErrores(v.errors);
      setCargando(false);
      return;
    }

    try {
      const input: SimuladorInput = {
        tarifa: form.tarifa,
        idEntradaVerano: form.idEntradaVerano,
        tipoPeriodo: form.tipoPeriodo,
        region: form.region,
        dap: form.dap,
        apoyoEstatal: form.apoyoEstatal,
        ivaBajoFrontera: form.ivaBajoFrontera,
        subsidio: 0,
        fechaInicioPeriodo: form.fechaInicioPeriodo,
        fechaFinPeriodo: form.fechaFinPeriodo,
        consumoActual: form.consumoActual,
        adeudoAnterior: form.adeudoAnterior,
        pagoPrevio: form.pagoPrevio,
        periodosAnteriores: form.periodosAnteriores.map(p => ({
          fechaInicio: p.fechaInicio,
          fechaFin: p.fechaFin,
          consumo: p.consumo,
        })),
        cuotas,
      };

      const res = await fetch('/api/calcular', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Error en el servidor');
      }
      setResultado(data);
    } catch (e) {
      setErrores([e instanceof Error ? e.message : 'Error desconocido']);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#e8eaf0', fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Header */}
      <header style={{ background: '#1a1d2e', borderBottom: '1px solid #2a2d3e', padding: '20px 32px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ background: '#00c896', borderRadius: 8, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, color: '#0f1117' }}>⚡</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#ffffff' }}>Simulador de Factura CFE</h1>
            <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>Tarifas domésticas 1, 1A–1F y DAC • Períodos mixtos • Promedio móvil 12 meses</p>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

        {/* ─── Panel izquierdo: formulario ─── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Configuración del servicio */}
          <Card title="Configuración del servicio">
            <Row>
              <Field label="Tarifa">
                <Select value={form.tarifa} onChange={e => handleTarifaChange(e.target.value as TarifaId)}>
                  {TARIFAS.map(t => <option key={t} value={t}>Tarifa {t}</option>)}
                </Select>
              </Field>
              <Field label="Tipo de periodo">
                <Select value={form.tipoPeriodo} onChange={e => updateForm('tipoPeriodo', e.target.value as 'MENSUAL' | 'BIMESTRAL')}>
                  <option value="BIMESTRAL">Bimestral</option>
                  <option value="MENSUAL">Mensual</option>
                </Select>
              </Field>
            </Row>
            <Row>
              <Field label="Entrada de verano">
                <Select value={form.idEntradaVerano} onChange={e => updateForm('idEntradaVerano', Number(e.target.value) as IdEntradaVerano)}>
                  {([1, 2, 3, 4] as IdEntradaVerano[]).map(id => (
                    <option key={id} value={id}>1° de {MESES_ENTRADA[id]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="DAP mensual ($)">
                <NumberInput value={form.dap} min={0} onChange={v => updateForm('dap', v)} />
              </Field>
            </Row>
            <Row>
              <Field label="Apoyo estatal ($ por periodo)">
                <NumberInput value={form.apoyoEstatal} min={0} onChange={v => updateForm('apoyoEstatal', v)} />
              </Field>
              <Field label="Región tarifaria">
                <Select value={form.region} onChange={e => updateForm('region', e.target.value as RegionTarifaria)}>
                  {REGIONES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                </Select>
              </Field>
            </Row>
            <Field label="Región IVA">
              <Select value={form.ivaBajoFrontera ? 'frontera' : 'normal'} onChange={e => updateForm('ivaBajoFrontera', e.target.value === 'frontera')}>
                <option value="normal">Interior (16%)</option>
                <option value="frontera">Frontera/BC/BCS/QROO (8%)</option>
              </Select>
            </Field>
          </Card>

          {/* Periodo actual */}
          <Card title="Periodo actual">
            <Row>
              <Field label="Inicio periodo actual">
                <Input type="date" value={form.fechaInicioPeriodo} onChange={e => {
                  const d = e.target.valueAsDate;
                  if (d) {
                    const y = d.getFullYear();
                    const m = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    updateForm('fechaInicioPeriodo', `${y}-${m}-${day}`);
                  } else {
                    updateForm('fechaInicioPeriodo', e.target.value);
                  }
                }} />
              </Field>
              <Field label="Fin periodo (fecha de lectura)">
                <Input type="date" value={form.fechaFinPeriodo} onChange={e => {
                  const d = e.target.valueAsDate;
                  if (d) {
                    const y = d.getFullYear();
                    const m = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    updateForm('fechaFinPeriodo', `${y}-${m}-${day}`);
                  } else {
                    updateForm('fechaFinPeriodo', e.target.value);
                  }
                }} />
              </Field>
            </Row>
            <Field label="Consumo actual (kWh)">
              <NumberInput value={form.consumoActual} min={0} onChange={v => updateForm('consumoActual', v)} />
            </Field>
          </Card>

          {/* Adeudo anterior y pagos previos */}
          <Card title="Adeudo y pagos previos">
            <Row>
              <Field label="Adeudo de periodo anterior ($)">
                <NumberInput value={form.adeudoAnterior} min={0} onChange={v => updateForm('adeudoAnterior', v)} />
              </Field>
              <Field label="Pago previo ($)">
                <NumberInput value={form.pagoPrevio} min={0} onChange={v => updateForm('pagoPrevio', v)} />
              </Field>
            </Row>
          </Card>

          {/* Periodos anteriores */}
          <Card title={`Periodos anteriores (${form.tipoPeriodo === 'BIMESTRAL' ? 'bimestrales' : 'mensuales'}, del más antiguo al más reciente)`}>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px' }}>
              Se usan para el promedio móvil de 12 meses (detección DAC) y el CPD anterior (periodos mixtos).
              {form.tipoPeriodo === 'BIMESTRAL'
                ? ' Cada periodo bimestral se divide entre 2 para obtener el valor mensual equivalente.'
                : ''}
            </p>

            {form.periodosAnteriores.map((p, i) => (
              <div key={i} style={{ background: '#0f1117', borderRadius: 8, padding: 12, marginBottom: 10, border: '1px solid #2a2d3e' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 600 }}>Periodo #{i + 1}</span>
                  <button
                    onClick={() => removePeriodo(i)}
                    style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}
                  >Eliminar</button>
                </div>
                <Row>
                  <Field label="Inicio">
                    <Input type="date" value={p.fechaInicio} onChange={e => {
                      const d = e.target.valueAsDate;
                      if (d) {
                        const y = d.getFullYear();
                        const m = String(d.getMonth() + 1).padStart(2, '0');
                        const day = String(d.getDate()).padStart(2, '0');
                        updatePeriodo(i, 'fechaInicio', `${y}-${m}-${day}`);
                      } else {
                        updatePeriodo(i, 'fechaInicio', e.target.value);
                      }
                    }} />
                  </Field>
                  <Field label="Fin">
                    <Input type="date" value={p.fechaFin} onChange={e => {
                      const d = e.target.valueAsDate;
                      if (d) {
                        const y = d.getFullYear();
                        const m = String(d.getMonth() + 1).padStart(2, '0');
                        const day = String(d.getDate()).padStart(2, '0');
                        updatePeriodo(i, 'fechaFin', `${y}-${m}-${day}`);
                      } else {
                        updatePeriodo(i, 'fechaFin', e.target.value);
                      }
                    }} />
                  </Field>
                </Row>
                <Field label={`Consumo (kWh)`}>
                  <NumberInput value={p.consumo} min={0} onChange={v => updatePeriodo(i, 'consumo', v)} />
                </Field>
              </div>
            ))}

            <button
              onClick={addPeriodo}
              style={{
                background: 'none',
                border: '1px dashed #2a2d3e',
                borderRadius: 8,
                color: '#6b7280',
                cursor: 'pointer',
                padding: '10px 16px',
                fontSize: 13,
                fontWeight: 600,
                width: '100%',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => { (e.target as HTMLButtonElement).style.borderColor = '#00c896'; (e.target as HTMLButtonElement).style.color = '#00c896'; }}
              onMouseLeave={e => { (e.target as HTMLButtonElement).style.borderColor = '#2a2d3e'; (e.target as HTMLButtonElement).style.color = '#6b7280'; }}
            >
              + Agregar periodo {form.tipoPeriodo === 'BIMESTRAL' ? 'bimestral' : 'mensual'} anterior
            </button>

            <p style={{ fontSize: 11, color: '#6b7280', margin: '8px 0 0' }}>
              Periodos capturados: <strong style={{ color: '#00c896' }}>{form.periodosAnteriores.length}</strong>
              &nbsp;·&nbsp; Valores mensuales estimados: <strong style={{ color: '#00c896' }}>{form.tipoPeriodo === 'BIMESTRAL' ? form.periodosAnteriores.length * 2 : form.periodosAnteriores.length}</strong>
            </p>
          </Card>

          {/* Cuotas editables */}
          <Card title={`Cuotas de la tarifa ${form.tarifa}`}>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px' }}>
              Estos valores provienen de la tabla cosostatrifas de la BD. Modifícalos para simular distintos periodos.
            </p>

            <SectionLabel color="#00c896">Escalones fuera de verano</SectionLabel>
            {cuotas.escalonesNoVerano.map((e, i) => (
              <Row key={`nv-${i}`}>
                <Field label={`Escalón ${i + 1} — kWh`}>
                  <NumberInput
                    value={e.kwh === Infinity ? null : e.kwh}
                    allowEmpty
                    allowInfinity
                    placeholder="∞"
                    onChange={v => {
                      const next = [...cuotas.escalonesNoVerano];
                      next[i] = { ...next[i], kwh: v === null ? Infinity : v };
                      setCuotas(c => ({ ...c, escalonesNoVerano: next }));
                    }}
                  />
                </Field>
                <Field label="$/kWh">
                  <NumberInput
                    value={e.precio}
                    min={0}
                    step={0.001}
                    onChange={v => {
                      const next = [...cuotas.escalonesNoVerano];
                      next[i] = { ...next[i], precio: v };
                      setCuotas(c => ({ ...c, escalonesNoVerano: next }));
                    }}
                  />
                </Field>
              </Row>
            ))}

            <SectionLabel color="#f59e0b">Escalones de verano</SectionLabel>
            {cuotas.escalonesVerano.map((e, i) => (
              <Row key={`v-${i}`}>
                <Field label={`Escalón ${i + 1} — kWh`}>
                  <NumberInput
                    value={e.kwh === Infinity ? null : e.kwh}
                    allowEmpty
                    allowInfinity
                    placeholder="∞"
                    onChange={v => {
                      const next = [...cuotas.escalonesVerano];
                      next[i] = { ...next[i], kwh: v === null ? Infinity : v };
                      setCuotas(c => ({ ...c, escalonesVerano: next }));
                    }}
                  />
                </Field>
                <Field label="$/kWh">
                  <NumberInput
                    value={e.precio}
                    min={0}
                    step={0.001}
                    onChange={v => {
                      const next = [...cuotas.escalonesVerano];
                      next[i] = { ...next[i], precio: v };
                      setCuotas(c => ({ ...c, escalonesVerano: next }));
                    }}
                  />
                </Field>
              </Row>
            ))}

            <Row>
              <Field label="Límite no verano (kWh/mes)">
                <NumberInput
                  value={cuotas.limiteNoVerano === Infinity ? null : cuotas.limiteNoVerano}
                  allowEmpty
                  allowInfinity
                  placeholder="∞"
                  onChange={v => setCuotas(c => ({ ...c, limiteNoVerano: v === null ? Infinity : v }))}
                />
              </Field>
              <Field label="Límite verano (kWh/mes)">
                <NumberInput
                  value={cuotas.limiteVerano === Infinity ? null : cuotas.limiteVerano}
                  allowEmpty
                  allowInfinity
                  placeholder="∞"
                  onChange={v => setCuotas(c => ({ ...c, limiteVerano: v === null ? Infinity : v }))}
                />
              </Field>
            </Row>
            <Field label="Mínimo mensual ($)">
              <NumberInput value={cuotas.minimoMensual} min={0} step={0.01} onChange={v => setCuotas(c => ({ ...c, minimoMensual: v }))} />
            </Field>
          </Card>

          {/* Validación en vivo */}
          {!validation.ok && (
            <div style={{ background: '#2d1f0f', border: '1px solid #f59e0b', borderRadius: 8, padding: 14, fontSize: 13, color: '#fcd34d' }}>
              <strong style={{ display: 'block', marginBottom: 6 }}>⚠ Revisa los datos antes de calcular:</strong>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {validation.errors.map((err, i) => <li key={i} style={{ marginBottom: 2 }}>{err}</li>)}
              </ul>
            </div>
          )}

          <button
            onClick={calcular}
            disabled={cargando || !validation.ok}
            style={{
              background: cargando || !validation.ok ? '#374151' : '#00c896',
              color: cargando || !validation.ok ? '#9ca3af' : '#0f1117',
              border: 'none',
              borderRadius: 10,
              padding: '16px 32px',
              fontSize: 16,
              fontWeight: 700,
              cursor: cargando || !validation.ok ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {cargando ? 'Calculando...' : '⚡ Calcular factura'}
          </button>

          {errores.length > 0 && (
            <div style={{ background: '#2d1515', border: '1px solid #dc2626', borderRadius: 8, padding: 14, color: '#fca5a5', fontSize: 13 }}>
              <strong style={{ display: 'block', marginBottom: 6 }}>Error:</strong>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {errores.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>

        {/* ─── Panel derecho: resultados ─── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {resultado ? <Resultados r={resultado} /> : (
            <div style={{ background: '#1a1d2e', borderRadius: 12, border: '2px dashed #2a2d3e', padding: 60, textAlign: 'center', color: '#4b5563' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
              <p style={{ fontSize: 14 }}>Configura los parámetros y presiona <strong style={{ color: '#6b7280' }}>Calcular factura</strong> para ver el desglose</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTE: RESULTADOS
// ═══════════════════════════════════════════════════════════════════════════

function Resultados({ r }: { r: ResultadoCalculo }) {
  return (
    <>
      <Card title="Diagnóstico del periodo">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <Badge color={r.esVerano ? '#f59e0b' : '#00c896'} label={r.esVerano ? '☀️ Verano' : '❄️ No verano'} />
          {r.esMixto && <Badge color="#a78bfa" label={`🔀 Periodo mixto (${r.esEntradaVerano ? 'entrada' : 'salida'} de verano)`} />}
          {r.esDAC && <Badge color="#dc2626" label="⚠️ Tarifa DAC" />}
        </div>
        <Grid>
          <Stat label="Días del periodo" value={String(r.diasPeriodo)} />
          <Stat label="CPD actual" value={`${fmtKWh(r.cpd)} kWh/día`} />
          <Stat label="Consumo pronóstico" value={`${fmtKWh(r.consumoPronostico)} kWh`} />
          <Stat label="Promedio móvil 12 m" value={`${fmtKWh(r.promedioMovil12Meses)} kWh/mes`} />
          <Stat label="Días en verano" value={String(r.diasVeranoEnPeriodo)} />
          <Stat label="Días fuera verano" value={String(r.diasNoVeranoEnPeriodo)} />
          <Stat label="Entrada de verano" value={r.fechaEntradaVerano} />
          <Stat label="Salida de verano" value={r.fechaSalidaVerano} />
        </Grid>
      </Card>

      {r.mixto && (
        <Card title="Desglose periodo mixto">
          <Grid>
            <Stat label="Consumo no verano" value={`${fmtKWh(r.mixto.consumoNoVerano)} kWh`} />
            <Stat label="Consumo verano" value={`${fmtKWh(r.mixto.consumoVerano)} kWh`} />
            <Stat label="CPD actual" value={`${fmtKWh(r.mixto.cpd)} kWh/día`} />
            <Stat label="CPD anterior" value={r.mixto.cpdAnterior !== null ? `${fmtKWh(r.mixto.cpdAnterior)} kWh/día` : 'Sin historial'} />
          </Grid>
          <div style={{ marginTop: 12, background: '#0f1117', borderRadius: 8, padding: 12, fontSize: 13 }}>
            <p style={{ margin: '0 0 8px', color: '#9ca3af' }}>Comparación de opciones CFE:</p>
            {r.mixto.costoOpcionA !== null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1f2937' }}>
                <span>Opción A (menor CPD × días)</span>
                <span style={{ color: r.mixto.opcionSeleccionada === 'A' ? '#00c896' : '#6b7280', fontWeight: r.mixto.opcionSeleccionada === 'A' ? 700 : 400 }}>
                  {fmtMXN(r.mixto.costoOpcionA)} {r.mixto.opcionSeleccionada === 'A' ? '✓ Seleccionada' : ''}
                </span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
              <span>Opción B (CPD actual directo)</span>
              <span style={{ color: r.mixto.opcionSeleccionada === 'B' ? '#00c896' : '#6b7280', fontWeight: r.mixto.opcionSeleccionada === 'B' ? 700 : 400 }}>
                {r.mixto.costoOpcionB !== null ? fmtMXN(r.mixto.costoOpcionB) : '—'} {r.mixto.opcionSeleccionada === 'B' ? '✓ Seleccionada' : ''}
              </span>
            </div>
            {r.mixto.opcionSeleccionada === 'SIN_HISTORIAL' && (
              <p style={{ margin: '8px 0 0', color: '#f59e0b', fontSize: 12 }}>⚠ Sin historial anterior — se aplicó CPD actual directamente (Opción B)</p>
            )}
          </div>
        </Card>
      )}

      <Card title="Escalones aplicados">
        {r.escalonesAplicados.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: 13 }}>Sin escalones aplicados.</p>
        ) : r.esMixto ? (
          <>
            <SectionLabel color="#00c896">Fuera de verano</SectionLabel>
            <EscalonesTable escalones={r.escalonesNoVerano} />
            <div style={{ height: 16 }} />
            <SectionLabel color="#f59e0b">Verano</SectionLabel>
            <EscalonesTable escalones={r.escalonesVerano} />
          </>
        ) : (
          <EscalonesTable escalones={r.escalonesAplicados} />
        )}
      </Card>

      <Card title="Cadena de facturación">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <LineaFactura label="Energía (escalones + cargo fijo suministro)" valor={r.facturacionNeta} />
          <LineaFactura label={`IVA (${(r.tasaIva * 100).toFixed(0)}%)`} valor={r.iva} accent="#f59e0b" />
          <LineaFactura label="Facturación del periodo" valor={r.facturacionPeriodo} accent="#a78bfa" />
          <div style={{ borderTop: '1px solid #2a2d3e', margin: '8px 0' }} />
          {r.apoyoEstatalAplicado > 0 && <LineaFactura label="Apoyo estatal" valor={-r.apoyoEstatalAplicado} accent="#22d3ee" />}
          <LineaFactura label="Subtotal" valor={r.facturacionPeriodo - r.apoyoEstatalAplicado} accent="#6b7280" />
          <LineaFactura label="DAP (sin IVA)" valor={r.dapAplicado} accent="#6b7280" />
          {r.adeudoAplicado > 0 && <LineaFactura label="Adeudo periodo anterior" valor={r.adeudoAplicado} accent="#f59e0b" />}
          {r.pagoAplicado > 0 && <LineaFactura label="Pago previo" valor={-r.pagoAplicado} accent="#22d3ee" />}
          <div style={{ borderTop: '2px solid #2a2d3e', margin: '8px 0' }} />
        </div>

        <div style={{ background: '#0f1117', borderRadius: 12, padding: '20px 24px', textAlign: 'center', border: '1px solid #00c896' }}>
          <p style={{ margin: 0, fontSize: 12, color: '#6b7280', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Total a pagar</p>
          <p style={{ margin: '8px 0 0', fontSize: 36, fontWeight: 800, color: '#00c896' }}>{fmtMXN(r.totalPagar)}</p>
        </div>
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MICRO-COMPONENTES
// ═══════════════════════════════════════════════════════════════════════════

const inputStyle: React.CSSProperties = {
  background: '#0f1117',
  border: '1px solid #2a2d3e',
  borderRadius: 8,
  color: '#e8eaf0',
  padding: '10px 12px',
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...inputStyle, ...props.style }} />;
}

interface NumberInputProps {
  value: number | null;
  min?: number;
  step?: number;
  placeholder?: string;
  allowEmpty?: boolean;
  allowInfinity?: boolean;
  onChange: (value: number) => void;
}

function NumberInput({ value, min, step, placeholder, allowEmpty, onChange }: NumberInputProps) {
  const [raw, setRaw] = useState<string>('');

  useEffect(() => {
    if (value === null || value === undefined) {
      setRaw('');
    } else {
      setRaw(String(value));
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      placeholder={placeholder}
      style={inputStyle}
      onChange={e => {
        const r = e.target.value.replace(/,/g, '.');
        if (r === '' || r === '-' || r === '.') {
          setRaw(r);
          onChange(0);
          return;
        }
        const parsed = parseFloat(r);
        if (isNaN(parsed) || !isFinite(parsed)) {
          return;
        }
        if (min !== undefined && parsed < min) {
          setRaw(String(min));
          onChange(min);
          return;
        }
        setRaw(r);
        onChange(parsed);
      }}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} style={{ ...inputStyle, cursor: 'pointer', ...props.style }}>
      {props.children}
    </select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
      <label style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>{children}</div>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#1a1d2e', borderRadius: 12, border: '1px solid #2a2d3e', padding: 20 }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</h2>
      {children}
    </div>
  );
}

function SectionLabel({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 13, fontWeight: 600, color, margin: '12px 0 8px' }}>{children}</p>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#0f1117', borderRadius: 8, padding: '10px 14px' }}>
      <p style={{ margin: 0, fontSize: 11, color: '#6b7280' }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: 15, fontWeight: 600, color: '#e8eaf0', wordBreak: 'break-word' }}>{value}</p>
    </div>
  );
}

function Badge({ color, label }: { color: string; label: string }) {
  return (
    <span style={{
      background: color + '22',
      color,
      border: `1px solid ${color}44`,
      borderRadius: 20,
      padding: '4px 12px',
      fontSize: 12,
      fontWeight: 600,
    }}>
      {label}
    </span>
  );
}

function LineaFactura({ label, valor, muted, accent }: { label: string; valor: number; muted?: boolean; accent?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', opacity: muted ? 0.5 : 1 }}>
      <span style={{ fontSize: 13, color: '#9ca3af' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: accent ?? '#e8eaf0' }}>{fmtMXN(valor)}</span>
    </div>
  );
}

function EscalonesTable({ escalones }: { escalones: DesgloseEscalones[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid #2a2d3e' }}>
          <th style={thStyle}>Tramo</th>
          <th style={thStyle}>kWh consumidos</th>
          <th style={thStyle}>$/kWh</th>
          <th style={thStyle}>Subtotal</th>
        </tr>
      </thead>
      <tbody>
        {escalones.map((e, i) => (
          <tr key={i} style={{ borderBottom: '1px solid #1f2937' }}>
            <td style={tdStyle}>{e.nombre}</td>
            <td style={tdStyle}>{fmtKWh(e.kwh)}</td>
            <td style={tdStyle}>${fmt(e.precio)}</td>
            <td style={{ ...tdStyle, color: '#00c896' }}>{fmtMXN(e.subtotal)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', color: '#6b7280', fontSize: 12, fontWeight: 500 };
const tdStyle: React.CSSProperties = { padding: '8px 12px', color: '#e8eaf0' };

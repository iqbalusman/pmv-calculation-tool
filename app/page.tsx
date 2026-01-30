'use client'

import React, { useEffect, useState } from "react"
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceDot,
} from "recharts"
import { Phone, Globe } from "lucide-react"


import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Inputs = {
  pmv_iso: number | ''
  v: number | ''
  svf: number | ''
  h_w: number | ''
  veg_func: number | ''
}

export default function ThermalComfortCalculator() {
  // Default contoh dari dokumen
  const DEFAULT_VALUES: Inputs = {
    pmv_iso: 0.60,
    v: 3.2,
    svf: 0.55,
    h_w: 0.923,
    veg_func: 1,
  }

  // Parameter dari formula
  const PARAMS = {
    alpha: 0.225,
    beta1: 0.774,
    beta2: 7.379,
    beta3: -0.385,
    beta4: -0.098,
    k: 0.3,
    alphaV: 0.5,
  }

  const [inputs, setInputs] = useState<Inputs>(DEFAULT_VALUES)
  const [results, setResults] = useState<any>(null)
  const [errors, setErrors] = useState<string>('')

  // Helper functions untuk pembulatan sesuai dokumen
  const round3 = (x: number): number => Number(x.toFixed(3))

  const trunc3 = (x: number): number => {
    if (x >= 0) return Math.floor(x * 1000) / 1000
    return Math.ceil(x * 1000) / 1000
  }

  // Fungsi perhitungan PMV_abran
  const calculatePMVAbran = (pmv_iso: number, v: number, svf: number, h_w: number, veg_func: number) => {
    // Validasi input
    if ([pmv_iso, v, svf, h_w, veg_func].some((n) => Number.isNaN(n))) {
      throw new Error('Semua input harus berupa angka')
    }

    // Hitung A = H/W + αv*v
    const A = h_w + PARAMS.alphaV * v

    // Hitung exponent = -k*A
    const exponent = -PARAMS.k * A

    // Hitung exp_factor = exp(exponent) menggunakan 2.72
    const exp_factor = Math.pow(2.72, exponent)

    // Hitung SVFv = SVF*v
    const SVFv = svf * v

    // Hitung masing-masing term
    const termAlpha = round3(PARAMS.alpha)
    const termBeta1 = round3(PARAMS.beta1 * pmv_iso)
    const termBeta2 = trunc3(PARAMS.beta2 * exp_factor)
    const termBeta3 = round3(PARAMS.beta3 * SVFv)
    const termBeta4 = round3(PARAMS.beta4 * veg_func)

    // Total PMV_abran
    const total = round3(termAlpha + termBeta1 + termBeta2 + termBeta3 + termBeta4)

    return {
      A: round3(A),
      exponent: round3(exponent),
      exp_factor: round3(exp_factor),
      SVFv: round3(SVFv),
      terms: {
        alpha: termAlpha,
        beta1: termBeta1,
        beta2: termBeta2,
        beta3: termBeta3,
        beta4: termBeta4,
      },
      total,
    }
  }

  const handleCalculate = () => {
    try {
      setErrors('')

      const pmv_iso = parseFloat(String(inputs.pmv_iso))
      const v = parseFloat(String(inputs.v))
      const svf = parseFloat(String(inputs.svf))
      const h_w = parseFloat(String(inputs.h_w))
      const veg_func = parseFloat(String(inputs.veg_func))

      const result = calculatePMVAbran(pmv_iso, v, svf, h_w, veg_func)
      setResults(result)
    } catch (error: any) {
      setErrors(error.message)
      setResults(null)
    }
  }

  const handleReset = () => {
    setInputs(DEFAULT_VALUES)
    try {
      const result = calculatePMVAbran(
        Number(DEFAULT_VALUES.pmv_iso),
        Number(DEFAULT_VALUES.v),
        Number(DEFAULT_VALUES.svf),
        Number(DEFAULT_VALUES.h_w),
        Number(DEFAULT_VALUES.veg_func)
      )
      setResults(result)
      setErrors('')
    } catch (error: any) {
      setErrors(error.message)
      setResults(null)
    }
  }

  const handleInputChange = (key: keyof Inputs, value: string) => {
    setInputs(prev => ({
      ...prev,
      [key]: value === '' ? '' : parseFloat(value),
    }))
  }

  // Chart 1: breakdown dari hasil hitung (komponen & akumulasi)
  const generateBreakdownData = () => {
    if (!results) return []

    const terms = [
      { name: 'α', component: Number(results.terms.alpha) },
      { name: 'β1·PMV_iso', component: Number(results.terms.beta1) },
      { name: 'β2·exp', component: Number(results.terms.beta2) },
      { name: 'β3·(SVF·v)', component: Number(results.terms.beta3) },
      { name: 'β4·veg', component: Number(results.terms.beta4) },
    ]

    let cum = 0
    const data = terms.map((t) => {
      cum = round3(cum + t.component)
      return { ...t, cumulative: cum }
    })

    data.push({
      name: 'Total',
      component: 0,
      cumulative: Number(results.total),
    })

    return data
  }

  // Chart 2: zona kenyamanan (garis hijau) + titik hasil PMV (merah)
  const generateZoneData = () => {
    if (!results) return []

    const data: Array<{ pmv: number; zone: number | null }> = []
    const pmvValue = Number(results.total)

    for (let i = -2; i <= 4; i += 0.2) {
      const x = round3(i)
      data.push({
        pmv: x,
        zone: Math.abs(x - pmvValue) < 0.5 ? 20 : null, // “zona” di sekitar hasil (±0.5)
      })
    }

    return data
  }

  // Initialize dengan default values
  useEffect(() => {
    handleReset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const breakdownData = generateBreakdownData()
  const zoneData = generateZoneData()

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">
            Thermal Comfort Calculator
          </h1>
          <p className="text-slate-600">
            PMV-ABRAN Model - Perhitungan Kenyamanan Termal Adaptif (Lingkungan Permukiman Pesisir)
          </p>
        </div>

        {/* Top layout: Input + Result */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Panel Input */}
          <Card className="h-fit">
            <CardHeader className="bg-slate-50 border-b">
              <CardTitle>Input Parameters</CardTitle>
              <CardDescription>Masukkan nilai parameter perhitungan</CardDescription>
            </CardHeader>

            <CardContent className="pt-6 space-y-6">
              {/* PMV_iso */}
              <div className="space-y-2">
                <Label htmlFor="pmv_iso" className="text-sm font-medium text-slate-700">
                  PMV Isotropic
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="pmv_iso"
                    type="number"
                    step="0.01"
                    value={inputs.pmv_iso}
                    onChange={(e) => handleInputChange('pmv_iso', e.target.value)}
                    className="flex-1"
                    placeholder="0.60"
                  />
                  <span className="flex items-center text-sm text-slate-500 px-2 bg-slate-50 rounded border border-slate-200">
                    -
                  </span>
                </div>
              </div>

              {/* Wind Speed */}
              <div className="space-y-2">
                <Label htmlFor="v" className="text-sm font-medium text-slate-700">
                  Wind Speed (v)
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="v"
                    type="number"
                    step="0.01"
                    value={inputs.v}
                    onChange={(e) => handleInputChange('v', e.target.value)}
                    className="flex-1"
                    placeholder="3.2"
                  />
                  <span className="flex items-center text-sm text-slate-500 px-2 bg-slate-50 rounded border border-slate-200">
                    m/s
                  </span>
                </div>
              </div>

              {/* SVF */}
              <div className="space-y-2">
                <Label htmlFor="svf" className="text-sm font-medium text-slate-700">
                  Sky View Factor (SVF)
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="svf"
                    type="number"
                    step="0.01"
                    value={inputs.svf}
                    onChange={(e) => handleInputChange('svf', e.target.value)}
                    className="flex-1"
                    placeholder="0.55"
                  />
                  <span className="flex items-center text-sm text-slate-500 px-2 bg-slate-50 rounded border border-slate-200">
                    (λₚ)
                  </span>
                </div>
              </div>

              {/* H/W */}
              <div className="space-y-2">
                <Label htmlFor="h_w" className="text-sm font-medium text-slate-700">
                  Height/Width Ratio (H/W)
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="h_w"
                    type="number"
                    step="0.01"
                    value={inputs.h_w}
                    onChange={(e) => handleInputChange('h_w', e.target.value)}
                    className="flex-1"
                    placeholder="0.923"
                  />
                  <span className="flex items-center text-sm text-slate-500 px-2 bg-slate-50 rounded border border-slate-200">
                    Ratio
                  </span>
                </div>
              </div>

              {/* Vegetation Function */}
              <div className="space-y-2">
                <Label htmlFor="veg_func" className="text-sm font-medium text-slate-700">
                  Vegetation Function
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="veg_func"
                    type="number"
                    step="0.01"
                    value={inputs.veg_func}
                    onChange={(e) => handleInputChange('veg_func', e.target.value)}
                    className="flex-1"
                    placeholder="1"
                  />
                  <span className="flex items-center text-sm text-slate-500 px-2 bg-slate-50 rounded border border-slate-200">
                    -
                  </span>
                </div>
              </div>

              {errors && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {errors}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  onClick={handleCalculate}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Hitung
                </Button>
                <Button
                  onClick={handleReset}
                  variant="outline"
                  className="flex-1 bg-transparent"
                >
                  Reset ke Contoh
                </Button>
              </div>

              <div className="mt-2 p-4 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-xs font-semibold text-slate-700 mb-3">Parameter Formula</p>
                <div className="text-xs text-slate-600 space-y-1">
                  <div>α = {PARAMS.alpha}</div>
                  <div>β1 = {PARAMS.beta1}</div>
                  <div>β2 = {PARAMS.beta2}</div>
                  <div>β3 = {PARAMS.beta3}</div>
                  <div>β4 = {PARAMS.beta4}</div>
                  <div>k = {PARAMS.k}, αv = {PARAMS.alphaV}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Panel Hasil */}
          <div className="space-y-6">
            {results ? (
              <Card>
                <CardHeader className="bg-green-50 border-b border-green-200">
                  <CardTitle className="text-green-700">✓ Hasil Perhitungan</CardTitle>
                </CardHeader>

                <CardContent className="pt-6">
                  <div className="mb-6 p-6 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg border border-blue-200">
                    <p className="text-xs text-blue-600 uppercase tracking-wide font-semibold mb-2">
                      PMV-ABRAN
                    </p>
                    <p className="text-5xl font-bold text-blue-700">
                      {Number(results.total).toFixed(3)}
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-700 mb-3">
                        Langkah Perhitungan
                      </p>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between py-2 border-b border-slate-100">
                          <span className="text-slate-600">A = H/W + αv × v</span>
                          <span className="font-mono font-semibold text-slate-900">
                            {results.A}
                          </span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-slate-100">
                          <span className="text-slate-600">Exponent = -k × A</span>
                          <span className="font-mono font-semibold text-slate-900">
                            {results.exponent}
                          </span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-slate-100">
                          <span className="text-slate-600">
                            exp_factor = e<sup>exponent</sup>
                          </span>
                          <span className="font-mono font-semibold text-slate-900">
                            {results.exp_factor}
                          </span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-slate-100">
                          <span className="text-slate-600">SVF × v</span>
                          <span className="font-mono font-semibold text-slate-900">
                            {results.SVFv}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <p className="text-sm font-semibold text-slate-700 mb-3">
                        Komponen Hasil
                      </p>
                      <div className="space-y-2 text-sm bg-slate-50 p-3 rounded-lg">
                        <div className="flex justify-between">
                          <span className="text-slate-600">α</span>
                          <span className="font-mono font-semibold">{results.terms.alpha}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">β1 × PMV_iso</span>
                          <span className="font-mono font-semibold">{results.terms.beta1}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">β2 × exp_factor</span>
                          <span className="font-mono font-semibold">{results.terms.beta2}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">β3 × (SVF × v)</span>
                          <span className="font-mono font-semibold">{results.terms.beta3}</span>
                        </div>
                        <div className="flex justify-between border-t border-slate-200 pt-2 mt-2">
                          <span className="text-slate-600">β4 × veg_func</span>
                          <span className="font-mono font-semibold">{results.terms.beta4}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 p-4 bg-blue-50 rounded-lg border border-blue-200">
                      <p className="text-xs text-blue-600 font-semibold uppercase tracking-wide mb-2">
                        Total PMV-ABRAN
                      </p>
                      <p className="text-3xl font-bold text-blue-700">
                        {Number(results.total).toFixed(3)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-8 pb-8">
                  <div className="text-center">
                    <p className="text-slate-500 mb-4">
                      Masukkan parameter dan klik "Hitung" untuk melihat hasil
                    </p>
                    <Button onClick={handleReset} className="bg-blue-600 hover:bg-blue-700">
                      Muat Nilai Default
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Distribusi PMV: SATU GRAFIK (Breakdown Komponen) */}
{results && (
  <div className="mt-6">
    <Card>
      <CardHeader className="border-b bg-white">
        <CardTitle className="text-lg">Distribusi PMV</CardTitle>
        <CardDescription>
          Grafik kontribusi tiap komponen terhadap total PMV-ABRAN (paling relevan untuk hasil akhir).
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-6">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-800 mb-3">
            Breakdown Komponen & Akumulasi
          </p>

          <div className="h-[380px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={breakdownData}
                margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />

                <Bar dataKey="component" name="Nilai Komponen" fill="#10B981"/>
                <Line
                  type="monotone"
                  dataKey="cumulative"
                  name="Akumulasi"
                  strokeWidth={3}
                  dot
                  isAnimationActive={false}
                />

                <ReferenceDot
                  x="Total"
                  y={Number(results.total)}
                  r={7}
                  fill="#ef4444"
                  stroke="#dc2626"
                  strokeWidth={2}
                  label={{ value: `Total: ${Number(results.total).toFixed(3)}`, position: 'top' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <p className="text-xs text-slate-500 mt-3">
            Batang = kontribusi tiap komponen, garis = akumulasi sampai total PMV-ABRAN.
          </p>
        </div>
      </CardContent>
    </Card>
  </div>
)}
<footer className="mt-10 border-t border-slate-200 bg-white/70 backdrop-blur">
  <div className="max-w-7xl mx-auto px-6 py-10">
    {/* Top */}
    <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
      {/* Brand */}
      <div className="max-w-2xl">
        <div className="flex items-center gap-4">
          <div className="h-11 w-11 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-sm ring-4 ring-blue-100">
            <span className="text-sm font-bold">TC</span>
          </div>

          <div className="leading-tight">
            <p className="text-base font-semibold text-slate-900">
              Thermal Comfort Calculator
            </p>
            <p className="text-xs text-slate-500">
              PMV-ABRAN • Adaptive Thermal Comfort
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm text-slate-600 leading-relaxed">
          Aplikasi untuk menghitung PMV-ABRAN berdasarkan parameter lingkungan
          permukiman pesisir, menampilkan hasil, komponen perhitungan, dan visualisasi grafik.
        </p>
      </div>

      {/* Contact */}
      <div className="w-full md:w-[320px]">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
          <p className="text-sm font-semibold text-slate-900 mb-3">
            Kontak
          </p>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-slate-100 flex items-center justify-center">
                <Phone className="h-4 w-4 text-slate-600" />
              </div>

              <div className="leading-tight">
                <p className="text-xs text-slate-500">Telepon / WhatsApp</p>
                <a
                  href="https://wa.me/082226192277"
                 target="_blank"
                 rel="noreferrer"
                 className="text-sm font-semibold text-slate-900 hover:text-blue-700"
                  >
                 +62 822 2619 2277
                 </a>

              </div>
            </div>

            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
              Active
            </span>
          </div>
        </div>
      </div>
    </div>

    {/* Bottom */}
    <div className="mt-8 border-t border-slate-200 pt-5 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
      <p className="text-xs text-slate-500">
        © {new Date().getFullYear()} Thermal Comfort Calculator. Ibalusman
      </p>
    </div>
  </div>
</footer>

      </div>
    </main>
  )
}

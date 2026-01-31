'use client'

import React, { useEffect, useState } from "react"
import jsPDF from "jspdf"
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceDot,
} from "recharts"
import { Phone } from "lucide-react"

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

  // ✅ Ikuti perhitungan yang ada di sini (exp_factor pakai 2.72^exponent)
  const calculatePMVAbran = (
    pmv_iso: number,
    v: number,
    svf: number,
    h_w: number,
    veg_func: number
  ) => {
    if ([pmv_iso, v, svf, h_w, veg_func].some((n) => Number.isNaN(n))) {
      throw new Error('Semua input harus berupa angka')
    }

    // A = H/W + αv*v
    const A = h_w + PARAMS.alphaV * v

    // exponent = -k*A
    const exponent = -PARAMS.k * A

    // exp_factor = 2.72^exponent  (sesuai kode kamu)
    const exp_factor = Math.pow(2.72, exponent)

    // SVFv = SVF*v
    const SVFv = svf * v

    // Term sesuai rounding/truncation yang kamu pakai
    const termAlpha = round3(PARAMS.alpha)
    const termBeta1 = round3(PARAMS.beta1 * pmv_iso)
    const termBeta2 = trunc3(PARAMS.beta2 * exp_factor)
    const termBeta3 = round3(PARAMS.beta3 * SVFv)
    const termBeta4 = round3(PARAMS.beta4 * veg_func)

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

  // Chart: breakdown komponen & akumulasi
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

  const breakdownData = generateBreakdownData()

  // ✅ Download PDF: Cara kerja dari awal sampai selesai (sesuai rumus di kode kamu)
  const handleDownloadPDF = () => {
    if (!results) return

    const doc = new jsPDF({ unit: "pt", format: "a4" })
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const marginX = 40
    const maxW = pageW - marginX * 2

    let y = 48
    const lineGap = 16

    const ensureSpace = (need: number) => {
      if (y + need > pageH - 40) {
        doc.addPage()
        y = 48
      }
    }

    const hr = () => {
      ensureSpace(10)
      doc.setDrawColor(200)
      doc.line(marginX, y, pageW - marginX, y)
      y += 14
    }

    const write = (text: string, opts?: { bold?: boolean; size?: number }) => {
      ensureSpace(24)
      doc.setFont("helvetica", opts?.bold ? "bold" : "normal")
      doc.setFontSize(opts?.size ?? 11)
      const lines = doc.splitTextToSize(text, maxW)
      for (const ln of lines) {
        ensureSpace(18)
        doc.text(ln, marginX, y)
        y += lineGap
      }
    }

    const writeKV = (k: string, v: string) => {
      ensureSpace(18)
      doc.setFont("helvetica", "normal")
      doc.setFontSize(11)
      doc.text(`${k}`, marginX, y)
      doc.text(`${v}`, marginX + 240, y)
      y += lineGap
    }

    const now = new Date()
    const dateStr = now.toLocaleString()

    // Header
    doc.setFont("helvetica", "bold")
    doc.setFontSize(16)
    doc.text("THERMAL COMFORT ENVIRONMENT", marginX, y); y += 20
    doc.setFontSize(13)
    doc.text("LAPORAN CARA KERJA PERHITUNGAN PMV-ABRAN", marginX, y); y += 18
    doc.setFont("helvetica", "normal")
    doc.setFontSize(10)
    doc.text(`Tanggal/Jam: ${dateStr}`, marginX, y); y += 14
    hr()

    // Rumus yang dipakai di project (sesuai kode kamu)
    write("RUMUS YANG DIGUNAKAN (SESUAI PROJECT)", { bold: true, size: 12 })
    hr()
    write("1) A = (H/W) + αv·v")
    write("2) exponent = -k·A")
    write("3) exp_factor = 2.72^(exponent)")
    write("4) SVFv = SVF·v")
    write("5) PMV_ABRAN = α + β1·PMV_iso + β2·exp_factor + β3·SVFv + β4·veg_func")
    y += 6

    // Input
    write("INPUT", { bold: true, size: 12 })
    hr()
    writeKV("PMV_iso", String(inputs.pmv_iso))
    writeKV("Wind Speed (v)", `${inputs.v} m/s`)
    writeKV("SVF", String(inputs.svf))
    writeKV("H/W", String(inputs.h_w))
    writeKV("Vegetation Function", String(inputs.veg_func))
    y += 6

    // Parameter
    write("PARAMETER MODEL", { bold: true, size: 12 })
    hr()
    writeKV("α", String(PARAMS.alpha))
    writeKV("β1", String(PARAMS.beta1))
    writeKV("β2", String(PARAMS.beta2))
    writeKV("β3", String(PARAMS.beta3))
    writeKV("β4", String(PARAMS.beta4))
    writeKV("k", String(PARAMS.k))
    writeKV("αv", String(PARAMS.alphaV))
    y += 6

    // Cara kerja (substitusi angka)
    write("CARA PENGERJAAN (DARI AWAL SAMPAI SELESAI)", { bold: true, size: 12 })
    hr()

    write("Langkah 1: Hitung A = (H/W) + αv·v")
    writeKV("A", `${inputs.h_w} + (${PARAMS.alphaV} × ${inputs.v}) = ${results.A}`)

    write("Langkah 2: Hitung exponent = -k·A")
    writeKV("exponent", `-${PARAMS.k} × ${results.A} = ${results.exponent}`)

    write("Langkah 3: Hitung exp_factor = 2.72^(exponent)")
    writeKV("exp_factor", `2.72^(${results.exponent}) = ${results.exp_factor}`)

    write("Langkah 4: Hitung SVFv = SVF·v")
    writeKV("SVFv", `${inputs.svf} × ${inputs.v} = ${results.SVFv}`)
    y += 6

    // Komponen
    write("KOMPONEN HASIL", { bold: true, size: 12 })
    hr()
    writeKV("α", String(results.terms.alpha))
    writeKV("β1·PMV_iso", String(results.terms.beta1))
    writeKV("β2·exp_factor", String(results.terms.beta2))
    writeKV("β3·SVFv", String(results.terms.beta3))
    writeKV("β4·veg_func", String(results.terms.beta4))
    y += 6

    // Total
    write("HASIL AKHIR", { bold: true, size: 12 })
    hr()
    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
    ensureSpace(24)
    doc.text(`TOTAL PMV-ABRAN = ${Number(results.total).toFixed(3)}`, marginX, y)
    y += 22

    doc.setFont("helvetica", "normal")
    doc.setFontSize(10)
    doc.text("© Thermal Comfort Environment", marginX, pageH - 28)

    const date = new Date().toISOString().slice(0, 10)
    doc.save(`CaraKerja-PMVABRAN-${date}.pdf`)
  }

  // Initialize dengan default values
  useEffect(() => {
    handleReset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">
            <span className="text-blue-900">Thermal Comfort Environment</span>
          </h1>
          <p className="text-slate-600">
            PMVabran Model Perhitungan Kenyamanan Termal Adaptif (Lingkungan Permukiman Pesisir)
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
                  PMViso
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

                  {/* ✅ Tombol Download PDF */}
                  <Button
                    onClick={handleDownloadPDF}
                    className="w-full mb-4 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    Download (PDF)
                  </Button>

                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-700 mb-3">
                        Langkah Perhitungan
                      </p>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between py-2 border-b border-slate-100">
                          <span className="text-slate-600">A = H/W + αv × v</span>
                          <span className="font-mono font-semibold text-slate-900">{results.A}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-slate-100">
                          <span className="text-slate-600">Exponent = -k × A</span>
                          <span className="font-mono font-semibold text-slate-900">{results.exponent}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-slate-100">
                          <span className="text-slate-600">exp_factor = 2.72^(exponent)</span>
                          <span className="font-mono font-semibold text-slate-900">{results.exp_factor}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-slate-100">
                          <span className="text-slate-600">SVF × v</span>
                          <span className="font-mono font-semibold text-slate-900">{results.SVFv}</span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <p className="text-sm font-semibold text-slate-700 mb-3">Komponen Hasil</p>
                      <div className="space-y-2 text-sm bg-slate-50 p-3 rounded-lg">
                        <div className="flex justify-between">
                          <span className="text-slate-600">α</span>
                          <span className="font-mono font-semibold">{results.terms.alpha}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">β1 × pmviso</span>
                          <span className="font-mono font-semibold">{results.terms.beta1}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">β2 × expfactor</span>
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

        {/* Distribusi PMV */}
        {results && (
          <div className="mt-6">
            <Card>
              <CardHeader className="border-b bg-white">
                <CardTitle className="text-lg">Distribusi PMV</CardTitle>
                <CardDescription>
                  Grafik kontribusi tiap komponen terhadap total PMV-ABRAN.
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

                        <Bar dataKey="component" name="Nilai Komponen" fill="#10B981" />
                        <Line
                          type="monotone"
                          dataKey="cumulative"
                          name="Akumulasi"
                          strokeWidth={1}
                          dot
                          isAnimationActive={false}
                        />

                        <ReferenceDot
                          x="Total"
                          y={Number(results.total)}
                          r={7}
                          fill="#EF4444"
                          stroke="#DC2626"
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

        {/* Footer (minimal) */}
        <footer className="mt-10 border-t border-slate-200 bg-white/70 backdrop-blur">
          <div className="max-w-7xl mx-auto px-6 py-10">
            <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
              <div className="max-w-2xl">
                <div className="flex items-center gap-4">
                  <div className="h-11 w-11 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-sm ring-4 ring-blue-100">
                    <span className="text-sm font-bold">TC</span>
                  </div>

                  <div className="leading-tight">
                    <p className="text-base font-semibold text-slate-900">
                      Thermal Comfort Environment
                    </p>
                    <p className="text-xs text-slate-500">
                      PMVabran • Adaptive Thermal Comfort
                    </p>
                  </div>
                </div>

                <p className="mt-4 text-sm text-slate-600 leading-relaxed">
                  Aplikasi untuk menghitung PMVabran berdasarkan parameter lingkungan
                  permukiman pesisir, menampilkan hasil, komponen perhitungan, dan visualisasi grafik.
                </p>
              </div>

              
            </div>

            <div className="mt-8 border-t border-slate-200 pt-5">
              <p className="text-xs text-slate-500">
                © {new Date().getFullYear()} Thermal Comfort Calculator. Iblusman
              </p>
            </div>
          </div>
        </footer>

      </div>
    </main>
  )
}

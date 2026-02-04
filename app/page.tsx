'use client'

import React, { useEffect, useMemo, useRef, useState } from "react"
import jsPDF from "jspdf"
import html2canvas from "html2canvas"
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

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Inputs = {
  pmv_iso: number | ''
  v: number | ''        // v = wind speed (m/s)
  svf: number | ''
  h_w: number | ''
  veg_func: number | ''
  u_site: number | ''
  u_jam: number | ''
  epsilon: number | ''

  // Normalisasi
  normalize: boolean
  pmv_obs_ref: number | ''
}

type AshraeResult = {
  label: string
  range: string
}

type PMVAbranResult = {
  A: number
  exponent: number
  expfactor_raw: number
  expfactor_used: number
  SVFv: number
  terms: {
    alpha: number
    beta1: number
    beta2: number
    beta3: number
    beta4: number
    u_site: number
    u_jam: number
    epsilon: number
  }
  preTotal: number
  normalizationOffset: number
  total: number
}

export default function ThermalComfortCalculator() {
  // ✅ Nilai contoh (kalau klik "Muat Nilai Default")
  const DEFAULT_VALUES: Inputs = {
    pmv_iso: 0.60,
    v: 3.2,
    svf: 0.55,
    h_w: 0.923,
    veg_func: 1,
    u_site: 0,
    u_jam: 0,
    epsilon: 0,
    normalize: false,
    pmv_obs_ref: -0.61,
  }

  // ✅ Nilai awal saat refresh (SEMUA 0 seperti gambar)
  const INITIAL_VALUES: Inputs = {
    pmv_iso: 0,
    v: 0,
    svf: 0,
    h_w: 0,
    veg_func: 0,
    u_site: 0,
    u_jam: 0,
    epsilon: 0,
    normalize: false,
    pmv_obs_ref: 0, // kalau mau tetap -0.61, ubah jadi -0.61
  }

  // Koefisien model Bab 4
  const PARAMS = {
    alpha: 0.225,
    beta1: 0.774,
    beta2: 7.379,
    beta3: -0.385,
    beta4: -0.098,
    k: 0.3,
    alphaV: 0.5,
  }

  const [inputs, setInputs] = useState<Inputs>(INITIAL_VALUES)
  const [results, setResults] = useState<PMVAbranResult | null>(null)
  const [errors, setErrors] = useState<string>('')

  const chartRef = useRef<HTMLDivElement | null>(null)

  const round3 = (x: number): number => Number(x.toFixed(3))

  const trunc3 = (x: number): number => {
    if (x >= 0) return Math.floor(x * 1000) / 1000
    return Math.ceil(x * 1000) / 1000
  }

  /**
   * PMV_abran (sesuai Bab 4):
   * PMV_abran =
   *   α + β1·PMV_iso + β2·e^{-k( H/W + αv·v )} + β3·(SVF·v) + β4·veg_func + u_site + u_jam + ε
   *
   * Normalisasi (offset):
   * PMV_final = PMV_pre + (PMV_obs_ref - PMV_pre)  -> hasil akhirnya jadi pmv_obs_ref
   * (gunakan jika memang konsepnya "shift" ke referensi).
   */
  const calculatePMVAbran = (
    pmv_iso: number,
    v: number,
    svf: number,
    h_w: number,
    veg_func: number,
    u_site: number,
    u_jam: number,
    epsilon: number,
    normalize: boolean,
    pmv_obs_ref: number
  ): PMVAbranResult => {
    if ([pmv_iso, v, svf, h_w, veg_func, u_site, u_jam, epsilon, pmv_obs_ref].some((n) => Number.isNaN(n))) {
      throw new Error('Semua input harus berupa angka')
    }

    // 1) A = (H/W) + αv·v
    const A = h_w + PARAMS.alphaV * v

    // 2) exponent = -k·A
    const exponent = -PARAMS.k * A

    // 3) expfactor_raw = e^(exponent)
    const exp_raw = Math.exp(exponent)

    // Bab 4 menampilkan expfactor seperti 0.469 (3 desimal)
    const exp_used = round3(exp_raw)

    // 4) SVFv = SVF·v
    const SVFv = round3(svf * v)

    // 5) komponen
    const termAlpha = round3(PARAMS.alpha)
    const termBeta1 = round3(PARAMS.beta1 * pmv_iso)

    const termBeta2 = round3(PARAMS.beta2 * exp_used)
    // const termBeta2 = trunc3(PARAMS.beta2 * exp_used)

    const termBeta3 = round3(PARAMS.beta3 * SVFv)
    const termBeta4 = round3(PARAMS.beta4 * veg_func)

    const termUSite = round3(u_site)
    const termUJam = round3(u_jam)
    const termEps = round3(epsilon)

    // 6) total sebelum normalisasi
    const preTotal = round3(
      termAlpha +
      termBeta1 +
      termBeta2 +
      termBeta3 +
      termBeta4 +
      termUSite +
      termUJam +
      termEps
    )

    // 7) normalisasi (offset)
    const offset = normalize ? round3(pmv_obs_ref - preTotal) : 0
    const total = round3(preTotal + offset)

    return {
      A: round3(A),
      exponent: round3(exponent),
      expfactor_raw: round3(exp_raw),
      expfactor_used: exp_used,
      SVFv,
      terms: {
        alpha: termAlpha,
        beta1: termBeta1,
        beta2: termBeta2,
        beta3: termBeta3,
        beta4: termBeta4,
        u_site: termUSite,
        u_jam: termUJam,
        epsilon: termEps,
      },
      preTotal,
      normalizationOffset: offset,
      total,
    }
  }

  const handleNumberChange = (key: Exclude<keyof Inputs, 'normalize'>, value: string) => {
    setInputs(prev => ({
      ...prev,
      [key]: value === '' ? '' : parseFloat(value),
    }))
  }

  const handleCalculate = () => {
    try {
      setErrors('')

      const pmv_iso = parseFloat(String(inputs.pmv_iso))
      const v = parseFloat(String(inputs.v))
      const svf = parseFloat(String(inputs.svf))
      const h_w = parseFloat(String(inputs.h_w))
      const veg_func = parseFloat(String(inputs.veg_func))
      const u_site = parseFloat(String(inputs.u_site))
      const u_jam = parseFloat(String(inputs.u_jam))
      const epsilon = parseFloat(String(inputs.epsilon))
      const pmv_obs_ref = parseFloat(String(inputs.pmv_obs_ref))

      const result = calculatePMVAbran(
        pmv_iso, v, svf, h_w, veg_func, u_site, u_jam, epsilon,
        inputs.normalize, pmv_obs_ref
      )

      setResults(result)
    } catch (error: any) {
      setErrors(error.message)
      setResults(null)
    }
  }

  // ✅ tombol "Muat Nilai Default" (isi contoh + hitung otomatis)
  const handleLoadDefaults = () => {
    setInputs(DEFAULT_VALUES)
    setErrors('')
    try {
      const result = calculatePMVAbran(
        Number(DEFAULT_VALUES.pmv_iso),
        Number(DEFAULT_VALUES.v),
        Number(DEFAULT_VALUES.svf),
        Number(DEFAULT_VALUES.h_w),
        Number(DEFAULT_VALUES.veg_func),
        Number(DEFAULT_VALUES.u_site),
        Number(DEFAULT_VALUES.u_jam),
        Number(DEFAULT_VALUES.epsilon),
        Boolean(DEFAULT_VALUES.normalize),
        Number(DEFAULT_VALUES.pmv_obs_ref),
      )
      setResults(result)
    } catch (error: any) {
      setErrors(error.message)
      setResults(null)
    }
  }

  // ASHRAE 55 (rentang)
  const getAshrae55Category = (pmv: number): AshraeResult => {
    if (pmv < -2.5) return { label: "Sangat Dingin", range: "< -2.5" }
    if (pmv < -1.5) return { label: "Dingin", range: "[-2.5, -1.5)" }
    if (pmv < -0.5) return { label: "Sejuk", range: "[-1.5, -0.5)" }
    if (pmv < 0.5) return { label: "Netral (Nyaman)", range: "[-0.5, 0.5)" }
    if (pmv < 1.5) return { label: "Hangat", range: "[0.5, 1.5)" }
    if (pmv < 2.5) return { label: "Panas", range: "[1.5, 2.5)" }
    return { label: "Sangat Panas", range: "≥ 2.5" }
  }

  const ashrae = useMemo(() => {
    if (!results) return null
    return getAshrae55Category(Number(results.total))
  }, [results])

  // Breakdown chart
  const breakdownData = useMemo(() => {
    if (!results) return []

    const terms = [
      { name: 'α', component: Number(results.terms.alpha) },
      { name: 'β₁·PMVᵢₛₒ', component: Number(results.terms.beta1) },
      { name: 'β₂·exp', component: Number(results.terms.beta2) },
      { name: 'β₃·(SVF·v)', component: Number(results.terms.beta3) },
      { name: 'β₄·veg_func', component: Number(results.terms.beta4) },
      { name: 'u_site', component: Number(results.terms.u_site) },
      { name: 'u_jam', component: Number(results.terms.u_jam) },
      { name: 'ε', component: Number(results.terms.epsilon) },
    ]

    if (Number(results.normalizationOffset) !== 0) {
      terms.push({ name: 'Offset (normalisasi)', component: Number(results.normalizationOffset) })
    }

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
  }, [results])

  // ✅ Download grafik PNG
  const handleDownloadChartPNG = async () => {
    if (!chartRef.current) return
    const date = new Date().toISOString().slice(0, 10)

    try {
      const canvas = await html2canvas(chartRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        onclone: (clonedDoc) => {
          const root = clonedDoc.getElementById("chart-export") as HTMLElement | null
          if (!root) return

          root.style.backgroundColor = "#ffffff"
          root.style.boxShadow = "none"
          root.style.filter = "none"

          root.querySelectorAll<HTMLElement>("*").forEach((el) => {
            if (el.closest("svg")) return
            el.style.setProperty("color", "#111827", "important")
            el.style.setProperty("background-color", "transparent", "important")
            el.style.setProperty("border-color", "#e5e7eb", "important")
            el.style.setProperty("outline-color", "#e5e7eb", "important")
            el.style.setProperty("caret-color", "#111827", "important")
            el.style.setProperty("text-decoration-color", "#111827", "important")
            el.style.boxShadow = "none"
            el.style.textShadow = "none"
            el.style.filter = "none"
            ;(el.style as any).backdropFilter = "none"
            el.style.backgroundImage = "none"
          })
        },
      })

      const dataUrl = canvas.toDataURL("image/png")
      const a = document.createElement("a")
      a.href = dataUrl
      a.download = `Grafik-PMVabran-${date}.png`
      a.click()
    } catch {
      const svg = chartRef.current.querySelector("svg")
      if (!svg) return

      const rect = svg.getBoundingClientRect()
      const scale = 2

      const svgText = new XMLSerializer().serializeToString(svg)
      const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" })
      const url = URL.createObjectURL(blob)

      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement("canvas")
        canvas.width = Math.ceil(rect.width * scale)
        canvas.height = Math.ceil(rect.height * scale)

        const ctx = canvas.getContext("2d")
        if (!ctx) return

        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

        URL.revokeObjectURL(url)

        const dataUrl = canvas.toDataURL("image/png")
        const a = document.createElement("a")
        a.href = dataUrl
        a.download = `Grafik-PMVabran-${date}.png`
        a.click()
      }
      img.onerror = () => URL.revokeObjectURL(url)
      img.src = url
    }
  }

  // ✅ Download PDF
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
      doc.setDrawColor(210)
      doc.line(marginX, y, pageW - marginX, y)
      y += 14
    }

    const cleanPdfText = (s: string) =>
      s
        .replace(/\u2212/g, "-")
        .replace(/\u00B1/g, "+/-")
        .replace(/\u00D7/g, "x")
        .replace(/\u00B7/g, "*")
        .replace(/[α]/g, "alpha")
        .replace(/[β]/g, "beta")
        .replace(/[ε]/g, "epsilon")
        .replace(/[ᵥ]/g, "v")
        .replace(/[₁]/g, "1")
        .replace(/[₂]/g, "2")
        .replace(/[₃]/g, "3")
        .replace(/[₄]/g, "4")

    const write = (text: string, opts?: { bold?: boolean; size?: number }) => {
      ensureSpace(24)
      doc.setFont("helvetica", opts?.bold ? "bold" : "normal")
      doc.setFontSize(opts?.size ?? 11)

      const safe = cleanPdfText(text)
      const lines = doc.splitTextToSize(safe, maxW)

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
      doc.text(cleanPdfText(k), marginX, y)
      doc.text(cleanPdfText(v), marginX + 260, y)
      y += lineGap
    }

    const now = new Date()
    const dateStr = now.toLocaleString()

    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
    doc.text("THERMAL COMFORT ENVIRONMENT", marginX, y); y += 18

    doc.setFontSize(12)
    doc.text("HASIL ANALISIS KALKULASI MODEL PMVabran", marginX, y); y += 16

    doc.setFont("helvetica", "normal")
    doc.setFontSize(10)
    doc.text(`Tanggal/Jam: ${dateStr}`, marginX, y); y += 12
    hr()

    write("RUMUS (Bab 4)")
    write("PMVabran = alpha + beta1*PMV_iso + beta2*exp(-k*(H/W + alphaV*v)) + beta3*(SVF*v) + beta4*vegfunc + u_site + u_jam + epsilon")
    if (inputs.normalize) {
      write("Normalisasi (offset): PMV_final = PMV_pre + (PMV_obs_ref - PMV_pre)")
    }
    hr()

    write("INPUT", { bold: true, size: 12 })
    hr()
    writeKV("PMV_iso", String(inputs.pmv_iso))
    writeKV("v (m/s)", String(inputs.v))
    writeKV("SVF", String(inputs.svf))
    writeKV("H/W", String(inputs.h_w))
    writeKV("veg_func", String(inputs.veg_func))
    writeKV("u_site", String(inputs.u_site))
    writeKV("u_jam", String(inputs.u_jam))
    writeKV("epsilon", String(inputs.epsilon))
    writeKV("normalisasi", inputs.normalize ? "ON" : "OFF")
    writeKV("PMV_obs_ref", String(inputs.pmv_obs_ref))
    hr()

    write("PARAMETER MODEL", { bold: true, size: 12 })
    hr()
    writeKV("alpha", String(PARAMS.alpha))
    writeKV("beta1", String(PARAMS.beta1))
    writeKV("beta2", String(PARAMS.beta2))
    writeKV("beta3", String(PARAMS.beta3))
    writeKV("beta4", String(PARAMS.beta4))
    writeKV("k", String(PARAMS.k))
    writeKV("alphaV", String(PARAMS.alphaV))
    hr()

    write("LANGKAH PERHITUNGAN", { bold: true, size: 12 })
    hr()
    writeKV("A", `${results.A}   (H/W + alphaV*v)`)
    writeKV("exponent", `${results.exponent}   (-k*A)`)
    writeKV("expfactor_raw", `${results.expfactor_raw}`)
    writeKV("expfactor_used", `${results.expfactor_used}   (dibulatkan 3 desimal)`)
    writeKV("SVF*v", `${results.SVFv}`)
    hr()

    write("KOMPONEN HASIL", { bold: true, size: 12 })
    hr()
    writeKV("alpha", String(results.terms.alpha))
    writeKV("beta1*PMV_iso", String(results.terms.beta1))
    writeKV("beta2*expfactor", String(results.terms.beta2))
    writeKV("beta3*(SVF*v)", String(results.terms.beta3))
    writeKV("beta4*vegfunc", String(results.terms.beta4))
    writeKV("u_site", String(results.terms.u_site))
    writeKV("u_jam", String(results.terms.u_jam))
    writeKV("epsilon", String(results.terms.epsilon))
    writeKV("PMV_pre", String(results.preTotal))
    writeKV("offset_norm", String(results.normalizationOffset))
    hr()

    if (ashrae) {
      write("PERBANDINGAN STANDAR PMV (ASHRAE 55)", { bold: true, size: 12 })
      hr()
      writeKV("PMVabran", `${Number(results.total).toFixed(3)}`)
      writeKV("Kategori", `${ashrae.label} (rentang ${ashrae.range})`)
      hr()
    }

    write("HASIL AKHIR", { bold: true, size: 12 })
    hr()
    doc.setFont("helvetica", "bold")
    doc.setFontSize(13)
    ensureSpace(22)
    doc.text(`TOTAL PMVabran = ${Number(results.total).toFixed(3)}`, marginX, y)
    y += 20

    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.text("© Thermal Comfort Environment", marginX, pageH - 28)

    const date = new Date().toISOString().slice(0, 10)
    doc.save(`Hasil-Analisis-PMVabran-${date}.pdf`)
  }

  // ✅ Saat pertama kali load/refresh: input 0 semua & hasil kosong
  useEffect(() => {
    setInputs(INITIAL_VALUES)
    setResults(null)
    setErrors('')
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
            Model PMVabran — Perhitungan Kenyamanan Termal Adaptif (Permukiman Pesisir)
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Panel Input */}
          <Card className="h-fit">
            <CardHeader className="bg-slate-50 border-b">
              <CardTitle>Input Parameters</CardTitle>
              <CardDescription>Masukkan nilai parameter perhitungan </CardDescription>
            </CardHeader>

            <CardContent className="pt-6 space-y-6">
              {/* PMV ISO + v */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                {/* PMV ISO */}
                <div className="space-y-2">
                  <Label htmlFor="pmv_iso" className="text-sm font-medium text-slate-700">
                    <span className="inline-flex items-baseline gap-0">
                      <span>PMV</span>
                      <sub className="m-0 p-0 leading-none align-baseline text-[0.75em] relative top-[0.15em]">
                        iso
                      </sub>
                    </span>
                  </Label>

                  <Input
                    id="pmv_iso"
                    type="number"
                    step="0.01"
                    value={inputs.pmv_iso}
                    onChange={(e) => handleNumberChange('pmv_iso', e.target.value)}
                    placeholder="0.60"
                  />
                </div>

                {/* v */}
                <div className="space-y-2">
                  <Label htmlFor="v" className="text-sm font-medium text-slate-700">
                    Alfa (α)
                  </Label>
                  <Input
                    id="v"
                    type="number"
                    step="0.01"
                    value={inputs.v}
                    onChange={(e) => handleNumberChange('v', e.target.value)}
                    placeholder="3.2"
                  />
                </div>
              </div>

              {/* Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="svf" className="text-sm font-medium text-slate-700">
                    Sky View Factor (SVF)
                  </Label>
                  <Input
                    id="svf"
                    type="number"
                    step="0.01"
                    value={inputs.svf}
                    onChange={(e) => handleNumberChange('svf', e.target.value)}
                    placeholder="0.55"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="h_w" className="text-sm font-medium text-slate-700">
                    Rasio H/W
                  </Label>
                  <Input
                    id="h_w"
                    type="number"
                    step="0.01"
                    value={inputs.h_w}
                    onChange={(e) => handleNumberChange('h_w', e.target.value)}
                    placeholder="0.923"
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="veg_func" className="text-sm font-medium text-slate-700">
                    Vegetasi Function (Vegfunc)
                  </Label>

                  <Input
                    id="veg_func"
                    type="number"
                    step="0.01"
                    value={inputs.veg_func}
                    onChange={(e) => handleNumberChange('veg_func', e.target.value)}
                    placeholder="1"
                  />
                </div>
              </div>

              {/* u_site, u_jam, epsilon */}
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="u_site" className="text-sm font-medium text-slate-700">
                      u<sub>site</sub>
                    </Label>
                    <Input
                      id="u_site"
                      type="number"
                      step="0.01"
                      value={inputs.u_site}
                      onChange={(e) => handleNumberChange('u_site', e.target.value)}
                      placeholder="0"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="u_jam" className="text-sm font-medium text-slate-700">
                      u<sub>jam</sub>
                    </Label>
                    <Input
                      id="u_jam"
                      type="number"
                      step="0.01"
                      value={inputs.u_jam}
                      onChange={(e) => handleNumberChange('u_jam', e.target.value)}
                      placeholder="0"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="epsilon" className="text-sm font-medium text-slate-700">
                      ε
                    </Label>
                    <Input
                      id="epsilon"
                      type="number"
                      step="0.01"
                      value={inputs.epsilon}
                      onChange={(e) => handleNumberChange('epsilon', e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>

              {errors && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {errors}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button onClick={handleCalculate} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white">
                  Hitung
                </Button>
              </div>

              {/* Parameter Formula */}
              <div className="mt-2 p-4 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-xs font-semibold text-slate-700 mb-3">Parameter Koefisien Model</p>

                <div className="space-y-1 text-sm text-slate-800">
                  {[
                    { no: "1.", left: "α (intersep)", right: PARAMS.alpha },
                    { no: "2.", left: "β1", right: PARAMS.beta1 },
                    { no: "3.", left: "β2", right: PARAMS.beta2 },
                    { no: "4.", left: "β3", right: PARAMS.beta3 },
                    { no: "5.", left: "β4", right: PARAMS.beta4 },
                    { no: "6.", left: "k", right: PARAMS.k },
                    { no: "7.", left: "αv", right: PARAMS.alphaV },
                  ].map((row, idx) => (
                    <div key={idx} className="grid grid-cols-[210px_22px_90px] items-center">
                      <span className="font-medium">{row.no}&nbsp;&nbsp;{row.left}</span>
                      <span className="text-center font-medium">=</span>
                      <span className="text-right font-medium">{String(row.right)}</span>
                    </div>
                  ))}
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
                  <div className="mb-4 p-6 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg border border-blue-200">
                    <p className="text-xs text-blue-600 tracking-wide font-semibold mb-2">
                      PMVabran (Final)
                    </p>
                    <p className="text-5xl font-bold text-blue-700">
                      {Number(results.total).toFixed(3)}
                    </p>
                  </div>

                  <div className="mb-4 p-4 rounded-lg border border-slate-200 bg-white">
                    <p className="text-sm font-semibold text-slate-900 mb-1">
                      Nilai ini kemudian dinormalisasi terhadap PMV observasi lapangan  (–0.61) untuk skala relatif lokasi, menghasilkan estimasi model yang mengikuti arah perubahan spasial kenyamanan
                    </p>
                  </div>

                  {ashrae && (
                    <div className="mb-4 p-4 rounded-lg border border-slate-200 bg-white">
                      <p className="text-sm font-semibold text-slate-900 mb-1">
                        Perbandingan Standar PMV (ASHRAE 55)
                      </p>
                      <p className="text-sm text-slate-700">
                        PMVabran <span className="font-mono font-semibold text-blue-700">{Number(results.total).toFixed(3)}</span>
                        {" "}→{" "}
                        <span className="font-semibold">{ashrae.label}</span>
                        {" "}({ashrae.range})
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                    <Button onClick={handleDownloadPDF} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                      Download PDF
                    </Button>

                    <Button onClick={handleDownloadChartPNG} variant="outline" className="w-full bg-transparent">
                      Download Grafik
                    </Button>
                  </div>

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
                          <span className="text-slate-600">expfactor (raw)</span>
                          <span className="font-mono font-semibold text-slate-900">{results.expfactor_raw}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-slate-100">
                          <span className="text-slate-600">expfactor (used, 3 desimal)</span>
                          <span className="font-mono font-semibold text-slate-900">{results.expfactor_used}</span>
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
                        {[
                          ["α", results.terms.alpha],
                          ["β₁ × PMViso", results.terms.beta1],
                          ["β₂ × expfactor", results.terms.beta2],
                          ["β₃ × (SVF×v)", results.terms.beta3],
                          ["β₄ × vegfunc", results.terms.beta4],
                          ["u_site", results.terms.u_site],
                          ["u_jam", results.terms.u_jam],
                          ["ε", results.terms.epsilon],
                          ["PMV_pre", results.preTotal],
                          
                        ].map(([k, v], i) => (
                          <div key={i} className="flex justify-between">
                            <span className="text-slate-600">{k}</span>
                            <span className="font-mono font-semibold text-blue-700">{Number(v).toFixed(3)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-2 p-4 bg-blue-50 rounded-lg border border-blue-200">
                      <p className="text-xs text-blue-600 font-semibold tracking-wide mb-2">
                        TOTAL PMVabran (Final)
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
                    <Button onClick={handleLoadDefaults} className="bg-blue-600 hover:bg-blue-700">
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
          Grafik kontribusi tiap komponen terhadap total PMVabran (termasuk offset normalisasi jika aktif).
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-6">
        <div
          id="chart-export"
          className="rounded-lg border border-slate-200 bg-white p-4"
          ref={chartRef}
        >
          <p className="text-sm font-semibold text-slate-800 mb-3">
            Breakdown Komponen & Akumulasi
          </p>

          <div className="h-[380px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={breakdownData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />

                {/* ✅ Hijau: Nilai Komponen */}
                <Bar dataKey="component" name="Nilai Komponen" fill="#16a34a" />

                {/* ✅ Biru: Akumulasi */}
                <Line
                  type="monotone"
                  dataKey="cumulative"
                  name="Akumulasi"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot
                  isAnimationActive={false}
                />

                {/* ✅ Merah: Total */}
                <ReferenceDot
                  x="Total"
                  y={Number(results.total)}
                  r={7}
                  fill="#dc2626"
                  stroke="#dc2626"
                  strokeWidth={2}
                  label={{
                    value: `Total: ${Number(results.total).toFixed(3)}`,
                    position: 'top',
                    fill: '#dc2626',
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <p className="text-xs text-slate-500 mt-3">
            Batang = kontribusi tiap komponen, garis = akumulasi sampai total PMVabran.
          </p>
        </div>
      </CardContent>
    </Card>
  </div>
)}

        {/* Footer */}
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
                  Aplikasi untuk menghitung PMVabran berdasarkan parameter lingkungan permukiman pesisir,
                  menampilkan hasil, komponen perhitungan, dan visualisasi grafik.
                </p>

                <p className="mt-4 text-sm text-slate-600 leading-relaxed border-l-4 border-blue-200 pl-4 italic">
                  Model PMVabran merupakan model prediktif kenyamanan termal ruang luar pesisir yang
                  mengintegrasikan respon fisiologis manusia dengan koreksi spasial berbasis morfologi
                  dan dinamika angin laut, sehingga lebih representatif untuk menjelaskan dan merancang
                  kenyamanan termal pada permukiman pesisir tropis.
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

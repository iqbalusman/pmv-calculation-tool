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
  v: number | '' // tetap v untuk perhitungan, tapi label UI jadi α (alfa)
  svf: number | ''
  h_w: number | ''
  veg_func: number | ''
  u_site: number | ''
  u_jam: number | ''
  epsilon: number | ''
}

type AshraeResult = {
  label: string
  range: string
}

export default function ThermalComfortCalculator() {
  // ✅ Mulai dari nol saat refresh
  const ZERO_VALUES: Inputs = {
    pmv_iso: 0,
    v: 0,
    svf: 0,
    h_w: 0,
    veg_func: 0,
    u_site: 0,
    u_jam: 0,
    epsilon: 0,
  }

  // Nilai default (untuk tombol "Muat Nilai Default")
  const DEFAULT_VALUES: Inputs = {
    pmv_iso: 0.60,
    v: 3.2,
    svf: 0.55,
    h_w: 0.923,
    veg_func: 1,
    u_site: 0,
    u_jam: 0,
    epsilon: 0,
  }

  const PARAMS = {
    alpha: 0.225,
    beta1: 0.774,
    beta2: 7.379,
    beta3: -0.385,
    beta4: -0.098,
    k: 0.3,
    alphaV: 0.5,
  }

  const [inputs, setInputs] = useState<Inputs>(ZERO_VALUES)
  const [results, setResults] = useState<any>(null)
  const [errors, setErrors] = useState<string>('')

  const chartRef = useRef<HTMLDivElement | null>(null)

  const round3 = (x: number): number => Number(x.toFixed(3))

  const trunc3 = (x: number): number => {
    if (x >= 0) return Math.floor(x * 1000) / 1000
    return Math.ceil(x * 1000) / 1000
  }

  /**
   * PMV_abran =
   *   α + β1·PMV_iso + β2·e^{-k( H/W + αv·v )} + β3·(SVF·v) + β4·veg_func + u_site + u_jam + ε
   */
  const calculatePMVAbran = (
    pmv_iso: number,
    v: number,
    svf: number,
    h_w: number,
    veg_func: number,
    u_site: number,
    u_jam: number,
    epsilon: number
  ) => {
    if ([pmv_iso, v, svf, h_w, veg_func, u_site, u_jam, epsilon].some((n) => Number.isNaN(n))) {
      throw new Error('Semua input harus berupa angka')
    }

    const A = h_w + PARAMS.alphaV * v
    const exponent = -PARAMS.k * A
    const exp_raw = Math.exp(exponent)
    const SVFv = svf * v

    const termAlpha = round3(PARAMS.alpha)
    const termBeta1 = round3(PARAMS.beta1 * pmv_iso)
    const termBeta2 = trunc3(PARAMS.beta2 * exp_raw)
    const termBeta3 = round3(PARAMS.beta3 * SVFv)
    const termBeta4 = round3(PARAMS.beta4 * veg_func)

    const termUSite = round3(u_site)
    const termUJam = round3(u_jam)
    const termEps = round3(epsilon)

    const total = round3(
      termAlpha +
      termBeta1 +
      termBeta2 +
      termBeta3 +
      termBeta4 +
      termUSite +
      termUJam +
      termEps
    )

    return {
      A: round3(A),
      exponent: round3(exponent),
      expfactor: round3(exp_raw),
      SVFv: round3(SVFv),
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
      const u_site = parseFloat(String(inputs.u_site))
      const u_jam = parseFloat(String(inputs.u_jam))
      const epsilon = parseFloat(String(inputs.epsilon))

      const result = calculatePMVAbran(pmv_iso, v, svf, h_w, veg_func, u_site, u_jam, epsilon)
      setResults(result)
    } catch (error: any) {
      setErrors(error.message)
      setResults(null)
    }
  }

  // Tombol "Muat Nilai Default"
  const handleReset = () => {
    setInputs(DEFAULT_VALUES)
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

  // ✅ PDF: rumus image + fix error "lab()"
  const handleDownloadPDF = async () => {
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

    // ✅ rumus persis gambar + isolasi dari CSS "lab()"
    const addPMVabranFormulaImage = async () => {
      const wrap = document.createElement("div")
      wrap.id = "pmv-formula-export"
      ;(wrap.style as any).all = "initial"

      wrap.style.position = "fixed"
      wrap.style.left = "-10000px"
      wrap.style.top = "0"
      wrap.style.backgroundColor = "#ffffff"
      wrap.style.padding = "0"
      wrap.style.margin = "0"
      wrap.style.display = "inline-block"

      wrap.innerHTML = `
        <div style="
          all: initial;
          font-family: 'Times New Roman', Times, serif;
          font-size: 22px;
          color: #111827;
          line-height: 1.35;
          display: inline-block;
          background: #ffffff;
        ">
          <div style="
            display: inline-block;
            background: #f3f4f6;
            border-radius: 10px;
            padding: 10px 14px;
            white-space: nowrap;
          ">
            <span style="font-style: italic;">PMV</span><sub style="font-style: italic;">abran</sub>
            &nbsp;=&nbsp;α
            &nbsp;+&nbsp;β<sub>1</sub>
            &nbsp;<span style="font-style: italic;">PMV</span><sub style="font-style: italic;">iso</sub>
            (<span style="font-style: italic;">Ta</span>,&nbsp;<span style="font-style: italic;">RH</span>,&nbsp;<span style="font-style: italic;">v</span>,&nbsp;<span style="font-style: italic;">MRT</span>)
            &nbsp;+&nbsp;β<sub>2</sub>
            &nbsp;e<sup>−k( <span style="font-style: italic;">H</span>/<span style="font-style: italic;">W</span> + α<sub style="font-style: italic;">v</sub> <span style="font-style: italic;">v</span> )</sup>
            &nbsp;+&nbsp;β<sub>3</sub>
            &nbsp;(<span style="font-style: italic;">SVF</span>&nbsp;·&nbsp;<span style="font-style: italic;">v</span>)
            &nbsp;+&nbsp;β<sub>4</sub>
            &nbsp;<span style="font-style: italic;">veg</span><sub style="font-style: italic;">func</sub>
          </div>

          <div style="
            margin-top: 10px;
            margin-left: 120px;
            white-space: nowrap;
          ">
            +&nbsp;<span style="font-style: italic;">u</span><sub style="font-style: italic;">site</sub>
            &nbsp;+&nbsp;<span style="font-style: italic;">u</span><sub style="font-style: italic;">jam</sub>
            &nbsp;+&nbsp;ε
          </div>
        </div>
      `

      document.body.appendChild(wrap)

      try {
        const canvas = await html2canvas(wrap, {
          backgroundColor: "#ffffff",
          scale: 3,
          useCORS: true,
          onclone: (clonedDoc) => {
            clonedDoc.documentElement.style.backgroundColor = "#ffffff"
            clonedDoc.body.style.backgroundColor = "#ffffff"
            clonedDoc.body.style.color = "#111827"

            const root = clonedDoc.getElementById("pmv-formula-export") as HTMLElement | null
            if (!root) return

            root.querySelectorAll<HTMLElement>("*").forEach((el) => {
              el.style.setProperty("color", "#111827", "important")
              el.style.setProperty("background-color", "transparent", "important")
              el.style.setProperty("border-color", "#e5e7eb", "important")
              el.style.setProperty("outline-color", "#e5e7eb", "important")
              el.style.setProperty("caret-color", "#111827", "important")
              el.style.setProperty("text-decoration-color", "#111827", "important")
              el.style.setProperty("filter", "none", "important")
              ;(el.style as any).backdropFilter = "none"
            })
          },
        })

        const imgData = canvas.toDataURL("image/png")
        const props = doc.getImageProperties(imgData)
        const imgW = maxW
        const imgH = (props.height * imgW) / props.width

        ensureSpace(imgH + 12)
        doc.addImage(imgData, "PNG", marginX, y, imgW, imgH)
        y += imgH + 12
      } catch {
        write("PMVabran formula gagal dirender (CSS color lab()).", { size: 10 })
      } finally {
        document.body.removeChild(wrap)
      }
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

    write("1) A = (H/W) + alphaV * v")
    write("2) exponent = -k * A")
    write("3) expfactor = exp(exponent) = e^(exponent)")
    write("4) SVFv = SVF * v")

    write("5) PMVabran", { bold: true })
    await addPMVabranFormulaImage()
    hr()

    write("INPUT", { bold: true, size: 12 })
    hr()
    writeKV("PMV_iso", String(inputs.pmv_iso))
    writeKV("alfa (input)", String(inputs.v))
    writeKV("SVF", String(inputs.svf))
    writeKV("H/W", String(inputs.h_w))
    writeKV("veg_func", String(inputs.veg_func))
    writeKV("u_site", String(inputs.u_site))
    writeKV("u_jam", String(inputs.u_jam))
    writeKV("epsilon", String(inputs.epsilon))
    hr()

    write("PARAMETER MODEL", { bold: true, size: 12 })
    hr()
    writeKV("alpha (alfa)", String(PARAMS.alpha))
    writeKV("beta1", String(PARAMS.beta1))
    writeKV("beta2", String(PARAMS.beta2))
    writeKV("beta3", String(PARAMS.beta3))
    writeKV("beta4", String(PARAMS.beta4))
    writeKV("k", String(PARAMS.k))
    writeKV("alphaV", String(PARAMS.alphaV))
    hr()

    write("HASIL UJI ANALISIS KALKULASI PERSAMAAN MODEL PMVabran", { bold: true, size: 12 })
    hr()

    write("Langkah 1: A = (H/W) + alphaV * v")
    writeKV("A", `${inputs.h_w} + (${PARAMS.alphaV} * ${inputs.v}) = ${results.A}`)

    write("Langkah 2: exponent = -k * A")
    writeKV("exponent", `-${PARAMS.k} * ${results.A} = ${results.exponent}`)

    write("Langkah 3: expfactor = exp(exponent)")
    writeKV("expfactor", `exp(${results.exponent}) = ${results.expfactor}`)

    write("Langkah 4: SVFv = SVF * v")
    writeKV("SVFv", `${inputs.svf} * ${inputs.v} = ${results.SVFv}`)
    hr()

    write("KOMPONEN HASIL", { bold: true, size: 12 })
    hr()
    writeKV("alpha", String(results.terms.alpha))
    writeKV("beta1 * PMV_iso", String(results.terms.beta1))
    writeKV("beta2 * expfactor", String(results.terms.beta2))
    writeKV("beta3 * SVFv", String(results.terms.beta3))
    writeKV("beta4 * vegfunc", String(results.terms.beta4))
    writeKV("u_site", String(results.terms.u_site))
    writeKV("u_jam", String(results.terms.u_jam))
    writeKV("epsilon", String(results.terms.epsilon))
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

  // ✅ Refresh: mulai dari nol (tidak auto-load default)
  useEffect(() => {
    setInputs(ZERO_VALUES)
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
            Model PMVabran — Perhitungan Kenyamanan Termal Adaptif (Lingkungan Permukiman Pesisir)
          </p>
        </div>

        {/* Top layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Panel Input */}
          <Card className="h-fit">
            <CardHeader className="bg-slate-50 border-b">
              <CardTitle>Input Parameters</CardTitle>
              <CardDescription>Masukkan nilai parameter perhitungan</CardDescription>
            </CardHeader>

            <CardContent className="pt-6 space-y-6">
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
                  onChange={(e) => handleInputChange('pmv_iso', e.target.value)}
                  placeholder="0.60"
                />
              </div>

              {/* α input */}
              <div className="space-y-2">
                <Label htmlFor="v" className="text-sm font-medium text-slate-700">
                  α (alfa)
                </Label>
                <Input
                  id="v"
                  type="number"
                  step="0.01"
                  value={inputs.v}
                  onChange={(e) => handleInputChange('v', e.target.value)}
                  placeholder="3.2"
                />
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
                    onChange={(e) => handleInputChange('svf', e.target.value)}
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
                    onChange={(e) => handleInputChange('h_w', e.target.value)}
                    placeholder="0.923"
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="veg_func" className="text-sm font-medium text-slate-700">
                    <span className="inline-flex items-baseline gap-0">
                      <span>Vegetasi Function </span>
                      <span>{'('}</span>
                      <span className="italic">
                        veg
                        <sub className="m-0 p-0 leading-none align-baseline text-[0.75em] relative top-[0.15em]">
                          func
                        </sub>
                      </span>
                      <span>{')'}</span>
                    </span>
                  </Label>

                  <Input
                    id="veg_func"
                    type="number"
                    step="0.01"
                    value={inputs.veg_func}
                    onChange={(e) => handleInputChange('veg_func', e.target.value)}
                    placeholder="1"
                  />
                </div>
              </div>

              {/* tambahan */}
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="u_site" className="text-sm font-medium text-slate-700">
                      <span className="inline-flex items-baseline gap-0">
                        <span>u</span>
                        <sub className="m-0 p-0 leading-none align-baseline text-[0.75em] relative top-[0.15em]">
                          site
                        </sub>
                      </span>
                    </Label>
                    <Input
                      id="u_site"
                      type="number"
                      step="0.01"
                      value={inputs.u_site}
                      onChange={(e) => handleInputChange('u_site', e.target.value)}
                      placeholder="0"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="u_jam" className="text-sm font-medium text-slate-700">
                      <span className="inline-flex items-baseline gap-0">
                        <span>u</span>
                        <sub className="m-0 p-0 leading-none align-baseline text-[0.75em] relative top-[0.15em]">
                          jam
                        </sub>
                      </span>
                    </Label>
                    <Input
                      id="u_jam"
                      type="number"
                      step="0.01"
                      value={inputs.u_jam}
                      onChange={(e) => handleInputChange('u_jam', e.target.value)}
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
                      onChange={(e) => handleInputChange('epsilon', e.target.value)}
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
                <p className="text-xs font-semibold text-slate-700 mb-3">Parameter Formula</p>

                <div className="space-y-1 text-sm text-slate-800">
                  {[
                    { no: "1.", left: "α (alfa)", right: PARAMS.alpha },
                    { no: "2.", left: <>β₁ <span className="italic">PMV</span><sub className="italic">iso</sub></>, right: PARAMS.beta1 },
                    { no: "3.", left: <>β₂ (<span className="italic">H</span>/<span className="italic">W</span>)</>, right: PARAMS.beta2 },
                    { no: "4.", left: <>β₃ <span className="italic">SVF</span></>, right: PARAMS.beta3 },
                    { no: "5.", left: <>β₄ <span className="italic">Veg</span><sub className="italic">func</sub></>, right: PARAMS.beta4 },
                    { no: "6.", left: <><span className="italic">U</span><sub className="italic">site</sub></>, right: inputs.u_site },
                    { no: "7.", left: <><span className="italic">U</span><sub className="italic">jam</sub></>, right: inputs.u_jam },
                    { no: "8.", left: <>ε</>, right: inputs.epsilon },
                  ].map((row, idx) => (
                    <div key={idx} className="grid grid-cols-[210px_22px_90px] items-center">
                      <span className="font-medium">
                        {row.no}&nbsp;&nbsp;{row.left}
                      </span>
                      <span className="text-center font-medium">=</span>
                      <span className="text-right font-medium">
                        {String(row.right)}
                      </span>
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
                      PMV<span className="lowercase">abran</span>
                    </p>

                    <p className="text-5xl font-bold text-blue-700">
                      {Number(results.total).toFixed(3)}
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
                          <span className="text-slate-600">A = H/W + αᵥ × v</span>
                          <span className="font-mono font-semibold text-slate-900">{results.A}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-slate-100">
                          <span className="text-slate-600">Exponent = -k × A</span>
                          <span className="font-mono font-semibold text-slate-900">{results.exponent}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-slate-100">
                          <span className="text-slate-600">expfactor = e^(exponent)</span>
                          <span className="font-mono font-semibold text-slate-900">{results.expfactor}</span>
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
                          <span className="font-mono font-semibold text-blue-700">{Number(results.terms.alpha).toFixed(3)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">β₁ × PMV<sub>iso</sub></span>
                          <span className="font-mono font-semibold text-blue-700">{Number(results.terms.beta1).toFixed(3)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">β₂ × expfactor</span>
                          <span className="font-mono font-semibold text-blue-700">{Number(results.terms.beta2).toFixed(3)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">β₃ × (SVF × v)</span>
                          <span className="font-mono font-semibold text-blue-700">{Number(results.terms.beta3).toFixed(3)}</span>
                        </div>
                        <div className="flex justify-between border-t border-slate-200 pt-2 mt-2">
                          <span className="text-slate-600">β₄ × <span className="italic">veg<sub>func</sub></span></span>
                          <span className="font-mono font-semibold text-blue-700">{Number(results.terms.beta4).toFixed(3)}</span>
                        </div>

                        <div className="flex justify-between pt-2 mt-2 border-t border-slate-200">
                          <span className="text-slate-600">u<sub>site</sub></span>
                          <span className="font-mono font-semibold text-blue-700">{Number(results.terms.u_site).toFixed(3)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">u<sub>jam</sub></span>
                          <span className="font-mono font-semibold text-blue-700">{Number(results.terms.u_jam).toFixed(3)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">ε</span>
                          <span className="font-mono font-semibold text-blue-700">{Number(results.terms.epsilon).toFixed(3)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 p-4 bg-blue-50 rounded-lg border border-blue-200">
                      <p className="text-xs text-blue-600 font-semibold tracking-wide mb-2">
                        TOTAL PMV<span className="lowercase">abran</span>
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
                  Grafik kontribusi tiap komponen terhadap total PMVabran.
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
                      <ComposedChart
                        data={breakdownData}
                        margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip />
                        <Legend />

                        <Bar dataKey="component" name="Nilai Komponen" fill="#2563EB" />

                        <Line
                          type="monotone"
                          dataKey="cumulative"
                          name="Akumulasi"
                          stroke="#10B981"
                          strokeWidth={2}
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
                    Batang = kontribusi tiap komponen, garis = akumulasi sampai total PMVabran.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </main>
  )
}

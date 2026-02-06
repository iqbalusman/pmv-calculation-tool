'use client'

import React, { useEffect, useMemo, useRef, useState } from "react"
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

  // Normalisasi (Skala Relatif sesuai dokumen)
  normalize: boolean
  pmv_obs_ref: number | ''      // PMV observasi lapangan (mis: -0.61)
  pmv_model_ref: number | ''    // PMV model pada titik referensi (mis: pantai)
}

type CategoryResult = {
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
  normalization: null | {
    pmv_obs_ref: number
    pmv_model_ref: number
    scale_raw: number
    scale_used: number
  }
  total: number // PMV_final (kalau normalize ON -> PMV_norm; kalau OFF -> PMV_pre)
}

export default function ThermalComfortCalculator() {
  // Koefisien model Bab 4 (disesuaikan agar PMV_pre konsisten ±2.96 sesuai dokumen)
  const PARAMS = {
    alpha: 0.225,
    beta1: 0.0774, // ✅ koreksi (sebelumnya 0.774)
    beta2: 7.379,
    beta3: -0.385,
    beta4: -0.098,
    k: 0.3,
    alphaV: 0.5,
  }

  // ✅ Nilai contoh (agar hasil PRE ~2.955 dan NORM ~ -1.66 dengan PMVobs=-0.61)
  // pmv_model_ref default diset agar ratio mendekati contoh dokumen.
  const DEFAULT_VALUES: Inputs = {
    pmv_iso: 0.60,
    v: 3.2,
    svf: 0.55,
    h_w: 0.923,
    veg_func: 1,
    u_site: 0,
    u_jam: 0,
    epsilon: 0,

    normalize: true,
    pmv_obs_ref: -0.61,     // ✅ sesuai dokumen (PMV observasi lapangan)
    pmv_model_ref: 1.085,   // ✅ contoh referensi model (pantai), agar PMV_norm ~ -1.66
  }

  // ✅ Nilai awal saat refresh
  const INITIAL_VALUES: Inputs = {
    pmv_iso: 0,
    v: 0,
    svf: 0,
    h_w: 0,
    veg_func: 0,
    u_site: 0,
    u_jam: 0,
    epsilon: 0,

    normalize: true,
    pmv_obs_ref: -0.61,
    pmv_model_ref: 1.085,
  }

  const [inputs, setInputs] = useState<Inputs>(INITIAL_VALUES)
  const [results, setResults] = useState<PMVAbranResult | null>(null)
  const [errors, setErrors] = useState<string>('')

  const chartRef = useRef<HTMLDivElement | null>(null)

  const round3 = (x: number): number => Number(x.toFixed(3))

  /**
   * PMVabran (sesuai model):
   *
   * PMV_pre =
   *   α + β₁·PMViso
   *   + β₂·e^{-k( H/W + αᵥ·v )}
   *   + β₃·(SVF·v)
   *   + β₄·veg_func
   *   + u_site + u_jam + ε
   *
   * Normalisasi (SKALA RELATIF - sesuai dokumen):
   *   PMV_norm = PMV_obs_ref * ( PMV_model / PMV_model_ref )
   *
   * - Jika input = referensi -> PMV_norm = PMV_obs_ref
   * - Jika input berubah -> skala mengikuti rasio model terhadap referensi
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
    pmv_obs_ref: number,
    pmv_model_ref: number
  ): PMVAbranResult => {
    if ([pmv_iso, v, svf, h_w, veg_func, u_site, u_jam, epsilon, pmv_obs_ref, pmv_model_ref].some((n) => Number.isNaN(n))) {
      throw new Error('Semua input harus berupa angka')
    }
    if (normalize && pmv_model_ref === 0) {
      throw new Error('PMV_model_ref tidak boleh 0 (pembagian rasio)')
    }

    const A = h_w + PARAMS.alphaV * v
    const exponent = -PARAMS.k * A
    const exp_raw = Math.exp(exponent)
    const exp_used = round3(exp_raw) // 3 desimal seperti contoh perhitungan
    const SVFv = round3(svf * v)

    const termAlpha = round3(PARAMS.alpha)
    const termBeta1 = round3(PARAMS.beta1 * pmv_iso)
    const termBeta2 = round3(PARAMS.beta2 * exp_used)
    const termBeta3 = round3(PARAMS.beta3 * SVFv)
    const termBeta4 = round3(PARAMS.beta4 * veg_func)
    const termUSite = round3(u_site)
    const termUJam = round3(u_jam)
    const termEps = round3(epsilon)

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

    if (!normalize) {
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
        normalization: null,
        total: preTotal,
      }
    }

    const scale_raw = preTotal / pmv_model_ref
    const scale_used = round3(scale_raw) // ditampilkan seperti 2.723 pada dokumen
    const total = round3(pmv_obs_ref * scale_used)

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
      normalization: {
        pmv_obs_ref: round3(pmv_obs_ref),
        pmv_model_ref: round3(pmv_model_ref),
        scale_raw: round3(scale_raw),
        scale_used,
      },
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
      const pmv_model_ref = parseFloat(String(inputs.pmv_model_ref))

      const result = calculatePMVAbran(
        pmv_iso, v, svf, h_w, veg_func, u_site, u_jam, epsilon,
        inputs.normalize, pmv_obs_ref, pmv_model_ref
      )

      setResults(result)
    } catch (error: any) {
      setErrors(error.message)
      setResults(null)
    }
  }

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
        Number(DEFAULT_VALUES.pmv_model_ref),
      )
      setResults(result)
    } catch (error: any) {
      setErrors(error.message)
      setResults(null)
    }
  }

  // ✅ Skala Persepsi
  const getPerceptionCategory = (pmv: number): CategoryResult => {
    if (pmv < -2.5) return { label: "Sangat Dingin", range: "< -2.5" }
    if (pmv < -1.5) return { label: "Sejuk Nyaman", range: "[-2.5, -1.5)" }
    if (pmv < -0.5) return { label: "Sejuk", range: "[-1.5, -0.5)" }
    if (pmv < 0.5) return { label: "Netral (Nyaman)", range: "[-0.5, 0.5)" }
    if (pmv < 1.5) return { label: "Hangat", range: "[0.5, 1.5)" }
    if (pmv < 2.5) return { label: "Panas", range: "[1.5, 2.5)" }
    return { label: "Sangat Panas", range: "≥ 2.5" }
  }

  const perception = useMemo(() => {
    if (!results) return null
    return getPerceptionCategory(Number(results.total))
  }, [results])

  // Breakdown chart (komponen PMV_pre + titik PMV_norm jika normalisasi aktif)
  const breakdownData = useMemo(() => {
    if (!results) return []

    const terms = [
      { name: 'α', component: Number(results.terms.alpha) },
      { name: 'β₁·PMVᵢₛₒ', component: Number(results.terms.beta1) },
      { name: 'β₂·e^{-k(H/W+αᵥv)}', component: Number(results.terms.beta2) },
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
      name: 'Total PMVpesisir',
      component: 0,
      cumulative: Number(results.preTotal),
    })

    if (results.normalization) {
      data.push({
        name: 'PMV_norm',
        component: 0,
        cumulative: Number(results.total),
      })
    }

    return data
  }, [results])

  // ===========================
  // Helpers: SVG -> PNG (tanpa html2canvas)
  // ===========================
  const svgToPngDataUrl = async (
    svgText: string,
    width: number,
    height: number,
    scale = 2
  ): Promise<string> => {
    return await new Promise((resolve, reject) => {
      const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" })
      const url = URL.createObjectURL(blob)

      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas")
          canvas.width = Math.ceil(width * scale)
          canvas.height = Math.ceil(height * scale)

          const ctx = canvas.getContext("2d")
          if (!ctx) {
            URL.revokeObjectURL(url)
            reject(new Error("Canvas context null"))
            return
          }

          ctx.setTransform(scale, 0, 0, scale, 0, 0)
          ctx.fillStyle = "#ffffff"
          ctx.fillRect(0, 0, width, height)
          ctx.drawImage(img, 0, 0, width, height)

          URL.revokeObjectURL(url)
          resolve(canvas.toDataURL("image/png"))
        } catch (e) {
          URL.revokeObjectURL(url)
          reject(e)
        }
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error("Gagal memuat SVG"))
      }
      img.src = url
    })
  }

  // ===========================
  // Download Grafik PNG
  // ===========================
  const handleDownloadChartPNG = async () => {
    if (!chartRef.current) return
    const date = new Date().toISOString().slice(0, 10)

    const svg = chartRef.current.querySelector("svg") as SVGSVGElement | null
    if (!svg) return

    const rect = svg.getBoundingClientRect()
    const w = Math.ceil(rect.width)
    const h = Math.ceil(rect.height)

    const clonedSvg = svg.cloneNode(true) as SVGSVGElement
    clonedSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg")
    clonedSvg.setAttribute("width", String(w))
    clonedSvg.setAttribute("height", String(h))
    clonedSvg.setAttribute("viewBox", `0 0 ${w} ${h}`)

    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect")
    bg.setAttribute("x", "0")
    bg.setAttribute("y", "0")
    bg.setAttribute("width", "100%")
    bg.setAttribute("height", "100%")
    bg.setAttribute("fill", "#ffffff")
    clonedSvg.insertBefore(bg, clonedSvg.firstChild)

    clonedSvg.querySelectorAll("text, tspan").forEach((t) => {
      const el = t as SVGElement
      if (!el.getAttribute("fill")) el.setAttribute("fill", "#111827")
    })

    const svgText = new XMLSerializer().serializeToString(clonedSvg)

    try {
      const dataUrl = await svgToPngDataUrl(svgText, w, h, 2)
      const a = document.createElement("a")
      a.href = dataUrl
      a.download = `Grafik-PMV-${date}.png`
      a.click()
    } catch {
      const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `Grafik-PMV-${date}.svg`
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  // ===========================
  // SVG blocks untuk PDF
  // ===========================
  const SVG_W = 1400
  const svgWrap = (h: number, inner: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${h}" viewBox="0 0 ${SVG_W} ${h}">
  <rect x="0" y="0" width="100%" height="100%" fill="#ffffff"/>
  ${inner}
</svg>`

  const sub = (text: string, size = 18) =>
    `<tspan font-size="${size}" baseline-shift="sub">${text}</tspan>`
  const sup = (text: string, size = 18) =>
    `<tspan font-size="${size}" baseline-shift="super">${text}</tspan>`

  const formulaSvg = () => {
    const h = 160
    const font = "Times New Roman, serif"
    const size = 26
    const subSize = 18
    const x = 30
    return {
      w: SVG_W,
      h,
      svg: svgWrap(h, `
  <text x="${x}" y="55" font-family="${font}" font-size="${size}" fill="#000">
    PMV${sub("pre", subSize)} = α + β${sub("1", subSize)} PMV${sub("iso", subSize)} + β${sub("2", subSize)} e${sup("-k(H/W + α", subSize)}${sup("v", subSize)}${sup("·v)", subSize)}
  </text>
  <text x="${x}" y="100" font-family="${font}" font-size="${size}" fill="#000">
    + β${sub("3", subSize)} (SVF · v) + β${sub("4", subSize)} veg${sub("func", subSize)} + u${sub("site", subSize)} + u${sub("jam", subSize)} + ε
  </text>
  <text x="${x}" y="140" font-family="${font}" font-size="${size}" fill="#000">
    PMV${sub("norm", subSize)} = PMV${sub("obs", subSize)} × ( PMV${sub("model", subSize)} / PMV${sub("model,ref", subSize)} )
  </text>
      `),
    }
  }

  const paramsSvg = () => {
    const h = 280
    const font = "Times New Roman, serif"
    const size = 30
    const line = 36
    const x = 70
    let y = 60

    const rows = [
      `α = ${PARAMS.alpha}`,
      `β${sub("1", 22)} = ${PARAMS.beta1}`,
      `β${sub("2", 22)} = ${PARAMS.beta2}`,
      `β${sub("3", 22)} = ${PARAMS.beta3}`,
      `β${sub("4", 22)} = ${PARAMS.beta4}`,
      `k = ${PARAMS.k}`,
      `α${sub("v", 22)} = ${PARAMS.alphaV}`,
    ]

    const inner = [
      `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="700" fill="#000">PARAMETER MODEL</text>`,
    ]
    y += 55
    for (const r of rows) {
      inner.push(`<text x="${x}" y="${y}" font-family="${font}" font-size="28" fill="#000">${r}</text>`)
      y += line
    }

    return { w: SVG_W, h, svg: svgWrap(h, inner.join("\n")) }
  }

  const stepsSvg = (r: PMVAbranResult) => {
    const h = 210
    const font = "Times New Roman, serif"
    const x = 60
    let y = 55
    const line = 34

    const inner = [
      `<text x="${x}" y="${y}" font-family="${font}" font-size="28" font-weight="700" fill="#000">LANGKAH PERHITUNGAN</text>`,
    ]
    y += 50
    const rows = [
      `A = H/W + α${sub("v", 18)}·v = ${r.A.toFixed(3)}`,
      `Exponent = −k·A = ${r.exponent.toFixed(3)}`,
      `expfactor (raw) = e^(Exponent) = ${r.expfactor_raw.toFixed(3)}`,
      `expfactor (used, 3 desimal) = ${Number(r.expfactor_used).toFixed(3)}`,
      `SVF·v = ${r.SVFv.toFixed(3)}`,
    ]
    for (const rr of rows) {
      inner.push(`<text x="${x}" y="${y}" font-family="${font}" font-size="24" fill="#000">${rr}</text>`)
      y += line
    }

    return { w: SVG_W, h, svg: svgWrap(h, inner.join("\n")) }
  }

  const componentsSvg = (r: PMVAbranResult) => {
    const h = 470
    const font = "Times New Roman, serif"
    const x = 60
    let y = 55
    const line = 34

    const inner = [
      `<text x="${x}" y="${y}" font-family="${font}" font-size="28" font-weight="700" fill="#000">KOMPONEN HASIL</text>`,
    ]
    y += 50

    const rows = [
      `α = ${Number(r.terms.alpha).toFixed(3)}`,
      `β${sub("1", 18)} · PMV${sub("iso", 18)} = ${Number(r.terms.beta1).toFixed(3)}`,
      `β${sub("2", 18)} · e${sup("-k(H/W + α", 18)}${sup("v", 18)}${sup("·v)", 18)} = ${Number(r.terms.beta2).toFixed(3)}`,
      `β${sub("3", 18)} · (SVF·v) = ${Number(r.terms.beta3).toFixed(3)}`,
      `β${sub("4", 18)} · veg${sub("func", 18)} = ${Number(r.terms.beta4).toFixed(3)}`,
      `u${sub("site", 18)} = ${Number(r.terms.u_site).toFixed(3)}`,
      `u${sub("jam", 18)} = ${Number(r.terms.u_jam).toFixed(3)}`,
      `ε = ${Number(r.terms.epsilon).toFixed(3)}`,
      `PMV${sub("pre", 18)} = ${Number(r.preTotal).toFixed(3)}`,
    ]

    for (const rr of rows) {
      inner.push(`<text x="${x}" y="${y}" font-family="${font}" font-size="24" fill="#000">${rr}</text>`)
      y += line
    }

    if (r.normalization) {
      y += 8
      inner.push(`<text x="${x}" y="${y}" font-family="${font}" font-size="26" font-weight="700" fill="#000">NORMALISASI (SKALA RELATIF)</text>`)
      y += 34
      inner.push(`<text x="${x}" y="${y}" font-family="${font}" font-size="24" fill="#000">PMV_obs_ref = ${Number(r.normalization.pmv_obs_ref).toFixed(3)}</text>`)
      y += line
      inner.push(`<text x="${x}" y="${y}" font-family="${font}" font-size="24" fill="#000">PMV_model_ref = ${Number(r.normalization.pmv_model_ref).toFixed(3)}</text>`)
      y += line
      inner.push(`<text x="${x}" y="${y}" font-family="${font}" font-size="24" fill="#000">Skala = PMV_model / PMV_model_ref = ${Number(r.normalization.scale_used).toFixed(3)}</text>`)
      y += line
    }

    y += 10
    inner.push(
      `<text x="${x}" y="${y}" font-family="${font}" font-size="28" font-weight="700" fill="#000">
        TOTAL PMV${sub(r.normalization ? "norm" : "pre", 20)} = ${Number(r.total).toFixed(3)}
      </text>`
    )

    return { w: SVG_W, h, svg: svgWrap(h, inner.join("\n")) }
  }

  // ✅ Download PDF
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

    const addSvgToPdf = async (svgText: string, svgW: number, svgH: number) => {
      const png = await svgToPngDataUrl(svgText, svgW, svgH, 2)
      const imgW = maxW
      const imgH = (svgH * imgW) / svgW
      ensureSpace(imgH + 10)
      doc.addImage(png, "PNG", marginX, y, imgW, imgH)
      y += imgH + 10
    }
    

    const now = new Date()
    const dateStr = now.toLocaleString()

    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
    doc.text("THERMAL COMFORT ENVIRONMENT", marginX, y); y += 18

    doc.setFontSize(12)
    doc.text("HASIL ANALISIS KALKULASI MODEL PMVpesisir", marginX, y); y += 16

    doc.setFont("helvetica", "normal")
    doc.setFontSize(10)
    doc.text(`Tanggal/Jam: ${dateStr}`, marginX, y); y += 12
    hr()

    // RUMUS
    write("1. Model Persamaan PMVpesisir dan Normalisasi Skala Relatif PMV_norm.")
    try {
      const f = formulaSvg()
      await addSvgToPdf(f.svg, f.w, f.h)
    } catch {
      write("PMVpesisir = alpha + beta1*PMV_iso + beta2*exp(-k*(H/W + alphaV*v)) + beta3*(SVF*v) + beta4*vegfunc + u_site + u_jam + epsilon")
      write("PMV_norm = PMV_obs_ref * (PMV_model / PMV_model_ref)")
    }

    if (inputs.normalize && results.normalization) {
      write(`Normalisasi (skala relatif): PMV_norm = PMV_obs_ref × (PMV_model / PMV_model_ref)`)
      write(`PMV_obs_ref = ${Number(inputs.pmv_obs_ref).toFixed(2)}   (observasi lapangan)`)
      write(`PMV_model_ref = ${Number(inputs.pmv_model_ref).toFixed(3)} (model titik referensi)`)
      write(`Skala (digunakan) = ${Number(results.normalization.scale_used).toFixed(3)}`)
    }
    hr()

    // INPUT
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
    writeKV("PMV ObserfaLapangansi ", String(inputs.pmv_obs_ref))
    writeKV("PMV Referensi", String(inputs.pmv_model_ref))
    hr()

    // PARAMETER MODEL
    write("PARAMETER MODEL", { bold: true, size: 12 })
    hr()
    try {
      const p = paramsSvg()
      await addSvgToPdf(p.svg, p.w, p.h)
    } catch {
      writeKV("alpha", String(PARAMS.alpha))
      writeKV("beta1", String(PARAMS.beta1))
      writeKV("beta2", String(PARAMS.beta2))
      writeKV("beta3", String(PARAMS.beta3))
      writeKV("beta4", String(PARAMS.beta4))
      writeKV("k", String(PARAMS.k))
      writeKV("alphaV", String(PARAMS.alphaV))
    }
    hr()

    // LANGKAH PERHITUNGAN
    write("LANGKAH PERHITUNGAN", { bold: true, size: 12 })
    hr()
    try {
      const s = stepsSvg(results)
      await addSvgToPdf(s.svg, s.w, s.h)
    } catch {
      writeKV("A", `${results.A} (H/W + alphaV*v)`)
      writeKV("Exponent", `${results.exponent} (-k*A)`)
      writeKV("expfactor_raw", `${results.expfactor_raw}`)
      writeKV("expfactor_used", `${results.expfactor_used}`)
      writeKV("SVF*v", `${results.SVFv}`)
    }
    hr()

    // KOMPONEN HASIL
    write("KOMPONEN HASIL", { bold: true, size: 12 })
    hr()
    try {
      const c = componentsSvg(results)
      await addSvgToPdf(c.svg, c.w, c.h)
    } catch {
      writeKV("alpha", String(results.terms.alpha))
      writeKV("beta1*PMV_iso", String(results.terms.beta1))
      writeKV("beta2*expfactor", String(results.terms.beta2))
      writeKV("beta3*(SVF*v)", String(results.terms.beta3))
      writeKV("beta4*vegfunc", String(results.terms.beta4))
      writeKV("u_site", String(results.terms.u_site))
      writeKV("u_jam", String(results.terms.u_jam))
      writeKV("epsilon", String(results.terms.epsilon))
      writeKV("PMVpesisir", String(results.preTotal))
      if (results.normalization) {
        writeKV("scale_used", String(results.normalization.scale_used))
      }
    }
    hr()

    // SKALA PERSEPSI
    if (perception) {
      write("KATEGORI PMVpesisir", { bold: true, size: 12 })
      hr()
      writeKV("PMVpesisir", `${Number(results.total).toFixed(3)}`)
      writeKV("Kategori", `${perception.label} (rentang ${perception.range})`)
      hr()
    }

    write("HASIL AKHIR", { bold: true, size: 12 })
    hr()
    doc.setFont("helvetica", "bold")
    doc.setFontSize(13)
    ensureSpace(22)
    doc.text(`TOTAL PMVpesisir = ${Number(results.total).toFixed(3)}`, marginX, y)
    y += 20

    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.text("© Thermal Comfort Environment", marginX, pageH - 28)

    const date = new Date().toISOString().slice(0, 10)
    doc.save(`Hasil-Analisis-PMV-${date}.pdf`)
  }

  // ✅ Saat pertama kali load/refresh: input 0 semua & hasil kosong
  useEffect(() => {
    setInputs(INITIAL_VALUES)
    setResults(null)
    setErrors('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ✅ Titik label untuk ReferenceDot pada chart
  const dotX = useMemo(() => {
    if (!results) return "Total (PMVpesisir)"
    return results.normalization ? "PMV_norm" : "Total (PMVpesisir)"
  }, [results])

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">
            <span className="text-blue-900">Thermal Comfort Environment</span>
          </h1>
          <p className="text-slate-600">
            Model PMVpesisir + Normalisasi Skala Relatif (PMV_norm)
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Panel Input */}
          <Card className="h-fit">
            <CardHeader className="bg-slate-50 border-b">
              <CardTitle>Input Parameters</CardTitle>
              <CardDescription>Masukkan nilai parameter perhitungan</CardDescription>
            </CardHeader>

            <CardContent className="pt-6 space-y-6">
              {/* PMV ISO + v */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
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
                {/* PMV ISO */}
                  <div className="space-y-2">
                    <Label htmlFor="pmv_iso" className="text-sm font-medium text-slate-700">
                      <span className="inline-flex items-baseline gap-1">
                        <span>(β₁)</span>
                        <span className="inline-flex items-baseline gap-0">
                          <span>PMV</span>
                          <sub className="m-0 p-0 leading-none align-baseline text-[0.75em] relative top-[0.15em]">
                            iso
                          </sub>
                        </span>
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
              </div>

              {/* Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="svf" className="text-sm font-medium text-slate-700">
                  (β₃)Sky View Factor (SVF) 
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
                  (β₂) Rasio H/W 
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
                    <span>(β₄)Vegetasi Function </span>
                    <span className="inline-flex items-baseline gap-0">
                      <span>(</span>
                      <span className="italic">
                        veg
                        <sub className="m-0 p-0 leading-none text-[0.75em] italic">
                          func 
                        </sub>
                      </span>
                      <span>)</span>
                    </span>
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
                      <span className="inline-flex items-baseline gap-0">
                        <span>u</span>
                        <sub className="m-0 p-0 leading-none text-[0.75em] italic">
                          site
                        </sub>
                      </span>
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
                      <span className="inline-flex items-baseline gap-0">
                        <span>u</span>
                        <sub className="m-0 p-0 leading-none text-[0.75em] italic relative top-[0.15em]">
                          jam
                        </sub>
                      </span>
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

              {/* Normalisasi */}
              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-900">Normalisasi (Skala Relatif)</p>

                  <label className="flex items-center gap-2 text-sm text-slate-700 select-none">
                    <input
                      type="checkbox"
                      checked={inputs.normalize}
                      onChange={(e) => setInputs(prev => ({ ...prev, normalize: e.target.checked }))}
                      className="h-4 w-4"
                    />
                    Aktif
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="pmv_obs_ref" className="text-sm font-medium text-slate-700">
                      PMV ( Observasi Lapangan)
                    </Label>
                    <Input
                      id="pmv_obs_ref"
                      type="number"
                      step="0.01"
                      value={inputs.pmv_obs_ref}
                      onChange={(e) => handleNumberChange('pmv_obs_ref', e.target.value)}
                      placeholder="-0.61"
                    />
                  </div>

                  {/*<div className="space-y-2">
                    <Label htmlFor="pmv_model_ref" className="text-sm font-medium text-slate-700">
                      PMV (Referensi)
                    </Label>
                    <Input
                      id="pmv_model_ref"
                      type="number"
                      step="0.001"
                      value={inputs.pmv_model_ref}
                      onChange={(e) => handleNumberChange('pmv_model_ref', e.target.value)}
                      placeholder="1.085"
                    />
                  </div>*/}
                </div>

                {/*<p className="text-xs text-slate-600">
                  Rumus: <span className="font-mono">PMV_norm = PMV_obs_ref × (PMV_model / PMV_model_ref)</span>
                </p>*/}
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
                    { no: "2.", left: "β₁", right: PARAMS.beta1 },
                    { no: "3.", left: "β₂", right: PARAMS.beta2 },
                    { no: "4.", left: "β₃", right: PARAMS.beta3 },
                    { no: "5.", left: "β₄", right: PARAMS.beta4 },
                    { no: "6.", left: "k", right: PARAMS.k },
                    { no: "7.", left: "αᵥ", right: PARAMS.alphaV },
                  ].map((row, idx) => (
                    <div key={idx} className="grid grid-cols-[210px_22px_90px] items-center">
                      <span className="font-medium">{row.no}&nbsp;&nbsp;{row.left}</span>
                      <span className="text-center font-medium">=</span>
                      <span className="text-right font-medium">{String(row.right)}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-3 text-xs text-slate-600 border-t border-slate-200 pt-3">
                  Normalisasi skala relatif: <b>{inputs.normalize ? "ON" : "OFF"}</b>
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
                      PMVpesisir {results.normalization ? "" : "(PMV_pre)"}
                    </p>
                    <p className="text-5xl font-bold text-blue-700">
                      {Number(results.total).toFixed(3)}
                    </p>
                  </div>

                  {results.normalization && (
  <div className="mb-4 p-4 rounded-lg border border-slate-200 bg-white">
    <p className="text-sm font-semibold text-slate-900 mb-2">
      Nilai dinormalisasi (skala relatif)
    </p>

    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">Skala</span>
      <span className="font-mono font-semibold text-blue-700">
        {Number(results.normalization.scale_used).toFixed(3)}
      </span>
    </div>

    <div className="flex items-center justify-between text-sm mt-1">
      <span className="text-slate-600">PMV Observasi Lapangan</span>
      <span className="font-mono font-semibold text-blue-700">
        {Number(results.normalization.pmv_obs_ref).toFixed(2)}
      </span>
    </div>

    <div className="flex items-center justify-between text-sm mt-1">
      <span className="text-slate-600">PMVpesisir</span>
      <span className="font-mono font-semibold text-blue-700">
        {Number(results.total).toFixed(3)}
      </span>
    </div>
  </div>
)}


                  {perception && (
                    <div className="mb-4 p-4 rounded-lg border border-slate-200 bg-white">
                      <p className="text-sm font-semibold text-slate-900 mb-1">
                        Kategori PMVpesisir
                      </p>
                      <p className="text-sm text-slate-700">
                        PMV{" "}
                        <span className="font-mono font-semibold text-blue-700">{Number(results.total).toFixed(3)}</span>
                        {" "}→{" "}
                        <span className="font-semibold">{perception.label}</span>
                        {" "}({perception.range})
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
                          <span className="text-slate-600">Exponent = −k × A</span>
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
                      <p className="text-sm font-semibold text-slate-700 mb-3">
                        Komponen (PMVpesisir)
                      </p>
                      <div className="space-y-2 text-sm bg-slate-50 p-3 rounded-lg">
                        {[
                          ["α", results.terms.alpha],
                          ["β₁ × PMVᵢₛₒ", results.terms.beta1],
                          ["β₂ × e^{-k(H/W+αᵥv)}", results.terms.beta2],
                          ["β₃ × (SVF·v)", results.terms.beta3],
                          ["β₄ × veg_func", results.terms.beta4],
                          ["u_site", results.terms.u_site],
                          ["u_jam", results.terms.u_jam],
                          ["ε", results.terms.epsilon],
                          ["PMVpesisir", results.preTotal],
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
                        TOTAL PMVpesisir {results.normalization ? "(PMV_norm)" : "(PMV_pre)"}
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
                  Batang = komponen PMVpesisir, garis = akumulasi PMVpesisir. Jika normalisasi aktif, titik PMV_norm ditampilkan sebagai titik terakhir.
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

                        <Bar dataKey="component" name="Nilai Komponen (PMVpesisir)" fill="#16a34a" />

                        <Line
                          type="monotone"
                          dataKey="cumulative"
                          name="Akumulasi"
                          stroke="#2563eb"
                          strokeWidth={2}
                          dot
                          isAnimationActive={false}
                        />

                        <ReferenceDot
                          x={dotX}
                          y={Number(results.normalization ? results.total : results.preTotal)}
                          r={7}
                          fill="#dc2626"
                          stroke="#dc2626"
                          strokeWidth={2}
                          label={{
                            value: results.normalization
                              ? `PMV_norm: ${Number(results.total).toFixed(3)}`
                              : `PMV_pre: ${Number(results.preTotal).toFixed(3)}`,
                            position: 'top',
                            fill: '#dc2626',
                          }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  <p className="text-xs text-slate-500 mt-3">
                    Catatan: PMV_norm adalah hasil normalisasi skala relatif terhadap PMV_obs_ref dan PMV_model_ref.
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
                      PMVpesisir• PMV_norm • Adaptive Thermal Comfort
                    </p>
                  </div>
                </div>

                <p className="mt-4 text-sm text-slate-600 leading-relaxed">
                Aplikasi untuk menghitung PMVpesisir berdasarkan parameter lingkungan permukiman pesisir, menampilkan hasil, komponen perhitungan, dan visualisasi grafik. (dp narasi tambahan).....
                Model PMVpesisir merupakan model prediktif kenyamanan termal ruang luar pesisir yang mengintegrasikan respon fisiologis manusia dengan koreksi spasial berbasis morfologi dan dinamika angin laut, sehingga lebih representatif untuk menjelaskan dan merancang kenyamanan termal pada permukiman pesisir tropis.
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

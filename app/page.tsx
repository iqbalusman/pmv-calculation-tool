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
  v: number | ''        // v (m/s) dipakai juga untuk PMV ISO (disinkronkan)
  svf: number | ''
  h_w: number | ''
  veg_func: number | ''
  u_site: number | ''
  u_jam: number | ''
  epsilon: number | ''

  normalize: boolean
  pmv_obs_ref: number | ''
  pmv_model_ref: number | ''
}

type Ashrae55Inputs = {
  tdb: number | ''    // Ta (°C)
  tr: number | ''     // Tr (°C)
  rh: number | ''     // RH (%)
  met: number | ''    // met
  clo: number | ''    // clo
  v_air: number | ''  // v (m/s) — disinkronkan dengan inputs.v
  wme: number | ''    // default 0
}

type PMVIsoPPDResult = {
  pmv: number
  ppd: number
  tsv: string
  v_r: number
  clo_d: number
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
  total: number
}

export default function ThermalComfortCalculator() {
  // Koefisien model (disesuaikan agar PMV_pre ~2.96 sesuai dokumen)
  const PARAMS = {
    alpha: 0.225,
    beta1: 0.0774,
    beta2: 7.379,
    beta3: -0.385,
    beta4: -0.098,
    k: 0.3,
    alphaV: 0.5,
  }

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
    pmv_obs_ref: -0.61,
    pmv_model_ref: 1.085,
  }

  const ASHRAE_DEFAULT_VALUES: Ashrae55Inputs = {
    tdb: 25,
    tr: 25,
    rh: 50,
    met: 1.2,
    clo: 0.5,
    v_air: 3.2,  // ✅ samakan dengan v (sesuai gambar)
    wme: 0,
  }

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

  const ASHRAE_INITIAL_VALUES: Ashrae55Inputs = {
    tdb: '',
    tr: '',
    rh: '',
    met: '',
    clo: '',
    v_air: '',
    wme: 0,
  }

  const [inputs, setInputs] = useState<Inputs>(INITIAL_VALUES)
  const [ashrae55, setAshrae55] = useState<Ashrae55Inputs>(ASHRAE_INITIAL_VALUES)

  const [pmvIsoResult, setPmvIsoResult] = useState<PMVIsoPPDResult | null>(null)
  const [results, setResults] = useState<PMVAbranResult | null>(null)
  const [errors, setErrors] = useState<string>('')

  const chartRef = useRef<HTMLDivElement | null>(null)

  const round3 = (x: number): number => Number(x.toFixed(3))
  const round2 = (x: number): number => Number(x.toFixed(2))
  const round1 = (x: number): number => Number(x.toFixed(1))
  const trunc3 = (x: number): number => Math.trunc(x * 1000) / 1000

  // ===========================
  // Sync v (sesuai gambar: 1 v untuk semuanya)
  // ===========================
  const setWindSpeed = (value: string) => {
    const parsed = value === '' ? '' : parseFloat(value)
    setAshrae55(prev => ({ ...prev, v_air: parsed }))
    setInputs(prev => ({ ...prev, v: parsed }))
  }

  const handleNumberChange = (key: Exclude<keyof Inputs, 'normalize'>, value: string) => {
    setInputs(prev => ({
      ...prev,
      [key]: value === '' ? '' : parseFloat(value),
    }))
  }

  const handleAshraeChange = (key: keyof Ashrae55Inputs, value: string) => {
    setAshrae55(prev => ({
      ...prev,
      [key]: value === '' ? '' : parseFloat(value),
    }))
  }

  // ===========================
  // ASHRAE helpers
  // ===========================
  const v_relative = (v: number, met: number) => {
    if (met > 1) return round3(v + 0.3 * (met - 1))
    return round3(v)
  }

  const clo_dynamic = (clo: number, met: number) => {
    if (met >= 1.2) return round3(clo * (0.6 + 0.4 / met))
    return round3(clo)
  }

  const pmv_ppd_iso = (tdb: number, tr: number, v: number, rh: number, met: number, clo: number, wme: number) => {
    const pa =
      (rh / 100) *
      10 *
      Math.exp(16.6536 - 4030.183 / (tdb + 235))

    const icl = 0.155 * clo
    const m = met * 58.15
    const w = wme * 58.15
    const mw = m - w

    const fcl = icl <= 0.078 ? (1 + 1.29 * icl) : (1.05 + 0.645 * icl)
    const hcf = 12.1 * Math.sqrt(Math.max(v, 0.0001))
    const taa = tdb + 273
    const tra = tr + 273

    const tcla = taa + (35.5 - tdb) / (3.5 * (6.45 * icl + 0.1))
    const p1 = icl * fcl
    const p2 = p1 * 3.96
    const p3 = p1 * 100
    const p4 = p1 * taa
    const p5 = 308.7 - 0.028 * mw + p2 * Math.pow(tra / 100, 4)

    let xn = tcla / 100
    let xf = xn
    const eps = 0.00015

    let hc = hcf
    for (let i = 0; i < 150; i++) {
      xf = xn
      const hcn = 2.38 * Math.pow(Math.abs(100 * xf - taa), 0.25)
      hc = Math.max(hcf, hcn)
      xn = (p5 + p4 * hc - p2 * Math.pow(xf, 4)) / (100 + p3 * hc)
      if (Math.abs(xn - xf) <= eps) break
    }

    const tcl = 100 * xn - 273

    const hl1 = 3.05 * 0.001 * (5733 - 6.99 * mw - pa)
    const hl2 = mw > 58.15 ? 0.42 * (mw - 58.15) : 0
    const hl3 = 1.7e-5 * m * (5867 - pa)
    const hl4 = 0.0014 * m * (34 - tdb)
    const hl5 = 3.96 * fcl * (Math.pow(xn, 4) - Math.pow(tra / 100, 4))
    const hl6 = fcl * hc * (tcl - tdb)

    const ts = 0.303 * Math.exp(-0.036 * m) + 0.028
    const pmv = ts * (mw - hl1 - hl2 - hl3 - hl4 - hl5 - hl6)
    const ppd = 100 - 95 * Math.exp(-0.03353 * Math.pow(pmv, 4) - 0.2179 * Math.pow(pmv, 2))

    const tsvMap = [
      { t: -2.5, l: "Cold" },
      { t: -1.5, l: "Cool" },
      { t: -0.5, l: "Slightly Cool" },
      { t: 0.5, l: "Neutral" },
      { t: 1.5, l: "Slightly Warm" },
      { t: 2.5, l: "Warm" },
    ]
    let tsv = "Hot"
    for (const it of tsvMap) {
      if (pmv < it.t) {
        tsv = it.l
        break
      }
    }

    return { pmv, ppd, tsv }
  }

  const calculatePMVIsoFromAshrae55 = (a: Ashrae55Inputs): PMVIsoPPDResult => {
    const tdb = Number(a.tdb)
    const tr = Number(a.tr)
    const rh = Number(a.rh)
    const met = Number(a.met)
    const clo = Number(a.clo)
    const v_air = Number(a.v_air)
    const wme = Number(a.wme || 0)

    if ([tdb, tr, rh, met, clo, v_air, wme].some((n) => Number.isNaN(n))) {
      throw new Error("INPUT PMV (Ta, RH, v, Tr, clo, met) harus angka semua")
    }

    const v_r = v_relative(v_air, met)
    const clo_d = clo_dynamic(clo, met)

    const { pmv, ppd, tsv } = pmv_ppd_iso(tdb, tr, v_r, rh, met, clo_d, wme)

    return {
      pmv: round2(pmv),
      ppd: round1(ppd),
      tsv,
      v_r: round3(v_r),
      clo_d: round3(clo_d),
    }
  }

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
      throw new Error('Input PMVpesisir/Normalisasi harus angka semua (SVF, H/W, veg_func, dst)')
    }
    if (normalize && pmv_model_ref === 0) {
      throw new Error('PMV_model_ref tidak boleh 0')
    }

    const A = h_w + PARAMS.alphaV * v
    const exponent = -PARAMS.k * A

    const exp_raw = Math.exp(exponent)
    const exp_used = round3(exp_raw)

    const SVFv = round3(svf * v)

    const termAlpha = round3(PARAMS.alpha)
    const termBeta1 = round3(PARAMS.beta1 * pmv_iso)
    const termBeta2 = round3(trunc3(PARAMS.beta2 * exp_raw))
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
    const scale_used = round3(scale_raw)
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

  // =========================================
  // ✅ OLah/Hitung SEKALIGUS:
  // PMV ISO -> PMV_pre -> PMV_norm
  // =========================================
  const handleCalculate = () => {
    setErrors('')

    // 1) PMV ISO (alur gambar)
    let iso: PMVIsoPPDResult
    try {
      iso = calculatePMVIsoFromAshrae55(ashrae55)
      setPmvIsoResult(iso)
      setInputs(prev => ({ ...prev, pmv_iso: iso.pmv }))
    } catch (error: any) {
      setErrors(error.message)
      setPmvIsoResult(null)
      setResults(null)
      return
    }

    // 2) PMVpesisir + normalisasi (dokumen)
    try {
      const v = Number(ashrae55.v_air) // ✅ v tunggal (sesuai gambar)
      const svf = Number(inputs.svf)
      const h_w = Number(inputs.h_w)
      const veg_func = Number(inputs.veg_func)
      const u_site = Number(inputs.u_site)
      const u_jam = Number(inputs.u_jam)
      const epsilon = Number(inputs.epsilon)
      const pmv_obs_ref = Number(inputs.pmv_obs_ref)
      const pmv_model_ref = Number(inputs.pmv_model_ref)

      const result = calculatePMVAbran(
        iso.pmv,
        v,
        svf,
        h_w,
        veg_func,
        u_site,
        u_jam,
        epsilon,
        inputs.normalize,
        pmv_obs_ref,
        pmv_model_ref
      )
      setResults(result)
    } catch (error: any) {
      setErrors(error.message)
      setResults(null)
    }
  }

  const handleLoadDefaults = () => {
    setErrors('')
    setInputs(DEFAULT_VALUES)
    setAshrae55(ASHRAE_DEFAULT_VALUES)

    try {
      const iso = calculatePMVIsoFromAshrae55(ASHRAE_DEFAULT_VALUES)
      setPmvIsoResult(iso)
      setInputs(prev => ({ ...prev, pmv_iso: iso.pmv }))

      const result = calculatePMVAbran(
        iso.pmv,
        Number(ASHRAE_DEFAULT_VALUES.v_air),
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
      setPmvIsoResult(null)
    }
  }

  // ✅ Skala Persepsi untuk hasil model (PMV_pre/PMV_norm)
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

  // Step-by-step PMVpesisir
  const docStepLines = useMemo(() => {
    if (!results) return null

    const pmvIsoVal = pmvIsoResult ? pmvIsoResult.pmv : Number(inputs.pmv_iso || 0)
    const pmvIso2 = Number(pmvIsoVal).toFixed(2)

    const exp3 = Number(results.expfactor_used).toFixed(3)
    const v_used = Number(ashrae55.v_air || 0)
    const svf2 = Number((Number(inputs.svf || 0) * v_used)).toFixed(2)
    const veg0 = Number(inputs.veg_func || 0).toFixed(0)

    const line1 = [
      `PMV_pesisir = ${PARAMS.alpha.toFixed(3)}`,
      `+ ${PARAMS.beta1.toFixed(4)} (${pmvIso2})`,
      `+ ${PARAMS.beta2.toFixed(3)} (${exp3})`,
      `− ${Math.abs(PARAMS.beta3).toFixed(3)} (${svf2})`,
      `− ${Math.abs(PARAMS.beta4).toFixed(3)} (${veg0})`,
    ].join(' ')

    const parts: string[] = []
    parts.push(`${Number(results.terms.alpha).toFixed(3)}`)
    parts.push(`${Number(results.terms.beta1).toFixed(3)}`)
    parts.push(`${Number(results.terms.beta2).toFixed(3)}`)

    const b3 = Number(results.terms.beta3)
    if (Math.abs(b3) > 0) parts.push(`− ${Math.abs(b3).toFixed(3)}`)

    const b4 = Number(results.terms.beta4)
    if (Math.abs(b4) > 0) parts.push(`− ${Math.abs(b4).toFixed(3)}`)

    const line2 = `= ${parts.join(' + ').replace(/\+ −/g, '− ')}`

    const line3 = `= ${Number(results.preTotal).toFixed(3)}`

    return [line1, line2, line3]
  }, [results, inputs, pmvIsoResult, ashrae55.v_air])

  // Breakdown chart (PMVpesisir)
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

  const svgToPngDataUrl = async (svgText: string, width: number, height: number, scale = 2): Promise<string> => {
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

  // ====== PDF (tetap ada, tidak dihapus) ======
  const handleDownloadPDF = async () => {
    if (!pmvIsoResult && !results) return

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

    const now = new Date()
    const dateStr = now.toLocaleString()

    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
    doc.text("THERMAL COMFORT ENVIRONMENT", marginX, y); y += 18

    doc.setFontSize(12)
    doc.text("HASIL ANALISIS KALKULASI PMV ISO + PMVpesisir", marginX, y); y += 16

    doc.setFont("helvetica", "normal")
    doc.setFontSize(10)
    doc.text(`Tanggal/Jam: ${dateStr}`, marginX, y); y += 12
    hr()

    write("INPUT PMV ISO (sesuai gambar)", { bold: true, size: 12 })
    hr()
    writeKV("Ta / tdb (°C)", String(ashrae55.tdb))
    writeKV("RH (%)", String(ashrae55.rh))
    writeKV("v (m/s)", String(ashrae55.v_air))
    writeKV("Tr (°C)", String(ashrae55.tr))
    writeKV("clo", String(ashrae55.clo))
    writeKV("met", String(ashrae55.met))
    hr()

    write("HASIL PMV ISO", { bold: true, size: 12 })
    hr()
    if (pmvIsoResult) {
      writeKV("PMV", pmvIsoResult.pmv.toFixed(2))
      writeKV("PPD (%)", pmvIsoResult.ppd.toFixed(1))
      writeKV("Sensasi (TSV)", pmvIsoResult.tsv)
      writeKV("v_relative", pmvIsoResult.v_r.toFixed(3))
      writeKV("clo_dynamic", pmvIsoResult.clo_d.toFixed(3))
    } else {
      write("PMV ISO tidak tersedia.")
    }
    hr()

    write("INPUT PMVpesisir + Normalisasi", { bold: true, size: 12 })
    hr()
    writeKV("SVF", String(inputs.svf))
    writeKV("H/W", String(inputs.h_w))
    writeKV("veg_func", String(inputs.veg_func))
    writeKV("u_site", String(inputs.u_site))
    writeKV("u_jam", String(inputs.u_jam))
    writeKV("epsilon", String(inputs.epsilon))
    writeKV("normalisasi", inputs.normalize ? "ON" : "OFF")
    writeKV("PMV_obs_ref", String(inputs.pmv_obs_ref))
    writeKV("PMV_model_ref", String(inputs.pmv_model_ref))
    hr()

    if (results) {
      write("HASIL MODEL", { bold: true, size: 12 })
      hr()
      writeKV("PMV_pre", Number(results.preTotal).toFixed(3))
      writeKV("TOTAL", Number(results.total).toFixed(3))
    }

    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.text("© Thermal Comfort Environment", marginX, pageH - 28)

    const date = new Date().toISOString().slice(0, 10)
    doc.save(`Hasil-Analisis-PMV-${date}.pdf`)
  }

  useEffect(() => {
    setInputs(INITIAL_VALUES)
    setAshrae55(ASHRAE_INITIAL_VALUES)
    setResults(null)
    setPmvIsoResult(null)
    setErrors('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dotX = useMemo(() => {
    if (!results) return "Total PMVpesisir"
    return results.normalization ? "PMV_norm" : "Total PMVpesisir"
  }, [results])

  // ===========================
  // UI helper: kotak input seperti gambar
  // ===========================
  const ParamBox = (props: {
    title: string
    value: number | ''
    onChange: (v: string) => void
    placeholder?: string
    unit: string
    step?: string
    id: string
  }) => {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-800">{props.title}</p>
        <div className="flex border border-slate-300 rounded-md overflow-hidden bg-white">
          <Input
            id={props.id}
            type="number"
            step={props.step ?? "0.1"}
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            placeholder={props.placeholder}
            className="border-0 rounded-none focus-visible:ring-0"
          />
          <div className="px-3 flex items-center border-l border-slate-300 bg-slate-50 text-slate-800 font-semibold">
            {props.unit}
          </div>
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">
            <span className="text-blue-900">Thermal Comfort Environment</span>
          </h1>
          <p className="text-slate-600">
            Alur sesuai gambar: Ta, RH, v, Tr, clo, met → Olah → Nilai PMV → Sensasi. (Sekaligus dihitung PMVpesisir + Normalisasi)
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

              {/* ✅ UI PMV ISO SESUAI GAMBAR */}
              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
                <p className="text-sm font-semibold text-slate-900">
                  INPUT PMV (ISO 7730 / ASHRAE 55) — UI sesuai gambar
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <ParamBox
                    id="ta"
                    title="Temperature (Ta)"
                    value={ashrae55.tdb}
                    onChange={(v) => handleAshraeChange('tdb', v)}
                    placeholder="25"
                    unit="°C"
                    step="0.1"
                  />
                  <ParamBox
                    id="rh"
                    title="Relative Humidity (RH)"
                    value={ashrae55.rh}
                    onChange={(v) => handleAshraeChange('rh', v)}
                    placeholder="50"
                    unit="%"
                    step="1"
                  />
                  <ParamBox
                    id="v"
                    title="Wind speed (v)"
                    value={ashrae55.v_air}
                    onChange={(v) => setWindSpeed(v)}
                    placeholder="0.10 / 3.20"
                    unit="m/s"
                    step="0.01"
                  />
                  <ParamBox
                    id="tr"
                    title="Mean Radiant Temperature (Tr)"
                    value={ashrae55.tr}
                    onChange={(v) => handleAshraeChange('tr', v)}
                    placeholder="25"
                    unit="°C"
                    step="0.1"
                  />
                  <ParamBox
                    id="clo"
                    title="Clothing (insulasi pakaian)"
                    value={ashrae55.clo}
                    onChange={(v) => handleAshraeChange('clo', v)}
                    placeholder="0.50"
                    unit="clo"
                    step="0.01"
                  />
                  <ParamBox
                    id="met"
                    title="Metabolic Rate (M)"
                    value={ashrae55.met}
                    onChange={(v) => handleAshraeChange('met', v)}
                    placeholder="1.2"
                    unit="met"
                    step="0.1"
                  />
                </div>

                {/* Olah -> Nilai PMV -> Sensasi (sesuai gambar) */}
                <div className="mt-2 flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
                  <Button onClick={handleCalculate} className="bg-blue-600 hover:bg-blue-700 text-white lg:w-40">
                    Olah / Hitung
                  </Button>

                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-md border border-slate-300 bg-blue-600 text-white p-3">
                      <p className="text-xs font-semibold opacity-90">Nilai PMV</p>
                      <p className="text-2xl font-bold font-mono mt-1">
                        {pmvIsoResult ? pmvIsoResult.pmv.toFixed(2) : "—"}
                      </p>
                    </div>
                    <div className="rounded-md border border-slate-300 bg-blue-600 text-white p-3">
                      <p className="text-xs font-semibold opacity-90">Sensasi</p>
                      <p className="text-2xl font-bold font-mono mt-1">
                        {pmvIsoResult ? pmvIsoResult.tsv : "—"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Info tambahan (tidak mengganggu UI gambar) */}
                <div className="text-xs text-slate-600 mt-1">
                  {pmvIsoResult ? (
                    <div className="flex flex-wrap gap-x-6 gap-y-1">
                      <span>PPD: <b>{pmvIsoResult.ppd.toFixed(1)}%</b></span>
                      <span>v_relative: <b>{pmvIsoResult.v_r.toFixed(3)}</b></span>
                      <span>clo_dynamic: <b>{pmvIsoResult.clo_d.toFixed(3)}</b></span>
                    </div>
                  ) : (
                    <span>Isi semua parameter PMV ISO lalu klik Olah.</span>
                  )}
                </div>
              </div>

              {/* ✅ INPUT PARAMETER PMVpesisir (tetap ada, tidak dihilangkan) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                {/* PMV ISO (read-only) */}
                <div className="space-y-2">
                  <Label htmlFor="pmv_iso" className="text-sm font-medium text-slate-700">
                    PMV_iso (otomatis dari Olah)
                  </Label>
                  <Input
                    id="pmv_iso"
                    type="number"
                    step="0.01"
                    value={pmvIsoResult ? pmvIsoResult.pmv : inputs.pmv_iso}
                    readOnly
                    placeholder="—"
                  />
                </div>

                {/* v sinkron (read-only) */}
                <div className="space-y-2">
                  <Label htmlFor="v_sync" className="text-sm font-medium text-slate-700">
                    v (sinkron dari input PMV ISO)
                  </Label>
                  <Input
                    id="v_sync"
                    type="number"
                    step="0.01"
                    value={ashrae55.v_air}
                    readOnly
                    placeholder="—"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

                <div className="space-y-2">
                  <Label htmlFor="svf" className="text-sm font-medium text-slate-700">
                    (β₃) Sky View Factor (SVF)
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

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="veg_func" className="text-sm font-medium text-slate-700">
                    (β₄) Vegetasi Function (veg_func)
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
                    <Label htmlFor="u_site" className="text-sm font-medium text-slate-700">u_site</Label>
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
                    <Label htmlFor="u_jam" className="text-sm font-medium text-slate-700">u_jam</Label>
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
                    <Label htmlFor="epsilon" className="text-sm font-medium text-slate-700">ε</Label>
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

              {/* Normalisasi — ✅ aktifkan pmv_model_ref */}
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
                      PMV Observasi Lapangan (PMV_obs_ref)
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

                  <div className="space-y-2">
                    <Label htmlFor="pmv_model_ref" className="text-sm font-medium text-slate-700">
                      PMV Model Referensi (PMV_model_ref)
                    </Label>
                    <Input
                      id="pmv_model_ref"
                      type="number"
                      step="0.001"
                      value={inputs.pmv_model_ref}
                      onChange={(e) => handleNumberChange('pmv_model_ref', e.target.value)}
                      placeholder="1.085"
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
                <Button onClick={handleLoadDefaults} variant="outline" className="flex-1 bg-transparent">
                  Muat Nilai Default
                </Button>
                <Button onClick={handleCalculate} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white">
                  Hitung Sekaligus
                </Button>
              </div>

              {/* Parameter Koefisien Model */}
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
            {(pmvIsoResult || results) ? (
              <Card>
                <CardHeader className="bg-green-50 border-b border-green-200">
                  <CardTitle className="text-green-700">✓ Hasil Perhitungan</CardTitle>
                </CardHeader>

                <CardContent className="pt-6">
                  {/* Tahap 1: PMV ISO */}
                  {pmvIsoResult && (
                    <div className="mb-4 p-4 rounded-lg border border-slate-200 bg-white">
                      <p className="text-sm font-semibold text-slate-900 mb-2">
                        Tahap 1 — PMV ISO (sesuai gambar)
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-slate-600">PMV</span>
                          <span className="font-mono font-semibold text-blue-700">{pmvIsoResult.pmv.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">PPD (%)</span>
                          <span className="font-mono font-semibold text-blue-700">{pmvIsoResult.ppd.toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between sm:col-span-2">
                          <span className="text-slate-600">Sensasi (TSV)</span>
                          <span className="font-mono font-semibold text-blue-700">{pmvIsoResult.tsv}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Tahap 2/3: PMVpesisir */}
                  {results ? (
                    <>
                      <div className="mb-4 p-6 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg border border-blue-200">
                        <p className="text-xs text-blue-600 tracking-wide font-semibold mb-2">
                          PMVpesisir {results.normalization ? "(PMV_norm)" : "(PMV_pre)"}
                        </p>
                        <p className="text-5xl font-bold text-blue-700">
                          {Number(results.total).toFixed(3)}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          PMV_pre = {Number(results.preTotal).toFixed(3)} {results.normalization ? `→ dinormalisasi` : ``}
                        </p>
                      </div>

                      {docStepLines && (
                        <div className="mb-4 p-4 rounded-lg border border-slate-200 bg-white">
                          <p className="text-sm font-semibold text-slate-900 mb-2">Step-by-step (sesuai dokumen)</p>
                          <pre className="text-xs font-mono whitespace-pre-wrap text-slate-700">
                            {docStepLines.join('\n')}
                          </pre>
                          <p className="mt-2 text-[11px] text-slate-500">
                            *Catatan: β₂ menggunakan TRUNC 3 desimal (sesuai dokumen).
                          </p>
                        </div>
                      )}

                      {results.normalization && (
                        <div className="mb-4 p-4 rounded-lg border border-slate-200 bg-white">
                          <p className="text-sm font-semibold text-slate-900 mb-2">
                            Normalisasi (skala relatif)
                          </p>

                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-600">Skala</span>
                            <span className="font-mono font-semibold text-blue-700">
                              {Number(results.normalization.scale_used).toFixed(3)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-sm mt-1">
                            <span className="text-slate-600">PMV_obs_ref</span>
                            <span className="font-mono font-semibold text-blue-700">
                              {Number(results.normalization.pmv_obs_ref).toFixed(2)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-sm mt-1">
                            <span className="text-slate-600">PMV_norm</span>
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
                    </>
                  ) : (
                    <div className="p-4 rounded-lg border border-slate-200 bg-white">
                      <p className="text-sm text-slate-600">
                        PMV ISO sudah dihitung. Lengkapi parameter PMVpesisir (SVF, H/W, veg_func, dst) lalu klik Hitung Sekaligus.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-8 pb-8">
                  <div className="text-center">
                    <p className="text-slate-500 mb-4">
                      Masukkan parameter dan klik "Olah / Hitung"
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

        {/* Distribusi PMV (PMVpesisir) */}
        {results && (
          <div className="mt-6">
            <Card>
              <CardHeader className="border-b bg-white">
                <CardTitle className="text-lg">Distribusi PMV</CardTitle>
                <CardDescription>
                  Batang = komponen PMVpesisir, garis = akumulasi. Jika normalisasi aktif, titik PMV_norm ditampilkan sebagai titik terakhir.
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
                    Catatan: PMV_norm = PMV_obs_ref × (PMV_model / PMV_model_ref).
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
                      PMV ISO • PMVpesisir • PMV_norm
                    </p>
                  </div>
                </div>

                <p className="mt-4 text-sm text-slate-600 leading-relaxed">
                  Aplikasi untuk menghitung PMV ISO (sesuai gambar) dan PMVpesisir (model + normalisasi skala relatif).
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

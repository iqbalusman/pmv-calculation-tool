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

/**
 * ✅ Semua field input disimpan sebagai STRING
 * Parsing (koma->titik) dilakukan saat tombol "Hitung".
 */
type Inputs = {
  pmv_iso: string
  v: string

  svf: string
  h_w: string
  veg_func: string
  u_site: string
  u_jam: string
  epsilon: string

  normalize: boolean
  pmv_obs_ref: string
  pmv_model_ref: string
}

type Ashrae55Inputs = {
  tdb: string
  tr: string
  rh: string
  met: string
  clo: string
  v_air: string
  wme: string
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
    factor_raw: number
    factor_used: number
  }
  total: number
}

/** ✅ DIPINDAH KE LUAR (biar input tidak re-mount tiap render) */
function ParamBox(props: {
  title: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  unit: string
  step?: string
  id: string
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-slate-800">{props.title}</p>
      <div className="flex border border-slate-300 rounded-md overflow-hidden bg-white">
        <Input
          id={props.id}
          type="text"
          inputMode="decimal"
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

/** ✅ DIPINDAH KE LUAR (stabil) */
function VegFuncMark() {
  return (
    <span className="inline-flex items-baseline">
      <span className="tracking-wide font-semibold">VEG</span>
      <span className="text-xs ml-[1px]">func</span>
    </span>
  )
}

export default function ThermalComfortCalculator() {
  // Koefisien model (sesuai dokumen)
  const PARAMS = {
    alpha: 0.225,
    beta1: 0.0774,
    beta2: 7.379,
    beta3: -0.385,
    beta4: -0.098,
    k: 0.3,
    alphaV: 0.5,
  }

  // ✅ Default pakai string
  const DEFAULT_VALUES: Inputs = {
    pmv_iso: "0.60",
    v: "3.2",
    svf: "0.55",
    h_w: "0.923",
    veg_func: "1",
    u_site: "0",
    u_jam: "0",
    epsilon: "0",
    normalize: true,
    pmv_obs_ref: "-0.61",
    pmv_model_ref: "1.085",
  }

  const ASHRAE_DEFAULT_VALUES: Ashrae55Inputs = {
    tdb: "25",
    tr: "25",
    rh: "50",
    met: "1.2",
    clo: "0.5",
    v_air: "3.2",
    wme: "0",
  }

  const INITIAL_VALUES: Inputs = {
    pmv_iso: "",
    v: "",
    svf: "",
    h_w: "",
    veg_func: "",
    u_site: "0",
    u_jam: "0",
    epsilon: "0",
    normalize: true,
    pmv_obs_ref: "-0.61",
    pmv_model_ref: "1.085",
  }

  const ASHRAE_INITIAL_VALUES: Ashrae55Inputs = {
    tdb: "",
    tr: "",
    rh: "",
    met: "",
    clo: "",
    v_air: "",
    wme: "0",
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
  // ✅ Parser angka (support koma)
  // ===========================
  const toNumOrZero = (s: string) => {
    const t = (s ?? "").trim().replace(',', '.')
    const n = Number(t)
    return Number.isFinite(n) ? n : 0
  }

  const mustNumber = (s: string, name: string) => {
    const t = (s ?? "").trim().replace(',', '.')
    if (t === '' || t === '-' || t === '.' || t === '-.') throw new Error(`${name} harus diisi angka`)
    const n = Number(t)
    if (!Number.isFinite(n)) throw new Error(`${name} harus angka valid`)
    return n
  }

  const optionalNumber = (s: string, name: string, def = 0) => {
    const t = (s ?? "").trim().replace(',', '.')
    if (t === '') return def
    const n = Number(t)
    if (!Number.isFinite(n)) throw new Error(`${name} harus angka valid`)
    return n
  }

  // ===========================
  // Sync v (1 v untuk semuanya) — simpan string
  // ===========================
  const setWindSpeed = (value: string) => {
    setAshrae55(prev => ({ ...prev, v_air: value }))
    setInputs(prev => ({ ...prev, v: value }))
  }

  // ✅ handler hanya simpan string (tidak parseFloat di sini)
  const handleNumberChange = (key: Exclude<keyof Inputs, 'normalize'>, value: string) => {
    setInputs(prev => ({ ...prev, [key]: value }))
  }

  const handleAshraeChange = (key: keyof Ashrae55Inputs, value: string) => {
    setAshrae55(prev => ({ ...prev, [key]: value }))
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

    // ✅ TSV Bahasa Indonesia
    const tsvMap = [
      { t: -2.5, l: "Sangat Dingin" },
      { t: -1.5, l: "Dingin" },
      { t: -0.5, l: "Agak Dingin" },
      { t: 0.5,  l: "Netral" },
      { t: 1.5,  l: "Agak Panas" },
      { t: 2.5,  l: "Panas" },
    ]
    let tsv = "Sangat Panas"
    for (const it of tsvMap) {
      if (pmv < it.t) {
        tsv = it.l
        break
      }
    }

    return { pmv, ppd, tsv }
  }

  const calculatePMVIsoFromAshrae55 = (a: Ashrae55Inputs): PMVIsoPPDResult => {
    const tdb = mustNumber(a.tdb, "Ta/tdb")
    const tr = mustNumber(a.tr, "Tr")
    const rh = mustNumber(a.rh, "RH")
    const met = mustNumber(a.met, "met")
    const clo = mustNumber(a.clo, "clo")
    const v_air = mustNumber(a.v_air, "v")
    const wme = optionalNumber(a.wme, "wme", 0)

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

  /**
   * ✅ PMVpesisir sesuai dokumen:
   * - exp = e^{-k(H/W + αv·v)} dibulatkan 3 desimal (exp_used)
   * - komponen β2 = TRUNC3(β2 * exp_used)
   * Normalisasi:
   * PMV_norm = PMV_pre × (PMV_obs_ref / PMV_model_ref)
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
      throw new Error('Input PMVpesisir/Normalisasi harus angka semua (SVF, H/W, VEGfunc, dst)')
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

    const termBeta2 = trunc3(PARAMS.beta2 * exp_used)

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
        expfactor_used: round3(exp_used),
        SVFv,
        terms: {
          alpha: termAlpha,
          beta1: termBeta1,
          beta2: round3(termBeta2),
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

    const factor_raw = pmv_obs_ref / pmv_model_ref
    const factor_used = round3(factor_raw)
    const total = round3(preTotal * factor_used)

    return {
      A: round3(A),
      exponent: round3(exponent),
      expfactor_raw: round3(exp_raw),
      expfactor_used: round3(exp_used),
      SVFv,
      terms: {
        alpha: termAlpha,
        beta1: termBeta1,
        beta2: round3(termBeta2),
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
        factor_raw: round3(factor_raw),
        factor_used,
      },
      total,
    }
  }

  // =========================================
  // Hitung sekaligus
  // =========================================
  const handleCalculate = () => {
    setErrors('')

    let iso: PMVIsoPPDResult
    try {
      iso = calculatePMVIsoFromAshrae55(ashrae55)
      setPmvIsoResult(iso)
      setInputs(prev => ({ ...prev, pmv_iso: iso.pmv.toFixed(2) }))
    } catch (error: any) {
      setErrors(error.message)
      setPmvIsoResult(null)
      setResults(null)
      return
    }

    try {
      const v = mustNumber(ashrae55.v_air, "v")
      const svf = mustNumber(inputs.svf, "SVF")
      const h_w = mustNumber(inputs.h_w, "H/W")
      const veg_func = mustNumber(inputs.veg_func, "VEGfunc")

      const u_site = optionalNumber(inputs.u_site, "u_site", 0)
      const u_jam = optionalNumber(inputs.u_jam, "u_jam", 0)
      const epsilon = optionalNumber(inputs.epsilon, "epsilon", 0)

      const pmv_obs_ref = mustNumber(inputs.pmv_obs_ref, "PMV_obs_ref")
      const pmv_model_ref = mustNumber(inputs.pmv_model_ref, "PMV_model_ref")

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
      setInputs(prev => ({ ...prev, pmv_iso: iso.pmv.toFixed(2) }))

      const result = calculatePMVAbran(
        iso.pmv,
        mustNumber(ASHRAE_DEFAULT_VALUES.v_air, "v"),
        mustNumber(DEFAULT_VALUES.svf, "SVF"),
        mustNumber(DEFAULT_VALUES.h_w, "H/W"),
        mustNumber(DEFAULT_VALUES.veg_func, "VEGfunc"),
        optionalNumber(DEFAULT_VALUES.u_site, "u_site", 0),
        optionalNumber(DEFAULT_VALUES.u_jam, "u_jam", 0),
        optionalNumber(DEFAULT_VALUES.epsilon, "epsilon", 0),
        Boolean(DEFAULT_VALUES.normalize),
        mustNumber(DEFAULT_VALUES.pmv_obs_ref, "PMV_obs_ref"),
        mustNumber(DEFAULT_VALUES.pmv_model_ref, "PMV_model_ref"),
      )
      setResults(result)
    } catch (error: any) {
      setErrors(error.message)
      setResults(null)
      setPmvIsoResult(null)
    }
  }

  // Skala persepsi PMVpesisir
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

    const pmvIso2 = (pmvIsoResult ? pmvIsoResult.pmv : toNumOrZero(inputs.pmv_iso)).toFixed(2)
    const exp3 = Number(results.expfactor_used).toFixed(3)

    const v_used = toNumOrZero(ashrae55.v_air)
    const svf2 = (toNumOrZero(inputs.svf) * v_used).toFixed(2)
    const veg0 = toNumOrZero(inputs.veg_func).toFixed(0)

    const line1 = [
      `PMV_pesisir = ${PARAMS.alpha.toFixed(3)}`,
      `+ ${PARAMS.beta1.toFixed(4)} (${pmvIso2})`,
      `+ ${PARAMS.beta2.toFixed(3)} (${exp3})`,
      `− ${Math.abs(PARAMS.beta3).toFixed(3)} (${svf2})`,
      `− ${Math.abs(PARAMS.beta4).toFixed(3)} (${veg0})`,
      `+ u_site + u_jam + ε`,
    ].join(' ')

    const parts: string[] = []
    parts.push(`${Number(results.terms.alpha).toFixed(3)}`)
    parts.push(`${Number(results.terms.beta1).toFixed(3)}`)
    parts.push(`${Number(results.terms.beta2).toFixed(3)}`)

    const b3 = Number(results.terms.beta3)
    if (Math.abs(b3) > 0) parts.push(`− ${Math.abs(b3).toFixed(3)}`)

    const b4 = Number(results.terms.beta4)
    if (Math.abs(b4) > 0) parts.push(`− ${Math.abs(b4).toFixed(3)}`)

    const us = Number(results.terms.u_site)
    if (Math.abs(us) > 0) parts.push(`${us >= 0 ? '+ ' : '− '}${Math.abs(us).toFixed(3)}`)

    const uj = Number(results.terms.u_jam)
    if (Math.abs(uj) > 0) parts.push(`${uj >= 0 ? '+ ' : '− '}${Math.abs(uj).toFixed(3)}`)

    const ep = Number(results.terms.epsilon)
    if (Math.abs(ep) > 0) parts.push(`${ep >= 0 ? '+ ' : '− '}${Math.abs(ep).toFixed(3)}`)

    const line2 = `= ${parts.join(' + ').replace(/\+ −/g, '− ').replace(/\+ \+/g, '+ ')}`
    const line3 = `= ${Number(results.preTotal).toFixed(3)}`

    const normLines: string[] = []
    if (results.normalization) {
      normLines.push(
        `Faktor = PMV_obs_ref / PMV_model_ref = ${Number(results.normalization.pmv_obs_ref).toFixed(2)} / ${Number(results.normalization.pmv_model_ref).toFixed(3)} = ${Number(results.normalization.factor_used).toFixed(3)}`
      )
      normLines.push(
        `PMV_norm = PMV_pre × Faktor = ${Number(results.preTotal).toFixed(3)} × ${Number(results.normalization.factor_used).toFixed(3)} = ${Number(results.total).toFixed(3)}`
      )
    }

    return [line1, line2, line3, ...normLines]
  }, [results, inputs, pmvIsoResult, ashrae55.v_air])

  // Breakdown chart
  const breakdownData = useMemo(() => {
    if (!results) return []

    const terms = [
      { name: 'α', component: Number(results.terms.alpha) },
      { name: 'β₁·PMVᵢₛₒ', component: Number(results.terms.beta1) },
      { name: 'β₂·e^{-k(H/W+αᵥv)}', component: Number(results.terms.beta2) },
      { name: 'β₃·(SVF·v)', component: Number(results.terms.beta3) },
      { name: 'β₄·VEGfunc', component: Number(results.terms.beta4) },
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
      name: 'Total PMV_pre',
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

  // ====== Export Grafik ======
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

  // ====== PDF ======
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

    const dateStr = new Date().toLocaleString()

    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
    doc.text("THERMAL COMFORT ENVIRONMENT", marginX, y); y += 18

    doc.setFontSize(12)
    doc.text("HASIL ANALISIS KALKULASI PMV ISO + PMVpesisir", marginX, y); y += 16

    doc.setFont("helvetica", "normal")
    doc.setFontSize(10)
    doc.text(`Tanggal/Jam: ${dateStr}`, marginX, y); y += 12
    hr()

    write("INPUT PMV ISO (sesuai alur)", { bold: true, size: 12 })
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
    writeKV("α (intersep)", String(PARAMS.alpha))
    writeKV("SVF", String(inputs.svf))
    writeKV("H/W", String(inputs.h_w))
    writeKV("VEGfunc", String(inputs.veg_func))
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
      if (results.normalization) {
        writeKV("Faktor (obs/model_ref)", Number(results.normalization.factor_used).toFixed(3))
        writeKV("PMV_norm", Number(results.total).toFixed(3))
      } else {
        writeKV("TOTAL", Number(results.total).toFixed(3))
      }
      writeKV("exp (3 desimal)", Number(results.expfactor_used).toFixed(3))
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
    if (!results) return "Total PMV_pre"
    return results.normalization ? "PMV_norm" : "Total PMV_pre"
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
            PMVpesisir adalah Model adaptif-kontekstual untuk ruang luar permukiman pesisir (Outdoor Thermal Comfort)
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

              {/* PMV ISO */}
              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
                <p className="text-sm font-semibold text-slate-900">
                  INPUT PMV (ISO 7730 / ASHRAE 55)
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
                    placeholder="0,10 / 3,20"
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
                    placeholder="0,50"
                    unit="clo"
                    step="0.01"
                  />
                  <ParamBox
                    id="met"
                    title="Metabolic Rate (M)"
                    value={ashrae55.met}
                    onChange={(v) => handleAshraeChange('met', v)}
                    placeholder="1,2"
                    unit="met"
                    step="0.1"
                  />
                </div>

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

              {/* PMVpesisir — alur dokumen */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                <div className="space-y-2">
                  <Label htmlFor="alpha_const" className="text-sm font-medium text-slate-700">
                    Alfa (α)
                  </Label>
                  <Input
                    id="alpha_const"
                    type="text"
                    inputMode="decimal"
                    value={String(PARAMS.alpha)}
                    readOnly
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="beta1_pmv" className="text-sm font-medium text-slate-700">
                    β₁·PMVᵢₛₒ
                  </Label>
                  <Input
                    id="beta1_pmv"
                    type="text"
                    inputMode="decimal"
                    value={results ? Number(results.terms.beta1).toFixed(3) : "—"}
                    readOnly
                    placeholder="—"
                  />
                </div>
              </div>

              {/* Panel transparansi komponen eksponensial (disembunyikan tapi tetap jalan) */}
              {results && (
  <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
    <p className="text-sm font-semibold text-slate-900">Komponen Eksponensial</p>

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="space-y-2">
        <Label className="text-sm font-medium text-slate-700">αᵥ (konstanta)</Label>
        <Input readOnly value={String(PARAMS.alphaV)} />
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium text-slate-700">V (sinkron dari PMV ISO)</Label>
        <Input readOnly value={ashrae55.v_air === "" ? "—" : ashrae55.v_air} />
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium text-slate-700">
          {`e^{-k(H/W + αᵥ·V)} (3 desimal)`}
        </Label>
        <Input readOnly value={Number(results.expfactor_used).toFixed(3)} />
      </div>
    </div>

    <p className="text-[11px] text-slate-500">
      Catatan dokumen: β₂·exp dihitung dari exp (3 desimal), lalu hasilnya di-TRUNC 3 desimal.
    </p>
  </div>
)}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="h_w" className="text-sm font-medium text-slate-700">
                    (β₂) Rasio H/W
                  </Label>
                  <Input
                    id="h_w"
                    type="text"
                    inputMode="decimal"
                    value={inputs.h_w}
                    onChange={(e) => handleNumberChange('h_w', e.target.value)}
                    placeholder="0,923"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="svf" className="text-sm font-medium text-slate-700">
                    (β₃) Sky View Factor (SVF)
                  </Label>
                  <Input
                    id="svf"
                    type="text"
                    inputMode="decimal"
                    value={inputs.svf}
                    onChange={(e) => handleNumberChange('svf', e.target.value)}
                    placeholder="0,55"
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="veg_func" className="text-sm font-medium text-slate-700">
                    (β₄) Vegetasi Function (<VegFuncMark />)
                  </Label>
                  <Input
                    id="veg_func"
                    type="text"
                    inputMode="decimal"
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
                      type="text"
                      inputMode="decimal"
                      value={inputs.u_site}
                      onChange={(e) => handleNumberChange('u_site', e.target.value)}
                      placeholder="0"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="u_jam" className="text-sm font-medium text-slate-700">u_jam</Label>
                    <Input
                      id="u_jam"
                      type="text"
                      inputMode="decimal"
                      value={inputs.u_jam}
                      onChange={(e) => handleNumberChange('u_jam', e.target.value)}
                      placeholder="0"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="epsilon" className="text-sm font-medium text-slate-700">ε</Label>
                    <Input
                      id="epsilon"
                      type="text"
                      inputMode="decimal"
                      value={inputs.epsilon}
                      onChange={(e) => handleNumberChange('epsilon', e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>

              {/* Normalisasi */}
              {false && (
  <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
    <div className="flex items-center justify-between">
      <p className="text-sm font-semibold text-slate-900">Normalisasi (Kalibrasi ke Observasi)</p>

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
          Observasi Lapangan (PMV_obs_ref)
        </Label>
        <Input
          id="pmv_obs_ref"
          type="text"
          inputMode="decimal"
          value={inputs.pmv_obs_ref}
          onChange={(e) => handleNumberChange('pmv_obs_ref', e.target.value)}
          placeholder="-0,61"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="pmv_model_ref" className="text-sm font-medium text-slate-700">
          Model Referensi (PMV_model_ref)
        </Label>
        <Input
          id="pmv_model_ref"
          type="text"
          inputMode="decimal"
          value={inputs.pmv_model_ref}
          onChange={(e) => handleNumberChange('pmv_model_ref', e.target.value)}
          placeholder="1,085"
        />
      </div>
    </div>

    <p className="text-[11px] text-slate-500">
      Rumus: PMV_norm = PMV_pre × (PMV_obs_ref / PMV_model_ref)
    </p>
  </div>
)}


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
                  Normalisasi: <b>{inputs.normalize ? "ON" : "OFF"}</b>
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
                        Tahap 1 — PMV ISO
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
    PMVpesisir (PMV_pre)
  </p>

  <p className="text-5xl font-bold text-blue-700">
    {Number(results.preTotal).toFixed(3)}
  </p>
</div>


                      {docStepLines && (
                        <div className="mb-4 p-4 rounded-lg border border-slate-200 bg-white">
                          <p className="text-sm font-semibold text-slate-900 mb-2">Step-by-step (sesuai dokumen)</p>
                          <pre className="text-xs font-mono whitespace-pre-wrap text-slate-700">
                            {docStepLines.join('\n')}
                          </pre>
                          <p className="mt-2 text-[11px] text-slate-500">
                            *Catatan: β₂·exp memakai exp (3 desimal), lalu hasil kali di-TRUNC 3 desimal (sesuai dokumen).
                          </p>
                        </div>
                      )}

{results.normalization && (
  <div className="mb-4 p-4 rounded-lg border border-slate-200 bg-white">
    <p className="text-sm font-semibold text-slate-900 mb-2">
      Normalisasi (Kalibrasi)
    </p>

    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">PMVpesisir (Hasil Persamaan/Model)</span>
      <span className="font-mono font-semibold text-blue-700">
        = {Number(results.preTotal).toFixed(3)}
      </span>
    </div>

    <div className="flex items-center justify-between text-sm mt-1">
      <span className="text-slate-600">PMVpesisir (Normalisasi)</span>
      <span className="font-mono font-semibold text-blue-700">
        = {Number(results.normalization.pmv_obs_ref).toFixed(2)}
      </span>
    </div>

    <div className="flex items-center justify-between text-sm mt-1">
      <span className="text-slate-600">PMVpesisir</span>
      <span className="font-mono font-semibold text-blue-700">
        = {Number(results.total).toFixed(3)}
      </span>
    </div>
  </div>
)}



{perception && (
  <div className="mb-4 p-4 rounded-lg border border-slate-200 bg-white">
    <p className="text-sm font-semibold text-slate-900 mb-2">
      Kategori PMVpesisir
    </p>

    <div className="flex flex-col gap-1">
      <span className="text-4xl font-bold font-mono text-blue-700 leading-none">
        {Number(results.total).toFixed(3)}
      </span>

      <p className="text-sm text-slate-700">
        <span className="font-semibold">{perception.label}</span>{" "}
        <span className="text-slate-500">({perception.range})</span>
      </p>
    </div>
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
                        PMV ISO sudah dihitung. Lengkapi parameter PMVpesisir (SVF, H/W, VEGfunc, dst) lalu klik Hitung Sekaligus.
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
                      Masukkan parameter dan klik Olah / Hitung
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
                    Catatan: PMV_norm = PMV_pre × (PMV_obs_ref / PMV_model_ref).
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
                  Aplikasi untuk menghitung PMV ISO dan PMVpesisir (model + normalisasi kalibrasi).
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

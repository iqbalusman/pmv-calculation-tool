'use client'

import React from "react"

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceDot } from 'recharts'

export default function ThermalComfortCalculator() {
  // Default contoh dari dokumen
  const DEFAULT_VALUES = {
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

  const [inputs, setInputs] = useState(DEFAULT_VALUES)
  const [results, setResults] = useState<any>(null)
  const [errors, setErrors] = useState<string>('')

  // Helper functions untuk pembulatan sesuai dokumen
  const round3 = (x: number): number => {
    return Number(x.toFixed(3))
  }

  const trunc3 = (x: number): number => {
    if (x >= 0) {
      return Math.floor(x * 1000) / 1000
    } else {
      return Math.ceil(x * 1000) / 1000
    }
  }

  // Fungsi perhitungan PMV_abran
  const calculatePMVAbran = (pmv_iso: number, v: number, svf: number, h_w: number, veg_func: number) => {
    try {
      // Validasi input
      if (isNaN(pmv_iso) || isNaN(v) || isNaN(svf) || isNaN(h_w) || isNaN(veg_func)) {
        throw new Error('Semua input harus berupa angka')
      }

      // Hitung A = H_W + αv*v
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
        total: total,
      }
    } catch (error: any) {
      throw new Error(error.message)
    }
  }

  const handleCalculate = () => {
    try {
      setErrors('')
      const pmv_iso = parseFloat(inputs.pmv_iso.toString())
      const v = parseFloat(inputs.v.toString())
      const svf = parseFloat(inputs.svf.toString())
      const h_w = parseFloat(inputs.h_w.toString())
      const veg_func = parseFloat(inputs.veg_func.toString())

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
        DEFAULT_VALUES.pmv_iso,
        DEFAULT_VALUES.v,
        DEFAULT_VALUES.svf,
        DEFAULT_VALUES.h_w,
        DEFAULT_VALUES.veg_func
      )
      setResults(result)
      setErrors('')
    } catch (error: any) {
      setErrors(error.message)
    }
  }

  const handleInputChange = (key: string, value: string) => {
    setInputs(prev => ({
      ...prev,
      [key]: value === '' ? '' : parseFloat(value),
    }))
  }

  // Generate chart data untuk menampilkan comfort zone
  const generateChartData = () => {
    if (!results) return []
    
    const data = []
    const pmvValue = results.total
    
    // Generate range of PMV values untuk comfort zone
    for (let i = -2; i <= 4; i += 0.2) {
      data.push({
        pmv: round3(i),
        zone: Math.abs(i - pmvValue) < 0.5 ? 20 : null,
      })
    }
    
    return data
  }

  // Initialize dengan default values
  React.useEffect(() => {
    handleReset()
  }, [])

  const chartData = generateChartData()

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">
            Thermal Comfort Calculator
          </h1>
          <p className="text-slate-600">
            PMV-ABRAN Model - Perhitungan Kenyamanan Termal Adaptif
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                    ratio
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
                    ratio
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

              {/* Error Message */}
              {errors && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {errors}
                </div>
              )}

              {/* Buttons */}
              <div className="flex gap-3 pt-4">
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

              {/* Parameter Reference */}
              <div className="mt-8 p-4 bg-slate-50 rounded-lg border border-slate-200">
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
            {results && (
              <>
                {/* Result Summary */}
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
                        {results.total.toFixed(3)}
                      </p>
                    </div>

                    {/* Detailed Calculations */}
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
                            <span className="text-slate-600">
                              Exponent = -k × A
                            </span>
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

                      {/* Term Components */}
                      <div>
                        <p className="text-sm font-semibold text-slate-700 mb-3">
                          Komponen Hasil
                        </p>
                        <div className="space-y-2 text-sm bg-slate-50 p-3 rounded-lg">
                          <div className="flex justify-between">
                            <span className="text-slate-600">α</span>
                            <span className="font-mono font-semibold">
                              {results.terms.alpha}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600">
                              β1 × PMV_iso
                            </span>
                            <span className="font-mono font-semibold">
                              {results.terms.beta1}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600">
                              β2 × exp_factor
                            </span>
                            <span className="font-mono font-semibold">
                              {results.terms.beta2}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600">
                              β3 × (SVF × v)
                            </span>
                            <span className="font-mono font-semibold">
                              {results.terms.beta3}
                            </span>
                          </div>
                          <div className="flex justify-between border-t border-slate-200 pt-2 mt-2">
                            <span className="text-slate-600">
                              β4 × veg_func
                            </span>
                            <span className="font-mono font-semibold">
                              {results.terms.beta4}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Final Result */}
                      <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                        <p className="text-xs text-blue-600 font-semibold uppercase tracking-wide mb-2">
                          Total PMV-ABRAN
                        </p>
                        <p className="text-3xl font-bold text-blue-700">
                          {results.total.toFixed(3)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Distribusi PMV</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="pmv"
                          label={{ value: 'PMV Value', position: 'insideBottom', offset: -5 }}
                        />
                        <YAxis label={{ value: 'Kenyamanan', angle: -90, position: 'insideLeft' }} />
                        <Tooltip />
                        <ReferenceDot
                          x={results.total}
                          y={20}
                          r={8}
                          fill="#ef4444"
                          stroke="#dc2626"
                          strokeWidth={2}
                          label={{ value: `Hasil: ${results.total}`, position: 'top' }}
                        />
                        <Line
                          type="monotone"
                          dataKey="zone"
                          stroke="#10b981"
                          strokeWidth={3}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                    <p className="text-xs text-slate-500 mt-4 text-center">
                      Merah: Posisi hasil perhitungan | Hijau: Zona kenyamanan optimal
                    </p>
                  </CardContent>
                </Card>
              </>
            )}

            {!results && (
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
      </div>
    </main>
  )
}

'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { importInventoryRows } from '@/lib/actions/inventory'
import {
  buildSkippedRowsCsv,
  inventoryTemplateCsv,
  normalizeInventoryCategory,
  parseInventoryCsv,
  type InventoryImportDraftRow,
} from '@/lib/inventory/import'

type Row = InventoryImportDraftRow & {
  errors: string[]
}

function validateRow(row: InventoryImportDraftRow): string[] {
  const errors: string[] = []
  if (!row.name.trim()) errors.push('Name is required')
  if (!normalizeInventoryCategory(row.category)) errors.push('Category must be flowers, decor, or consumables')
  if (!row.unit.trim()) errors.push('Unit is required')
  if (!row.sku.trim()) errors.push('SKU is required')
  if (Number.isNaN(Number(row.cost)) || Number(row.cost) < 0) errors.push('Cost must be a valid non-negative number')
  if (Number.isNaN(Number(row.quantityOnHand)) || Number(row.quantityOnHand) < 0) {
    errors.push('Quantity must be a valid non-negative number')
  }
  return errors
}

function convertRows(rows: InventoryImportDraftRow[]): Row[] {
  return rows.map((row) => ({
    ...row,
    category: normalizeInventoryCategory(row.category) || row.category,
    errors: validateRow(row),
  }))
}

export default function InventoryImportPage() {
  const { addToast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [skippedRows, setSkippedRows] = useState<Array<{ rowNumber: number; reason: string }>>([])

  const hasBlockingErrors = useMemo(() => rows.some((row) => row.errors.length > 0), [rows])

  const downloadTemplate = () => {
    const blob = new Blob([inventoryTemplateCsv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'eventvico-inventory-template.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const downloadSkippedRowsReport = () => {
    const content = buildSkippedRowsCsv(skippedRows)
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'inventory-import-skipped-rows.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const handleFile = async (file: File) => {
    setFileError(null)
    setSkippedRows([])

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setRows([])
      setFileError('Invalid file type. Upload a CSV file based on the template.')
      return
    }

    const content = await file.text()
    const parsed = parseInventoryCsv(content)
    if (parsed.errors.length > 0) {
      setRows([])
      setFileError(parsed.errors[0])
      return
    }

    setRows(convertRows(parsed.rows))
  }

  const updateCell = (rowIndex: number, field: keyof InventoryImportDraftRow, value: string) => {
    setRows((current) => {
      const next = [...current]
      const updated = {
        ...next[rowIndex],
        [field]: value,
      }
      next[rowIndex] = {
        ...updated,
        category: field === 'category' ? normalizeInventoryCategory(value) || value : updated.category,
        errors: validateRow(updated),
      }
      return next
    })
  }

  const confirmImport = async () => {
    if (rows.length === 0) return

    setIsImporting(true)
    const result = await importInventoryRows({
      rows: rows.map((row) => ({
        rowNumber: row.rowNumber,
        name: row.name,
        category: row.category,
        unit: row.unit,
        cost: row.cost,
        quantityOnHand: row.quantityOnHand,
        sku: row.sku,
      })),
    })
    setIsImporting(false)

    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    setSkippedRows(result.data.skippedRows)
    addToast(
      'success',
      `${result.data.importedCount} items imported successfully, ${result.data.skippedCount} rows skipped`
    )
  }

  return (
    <main className="flex-1 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Inventory import</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Upload your completed CSV, review detected rows, and import valid items.
          </p>
        </div>
        <Button type="button" variant="secondary" className="min-h-11" onClick={downloadTemplate}>
          Download template
        </Button>
      </div>

      <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-900">Upload file</h2>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="mt-3 block w-full text-sm text-neutral-700"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            void handleFile(file)
          }}
        />

        {fileError ? (
          <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-3">
            <p className="text-sm text-red-700">{fileError}</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() => {
                fileInputRef.current?.click()
              }}
            >
              Re-upload file
            </Button>
          </div>
        ) : null}
      </section>

      {rows.length > 0 ? (
        <section className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-900">Review rows</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-neutral-600">
                  <th className="border-b border-neutral-200 px-2 py-2">Row</th>
                  <th className="border-b border-neutral-200 px-2 py-2">Name</th>
                  <th className="border-b border-neutral-200 px-2 py-2">Category</th>
                  <th className="border-b border-neutral-200 px-2 py-2">Unit</th>
                  <th className="border-b border-neutral-200 px-2 py-2">Cost</th>
                  <th className="border-b border-neutral-200 px-2 py-2">Quantity</th>
                  <th className="border-b border-neutral-200 px-2 py-2">SKU</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.rowNumber} className={row.errors.length > 0 ? 'bg-red-50' : ''}>
                    <td className="border-b border-neutral-200 px-2 py-2 align-top text-xs text-neutral-600">
                      {row.rowNumber}
                    </td>
                    <td className="border-b border-neutral-200 px-2 py-2">
                      <input
                        value={row.name}
                        onChange={(event) => {
                          updateCell(index, 'name', event.target.value)
                        }}
                        className="h-9 w-40 rounded-md border border-neutral-300 px-2 text-sm"
                      />
                    </td>
                    <td className="border-b border-neutral-200 px-2 py-2">
                      <input
                        value={row.category}
                        onChange={(event) => {
                          updateCell(index, 'category', event.target.value)
                        }}
                        className="h-9 w-36 rounded-md border border-neutral-300 px-2 text-sm"
                      />
                    </td>
                    <td className="border-b border-neutral-200 px-2 py-2">
                      <input
                        value={row.unit}
                        onChange={(event) => {
                          updateCell(index, 'unit', event.target.value)
                        }}
                        className="h-9 w-28 rounded-md border border-neutral-300 px-2 text-sm"
                      />
                    </td>
                    <td className="border-b border-neutral-200 px-2 py-2">
                      <input
                        value={row.cost}
                        onChange={(event) => {
                          updateCell(index, 'cost', event.target.value)
                        }}
                        className="h-9 w-24 rounded-md border border-neutral-300 px-2 text-sm"
                      />
                    </td>
                    <td className="border-b border-neutral-200 px-2 py-2">
                      <input
                        value={row.quantityOnHand}
                        onChange={(event) => {
                          updateCell(index, 'quantityOnHand', event.target.value)
                        }}
                        className="h-9 w-24 rounded-md border border-neutral-300 px-2 text-sm"
                      />
                    </td>
                    <td className="border-b border-neutral-200 px-2 py-2">
                      <input
                        value={row.sku}
                        onChange={(event) => {
                          updateCell(index, 'sku', event.target.value)
                        }}
                        className="h-9 w-28 rounded-md border border-neutral-300 px-2 text-sm"
                      />
                      {row.errors.length > 0 ? (
                        <p className="mt-1 text-xs text-red-700">{row.errors.join(' · ')}</p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => {
                void confirmImport()
              }}
              disabled={isImporting || rows.length === 0}
              className="min-h-11"
            >
              {isImporting ? 'Importing...' : 'Confirm import'}
            </Button>
            {hasBlockingErrors ? (
              <p className="self-center text-xs text-amber-700">
                Rows with errors will be skipped until corrected.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {skippedRows.length > 0 ? (
        <section className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            {skippedRows.length} row(s) were skipped. Download the error report to review details.
          </p>
          <Button type="button" variant="secondary" className="mt-2 min-h-11" onClick={downloadSkippedRowsReport}>
            Download skipped rows report
          </Button>
        </section>
      ) : null}

      <Link
        href="/inventory"
        className="mt-4 inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        Back to inventory
      </Link>
    </main>
  )
}

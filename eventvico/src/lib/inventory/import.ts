import type { InventoryCategory } from '@/lib/schemas/inventory'

export type InventoryImportDraftRow = {
  rowNumber: number
  name: string
  category: string
  unit: string
  cost: string
  quantityOnHand: string
  sku: string
}

export const inventoryTemplateHeaders = ['name', 'category', 'unit', 'cost', 'quantity', 'sku'] as const

export const inventoryTemplateCsv = [
  inventoryTemplateHeaders.join(','),
  'White Rose,flowers,stems,2.50,120,FLR-001',
  'Cylinder Vase,decor,pieces,8.00,24,DEC-010',
  'Floral Tape,consumables,rolls,1.25,40,CON-004',
].join('\n')

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let value = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"' && inQuotes && next === '"') {
      value += '"'
      index += 1
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (char === ',' && !inQuotes) {
      cells.push(value.trim())
      value = ''
      continue
    }
    value += char
  }

  cells.push(value.trim())
  return cells
}

export function normalizeInventoryCategory(value: string): InventoryCategory | '' {
  const normalized = value.trim().toLowerCase()
  if (['flower', 'flowers', 'floral'].includes(normalized)) return 'flowers'
  if (['decor', 'decors', 'decoration', 'decorations'].includes(normalized)) return 'decor'
  if (['consumable', 'consumables', 'supply', 'supplies'].includes(normalized)) return 'consumables'
  return ''
}

export function parseInventoryCsv(content: string): { rows: InventoryImportDraftRow[]; errors: string[] } {
  const trimmed = content.trim()
  if (!trimmed) {
    return {
      rows: [],
      errors: ['The uploaded file is empty.'],
    }
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length < 2) {
    return {
      rows: [],
      errors: ['The file must include a header row and at least one data row.'],
    }
  }

  const header = parseCsvLine(lines[0]).map((item) => item.toLowerCase())
  const headerIndexes = {
    name: header.indexOf('name'),
    category: header.indexOf('category'),
    unit: header.indexOf('unit'),
    cost: header.indexOf('cost'),
    quantity: header.indexOf('quantity'),
    sku: header.indexOf('sku'),
  }

  const hasMissingColumn = Object.values(headerIndexes).some((value) => value < 0)
  if (hasMissingColumn) {
    return {
      rows: [],
      errors: ['Invalid template columns. Expected: name, category, unit, cost, quantity, sku.'],
    }
  }

  const rows: InventoryImportDraftRow[] = []
  for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
    const cells = parseCsvLine(lines[rowIndex])
    rows.push({
      rowNumber: rowIndex + 1,
      name: cells[headerIndexes.name] ?? '',
      category: cells[headerIndexes.category] ?? '',
      unit: cells[headerIndexes.unit] ?? '',
      cost: cells[headerIndexes.cost] ?? '',
      quantityOnHand: cells[headerIndexes.quantity] ?? '',
      sku: cells[headerIndexes.sku] ?? '',
    })
  }

  return {
    rows,
    errors: [],
  }
}

export function buildSkippedRowsCsv(skippedRows: Array<{ rowNumber: number; reason: string }>) {
  const lines = ['row_number,reason']
  skippedRows.forEach((row) => {
    lines.push(`${row.rowNumber},"${row.reason.replace(/"/g, '""')}"`)
  })
  return `${lines.join('\n')}\n`
}

import {
  buildSkippedRowsCsv,
  normalizeInventoryCategory,
  parseInventoryCsv,
} from '@/lib/inventory/import'

describe('inventory import helpers', () => {
  it('parses valid CSV rows with required headers', () => {
    const csv = [
      'name,category,unit,cost,quantity,sku',
      'White Rose,flowers,stems,2.50,120,FLR-001',
    ].join('\n')

    const result = parseInventoryCsv(csv)
    expect(result.errors).toEqual([])
    expect(result.rows.length).toBe(1)
    expect(result.rows[0]).toEqual(
      expect.objectContaining({
        name: 'White Rose',
        category: 'flowers',
        quantityOnHand: '120',
      })
    )
  })

  it('returns an error when CSV headers are invalid', () => {
    const csv = [
      'name,wrong_column,unit,cost,quantity,sku',
      'White Rose,flowers,stems,2.50,120,FLR-001',
    ].join('\n')

    const result = parseInventoryCsv(csv)
    expect(result.rows).toEqual([])
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('normalizes category aliases deterministically', () => {
    expect(normalizeInventoryCategory('floral')).toBe('flowers')
    expect(normalizeInventoryCategory('decorations')).toBe('decor')
    expect(normalizeInventoryCategory('supplies')).toBe('consumables')
    expect(normalizeInventoryCategory('unknown')).toBe('')
  })

  it('builds skipped-row CSV content', () => {
    const csv = buildSkippedRowsCsv([{ rowNumber: 3, reason: 'SKU already exists' }])
    expect(csv).toContain('row_number,reason')
    expect(csv).toContain('3,"SKU already exists"')
  })
})

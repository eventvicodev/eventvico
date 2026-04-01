import { z } from 'zod'

export const inventoryCategories = ['flowers', 'decor', 'consumables'] as const
export type InventoryCategory = typeof inventoryCategories[number]

const baseInventoryItemSchema = z.object({
  name: z.string().trim().min(2, 'Item name is required').max(120, 'Item name must be 120 characters or fewer'),
  category: z.enum(inventoryCategories, { message: 'Choose a valid category' }),
  unit: z.string().trim().min(1, 'Unit is required').max(32, 'Unit must be 32 characters or fewer'),
  cost: z.string().trim().min(1, 'Cost is required'),
  quantityOnHand: z.string().trim().min(1, 'Quantity is required'),
  sku: z.string().trim().min(1, 'SKU is required').max(64, 'SKU must be 64 characters or fewer'),
})

export const createInventoryItemSchema = baseInventoryItemSchema.superRefine((input, ctx) => {
  if (Number.isNaN(Number(input.cost)) || Number(input.cost) < 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cost'],
      message: 'Cost must be a valid non-negative number',
    })
  }

  if (Number.isNaN(Number(input.quantityOnHand)) || Number(input.quantityOnHand) < 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['quantityOnHand'],
      message: 'Quantity must be a valid non-negative number',
    })
  }
})

export const updateInventoryItemSchema = createInventoryItemSchema.extend({
  id: z.string().trim().uuid('Invalid inventory item identifier'),
})

export const deleteInventoryItemSchema = z.object({
  id: z.string().trim().uuid('Invalid inventory item identifier'),
})

export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>
export type UpdateInventoryItemInput = z.infer<typeof updateInventoryItemSchema>

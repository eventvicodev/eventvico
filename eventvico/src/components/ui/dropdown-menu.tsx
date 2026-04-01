'use client'

import * as React from 'react'
import * as RadixDropdown from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight, Circle } from 'lucide-react'

type Surface = 'studio' | 'portal'

const DropdownMenu = RadixDropdown.Root
const DropdownMenuTrigger = RadixDropdown.Trigger
const DropdownMenuGroup = RadixDropdown.Group
const DropdownMenuSub = RadixDropdown.Sub
const DropdownMenuRadioGroup = RadixDropdown.RadioGroup

const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof RadixDropdown.Content>,
  React.ComponentPropsWithoutRef<typeof RadixDropdown.Content> & { surface?: Surface }
>(({ className, sideOffset = 4, surface = 'studio', ...props }, ref) => (
  <RadixDropdown.Portal>
    <RadixDropdown.Content
      ref={ref}
      sideOffset={sideOffset}
      data-surface={surface}
      className={`z-50 min-w-[10rem] overflow-hidden rounded-lg border border-neutral-200 bg-white p-1 shadow-md ${className ?? ''}`}
      {...props}
    />
  </RadixDropdown.Portal>
))
DropdownMenuContent.displayName = RadixDropdown.Content.displayName

const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof RadixDropdown.Item>,
  React.ComponentPropsWithoutRef<typeof RadixDropdown.Item> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <RadixDropdown.Item
    ref={ref}
    className={`relative flex cursor-default select-none items-center rounded-md px-2 py-1.5 text-sm text-neutral-700 outline-none transition-colors focus:bg-neutral-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ${inset ? 'pl-8' : ''} ${className ?? ''}`}
    {...props}
  />
))
DropdownMenuItem.displayName = RadixDropdown.Item.displayName

const DropdownMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof RadixDropdown.Separator>,
  React.ComponentPropsWithoutRef<typeof RadixDropdown.Separator>
>(({ className, ...props }, ref) => (
  <RadixDropdown.Separator
    ref={ref}
    className={`-mx-1 my-1 h-px bg-neutral-200 ${className ?? ''}`}
    {...props}
  />
))
DropdownMenuSeparator.displayName = RadixDropdown.Separator.displayName

const DropdownMenuLabel = React.forwardRef<
  React.ComponentRef<typeof RadixDropdown.Label>,
  React.ComponentPropsWithoutRef<typeof RadixDropdown.Label> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <RadixDropdown.Label
    ref={ref}
    className={`px-2 py-1.5 text-xs font-medium text-neutral-500 ${inset ? 'pl-8' : ''} ${className ?? ''}`}
    {...props}
  />
))
DropdownMenuLabel.displayName = RadixDropdown.Label.displayName

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ComponentRef<typeof RadixDropdown.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof RadixDropdown.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <RadixDropdown.CheckboxItem
    ref={ref}
    checked={checked}
    className={`relative flex cursor-default select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm text-neutral-700 outline-none focus:bg-neutral-100 data-[disabled]:opacity-50 ${className ?? ''}`}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <RadixDropdown.ItemIndicator>
        <Check className="h-4 w-4 text-brand-500" />
      </RadixDropdown.ItemIndicator>
    </span>
    {children}
  </RadixDropdown.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName = RadixDropdown.CheckboxItem.displayName

const DropdownMenuRadioItem = React.forwardRef<
  React.ComponentRef<typeof RadixDropdown.RadioItem>,
  React.ComponentPropsWithoutRef<typeof RadixDropdown.RadioItem>
>(({ className, children, ...props }, ref) => (
  <RadixDropdown.RadioItem
    ref={ref}
    className={`relative flex cursor-default select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm text-neutral-700 outline-none focus:bg-neutral-100 data-[disabled]:opacity-50 ${className ?? ''}`}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <RadixDropdown.ItemIndicator>
        <Circle className="h-2 w-2 fill-brand-500" />
      </RadixDropdown.ItemIndicator>
    </span>
    {children}
  </RadixDropdown.RadioItem>
))
DropdownMenuRadioItem.displayName = RadixDropdown.RadioItem.displayName

const DropdownMenuSubTrigger = React.forwardRef<
  React.ComponentRef<typeof RadixDropdown.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof RadixDropdown.SubTrigger> & { inset?: boolean }
>(({ className, inset, children, ...props }, ref) => (
  <RadixDropdown.SubTrigger
    ref={ref}
    className={`flex cursor-default select-none items-center rounded-md px-2 py-1.5 text-sm text-neutral-700 outline-none focus:bg-neutral-100 ${inset ? 'pl-8' : ''} ${className ?? ''}`}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4 text-neutral-400" />
  </RadixDropdown.SubTrigger>
))
DropdownMenuSubTrigger.displayName = RadixDropdown.SubTrigger.displayName

const DropdownMenuSubContent = React.forwardRef<
  React.ComponentRef<typeof RadixDropdown.SubContent>,
  React.ComponentPropsWithoutRef<typeof RadixDropdown.SubContent>
>(({ className, ...props }, ref) => (
  <RadixDropdown.SubContent
    ref={ref}
    className={`z-50 min-w-[8rem] overflow-hidden rounded-lg border border-neutral-200 bg-white p-1 shadow-md ${className ?? ''}`}
    {...props}
  />
))
DropdownMenuSubContent.displayName = RadixDropdown.SubContent.displayName

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
